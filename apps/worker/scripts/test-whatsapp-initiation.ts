import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { whatsappInitiation } from '../src/routes/whatsapp-initiation.js';
import {
  buildWhatsAppTemplatePayload,
  MetaWhatsAppHttpError,
  MetaWhatsAppUnknownOutcomeError,
  normalizeE164Phone,
  normalizeWhatsAppTemplate,
  renderWhatsAppTemplatePreview,
  sendWhatsAppInitiationTemplate,
} from '../src/services/whatsapp-initiation.js';

const rawTemplate = {
  id: 'template-1',
  name: 'travel_inquiry_followup',
  status: 'APPROVED',
  category: 'UTILITY',
  language: 'en_US',
  parameter_format: 'POSITIONAL',
  components: [
    { type: 'HEADER', format: 'TEXT', text: 'Flat Travel' },
    { type: 'BODY', text: 'Hello {{1}}, we received your Japan travel inquiry {{2}}.' },
    { type: 'FOOTER', text: 'Reply STOP to opt out.' },
    { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Continue' }] },
  ],
};

const template = normalizeWhatsAppTemplate(rawTemplate);
assert.ok(template);
assert.equal(template.supportedForInitiation, true);
assert.deepEqual(template.parameters.map((item) => item.key), ['body:1', 'body:2']);
assert.equal(normalizeE164Phone('+81 70-1234-5678'), '817012345678');
assert.throws(() => normalizeE164Phone('070-1234-5678'), /国番号/);

const values = { 'body:1': 'Alex', 'body:2': 'FTQ-20260829-AB12CD34' };
const payload = buildWhatsAppTemplatePayload('817012345678', template, values) as any;
assert.equal(payload.type, 'template');
assert.equal(payload.to, '817012345678');
assert.equal(payload.template.name, 'travel_inquiry_followup');
assert.equal(payload.template.components[0].type, 'body');
assert.equal(payload.template.components[0].parameters[1].text, 'FTQ-20260829-AB12CD34');
assert.match(renderWhatsAppTemplatePreview(template, values), /Hello Alex/);

const mediaTemplate = normalizeWhatsAppTemplate({
  ...rawTemplate,
  name: 'media_header',
  components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Hello' }],
});
assert.equal(mediaTemplate?.supportedForInitiation, false);

const account = {
  id: 'wa-account',
  channel_id: 'phone-number-id',
  channel_access_token: 'secret-token',
  channel_secret: '',
  channel_type: 'whatsapp',
  whatsapp_business_account_id: '1234567890',
  is_active: 1,
} as any;

type Row = Record<string, any>;
const initiatives: Row[] = [];
const friends: Row[] = [];
const chats: Row[] = [];
const messages: Row[] = [];

function normalizedSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function statement(sqlInput: string) {
  const sql = normalizedSql(sqlInput);
  let bindings: any[] = [];
  const stmt = {
    bind(...valuesToBind: any[]) {
      bindings = valuesToBind;
      return stmt;
    },
    async first<T>() {
      if (sql === 'SELECT * FROM line_accounts WHERE id = ?') {
        return (bindings[0] === account.id ? account : null) as T | null;
      }
      if (sql.startsWith('SELECT * FROM whatsapp_outbound_initiations WHERE idempotency_key = ?')) {
        return (initiatives.find((row) => row.idempotency_key === bindings[0]) || null) as T | null;
      }
      if (sql.startsWith('SELECT id, line_account_id FROM friends WHERE line_user_id = ?')) {
        return (friends.find((row) => row.line_user_id === bindings[0]) || null) as T | null;
      }
      if (sql.startsWith('SELECT id FROM chats WHERE friend_id = ?')) {
        return (chats.find((row) => row.friend_id === bindings[0]) || null) as T | null;
      }
      throw new Error(`Unexpected first SQL: ${sql}`);
    },
    async run() {
      if (sql.startsWith('INSERT INTO whatsapp_outbound_initiations')) {
        const [
          id, idempotencyKey, lineAccountId, recipientPhone, customerName,
          consentSource, consentObtainedAt, templateName, templateLanguage,
          templateParameters, renderedPreview, friendId, chatId, messageLogId,
          createdAt, updatedAt,
        ] = bindings;
        if (initiatives.some((row) => row.idempotency_key === idempotencyKey)) {
          throw new Error('UNIQUE constraint failed');
        }
        initiatives.push({
          id,
          idempotency_key: idempotencyKey,
          line_account_id: lineAccountId,
          recipient_phone: recipientPhone,
          customer_name: customerName,
          number_provided_confirmed: 1,
          opt_in_confirmed: 1,
          consent_source: consentSource,
          consent_obtained_at: consentObtainedAt,
          template_name: templateName,
          template_language: templateLanguage,
          template_parameters: templateParameters,
          rendered_preview: renderedPreview,
          status: 'pending',
          provider_message_id: null,
          friend_id: friendId,
          chat_id: chatId,
          message_log_id: messageLogId,
          error_code: null,
          error_message: null,
          created_at: createdAt,
          updated_at: updatedAt,
        });
        return { success: true };
      }
      if (sql.startsWith("UPDATE whatsapp_outbound_initiations SET status = 'accepted'")) {
        const [providerMessageId, updatedAt, id] = bindings;
        Object.assign(initiatives.find((row) => row.id === id)!, {
          status: 'accepted', provider_message_id: providerMessageId,
          error_code: null, error_message: null, updated_at: updatedAt,
        });
        return { success: true };
      }
      if (sql.startsWith('UPDATE whatsapp_outbound_initiations SET status = ?, error_code = ?')) {
        const [status, code, message, updatedAt, id] = bindings;
        Object.assign(initiatives.find((row) => row.id === id)!, {
          status, error_code: code, error_message: message, updated_at: updatedAt,
        });
        return { success: true };
      }
      if (sql.startsWith("UPDATE whatsapp_outbound_initiations SET status = 'pending'")) {
        const [updatedAt, id] = bindings;
        Object.assign(initiatives.find((row) => row.id === id)!, {
          status: 'pending', error_code: null, error_message: null, updated_at: updatedAt,
        });
        return { success: true };
      }
      if (sql.startsWith('UPDATE whatsapp_outbound_initiations SET friend_id = ?, chat_id = ?')) {
        const [friendId, chatId, updatedAt, id] = bindings;
        Object.assign(initiatives.find((row) => row.id === id)!, {
          friend_id: friendId, chat_id: chatId, updated_at: updatedAt,
        });
        return { success: true };
      }
      if (sql.startsWith('UPDATE whatsapp_outbound_initiations SET chat_id = ?')) {
        const [chatId, updatedAt, id] = bindings;
        Object.assign(initiatives.find((row) => row.id === id)!, {
          chat_id: chatId, updated_at: updatedAt,
        });
        return { success: true };
      }
      if (sql.startsWith('INSERT OR IGNORE INTO friends')) {
        const [id, lineUserId, displayName, lineAccountId, createdAt, updatedAt] = bindings;
        if (!friends.some((row) => row.id === id || row.line_user_id === lineUserId)) {
          friends.push({
            id, line_user_id: lineUserId, display_name: displayName,
            is_following: 1, line_account_id: lineAccountId,
            created_at: createdAt, updated_at: updatedAt,
          });
        }
        return { success: true };
      }
      if (sql.startsWith('UPDATE friends SET display_name = ?')) {
        const [displayName, lineAccountId, updatedAt, id] = bindings;
        Object.assign(friends.find((row) => row.id === id)!, {
          display_name: displayName, line_account_id: lineAccountId,
          is_following: 1, updated_at: updatedAt,
        });
        return { success: true };
      }
      if (sql.startsWith('INSERT OR IGNORE INTO chats')) {
        const [id, friendId, lastMessageAt, createdAt, updatedAt] = bindings;
        if (!chats.some((row) => row.id === id)) {
          chats.push({
            id, friend_id: friendId, status: 'in_progress',
            last_message_at: lastMessageAt, created_at: createdAt, updated_at: updatedAt,
          });
        }
        return { success: true };
      }
      if (sql.startsWith('INSERT OR IGNORE INTO messages_log')) {
        const [id, friendId, content, createdAt] = bindings;
        if (!messages.some((row) => row.id === id)) {
          messages.push({
            id, friend_id: friendId, direction: 'outgoing',
            message_type: 'text', content, created_at: createdAt,
          });
        }
        return { success: true };
      }
      if (sql.startsWith("UPDATE chats SET status = 'in_progress'")) {
        const [lastMessageAt, updatedAt, id] = bindings;
        Object.assign(chats.find((row) => row.id === id)!, {
          status: 'in_progress', last_message_at: lastMessageAt, updated_at: updatedAt,
        });
        return { success: true };
      }
      throw new Error(`Unexpected run SQL: ${sql}`);
    },
  };
  return stmt;
}

const db = {
  prepare: statement,
  async batch(statements: Array<{ run(): Promise<unknown> }>) {
    return Promise.all(statements.map((item) => item.run()));
  },
} as any;

const app = new Hono();
app.route('/', whatsappInitiation);
const env = { DB: db, WHATSAPP_INITIAL_CONTACT_MODE: 'live' } as any;
const originalFetch = globalThis.fetch;
let templateFetches = 0;
let messageSends = 0;
let sendMode: 'accepted' | 'rejected' | 'unknown' = 'accepted';

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('/message_templates')) {
    templateFetches += 1;
    return new Response(JSON.stringify({ data: [rawTemplate] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (url.endsWith('/phone-number-id/messages')) {
    messageSends += 1;
    const posted = JSON.parse(String(init?.body || '{}'));
    assert.equal(posted.type, 'template');
    assert.match(posted.to, /^81(?:70|80|90)12345678$/);
    if (sendMode === 'unknown') throw new Error('simulated connection reset');
    if (sendMode === 'rejected') {
      return new Response(JSON.stringify({ error: { message: 'Template rejected', code: 131047 } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      contacts: [{ wa_id: posted.to }],
      messages: [{ id: `wamid.test-${messageSends}` }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return originalFetch(input, init);
}) as typeof fetch;

const baseRequest = {
  idempotencyKey: 'outbound-test-accepted',
  lineAccountId: account.id,
  recipientPhone: '+81 70-1234-5678',
  customerName: 'Alex Traveller',
  numberProvidedConfirmed: true,
  optInConfirmed: true,
  consentSource: 'email',
  consentObtainedAt: '2026-08-29T01:00:00.000Z',
  templateName: rawTemplate.name,
  templateLanguage: rawTemplate.language,
  templateParameters: values,
};

async function postInitialMessage(requestBody: Record<string, unknown>) {
  return app.fetch(new Request('https://line-flattravel.example/api/whatsapp/initial-messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody),
  }), env);
}

env.WHATSAPP_INITIAL_CONTACT_MODE = 'off';
const gatedOff = await postInitialMessage({ ...baseRequest, idempotencyKey: 'outbound-test-gated-off' });
assert.equal(gatedOff.status, 503);
assert.equal(messageSends, 0);

env.WHATSAPP_INITIAL_CONTACT_MODE = 'test';
env.WHATSAPP_INITIAL_CONTACT_TEST_PHONE_HASHES = '';
const unapprovedTestRecipient = await postInitialMessage({
  ...baseRequest,
  idempotencyKey: 'outbound-test-unapproved-recipient',
});
assert.equal(unapprovedTestRecipient.status, 403);
assert.equal(messageSends, 0);

env.WHATSAPP_INITIAL_CONTACT_MODE = 'live';

const created = await postInitialMessage(baseRequest);
assert.equal(created.status, 201);
const createdBody = await created.json() as any;
assert.equal(createdBody.success, true);
assert.equal(createdBody.data.accepted, true);
assert.equal(createdBody.data.duplicate, false);
assert.equal(friends.length, 1);
assert.equal(chats.length, 1);
assert.equal(messages.length, 1);
assert.match(messages[0].content, /Hello Alex/);
assert.equal(messageSends, 1);

const duplicate = await postInitialMessage(baseRequest);
assert.equal(duplicate.status, 200);
assert.equal((await duplicate.json() as any).data.duplicate, true);
assert.equal(messageSends, 1);
assert.equal(messages.length, 1);

sendMode = 'rejected';
const rejectedRequest = {
  ...baseRequest,
  idempotencyKey: 'outbound-test-rejected',
  recipientPhone: '+81 80-1234-5678',
};
const rejected = await postInitialMessage(rejectedRequest);
assert.equal(rejected.status, 502);
const rejectedBody = await rejected.json() as any;
assert.equal(rejectedBody.outcome, 'failed');
assert.equal(rejectedBody.code, '131047');
assert.equal(friends.length, 1);

sendMode = 'accepted';
const retried = await postInitialMessage(rejectedRequest);
assert.equal(retried.status, 201);
assert.equal((await retried.json() as any).data.accepted, true);
assert.equal(friends.length, 2);

sendMode = 'unknown';
const unknownRequest = {
  ...baseRequest,
  idempotencyKey: 'outbound-test-unknown',
  recipientPhone: '+81 90-1234-5678',
};
const unknown = await postInitialMessage(unknownRequest);
assert.equal(unknown.status, 502);
assert.equal((await unknown.json() as any).outcome, 'unknown');
const sendsBeforeUnknownReplay = messageSends;
const unknownReplay = await postInitialMessage(unknownRequest);
assert.equal(unknownReplay.status, 409);
assert.equal(messageSends, sendsBeforeUnknownReplay);

const noOptIn = await postInitialMessage({
  ...baseRequest,
  idempotencyKey: 'outbound-test-no-opt-in',
  optInConfirmed: false,
});
assert.equal(noOptIn.status, 400);

const sentDirectly = await sendWhatsAppInitiationTemplate({
  account,
  recipientPhone: '817012345678',
  template,
  values,
}).catch((error) => error);
assert.ok(sentDirectly instanceof MetaWhatsAppUnknownOutcomeError);

sendMode = 'rejected';
const rejectedDirectly = await sendWhatsAppInitiationTemplate({
  account,
  recipientPhone: '817012345678',
  template,
  values,
}).catch((error) => error);
assert.ok(rejectedDirectly instanceof MetaWhatsAppHttpError);

globalThis.fetch = originalFetch;
console.log('WhatsApp initiation: release and consent gates, templates, send, retry, idempotency, and unknown-outcome stop passed');
