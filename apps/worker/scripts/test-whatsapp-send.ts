import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { chats } from '../src/routes/chats.js';
import { friends } from '../src/routes/friends.js';
import { authMiddleware } from '../src/middleware/auth.js';
import { processScheduledMessages } from '../src/services/scheduled-messages.js';

// Exercise the real routes, SQL, claim and provider payload with an in-memory
// database and a closed network mock. No production recipient or API is used.
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync('../../packages/db/schema.sql', 'utf8'));
sqlite.exec(`
  INSERT INTO line_accounts
    (id, channel_id, name, channel_access_token, channel_secret, channel_type)
    VALUES ('wa-test', 'test-phone-id', 'Test WhatsApp', 'test-token', '', 'whatsapp');
  INSERT INTO friends (id, line_user_id, display_name, line_account_id)
    VALUES ('test-friend', '15555550100', 'Test only', 'wa-test');
  INSERT INTO chats (id, friend_id) VALUES ('test-chat', 'test-friend');
`);

const db = {
  prepare(sql: string) {
    const statement = sqlite.prepare(sql);
    let bindings: any[] = [];
    return {
      bind(...values: any[]) { bindings = values; return this; },
      async first() { return statement.get(...bindings) ?? null; },
      async all() { return { results: statement.all(...bindings), success: true }; },
      async run() {
        const result = statement.run(...bindings);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
  },
};
const env = { DB: db, API_KEY: 'test-api-key' } as any;
const app = new Hono();
app.use('*', authMiddleware as any);
app.route('/', chats);
app.route('/', friends);

const providerCalls: Record<string, any>[] = [];
let providerStatus = 200;
let releaseProvider: (() => void) | null = null;
let providerStarted: (() => void) | null = null;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  assert.equal(String(input), 'https://graph.facebook.com/v25.0/test-phone-id/messages');
  assert.equal(init?.method, 'POST');
  const payload = JSON.parse(String(init?.body));
  assert.equal(payload.messaging_product, 'whatsapp');
  assert.equal(payload.to, '15555550100');
  providerCalls.push(payload);
  if (providerStarted) {
    const started = providerStarted;
    providerStarted = null;
    await new Promise<void>((resolve) => { releaseProvider = resolve; started(); });
  }
  return new Response(JSON.stringify(providerStatus === 200
    ? { messages: [{ id: 'mock-provider-id' }] }
    : { error: { message: 'Mock provider rejection' } }), {
    status: providerStatus, headers: { 'content-type': 'application/json' },
  });
}) as typeof fetch;

async function request(path: string, body?: any, method = 'POST', authenticated = true) {
  return app.fetch(new Request('https://test.invalid' + path, {
    method,
    headers: {
      ...(authenticated ? { Authorization: 'Bearer test-api-key' } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env);
}
async function schedule(input: Record<string, any> = {}, direct = false) {
  const response = await request(direct ? '/api/friends/test-friend/messages' : '/api/chats/test-chat/send', {
    messageType: 'text', content: 'Test only',
    scheduledAt: new Date(Date.now() + 30_000).toISOString(),
    deliveryMode: 'undo_hold', undoGroupId: 'test-undo-group', ...input,
  });
  assert.equal(response.status, 201);
  const body: any = await response.json();
  assert.equal(body.success, true);
  return body.data.scheduledMessage;
}
function row(id: string): any {
  return sqlite.prepare('SELECT * FROM scheduled_messages WHERE id = ?').get(id);
}
function due(id: string) {
  sqlite.prepare('UPDATE scheduled_messages SET scheduled_at = ? WHERE id = ?')
    .run(new Date(Date.now() - 1000).toISOString(), id);
}
function sendNow(id: string) {
  return request('/api/scheduled-messages/' + id + '/send-now');
}
function cancel(id: string) {
  return request('/api/scheduled-messages/' + id, undefined, 'DELETE');
}

try {
  // The exact text + PDF composer contract keeps both messages in the same
  // undo group and does not contact Meta before the hold expires.
  const text = await schedule();
  const pdf = await schedule({ messageType: 'file', content: 'https://example.com/quote.pdf', fileName: 'quote.pdf', fileSize: '4.1MB', fileIcon: 'PDF' });
  for (const item of [text, pdf]) {
    const metadata = JSON.parse(item.metadata);
    assert.equal(metadata.deliveryMode, 'undo_hold');
    assert.equal(metadata.undoGroupId, 'test-undo-group');
  }
  assert.equal(JSON.parse(pdf.metadata).fileName, 'quote.pdf');
  assert.equal((await sendNow(text.id)).status, 409);
  assert.equal(providerCalls.length, 0);
  assert.equal((await request('/api/scheduled-messages/' + text.id + '/send-now', undefined, 'POST', false)).status, 401);

  due(text.id);
  assert.equal((await sendNow(text.id)).status, 200);
  assert.equal(providerCalls[0].type, 'text');
  assert.equal(row(text.id).status, 'sent');
  assert.equal((await sendNow(text.id)).status, 200);
  assert.equal(providerCalls.length, 1, 'completed sends must not repeat');

  due(pdf.id);
  await processScheduledMessages(env);
  assert.equal(providerCalls[1].type, 'document');
  assert.deepEqual(providerCalls[1].document, { link: 'https://example.com/quote.pdf', filename: 'quote.pdf' });
  assert.equal(row(pdf.id).status, 'sent');
  assert.equal(row(pdf.id).last_error, null);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM messages_log').get()?.n, 2);

  const direct = await schedule({}, true);
  assert.equal(JSON.parse(direct.metadata).deliveryMode, 'undo_hold');
  assert.equal((await cancel(direct.id)).status, 200);
  due(direct.id);
  assert.equal((await sendNow(direct.id)).status, 409);
  await processScheduledMessages(env);
  assert.equal(providerCalls.length, 2, 'cancelled sends must never dispatch');

  // A browser timer racing with cron may observe the same row, but only one
  // conditional SQL claim may dispatch it. Cancellation after claim is blocked.
  const race = await schedule();
  due(race.id);
  const started = new Promise<void>((resolve) => { providerStarted = resolve; });
  const first = sendNow(race.id);
  await started;
  assert.equal(row(race.id).status, 'sending');
  assert.equal((await cancel(race.id)).status, 400);
  await Promise.all([sendNow(race.id), processScheduledMessages(env)]);
  assert.equal(providerCalls.length, 3, 'cron and send-now must share an atomic claim');
  releaseProvider!();
  assert.equal((await first).status, 200);
  assert.equal(row(race.id).status, 'sent');

  const failure = await schedule();
  due(failure.id);
  providerStatus = 400;
  assert.equal((await sendNow(failure.id)).status, 500);
  assert.equal(row(failure.id).status, 'failed');
  assert.match(row(failure.id).last_error, /Mock provider rejection/);
  const failureCalls = providerCalls.length;
  await processScheduledMessages(env);
  await sendNow(failure.id);
  assert.equal(providerCalls.length, failureCalls, 'failed sends must not automatically retry');
  providerStatus = 200;

  // Old clients that explicitly omit a schedule still send immediately.
  assert.equal((await request('/api/chats/test-chat/send', { content: 'Immediate test' })).status, 200);
  assert.equal(providerCalls.at(-1)?.text.body, 'Immediate test');
  assert.equal((await request('/api/chats/test-chat/send', {
    content: 'Past schedule', scheduledAt: new Date(Date.now() - 60_000).toISOString(),
  })).status, 400);
  const future = await schedule({
    deliveryMode: 'scheduled', undoGroupId: undefined,
    scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  assert.equal(JSON.parse(future.metadata).deliveryMode, 'scheduled');
  assert.equal((await sendNow(future.id)).status, 409);
  console.log('PASS: WA text/PDF, undo metadata on both routes, expiry, authentication, cron fallback, atomic race, cancellation, provider rejection, immediate send and future schedule');
} finally {
  globalThis.fetch = originalFetch;
  sqlite.close();
}
