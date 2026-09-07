import { Hono } from 'hono';
import { getLineAccountById, jstNow } from '@line-crm/db';
import type { LineAccount } from '@line-crm/db';
import type { Env } from '../index.js';
import {
  fetchApprovedWhatsAppTemplates,
  MetaWhatsAppHttpError,
  MetaWhatsAppUnknownOutcomeError,
  normalizeE164Phone,
  renderWhatsAppTemplatePreview,
  sendWhatsAppInitiationTemplate,
  validateTemplateValues,
  type WhatsAppTemplateValues,
} from '../services/whatsapp-initiation.js';

const whatsappInitiation = new Hono<Env>();

type ConsentSource = 'web_form' | 'email' | 'phone' | 'in_person' | 'other';
type InitiationStatus = 'pending' | 'accepted' | 'failed' | 'unknown';
type ReleaseMode = 'off' | 'test' | 'live';

type InitiationRow = {
  id: string;
  idempotency_key: string;
  line_account_id: string;
  recipient_phone: string;
  customer_name: string;
  number_provided_confirmed: number;
  opt_in_confirmed: number;
  consent_source: ConsentSource;
  consent_obtained_at: string;
  template_name: string;
  template_language: string;
  template_parameters: string;
  rendered_preview: string;
  status: InitiationStatus;
  provider_message_id: string | null;
  friend_id: string;
  chat_id: string;
  message_log_id: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type InitiationRequest = {
  idempotencyKey: string;
  lineAccountId: string;
  recipientPhone: string;
  customerName: string;
  numberProvidedConfirmed: boolean;
  optInConfirmed: boolean;
  consentSource: ConsentSource;
  consentObtainedAt: string;
  templateName: string;
  templateLanguage: string;
  templateParameters?: Record<string, string>;
};

const CONSENT_SOURCES = new Set<ConsentSource>([
  'web_form',
  'email',
  'phone',
  'in_person',
  'other',
]);

function releaseMode(value: string | undefined): ReleaseMode {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'test' || normalized === 'live' ? normalized : 'off';
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function isAllowedByReleaseGate(
  env: Env['Bindings'],
  recipientPhone: string,
): Promise<{ allowed: boolean; mode: ReleaseMode }> {
  const mode = releaseMode(env.WHATSAPP_INITIAL_CONTACT_MODE);
  if (mode === 'live') return { allowed: true, mode };
  if (mode === 'off') return { allowed: false, mode };

  const allowedHashes = new Set(
    (env.WHATSAPP_INITIAL_CONTACT_TEST_PHONE_HASHES || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => /^[a-f0-9]{64}$/.test(item)),
  );
  return { allowed: allowedHashes.has(await sha256Hex(recipientPhone)), mode };
}

function canonicalParameters(values: WhatsAppTemplateValues): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right))),
  );
}

function validateConsentTimestamp(value: string): string {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) {
    throw new Error('同意取得日時を正しい日時で入力してください');
  }
  if (parsed.getTime() > Date.now() + 5 * 60 * 1000) {
    throw new Error('同意取得日時に未来の日時は指定できません');
  }
  return parsed.toISOString();
}

async function getWhatsAppAccount(db: D1Database, id: string): Promise<LineAccount | null> {
  const account = await getLineAccountById(db, id);
  if (!account || account.channel_type !== 'whatsapp' || !account.is_active) return null;
  return account;
}

async function getInitiationByKey(db: D1Database, key: string): Promise<InitiationRow | null> {
  return db
    .prepare('SELECT * FROM whatsapp_outbound_initiations WHERE idempotency_key = ?')
    .bind(key)
    .first<InitiationRow>();
}

function serializeInitiation(row: InitiationRow, duplicate: boolean) {
  return {
    accepted: row.status === 'accepted',
    duplicate,
    status: row.status,
    initiationId: row.id,
    friendId: row.friend_id,
    chatId: row.chat_id,
    messageId: row.message_log_id,
    providerMessageId: row.provider_message_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };
}

async function finalizeAcceptedInitiation(db: D1Database, row: InitiationRow): Promise<InitiationRow> {
  if (row.status !== 'accepted' || !row.provider_message_id) return row;
  const now = jstNow();

  const phoneFriend = await db
    .prepare('SELECT id, line_account_id FROM friends WHERE line_user_id = ? LIMIT 1')
    .bind(row.recipient_phone)
    .first<{ id: string; line_account_id: string | null }>();
  if (phoneFriend?.line_account_id && phoneFriend.line_account_id !== row.line_account_id) {
    throw new Error('This WhatsApp number already belongs to a different channel account');
  }

  let friendId = phoneFriend?.id || row.friend_id;
  let chatId = row.chat_id;
  if (phoneFriend && phoneFriend.id !== row.friend_id) {
    const existingChat = await db
      .prepare('SELECT id FROM chats WHERE friend_id = ? ORDER BY created_at DESC LIMIT 1')
      .bind(phoneFriend.id)
      .first<{ id: string }>();
    chatId = existingChat?.id || crypto.randomUUID();
    await db
      .prepare('UPDATE whatsapp_outbound_initiations SET friend_id = ?, chat_id = ?, updated_at = ? WHERE id = ?')
      .bind(friendId, chatId, now, row.id)
      .run();
  }

  const existingChat = await db
    .prepare('SELECT id FROM chats WHERE friend_id = ? ORDER BY created_at DESC LIMIT 1')
    .bind(friendId)
    .first<{ id: string }>();
  if (existingChat && existingChat.id !== chatId) {
    chatId = existingChat.id;
    await db
      .prepare('UPDATE whatsapp_outbound_initiations SET chat_id = ?, updated_at = ? WHERE id = ?')
      .bind(chatId, now, row.id)
      .run();
  }

  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO friends
         (id, line_user_id, display_name, is_following, line_account_id, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?)`,
    ).bind(friendId, row.recipient_phone, row.customer_name, row.line_account_id, now, now),
    db.prepare(
      `UPDATE friends
          SET display_name = ?, is_following = 1, line_account_id = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(row.customer_name, row.line_account_id, now, friendId),
    db.prepare(
      `INSERT OR IGNORE INTO chats
         (id, friend_id, status, last_message_at, created_at, updated_at)
       VALUES (?, ?, 'in_progress', ?, ?, ?)`,
    ).bind(chatId, friendId, now, now, now),
    db.prepare(
      `INSERT OR IGNORE INTO messages_log
         (id, friend_id, direction, message_type, content, created_at)
       VALUES (?, ?, 'outgoing', 'text', ?, ?)`,
    ).bind(row.message_log_id, friendId, row.rendered_preview, now),
    db.prepare(
      `UPDATE chats
          SET status = 'in_progress', last_message_at = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(now, now, chatId),
    db.prepare(
      `UPDATE whatsapp_outbound_initiations
          SET friend_id = ?, chat_id = ?, updated_at = ?
        WHERE id = ?`,
    ).bind(friendId, chatId, now, row.id),
  ]);

  return (await getInitiationByKey(db, row.idempotency_key))!;
}

whatsappInitiation.get('/api/whatsapp/accounts/:id/templates', async (c) => {
  try {
    const mode = releaseMode(c.env.WHATSAPP_INITIAL_CONTACT_MODE);
    const account = await getWhatsAppAccount(c.env.DB, c.req.param('id'));
    if (!account) {
      return c.json({ success: false, error: '有効なWhatsAppアカウントが見つかりません' }, 404);
    }
    if (!account.whatsapp_business_account_id) {
      return c.json({
        success: true,
        data: {
          configured: false,
          releaseMode: mode,
          templates: [],
          reason: 'アカウント管理でWhatsApp Business Account IDを設定してください',
        },
      });
    }

    const templates = await fetchApprovedWhatsAppTemplates(account);
    return c.json({
      success: true,
      data: { configured: true, releaseMode: mode, templates, reason: null },
    });
  } catch (error) {
    console.error('GET WhatsApp initiation templates error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : '承認済みテンプレートの取得に失敗しました',
    }, 502);
  }
});

whatsappInitiation.post('/api/whatsapp/initial-messages', async (c) => {
  let body: InitiationRequest;
  try {
    body = await c.req.json<InitiationRequest>();
  } catch {
    return c.json({ success: false, error: 'JSON body is required' }, 400);
  }

  try {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(body.idempotencyKey || '')) {
      return c.json({ success: false, error: 'idempotencyKey is invalid' }, 400);
    }
    if (!body.lineAccountId) {
      return c.json({ success: false, error: 'WhatsAppアカウントを選択してください' }, 400);
    }
    const customerName = body.customerName?.trim();
    if (!customerName || customerName.length > 120) {
      return c.json({ success: false, error: '顧客名は1〜120文字で入力してください' }, 400);
    }
    if (body.numberProvidedConfirmed !== true || body.optInConfirmed !== true) {
      return c.json({
        success: false,
        error: '電話番号の提供確認とWhatsApp連絡への同意確認が必要です',
      }, 400);
    }
    if (!CONSENT_SOURCES.has(body.consentSource)) {
      return c.json({ success: false, error: '同意取得元を選択してください' }, 400);
    }
    const consentObtainedAt = validateConsentTimestamp(body.consentObtainedAt);
    const recipientPhone = normalizeE164Phone(body.recipientPhone);
    const releaseGate = await isAllowedByReleaseGate(c.env, recipientPhone);
    if (!releaseGate.allowed) {
      return c.json({
        success: false,
        error: releaseGate.mode === 'off'
          ? 'WhatsApp初回連絡はレビュー待ちのため無効です'
          : '現在は承認済みテスト番号にのみ送信できます',
        releaseMode: releaseGate.mode,
      }, releaseGate.mode === 'off' ? 503 : 403);
    }
    const account = await getWhatsAppAccount(c.env.DB, body.lineAccountId);
    if (!account) {
      return c.json({ success: false, error: '有効なWhatsAppアカウントが見つかりません' }, 404);
    }
    if (!account.whatsapp_business_account_id) {
      return c.json({
        success: false,
        error: 'アカウント管理でWhatsApp Business Account IDを設定してください',
      }, 409);
    }

    const existingByKey = await getInitiationByKey(c.env.DB, body.idempotencyKey);
    if (existingByKey?.status === 'accepted') {
      const finalized = await finalizeAcceptedInitiation(c.env.DB, existingByKey);
      return c.json({ success: true, data: serializeInitiation(finalized, true) });
    }
    if (existingByKey?.status === 'pending') {
      return c.json({
        success: false,
        error: '同じ送信処理が進行中です。再送せず結果を確認してください',
      }, 409);
    }
    if (existingByKey?.status === 'unknown') {
      return c.json({
        success: false,
        error: '前回の送信結果が不明です。WhatsApp Managerまたは受信端末で確認するまで再送できません',
      }, 409);
    }

    const templates = await fetchApprovedWhatsAppTemplates(account);
    const template = templates.find((item) => (
      item.name === body.templateName?.trim()
      && item.language === body.templateLanguage?.trim()
      && item.status === 'APPROVED'
    ));
    if (!template) {
      return c.json({ success: false, error: '指定した承認済みテンプレートが見つかりません' }, 400);
    }
    const templateValues = validateTemplateValues(template, body.templateParameters || {});
    const serializedParameters = canonicalParameters(templateValues);
    const renderedPreview = renderWhatsAppTemplatePreview(template, templateValues);

    if (existingByKey) {
      const sameRequest = existingByKey.line_account_id === account.id
        && existingByKey.recipient_phone === recipientPhone
        && existingByKey.customer_name === customerName
        && existingByKey.consent_source === body.consentSource
        && existingByKey.consent_obtained_at === consentObtainedAt
        && existingByKey.template_name === template.name
        && existingByKey.template_language === template.language
        && existingByKey.template_parameters === serializedParameters;
      if (!sameRequest) {
        return c.json({
          success: false,
          error: '失敗した送信内容を変更する場合は新しい送信操作としてやり直してください',
        }, 409);
      }
    }

    const phoneFriend = await c.env.DB
      .prepare('SELECT id, line_account_id FROM friends WHERE line_user_id = ? LIMIT 1')
      .bind(recipientPhone)
      .first<{ id: string; line_account_id: string | null }>();
    if (phoneFriend?.line_account_id && phoneFriend.line_account_id !== account.id) {
      return c.json({
        success: false,
        error: 'この電話番号は別のWhatsAppアカウントに登録されています',
      }, 409);
    }
    const friendId = existingByKey?.friend_id || phoneFriend?.id || crypto.randomUUID();
    const existingChat = await c.env.DB
      .prepare('SELECT id FROM chats WHERE friend_id = ? ORDER BY created_at DESC LIMIT 1')
      .bind(friendId)
      .first<{ id: string }>();
    const chatId = existingByKey?.chat_id || existingChat?.id || crypto.randomUUID();
    const messageLogId = existingByKey?.message_log_id || crypto.randomUUID();
    const initiationId = existingByKey?.id || crypto.randomUUID();
    const now = jstNow();

    if (existingByKey) {
      await c.env.DB.prepare(
        `UPDATE whatsapp_outbound_initiations
            SET status = 'pending', error_code = NULL, error_message = NULL, updated_at = ?
          WHERE id = ?`,
      ).bind(now, existingByKey.id).run();
    } else {
      try {
        await c.env.DB.prepare(
          `INSERT INTO whatsapp_outbound_initiations
             (id, idempotency_key, line_account_id, recipient_phone, customer_name,
              number_provided_confirmed, opt_in_confirmed, consent_source, consent_obtained_at,
              template_name, template_language, template_parameters, rendered_preview, status,
              friend_id, chat_id, message_log_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
        ).bind(
          initiationId,
          body.idempotencyKey,
          account.id,
          recipientPhone,
          customerName,
          body.consentSource,
          consentObtainedAt,
          template.name,
          template.language,
          serializedParameters,
          renderedPreview,
          friendId,
          chatId,
          messageLogId,
          now,
          now,
        ).run();
      } catch (error) {
        const raced = await getInitiationByKey(c.env.DB, body.idempotencyKey);
        if (raced) {
          return c.json({
            success: false,
            error: '同じ送信処理が既に開始されています。再送せず結果を確認してください',
          }, 409);
        }
        throw error;
      }
    }

    try {
      const provider = await sendWhatsAppInitiationTemplate({
        account,
        recipientPhone,
        template,
        values: templateValues,
      });
      await c.env.DB.prepare(
        `UPDATE whatsapp_outbound_initiations
            SET status = 'accepted', provider_message_id = ?, error_code = NULL,
                error_message = NULL, updated_at = ?
          WHERE id = ?`,
      ).bind(provider.providerMessageId, jstNow(), initiationId).run();
    } catch (error) {
      const status: InitiationStatus = error instanceof MetaWhatsAppHttpError ? 'failed' : 'unknown';
      const code = error instanceof MetaWhatsAppHttpError
        ? error.code
        : error instanceof MetaWhatsAppUnknownOutcomeError
          ? 'UNKNOWN_OUTCOME'
          : 'UNEXPECTED_ERROR';
      const message = (error instanceof Error ? error.message : 'WhatsApp send failed').slice(0, 500);
      await c.env.DB.prepare(
        `UPDATE whatsapp_outbound_initiations
            SET status = ?, error_code = ?, error_message = ?, updated_at = ?
          WHERE id = ?`,
      ).bind(status, code, message, jstNow(), initiationId).run();
      return c.json({
        success: false,
        error: status === 'unknown'
          ? `${message}。送信結果が不明なため自動再送は停止しました`
          : message,
        code,
        outcome: status,
      }, 502);
    }

    const accepted = await getInitiationByKey(c.env.DB, body.idempotencyKey);
    if (!accepted) throw new Error('Accepted initiation record is missing');
    const finalized = await finalizeAcceptedInitiation(c.env.DB, accepted);
    return c.json({ success: true, data: serializeInitiation(finalized, false) }, 201);
  } catch (error) {
    console.error('POST WhatsApp initial message error:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'WhatsApp初回連絡の送信に失敗しました',
    }, 500);
  }
});

export { whatsappInitiation };
