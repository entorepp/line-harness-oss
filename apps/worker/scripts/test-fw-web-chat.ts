import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { fwWebChat } from '../src/routes/fw-web-chat.js';
import { authMiddleware } from '../src/middleware/auth.js';
import { dispatchOutboundMessage, getMessagingFriendContext } from '../src/services/outbound-messages.js';

const sql = new DatabaseSync(':memory:');
sql.exec(readFileSync('../../packages/db/schema.sql', 'utf8'));
const db = { prepare(query: string) { const stmt = sql.prepare(query); let values: any[] = []; return {
  bind(...v: any[]) { values = v; return this; },
  async first() { return stmt.get(...values) || null; },
  async all() { return { results: stmt.all(...values) }; },
  async run() { return { meta: { changes: Number(stmt.run(...values).changes) } }; },
}; } };
sql.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,channel_type,locale,default_slack_channel)
  VALUES('wa','phone','Flat Travel WA','token','secret','whatsapp','en','C_WHATSAPP');`);

const token = 'x'.repeat(40);
const env = { DB: db, API_KEY: 'staff-key', FLATWORKER_TRAVEL_QUOTE_TOKEN: token, FLATWORKER_API_BASE_URL: 'https://fw.example.test/',
  SLACK_BOT_TOKEN: 'xoxb-test' } as any;
const app = new Hono(); app.use('*', authMiddleware as any); app.route('/', fwWebChat);
const PATH = '/api/integrations/fw-web-chat/messages';
const call = (body: any, auth: string | null = token) => app.fetch(new Request('https://harness.example.test' + PATH, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth === null ? {} : { Authorization: 'Bearer ' + auth }) },
  body: JSON.stringify(body) }), env);

const ref = 'ref_' + 'a'.repeat(28);
const question = { ref, caseId: 'case-1', displayName: 'Alex Example', quotePageUrl: 'https://go.flat-travel.com/api/integrations/quote-email/view?token=t',
  staffName: 'Lisa', text: 'Is the hotel step-free?', clientMessageId: 'msg-1', sentAt: '2026-11-24T01:00:00Z' };

const realFetch = globalThis.fetch;
let slackPosts: any[] = []; let fwPosts: any[] = []; let fwReply: () => Response = () => Response.json({ ok: true, messageId: 'fw-1' });
globalThis.fetch = (async (url: any, init?: RequestInit) => {
  const u = String(url);
  if (u.startsWith('https://slack.com/api/')) { if (u.includes('chat.postMessage')) slackPosts.push(JSON.parse(String(init?.body || '{}'))); return Response.json({ ok: true, ts: '1.0' }); }
  if (u === 'https://fw.example.test/api/integrations/web-chat/staff-reply') { fwPosts.push({ headers: init?.headers, body: JSON.parse(String(init?.body || '{}')) }); return fwReply(); }
  throw new Error('unexpected fetch ' + u);
}) as typeof fetch;
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

try {
  // FW's bearer only: no header, the staff key, and a wrong token are refused before anything is stored.
  assert.equal((await call(question, null)).status, 401);
  assert.equal((await call(question, 'staff-key')).status, 401);
  assert.equal((await call(question, 'y'.repeat(40))).status, 401);

  // No active 'web' account yet: refused, nothing stored.
  assert.equal((await call(question)).status, 503);
  assert.equal((sql.prepare('SELECT COUNT(*) n FROM friends').get() as any).n, 0);

  // The account row the release adds by hand: same Slack channel and locale as the WhatsApp account.
  sql.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,channel_type,locale,default_slack_channel)
    SELECT 'web-quote-page','flatworker-quote-page','Flat Travel 見積ページ','not-used','not-used','web',locale,default_slack_channel FROM line_accounts WHERE id='wa';`);

  assert.equal((await call({ ...question, text: '' })).status, 400);
  assert.equal((await call({ ...question, text: 'x'.repeat(2001) })).status, 400);
  assert.equal((await call({ ...question, quotePageUrl: 'http://go.flat-travel.com/x' })).status, 400);
  assert.equal((await call({ ...question, ref: 'short' })).status, 400);
  assert.equal(slackPosts.length, 0);

  const first = await call(question); const result = await first.json() as any;
  assert.equal(first.status, 200, JSON.stringify(result));
  assert.equal(result.ok, true); assert.ok(result.friendId); assert.ok(result.messageId);
  await settle();
  assert.equal(slackPosts.length, 1, 'a question is announced to Slack once');
  assert.equal(slackPosts[0].channel, 'C_WHATSAPP', 'the same channel as WhatsApp');
  const friend = sql.prepare('SELECT * FROM friends WHERE id=?').get(result.friendId) as any;
  assert.equal(friend.line_user_id, 'web:' + ref); assert.equal(friend.display_name, 'Alex Example');
  assert.deepEqual(JSON.parse(friend.metadata), { provider: 'web', caseId: 'case-1', quotePageUrl: question.quotePageUrl, staffName: 'Lisa' });
  assert.equal((sql.prepare("SELECT status FROM chats WHERE friend_id=?").get(result.friendId) as any).status, 'unread');

  // The same clientMessageId again (FW retried): one stored message, no second Slack notice.
  const again = await (await call(question)).json() as any;
  await settle();
  assert.equal(again.duplicate, true); assert.equal(again.messageId, result.messageId); assert.equal(again.friendId, result.friendId);
  assert.equal(slackPosts.length, 1);
  assert.equal((sql.prepare("SELECT COUNT(*) n FROM messages_log WHERE friend_id=? AND direction='incoming'").get(result.friendId) as any).n, 1);

  // A new question in the same conversation: same friend, a second notice.
  const next = await (await call({ ...question, clientMessageId: 'msg-2', text: 'And the airport transfer?' })).json() as any;
  await settle();
  assert.equal(next.friendId, result.friendId); assert.notEqual(next.messageId, result.messageId); assert.equal(slackPosts.length, 2);

  // Staff reply from the Harness inbox goes to FW with FW's token header, and FW's messageId is the provider ID.
  const ctx = await getMessagingFriendContext(db as any, result.friendId);
  assert.equal(ctx?.channel_type, 'web');
  const sent = await dispatchOutboundMessage({ env, friend: ctx!, input: { messageType: 'text', content: 'Yes, it is step-free.' }, messageLogId: 'log-1' });
  assert.equal(sent.providerMessageId, 'fw-1'); assert.equal(sent.storedContent, 'Yes, it is step-free.');
  assert.equal(fwPosts.length, 1);
  assert.equal((fwPosts[0].headers as any)['X-Flat-Travel-Quote-Token'], token);
  assert.deepEqual({ ...fwPosts[0].body, sentAt: undefined }, { ref, text: 'Yes, it is step-free.', harnessMessageId: 'log-1', sentAt: undefined, staffName: 'Lisa' });

  // FW refusing, answering without a messageId, or not answering: the send fails.
  for (const reply of [() => new Response('no', { status: 500 }), () => Response.json({ ok: false }), () => Response.json({ ok: true })]) {
    fwReply = reply;
    await assert.rejects(dispatchOutboundMessage({ env, friend: ctx!, input: { messageType: 'text', content: 'Hi' }, messageLogId: 'log-x' }));
  }
  fwReply = () => { throw new Error('network'); };
  await assert.rejects(dispatchOutboundMessage({ env, friend: ctx!, input: { messageType: 'text', content: 'Hi' }, messageLogId: 'log-y' }));

  // Text only: images and templates are refused before FW is called.
  const before = fwPosts.length;
  await assert.rejects(dispatchOutboundMessage({ env, friend: ctx!, input: { messageType: 'image', content: JSON.stringify({ url: 'https://x.test/a.jpg' }) } }));
  await assert.rejects(dispatchOutboundMessage({ env, friend: ctx!, input: { messageType: 'template', content: '{}' } }));
  assert.equal(fwPosts.length, before, 'non-text sends never reach FW');
  assert.equal(before, 5, 'the reply and the four failed text sends reached FW');

  // A conversation reference already used by another channel's account is never taken over.
  sql.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,channel_type) VALUES('other','other','Other','t','s','line');
    INSERT INTO friends(id,line_user_id,display_name,line_account_id,is_following) VALUES('taken','web:ref_${'b'.repeat(28)}','Someone','other',1);`);
  assert.equal((await call({ ...question, ref: 'ref_' + 'b'.repeat(28), clientMessageId: 'msg-9' })).status, 409);

  console.log('PASS: FW web chat questions reach the web inbox once and staff replies go back to FW');
} finally {
  globalThis.fetch = realFetch;
}
