import { Hono } from 'hono';
import { createChat, getChatByFriendId, jstNow, toJstString, updateChat } from '@line-crm/db';
import type { LineAccount } from '@line-crm/db';
import type { Env } from '../index.js';
import { fireEvent } from '../services/event-bus.js';
import {
  fetchWeChatKfMessages,
  sendWeChatKfWelcome,
  type WeChatKfMessage,
} from '../services/wechat-kf.js';
import {
  decryptWeChatPayload,
  readWeChatXmlValue,
  sha1Hex,
  verifyWeChatSignature,
} from '../services/wechat.js';

const wechatKfWebhook = new Hono<Env>();

type WeChatKfCallbackAccount = Pick<
  LineAccount,
  | 'id'
  | 'name'
  | 'default_slack_channel'
  | 'wechat_kf_corp_id'
  | 'wechat_kf_secret'
  | 'wechat_kf_open_kfid'
  | 'wechat_kf_callback_token'
  | 'wechat_kf_encoding_aes_key'
  | 'wechat_kf_access_token'
  | 'wechat_kf_token_expires_at'
  | 'wechat_kf_contact_url'
  | 'wechat_kf_sync_cursor'
  | 'wechat_follow_url'
>;

type NormalizedWeChatKfMessage = {
  externalUserId: string;
  openKfid: string;
  receiptId: string;
  messageType: string;
  storedContent: string;
  eventText: string;
  occurredAt: string;
  direction: 'incoming' | 'outgoing';
  shouldNotify: boolean;
  metadata: Record<string, unknown>;
};

async function resolveWeChatKfAccount(
  db: D1Database,
  id: string,
): Promise<WeChatKfCallbackAccount | null> {
  return db
    .prepare(
      `SELECT id, name, default_slack_channel,
              wechat_kf_corp_id, wechat_kf_secret, wechat_kf_open_kfid,
              wechat_kf_callback_token, wechat_kf_encoding_aes_key,
              wechat_kf_access_token, wechat_kf_token_expires_at,
              wechat_kf_contact_url, wechat_kf_sync_cursor, wechat_follow_url
         FROM line_accounts
        WHERE id = ? AND channel_type = 'wechat' AND is_active = 1
        LIMIT 1`,
    )
    .bind(id)
    .first<WeChatKfCallbackAccount>();
}

function accountCallbackReady(
  account: WeChatKfCallbackAccount,
): account is WeChatKfCallbackAccount & {
  wechat_kf_corp_id: string;
  wechat_kf_callback_token: string;
  wechat_kf_encoding_aes_key: string;
} {
  return Boolean(
    account.wechat_kf_corp_id?.trim()
      && account.wechat_kf_callback_token?.trim()
      && account.wechat_kf_encoding_aes_key?.trim(),
  );
}

function normalizeOccurredAt(value: number | undefined): string {
  if (!Number.isFinite(value) || !value || value <= 0) return jstNow();
  return toJstString(new Date(value * 1000));
}

async function receiptId(message: WeChatKfMessage): Promise<string> {
  if (message.msgid?.trim()) return message.msgid.trim();
  return sha1Hex([
    message.open_kfid || '',
    message.external_userid || '',
    String(message.send_time || ''),
    message.msgtype || '',
    message.event?.event_type || '',
    message.event?.welcome_code || '',
  ]);
}

async function normalizeKfMessage(
  message: WeChatKfMessage,
  fallbackOpenKfid: string,
): Promise<NormalizedWeChatKfMessage | null> {
  const externalUserId = message.external_userid?.trim() || '';
  const openKfid = message.open_kfid?.trim() || fallbackOpenKfid;
  const rawMessageType = message.msgtype?.trim().toLowerCase() || 'unknown';
  if (!externalUserId || !openKfid) return null;

  const metadata: Record<string, unknown> = {
    provider: 'wechat_kf',
    externalUserId,
    openKfid,
    origin: message.origin ?? null,
    rawMessageType,
    providerMessageId: message.msgid || null,
    servicerUserId: message.servicer_userid || null,
  };
  const base = {
    externalUserId,
    openKfid,
    receiptId: await receiptId(message),
    occurredAt: normalizeOccurredAt(message.send_time),
    direction: message.origin === 5 ? 'outgoing' as const : 'incoming' as const,
    shouldNotify: message.origin === 3,
    metadata,
  };

  if (rawMessageType === 'text') {
    const text = message.text?.content?.trim() || '';
    return {
      ...base,
      messageType: 'text',
      storedContent: text || '[空のテキストメッセージ]',
      eventText: text || '[空のテキストメッセージ]',
    };
  }

  if (rawMessageType === 'image') {
    const mediaId = message.image?.media_id || '';
    return {
      ...base,
      messageType: 'image',
      storedContent: JSON.stringify({ mediaId }),
      eventText: '📷 画像を送信',
      metadata: { ...metadata, mediaId },
    };
  }

  if (rawMessageType === 'voice') {
    const mediaId = message.voice?.media_id || '';
    return {
      ...base,
      messageType: 'audio',
      storedContent: JSON.stringify({ mediaId }),
      eventText: '🎵 音声を送信',
      metadata: { ...metadata, mediaId },
    };
  }

  if (rawMessageType === 'video') {
    const mediaId = message.video?.media_id || '';
    return {
      ...base,
      messageType: 'video',
      storedContent: JSON.stringify({ mediaId }),
      eventText: '🎥 動画を送信',
      metadata: { ...metadata, mediaId },
    };
  }

  if (rawMessageType === 'file') {
    const mediaId = message.file?.media_id || '';
    return {
      ...base,
      messageType: 'file',
      storedContent: JSON.stringify({ mediaId, fileName: 'WeChat file' }),
      eventText: '📎 ファイルを送信',
      metadata: { ...metadata, mediaId },
    };
  }

  if (rawMessageType === 'link') {
    const title = message.link?.title?.trim() || '';
    const description = message.link?.desc?.trim() || '';
    const url = message.link?.url?.trim() || '';
    const content = [title, description, url].filter(Boolean).join('\n');
    return {
      ...base,
      messageType: 'text',
      storedContent: content || '[リンク]',
      eventText: content || '[リンク]',
      metadata: { ...metadata, url },
    };
  }

  if (rawMessageType === 'location') {
    const location = {
      latitude: message.location?.latitude ?? null,
      longitude: message.location?.longitude ?? null,
      name: message.location?.name || '',
      address: message.location?.address || '',
    };
    return {
      ...base,
      messageType: 'location',
      storedContent: JSON.stringify(location),
      eventText: `📍 ${location.name || location.address || '位置情報を送信'}`,
      metadata: { ...metadata, ...location },
    };
  }

  if (rawMessageType === 'event') {
    const eventType = message.event?.event_type || 'unknown';
    const label = eventType === 'enter_session' ? '相談を開始' : eventType;
    return {
      ...base,
      messageType: 'text',
      storedContent: `[微信客服イベント] ${label}`,
      eventText: `[微信客服イベント] ${label}`,
      shouldNotify: eventType === 'enter_session',
      metadata: {
        ...metadata,
        eventType,
        scene: message.event?.scene || '',
        sceneParam: message.event?.scene_param || '',
      },
    };
  }

  return {
    ...base,
    messageType: 'text',
    storedContent: `[微信客服 ${rawMessageType}]`,
    eventText: `[微信客服 ${rawMessageType}]`,
  };
}

async function upsertWeChatKfFriend(
  db: D1Database,
  account: WeChatKfCallbackAccount,
  message: NormalizedWeChatKfMessage,
): Promise<{ id: string; displayName: string }> {
  const externalId = `wechat-kf:${message.openKfid}:${message.externalUserId}`;
  const displayName = `微信客服 ${message.externalUserId.slice(-6)}`;
  const existing = await db
    .prepare(
      `SELECT id, metadata
         FROM friends
        WHERE line_user_id = ? AND line_account_id = ?
        LIMIT 1`,
    )
    .bind(externalId, account.id)
    .first<{ id: string; metadata: string | null }>();
  let previousMetadata: Record<string, unknown> = {};
  if (existing?.metadata) {
    try {
      previousMetadata = JSON.parse(existing.metadata) as Record<string, unknown>;
    } catch {
      previousMetadata = {};
    }
  }
  const metadata = JSON.stringify({
    ...previousMetadata,
    ...message.metadata,
    provider: 'wechat_kf',
    externalUserId: message.externalUserId,
    openKfid: message.openKfid,
    lastMessageAt: message.occurredAt,
    ...(message.direction === 'incoming'
      ? {
          lastCustomerMessageAt: message.occurredAt,
          replyableUntil: new Date(
            Date.parse(message.occurredAt) + 48 * 60 * 60 * 1000,
          ).toISOString(),
        }
      : {}),
  });

  if (!existing) {
    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO friends
           (id, line_user_id, display_name, is_following, line_account_id,
            slack_channel_id, metadata, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        externalId,
        displayName,
        account.id,
        account.default_slack_channel,
        metadata,
        message.occurredAt,
        message.occurredAt,
      )
      .run();
    return { id, displayName };
  }

  await db
    .prepare(
      `UPDATE friends
          SET line_account_id = ?,
              slack_channel_id = COALESCE(slack_channel_id, ?),
              metadata = ?,
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(
      account.id,
      account.default_slack_channel,
      metadata,
      message.occurredAt,
      existing.id,
    )
    .run();
  return { id: existing.id, displayName };
}

async function claimReceipt(
  db: D1Database,
  accountId: string,
  messageId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO wechat_kf_message_receipts
         (line_account_id, message_id)
       VALUES (?, ?)`,
    )
    .bind(accountId, messageId)
    .run();
  return (result.meta.changes || 0) > 0;
}

async function persistWeChatKfMessage(
  env: Env['Bindings'],
  account: WeChatKfCallbackAccount,
  message: NormalizedWeChatKfMessage,
): Promise<void> {
  if (!(await claimReceipt(env.DB, account.id, message.receiptId))) return;

  try {
    const friend = await upsertWeChatKfFriend(env.DB, account, message);
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO messages_log
           (id, friend_id, direction, message_type, content,
            broadcast_id, scenario_step_id, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
      )
      .bind(
        `wechat-kf:${account.id}:${message.receiptId}`,
        friend.id,
        message.direction,
        message.messageType,
        message.storedContent,
        message.occurredAt,
      )
      .run();

    const chat = await getChatByFriendId(env.DB, friend.id);
    if (chat) {
      await updateChat(env.DB, chat.id, {
        status:
          message.direction === 'incoming' && chat.status === 'resolved'
            ? 'unread'
            : chat.status,
        lastMessageAt: message.occurredAt,
      });
    } else {
      const created = await createChat(env.DB, { friendId: friend.id });
      await updateChat(env.DB, created.id, {
        status: message.direction === 'incoming' ? 'unread' : 'in_progress',
        lastMessageAt: message.occurredAt,
      });
    }

    if (message.shouldNotify) {
      await fireEvent(
        env.DB,
        'message_received',
        {
          friendId: friend.id,
          suppressLineActions: true,
          eventData: {
            text: message.eventText,
            messageType: message.messageType,
            provider: 'wechat_kf',
            messageId: message.receiptId,
          },
        },
        undefined,
        account.id,
        {
          token: env.SLACK_BOT_TOKEN,
          googleTranslateApiKey: env.GOOGLE_TRANSLATE_API_KEY,
        },
      );
    }
  } catch (err) {
    await env.DB
      .prepare(
        `DELETE FROM wechat_kf_message_receipts
          WHERE line_account_id = ? AND message_id = ?`,
      )
      .bind(account.id, message.receiptId)
      .run();
    throw err;
  }
}

async function syncWeChatKfMessages(
  env: Env['Bindings'],
  account: WeChatKfCallbackAccount,
  callbackToken: string,
): Promise<void> {
  let cursor = account.wechat_kf_sync_cursor || '';

  for (let page = 0; page < 10; page += 1) {
    const result = await fetchWeChatKfMessages({
      db: env.DB,
      env,
      account: { ...account, wechat_kf_sync_cursor: cursor },
      callbackToken,
      cursor,
      limit: 100,
    });

    for (const rawMessage of result.messages) {
      const event = rawMessage.event;
      if (event?.event_type === 'enter_session' && event.welcome_code) {
        try {
          await sendWeChatKfWelcome({
            db: env.DB,
            env,
            account,
            welcomeCode: event.welcome_code,
          });
        } catch (err) {
          console.error('WeChat Customer Service welcome failed:', err);
        }
      }

      const message = await normalizeKfMessage(
        rawMessage,
        account.wechat_kf_open_kfid || '',
      );
      if (message) await persistWeChatKfMessage(env, account, message);
    }

    cursor = result.nextCursor;
    await env.DB
      .prepare(
        `UPDATE line_accounts
            SET wechat_kf_sync_cursor = ?,
                updated_at = datetime('now', '+9 hours')
          WHERE id = ?`,
      )
      .bind(cursor, account.id)
      .run();
    if (!result.hasMore) return;
  }

  console.warn('WeChat Customer Service sync stopped after 10 pages', account.id);
}

wechatKfWebhook.get('/webhook/wechat-kf/:accountId', async (c) => {
  const account = await resolveWeChatKfAccount(c.env.DB, c.req.param('accountId'));
  if (!account) return c.text('WeChat account not found', 404);
  if (!accountCallbackReady(account)) return c.text('Customer Service callback is not configured', 409);

  const timestamp = c.req.query('timestamp') || '';
  const nonce = c.req.query('nonce') || '';
  const echo = c.req.query('echostr') || '';
  const signature = c.req.query('msg_signature') || '';
  if (!timestamp || !nonce || !echo || !signature) return c.text('Bad request', 400);

  const valid = await verifyWeChatSignature(
    account.wechat_kf_callback_token,
    timestamp,
    nonce,
    signature,
    echo,
  );
  if (!valid) return c.text('Unauthorized', 401);

  try {
    return c.text(
      decryptWeChatPayload(
        echo,
        account.wechat_kf_encoding_aes_key,
        account.wechat_kf_corp_id,
      ),
    );
  } catch (err) {
    console.error('WeChat Customer Service callback verification failed:', err);
    return c.text('Invalid encrypted challenge', 400);
  }
});

wechatKfWebhook.post('/webhook/wechat-kf/:accountId', async (c) => {
  const account = await resolveWeChatKfAccount(c.env.DB, c.req.param('accountId'));
  if (!account) return c.text('WeChat account not found', 404);
  if (!accountCallbackReady(account)) return c.text('Customer Service callback is not configured', 409);

  const timestamp = c.req.query('timestamp') || '';
  const nonce = c.req.query('nonce') || '';
  const signature = c.req.query('msg_signature') || '';
  const rawBody = await c.req.text();
  const encrypted = readWeChatXmlValue(rawBody, 'Encrypt')?.trim() || '';
  if (!timestamp || !nonce || !signature || !encrypted) return c.text('Bad request', 400);

  const valid = await verifyWeChatSignature(
    account.wechat_kf_callback_token,
    timestamp,
    nonce,
    signature,
    encrypted,
  );
  if (!valid) return c.text('Unauthorized', 401);

  let decrypted = '';
  try {
    decrypted = decryptWeChatPayload(
      encrypted,
      account.wechat_kf_encoding_aes_key,
      account.wechat_kf_corp_id,
    );
  } catch (err) {
    console.error('WeChat Customer Service callback decryption failed:', err);
    return c.text('Bad encrypted request', 400);
  }

  const callbackToken = readWeChatXmlValue(decrypted, 'Token')?.trim() || '';
  const openKfid = readWeChatXmlValue(decrypted, 'OpenKfId')?.trim() || '';
  if (!callbackToken || (openKfid && openKfid !== account.wechat_kf_open_kfid)) {
    return c.text('Bad callback payload', 400);
  }

  c.executionCtx.waitUntil(
    syncWeChatKfMessages(c.env, account, callbackToken).catch((err) => {
      console.error('WeChat Customer Service sync failed:', err);
    }),
  );
  return c.text('success');
});

wechatKfWebhook.get('/wechat/:accountId/contact', async (c) => {
  const account = await resolveWeChatKfAccount(c.env.DB, c.req.param('accountId'));
  if (!account?.wechat_kf_contact_url) {
    return c.html(
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>WeChat</title><p>微信客服尚未配置。</p></html>',
      404,
    );
  }

  const destination = new URL(account.wechat_kf_contact_url);
  const ref = c.req.query('ref')?.trim();
  if (ref) destination.searchParams.set('scene_param', ref.slice(0, 128));
  return c.redirect(destination.toString(), 302);
});

export { wechatKfWebhook };
