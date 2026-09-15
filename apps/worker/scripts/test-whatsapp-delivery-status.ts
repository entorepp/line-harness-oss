import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { authMiddleware } from '../src/middleware/auth.js';
import { chats } from '../src/routes/chats.js';
import { friends } from '../src/routes/friends.js';
import { waWebhook } from '../src/routes/wa-webhook.js';
import { recordWhatsappDelivery } from '../src/services/whatsapp-delivery.js';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync('../../packages/db/schema.sql', 'utf8'));
sqlite.exec(`
  INSERT INTO line_accounts
    (id, channel_id, name, channel_access_token, channel_secret, channel_type)
    VALUES ('wa-test', 'test-phone-id', 'Test WhatsApp', 'test-token', 'test-app-secret', 'whatsapp');
  INSERT INTO friends (id, line_user_id, display_name, line_account_id)
    VALUES ('test-friend', '15555550100', 'Test only', 'wa-test');
  INSERT INTO chats (id, friend_id) VALUES ('test-chat', 'test-friend');
  INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at)
    VALUES ('test-log', 'test-friend', 'outgoing', 'text', 'Test only', '2026-09-15T10:00:00.000+09:00');
`);

const db = {
  prepare(sql: string) {
    const statement = sqlite.prepare(sql);
    let bindings: any[] = [];
    return {
      bind(...values: any[]) { bindings = values; return this; },
      async first<T>() { return (statement.get(...bindings) ?? null) as T | null; },
      async all<T>() { return { results: statement.all(...bindings) as T[], success: true }; },
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
app.route('/', waWebhook);

function receipt(providerMessageId: string): any {
  return sqlite.prepare(
    'SELECT * FROM whatsapp_delivery_receipts WHERE provider_message_id = ?',
  ).get(providerMessageId);
}

function signedWebhook(statuses: unknown[], signature = true) {
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'test-waba-id',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'test-phone-id' },
          statuses,
        },
      }],
    }],
  });
  const digest = createHmac('sha256', 'test-app-secret').update(body).digest('hex');
  return app.fetch(new Request('https://test.invalid/webhook/whatsapp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': signature ? `sha256=${digest}` : 'sha256=invalid',
    },
    body,
  }), env);
}

try {
  await recordWhatsappDelivery({
    db: db as any,
    lineAccountId: 'wa-test',
    providerMessageId: 'wamid.test-1',
    messageLogId: 'test-log',
    status: 'accepted',
    providerStatusAt: '2026-09-15T10:00:01.000+09:00',
  });
  assert.equal(receipt('wamid.test-1').status, 'accepted');

  const delivered = await signedWebhook([
    { id: 'wamid.test-1', status: 'sent', timestamp: '1789434002' },
    { id: 'wamid.test-1', status: 'delivered', timestamp: '1789434003' },
    { id: 'wamid.test-1', status: 'read', timestamp: '1789434004' },
  ]);
  assert.equal(delivered.status, 200);
  assert.equal(receipt('wamid.test-1').status, 'read');
  assert.equal(receipt('wamid.test-1').error_code, null);

  const stale = await signedWebhook([
    { id: 'wamid.test-1', status: 'sent', timestamp: '1789434005' },
    { id: 'wamid.test-1', status: 'failed', timestamp: '1789434006', errors: [{ code: 131026 }] },
  ]);
  assert.equal(stale.status, 200);
  assert.equal(receipt('wamid.test-1').status, 'read', 'read must never regress to sent or failed');

  const failed = await signedWebhook([
    { id: 'wamid.test-2', status: 'failed', timestamp: '1789434007', errors: [{ code: 131026, error_subcode: 2494010 }] },
    { id: 'wamid.ignored', status: 'warning', timestamp: '1789434008' },
  ]);
  assert.equal(failed.status, 200);
  assert.equal(receipt('wamid.test-2').status, 'failed');
  assert.equal(receipt('wamid.test-2').error_code, '131026');
  assert.equal(receipt('wamid.test-2').error_subcode, '2494010');
  assert.equal(receipt('wamid.ignored'), undefined);

  const invalidSignature = await signedWebhook([], false);
  assert.equal(invalidSignature.status, 401);

  const chatResponse = await app.fetch(new Request('https://test.invalid/api/chats/test-chat', {
    headers: { Authorization: 'Bearer test-api-key' },
  }), env);
  assert.equal(chatResponse.status, 200);
  const chatBody: any = await chatResponse.json();
  assert.equal(chatBody.data.messages[0].deliveryStatus, 'read');
  assert.equal(chatBody.data.messages[0].deliveryStatusAt, receipt('wamid.test-1').provider_status_at);
  assert.equal(chatBody.data.messages[0].deliveryErrorCode, null);

  const friendResponse = await app.fetch(new Request('https://test.invalid/api/friends/test-friend/messages', {
    headers: { Authorization: 'Bearer test-api-key' },
  }), env);
  assert.equal(friendResponse.status, 200);
  const friendBody: any = await friendResponse.json();
  assert.equal(friendBody.data[0].deliveryStatus, 'read');
  assert.equal(friendBody.data[0].deliveryStatusAt, receipt('wamid.test-1').provider_status_at);

  console.log('PASS: WhatsApp accepted/sent/delivered/read/failed callbacks persist monotonically and appear in chat history');
} finally {
  sqlite.close();
}
