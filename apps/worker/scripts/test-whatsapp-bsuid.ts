import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { authMiddleware } from '../src/middleware/auth.js';
import { chats } from '../src/routes/chats.js';
import { friends } from '../src/routes/friends.js';
import { waWebhook } from '../src/routes/wa-webhook.js';
import { processScheduledMessages } from '../src/services/scheduled-messages.js';

// Real signed webhook, staff routes and SQL; every network request is mocked.
const sql = new DatabaseSync(':memory:');
sql.exec(readFileSync('../../packages/db/schema.sql', 'utf8'));
sql.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,channel_type)
  VALUES ('wa','test-phone-id','Test','token','app-secret','whatsapp'),
  ('other','other-phone-id','Other','token','app-secret','whatsapp');`);
const db = { prepare(query: string) {
  const stmt = sql.prepare(query); let values: any[] = [];
  return { bind(...args: any[]) { values = args; return this; },
    async first<T>() { return (stmt.get(...values) || null) as T | null; },
    async all<T>() { return { results: stmt.all(...values) as T[], success: true }; },
    async run() { return { success: true, meta: { changes: Number(stmt.run(...values).changes) } }; } };
} };
const env = { DB: db, API_KEY: 'test-key' } as any;
const app = new Hono(); app.use('*', authMiddleware as any); app.route('/', chats); app.route('/', friends); app.route('/', waWebhook);
const jobs: Promise<unknown>[] = [];
const context = { waitUntil(job: Promise<unknown>) { jobs.push(job); }, passThroughOnException() {} };
const stamp = () => String(Math.floor(Date.now() / 1000));
const count = (table: string) => Number((sql.prepare(`SELECT count(*) n FROM ${table}`).get() as any).n);
const friend = (external: string, account = 'wa') => sql.prepare("SELECT * FROM friends WHERE (line_user_id=? OR json_extract(metadata,'$.whatsappRecipient.userId')=?) AND line_account_id=?").get(external, external, account) as any;
const calls: any[] = []; let providerStatus = 200; let providerError: any = {}; let networkFailure = false; let missingReceipt = false;
const realFetch = globalThis.fetch; const realError = console.error; const errors: unknown[] = [];
console.error = (...args: unknown[]) => { errors.push(args); };
globalThis.fetch = (async (url: any, init?: RequestInit) => {
  assert.match(String(url), /^https:\/\/graph\.facebook\.com\/v25\.0\/(?:test|other)-phone-id\/messages$/);
  assert.equal(init?.method, 'POST'); calls.push(JSON.parse(String(init?.body)));
  if (networkFailure) throw new Error('PRIVATE-NETWORK-DETAIL');
  return new Response(JSON.stringify(providerStatus === 200 ? (missingReceipt ? {} : { messages: [{ id: `wamid.sent-${calls.length}` }] }) : { error: providerError }), { status: providerStatus });
}) as typeof fetch;
let seq = 0;
async function incoming(contact: any, message: any = {}, signature = true, phone = 'test-phone-id', extraContacts: any[] = []) {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'test-waba', changes: [{ field: 'messages', value: {
    metadata: { phone_number_id: phone }, contacts: [...extraContacts, contact],
    messages: [{ id: `wamid.in-${++seq}`, type: 'text', timestamp: stamp(), text: { body: `Customer test ${seq}` }, ...message }],
  } }] }] });
  const digest = createHmac('sha256', 'app-secret').update(body).digest('hex');
  const res = await app.fetch(new Request('https://test.invalid/webhook/whatsapp', { method: 'POST', body,
    headers: { 'X-Hub-Signature-256': signature ? `sha256=${digest}` : 'sha256=invalid' } }), env, context);
  await Promise.all(jobs.splice(0));
  return res;
}
function send(friendId: string, body: any, chat = false) {
  const chatId = (sql.prepare('SELECT id FROM chats WHERE friend_id=?').get(friendId) as any)?.id;
  return app.fetch(new Request('https://test.invalid' + (chat ? `/api/chats/${chatId}/send` : `/api/friends/${friendId}/messages`), {
    method: 'POST', headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), env, context);
}

try {
  assert.equal((await incoming({ user_id: 'US.Private1', profile: { username: 'private_user' } }, { from_user_id: 'US.Private1' }, false)).status, 401);
  assert.equal(count('friends'), 0, 'unsigned events cannot register a recipient');
  assert.equal((await incoming({ wa_id: '', user_id: 'US.Private1', profile: { name: 'Test', username: 'private_user' } }, { from: '', from_user_id: 'US.Private1' })).status, 200);
  const privateFriend = friend('US.Private1'); assert.ok(privateFriend);
  assert.equal(JSON.parse(privateFriend.metadata).whatsappRecipient.userId, 'US.Private1');
  assert.equal(calls.length, 0, 'BSUID intake does not activate an automatic sender');
  for (const chat of [false, true]) {
    for (const payload of [{ content: 'Test reply' }, { messageType: 'file', content: 'https://test.invalid/quote.pdf', fileName: 'quote.pdf' }]) {
      assert.equal((await send(privateFriend.id, payload, chat)).status, 200);
      assert.equal(calls.at(-1).recipient, 'US.Private1'); assert.equal(calls.at(-1).to, undefined);
    }
  }
  assert.equal(calls.at(-1).type, 'document');
  for (const chat of [false, true]) {
    const res = await send(privateFriend.id, { content: 'Held reply', scheduledAt: new Date(Date.now() + 30_000).toISOString(), deliveryMode: 'undo_hold', undoGroupId: 'test' }, chat);
    assert.equal(res.status, 201);
  }
  const beforeQueueCalls = calls.length;
  await processScheduledMessages(env); assert.equal(calls.length, beforeQueueCalls, 'undo hold has no provider side effect');
  sql.exec("UPDATE scheduled_messages SET scheduled_at='2000-01-01T00:00:00Z'");
  await processScheduledMessages(env); assert.equal(calls.length, beforeQueueCalls + 2);
  assert.ok(calls.slice(-2).every((x) => x.recipient === 'US.Private1' && !x.to));
  await incoming({ parent_user_id: 'US.ENT.Parent1' }, { from_parent_user_id: 'US.ENT.Parent1' });
  const parent = sql.prepare("SELECT id FROM friends WHERE line_user_id='whatsapp:wa:US.ENT.Parent1'").get() as any;
  assert.equal((await send(parent.id, { content: 'Parent ID reply' })).status, 200);
  assert.equal(calls.at(-1).recipient, 'US.ENT.Parent1');
  await incoming({}, { from_user_id: 'GB.NoContact1' });
  assert.ok(friend('GB.NoContact1'), 'message-level ID works without a contacts block');

  sql.exec(`INSERT INTO friends(id,line_user_id,display_name,line_account_id,metadata) VALUES ('existing','15555550100','Existing','wa','{"unrelated":"keep"}')`);
  await incoming({ wa_id: '15555550100', user_id: 'US.Existing1', profile: { username: 'existing_user' } }, { from: '15555550100', from_user_id: 'US.Existing1' });
  const same = friend('15555550100'); assert.equal(same.id, 'existing');
  assert.equal(JSON.parse(same.metadata).unrelated, 'keep');
  const beforePrivate = count('friends');
  await incoming({ user_id: 'US.Existing1', profile: { username: 'changed_name' } }, { from_user_id: 'US.Existing1' });
  assert.equal(count('friends'), beforePrivate, 'hidden phone does not split a verified existing conversation');
  assert.equal((await send('existing', { content: 'Same conversation' })).status, 200);
  assert.equal(calls.at(-1).recipient, 'US.Existing1');
  await incoming({ user_id: 'US.Private1' }, { from_user_id: 'US.Private1' }, true, 'other-phone-id');
  assert.notEqual(friend('US.Private1', 'other').id, privateFriend.id, 'identities stay inside their account');

  // Display names and usernames alone must never join two customer histories.
  sql.exec(`INSERT INTO friends(id,line_user_id,display_name,line_account_id) VALUES ('legacy','private_user','Legacy','wa')`);
  await incoming({ user_id: 'US.Different1', profile: { username: 'private_user' } }, { from_user_id: 'US.Different1' });
  assert.notEqual(friend('US.Different1').id, 'legacy');
  sql.prepare("INSERT INTO messages_log(id,friend_id,direction,message_type,content,created_at) VALUES ('legacy-in','legacy','incoming','text','test',?)").run(new Date().toISOString());
  for (const chat of [false, true]) {
    if (chat) sql.exec("INSERT INTO chats(id,friend_id) VALUES ('legacy-chat','legacy')");
    for (const extra of [{}, { scheduledAt: new Date(Date.now() + 30_000).toISOString() }]) {
      const before = calls.length; const queued = count('scheduled_messages');
      const res = await send('legacy', { content: 'Invalid username target', ...extra }, chat);
      assert.equal(res.status, 409); assert.equal((await res.json() as any).code, 'WHATSAPP_RECIPIENT_UNAVAILABLE');
      assert.equal(calls.length, before); assert.equal(count('scheduled_messages'), queued);
    }
  }
  const beforeMalformed = count('friends');
  await incoming({ user_id: 'not-a-bsuid', profile: { username: 'invalid' } });
  assert.equal(count('friends'), beforeMalformed, 'malformed ID cannot become a send address');
  await incoming({ user_id: 'US.Second1' }, { from_user_id: 'US.Second1' }, true, 'test-phone-id', [{ user_id: 'US.Wrong1', profile: { username: 'wrong' } }]);
  assert.ok(friend('US.Second1')); assert.equal(friend('US.Wrong1'), undefined);
  await incoming({ wa_id: '15555550104', user_id: 'US.Wrong2' }, { from: '15555550105', from_user_id: 'US.Right1' });
  assert.equal(JSON.parse(friend('15555550105').metadata).whatsappRecipient.userId, 'US.Right1');
  assert.equal(friend('US.Wrong2'), undefined, 'a mismatched contact cannot supply an address');
  const oldMetadata = privateFriend.metadata;
  sql.prepare('UPDATE friends SET metadata=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(oldMetadata), whatsappRecipient: { ...JSON.parse(oldMetadata).whatsappRecipient, accountId: 'other' } }), privateFriend.id);
  assert.equal((await send(privateFriend.id, { content: 'Wrong-scope metadata' })).status, 409);
  sql.prepare('UPDATE friends SET metadata=? WHERE id=?').run(oldMetadata, privateFriend.id);

  providerStatus = 400; providerError = { code: 100, error_subcode: 123, message: 'PRIVATE-RECIPIENT-SECRET', error_data: { details: 'PRIVATE-URL-SECRET' } };
  for (const chat of [false, true]) {
    const res = await send(privateFriend.id, { content: 'Rejected test' }, chat); const body: any = await res.json();
    assert.equal(res.status, 422); assert.equal(body.providerCode, '100'); assert.equal(body.providerSubcode, '123');
    assert.equal(body.code, 'WHATSAPP_PROVIDER_REJECTED'); assert.match(body.error, /100/); assert.ok(!JSON.stringify(body).includes('PRIVATE-'));
  }
  providerStatus = 200; networkFailure = true;
  const beforeUnknown = calls.length;
  const unknown = await send(privateFriend.id, { content: 'Unknown outcome' });
  assert.equal(unknown.status, 502); assert.equal((await unknown.json() as any).code, 'WHATSAPP_SEND_OUTCOME_UNKNOWN');
  assert.equal(calls.length, beforeUnknown + 1, 'unknown outcomes never retry automatically'); networkFailure = false;
  providerStatus = 503;
  const serverFailure = await send(privateFriend.id, { content: 'Provider 5xx' });
  assert.equal(serverFailure.status, 502); assert.equal((await serverFailure.json() as any).code, 'WHATSAPP_SEND_OUTCOME_UNKNOWN');
  providerStatus = 200;
  missingReceipt = true;
  const missing = await send(privateFriend.id, { content: 'Missing receipt' });
  assert.equal(missing.status, 502); assert.equal((await missing.json() as any).code, 'WHATSAPP_SEND_OUTCOME_UNKNOWN');
  assert.ok(!JSON.stringify(errors).includes('PRIVATE-'), 'logs contain bounded codes, never raw provider data');
  console.log('PASS: signed BSUID intake, private-phone continuity, account isolation, text/PDF, both staff/undo routes, invalid-recipient guards, safe errors and unknown-outcome stop');
} finally { globalThis.fetch = realFetch; console.error = realError; sql.close(); }
