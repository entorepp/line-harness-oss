import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { authMiddleware } from '../src/middleware/auth.js';
import { chats } from '../src/routes/chats.js';
import { friends } from '../src/routes/friends.js';
import { processScheduledMessages } from '../src/services/scheduled-messages.js';
import { getWhatsappReplyWindow } from '../src/services/whatsapp-reply-window.js';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync('../../packages/db/schema.sql', 'utf8'));
sqlite.exec(`
  INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret,channel_type)
  VALUES ('wa-test','test-phone-id','Test','test-token','','whatsapp');
  INSERT INTO friends (id,line_user_id,display_name,line_account_id)
  VALUES ('test-friend','15555550100','Test','wa-test');
  INSERT INTO chats (id,friend_id) VALUES ('test-chat','test-friend');
`);
const db = { prepare(sql: string) {
  const statement = sqlite.prepare(sql); let bindings: any[] = [];
  return {
    bind(...values: any[]) { bindings = values; return this; },
    async first() { return statement.get(...bindings) ?? null; },
    async all() { return { results: statement.all(...bindings), success: true }; },
    async run() { return { success: true, meta: { changes: Number(statement.run(...bindings).changes) } }; },
  };
} };
const env = { DB: db, API_KEY: 'test-api-key' } as any;
const app = new Hono(); app.use('*', authMiddleware as any); app.route('/', chats); app.route('/', friends);
const originalFetch = globalThis.fetch;
let providerCalls = 0;
globalThis.fetch = (async (input: any) => {
  assert.equal(String(input),'https://graph.facebook.com/v25.0/test-phone-id/messages');
  providerCalls++;
  return Response.json({messages:[{id:`wamid.test-${providerCalls}`}]});
}) as typeof fetch;
function incoming(at: string) {
  sqlite.prepare(`INSERT OR REPLACE INTO messages_log (id,friend_id,direction,message_type,content,created_at)
    VALUES ('customer-reply','test-friend','incoming','text','Test only',?)`).run(at);
}
function count(table: string) { return Number(sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get()?.n); }
function request(path: string, body?: any, method = body ? 'POST' : 'GET') {
  return app.fetch(new Request('https://test.invalid'+path,{method,
    headers:{Authorization:'Bearer test-api-key','Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{}),
  }),env);
}
const HOUR=3600000;
try {
  assert.equal((await getWhatsappReplyWindow(db as any,'test-friend')).canSend,false,'missing inbound fails closed');
  const now=Date.parse('2026-09-17T12:00:00+09:00');
  incoming('2026-09-16T12:00:00+09:00');
  assert.equal((await getWhatsappReplyWindow(db as any,'test-friend',now)).canSend,false,'exact 24-hour boundary is closed');
  incoming('2026-09-16 12:00:01');
  sqlite.prepare(`INSERT INTO messages_log (id,friend_id,direction,message_type,content,created_at)
    VALUES ('older-utc','test-friend','incoming','text','Test only','2026-09-16T02:30:00Z')`).run();
  assert.equal((await getWhatsappReplyWindow(db as any,'test-friend',now)).canSend,true,'legacy timestamps are JST');
  sqlite.prepare("DELETE FROM messages_log WHERE id='older-utc'").run();
  incoming('2026-09-16T03:00:01Z');
  assert.equal((await getWhatsappReplyWindow(db as any,'test-friend',now)).canSend,true,'UTC is normalized');
  incoming('2026-09-17T12:00:01+09:00');
  assert.equal((await getWhatsappReplyWindow(db as any,'test-friend',now)).canSend,false,'future inbound does not grant a window');
  incoming('not-a-date');
  assert.equal((await getWhatsappReplyWindow(db as any,'test-friend',now)).canSend,false,'invalid timestamps fail closed');
  incoming(new Date(Date.now()-26*HOUR).toISOString());
  sqlite.prepare(`INSERT INTO messages_log (id,friend_id,direction,message_type,content,created_at)
    VALUES ('staff-reply','test-friend','outgoing','text','Test only',?)`).run(new Date().toISOString());
  const beforeLogs=count('messages_log');
  for(const path of ['/api/chats/test-chat/send','/api/friends/test-friend/messages']) {
    for(const extra of [{},{scheduledAt:new Date(Date.now()+HOUR).toISOString()}]) {
      const response=await request(path,{content:'Expired reply',...extra});
      assert.equal(response.status,409);
      assert.equal((await response.json() as any).code,'WHATSAPP_REPLY_WINDOW_CLOSED');
    }
  }
  assert.equal(providerCalls,0,'expired replies never contact Meta');
  assert.equal(count('messages_log'),beforeLogs,'expired replies are not logged as sent');
  assert.equal(count('scheduled_messages'),0,'expired replies are not queued');
  const detail:any=await (await request('/api/chats/test-chat')).json();
  assert.equal(detail.data.whatsappReplyWindow.canSend,false);
  assert.equal(detail.data.whatsappReplyWindow.friendId,'test-friend');
  const history:any=await (await request('/api/friends/test-friend/messages')).json();
  assert.equal(history.whatsappReplyWindow.canSend,false);
  incoming(new Date(Date.now()-HOUR).toISOString());
  for(const path of ['/api/chats/test-chat/send','/api/friends/test-friend/messages']) {
    assert.ok((await request(path,{content:'Within window'})).ok);
    assert.equal((await request(path,{content:'Beyond window',scheduledAt:new Date(Date.now()+24*HOUR).toISOString()})).status,409);
  }
  assert.equal(providerCalls,2,'fresh customer reply permits both send routes');
  assert.equal(count('whatsapp_delivery_receipts'),2,'accepted sends retain provider receipts');
  const queued:any=await (await request('/api/chats/test-chat/send',{
    content:'Scheduled while open',scheduledAt:new Date(Date.now()+60000).toISOString(),
  })).json();
  assert.equal(queued.success,true);
  const id=queued.data.scheduledMessage.id;
  assert.equal((await request('/api/scheduled-messages/'+id,{scheduledAt:new Date(Date.now()+24*HOUR).toISOString()},'PUT')).status,409);
  incoming(new Date(Date.now()-26*HOUR).toISOString());
  sqlite.prepare('UPDATE scheduled_messages SET scheduled_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),id);
  await processScheduledMessages(env);
  const failed:any=sqlite.prepare('SELECT status,last_error FROM scheduled_messages WHERE id=?').get(id);
  assert.equal(failed.status,'failed');
  assert.match(failed.last_error,/24時間返信枠外/);
  await processScheduledMessages(env);
  assert.equal(providerCalls,2,'dispatch rechecks expiry and does not retry');
  console.log('PASS: WhatsApp 24-hour boundary, JST/UTC, unknown/future inbound, both send/read routes, no false sent/queue, new customer reply, receipt tracking, schedule edit and cron expiry');
} finally { globalThis.fetch=originalFetch; sqlite.close(); }
