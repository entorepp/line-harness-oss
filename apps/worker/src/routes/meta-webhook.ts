import { Hono } from 'hono';
import { createChat, getChatByFriendId, jstNow, updateChat } from '@line-crm/db';
import type { Env } from '../index.js';
import { fireEvent } from '../services/event-bus.js';
import { tryDeliverCustomerQuote } from '../services/quote-chat-delivery.js';
import {
  fetchMetaCustomerProfile,
  type MetaMessagingChannelType,
} from '../services/meta-messaging.js';
import {
  channelTypeForObject,
  normalizeMetaEvent,
  verifyMetaSignature,
  type MetaAttachment,
  type MetaWebhookPayload,
  type NormalizedMetaMessage,
} from '../services/meta-webhook-utils.js';

const metaWebhook = new Hono<Env>();

type MetaAccount = {
  id: string;
  channel_id: string;
  channel_access_token: string;
  channel_secret: string;
  channel_type: MetaMessagingChannelType;
  default_slack_channel: string | null;
};

type StoredMetaMessage = {
  messageType: string;
  content: string;
  eventText: string;
  mediaUrl?: string;
  fileName?: string;
};

async function getMetaAccount(
  db: D1Database,
  channelType: MetaMessagingChannelType,
  channelId?: string,
): Promise<MetaAccount | null> {
  if (channelId) {
    const exact = await db
      .prepare(
        `SELECT id, channel_id, channel_access_token, channel_secret, channel_type, default_slack_channel
           FROM line_accounts
          WHERE channel_type = ? AND channel_id = ? AND is_active = 1
          LIMIT 1`,
      )
      .bind(channelType, channelId)
      .first<MetaAccount>();
    if (exact) return exact;
  }

  return db
    .prepare(
      `SELECT id, channel_id, channel_access_token, channel_secret, channel_type, default_slack_channel
         FROM line_accounts
        WHERE channel_type = ? AND is_active = 1
        LIMIT 1`,
    )
    .bind(channelType)
    .first<MetaAccount>();
}

function getExtension(mimeType: string, type: string): string {
  const subtype = mimeType.split('/')[1]?.split(';')[0]?.toLowerCase();
  if (subtype === 'jpeg') return 'jpg';
  if (subtype) return subtype.replace(/[^a-z0-9]/g, '') || 'bin';
  if (type === 'image') return 'jpg';
  if (type === 'video') return 'mp4';
  if (type === 'audio') return 'mp3';
  return 'bin';
}

function fileIcon(type: string): string {
  if (type === 'image') return '🖼';
  if (type === 'video') return '🎥';
  if (type === 'audio') return '🎵';
  return '📎';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

async function persistAttachment(
  env: Env['Bindings'],
  attachment: MetaAttachment,
): Promise<StoredMetaMessage> {
  const type = attachment.type?.trim() || 'file';
  const location = attachment.payload?.coordinates;
  if (type === 'location' && location) {
    const content = `${location.lat ?? ''}, ${location.long ?? ''}`;
    return { messageType: 'text', content, eventText: `📍 位置情報 ${content}` };
  }

  const providerUrl = attachment.payload?.url?.trim();
  if (!providerUrl) {
    return { messageType: 'text', content: `[${type}]`, eventText: `[${type}]` };
  }

  let storedUrl = providerUrl;
  let storedFileName = attachment.payload?.title?.trim() || '';
  let storedFileSize = '';
  try {
    // Meta attachment URLs are signed, short-lived CDN URLs. Never forward the
    // Page access token to the attachment host.
    const response = await fetch(providerUrl);
    if (response.ok) {
      const body = await response.arrayBuffer();
      const mimeType = response.headers.get('content-type') || 'application/octet-stream';
      const extension = getExtension(mimeType, type);
      const key = `${crypto.randomUUID()}.${extension}`;
      storedFileName ||= `meta-${type}.${extension}`;
      storedFileSize = formatFileSize(body.byteLength);
      await env.UPLOADS.put(key, body, {
        metadata: {
          contentType: mimeType,
          originalName: storedFileName,
          size: body.byteLength,
        },
      });
      const workerUrl = env.WORKER_URL.replace(/\/+$/, '');
      storedUrl = `${workerUrl}/api/files/${key}`;
    }
  } catch (error) {
    console.error('Meta attachment persistence failed; keeping provider URL:', error);
  }

  if (type === 'image' || type === 'sticker') {
    return {
      messageType: 'image',
      content: JSON.stringify({
        url: storedUrl,
        originalContentUrl: storedUrl,
        previewImageUrl: storedUrl,
      }),
      eventText: '📷 画像を送信',
      mediaUrl: storedUrl,
      fileName: storedFileName || undefined,
    };
  }
  if (type === 'video' || type === 'audio') {
    return {
      messageType: type,
      content: JSON.stringify({ url: storedUrl }),
      eventText: type === 'video' ? '🎥 動画を送信' : '🎵 音声を送信',
      mediaUrl: storedUrl,
      fileName: storedFileName || undefined,
    };
  }

  const fileName = storedFileName || 'Meta attachment';
  return {
    messageType: 'file',
    content: JSON.stringify({
      url: storedUrl,
      fileName,
      fileSize: storedFileSize,
      fileIcon: fileIcon(type),
    }),
    eventText: `📎 ファイル: ${fileName}`,
    mediaUrl: storedUrl,
    fileName,
  };
}

async function ensureMetaFriend(
  db: D1Database,
  account: MetaAccount,
  customerId: string,
): Promise<{ id: string; slackChannelId: string | null }> {
  const externalId = `${account.channel_type}:${account.channel_id}:${customerId}`;
  const existing = await db
    .prepare(`SELECT id, display_name, slack_channel_id, metadata FROM friends WHERE line_user_id = ? LIMIT 1`)
    .bind(externalId)
    .first<{ id: string; display_name: string | null; slack_channel_id: string | null; metadata: string | null }>();

  let displayName = existing?.display_name || customerId;
  let pictureUrl: string | null = null;
  let username: string | null = null;
  if (!existing || !existing.display_name || existing.display_name === customerId) {
    try {
      const profile = await fetchMetaCustomerProfile({
        channelType: account.channel_type,
        customerId,
        accessToken: account.channel_access_token,
      });
      displayName = profile.displayName || customerId;
      pictureUrl = profile.pictureUrl;
      username = profile.username;
    } catch (error) {
      console.warn('Meta customer profile lookup failed:', error);
    }
  }

  let metadata: Record<string, unknown> = {};
  if (existing?.metadata) {
    try {
      const parsed = JSON.parse(existing.metadata);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      }
    } catch {
      metadata = {};
    }
  }
  metadata = {
    ...metadata,
    provider: account.channel_type,
    recipientId: customerId,
    ...(username ? { username } : {}),
  };
  const now = jstNow();

  if (!existing) {
    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO friends
           (id, line_user_id, display_name, picture_url, is_following, line_account_id, slack_channel_id, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        externalId,
        displayName,
        pictureUrl,
        account.id,
        account.default_slack_channel,
        JSON.stringify(metadata),
        now,
        now,
      )
      .run();
    return { id, slackChannelId: account.default_slack_channel };
  }

  await db
    .prepare(
      `UPDATE friends
          SET display_name = ?,
              picture_url = COALESCE(?, picture_url),
              line_account_id = ?,
              slack_channel_id = COALESCE(slack_channel_id, ?),
              metadata = ?,
              is_following = 1,
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(
      displayName,
      pictureUrl,
      account.id,
      account.default_slack_channel,
      JSON.stringify(metadata),
      now,
      existing.id,
    )
    .run();
  return {
    id: existing.id,
    slackChannelId: existing.slack_channel_id || account.default_slack_channel,
  };
}

async function updateMetaChat(
  db: D1Database,
  friendId: string,
  direction: 'incoming' | 'outgoing',
  messageAt: string,
): Promise<void> {
  const existing = await getChatByFriendId(db, friendId);
  if (!existing) {
    const chat = await createChat(db, { friendId });
    await updateChat(db, chat.id, {
      status: direction === 'incoming' ? 'unread' : 'in_progress',
      lastMessageAt: messageAt,
    });
    return;
  }

  const isNewest = !existing.last_message_at
    || new Date(messageAt).getTime() >= new Date(existing.last_message_at).getTime();
  if (!isNewest) return;
  await updateChat(db, existing.id, {
    status: direction === 'incoming'
      ? existing.status === 'resolved' ? 'unread' : existing.status
      : 'in_progress',
    lastMessageAt: messageAt,
  });
}

async function claimMessageReceipt(db: D1Database, accountId: string, messageId: string): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO meta_message_receipts (line_account_id, message_id, created_at)
       VALUES (?, ?, ?)`,
    )
    .bind(accountId, messageId, jstNow())
    .run();
  return Boolean(result.meta.changes);
}

async function releaseMessageReceipt(db: D1Database, accountId: string, messageId: string): Promise<void> {
  await db
    .prepare(`DELETE FROM meta_message_receipts WHERE line_account_id = ? AND message_id = ?`)
    .bind(accountId, messageId)
    .run();
}

async function echoAlreadyLogged(
  db: D1Database,
  friendId: string,
  content: string,
  messageAt: string,
): Promise<boolean> {
  const recent = await db
    .prepare(
      `SELECT created_at
         FROM messages_log
        WHERE friend_id = ? AND direction = 'outgoing' AND message_type = 'text' AND content = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
    )
    .bind(friendId, content)
    .first<{ created_at: string }>();
  if (!recent?.created_at) return false;
  return Math.abs(new Date(messageAt).getTime() - new Date(recent.created_at).getTime()) <= 2 * 60 * 1000;
}

async function persistMetaMessage(
  env: Env['Bindings'],
  account: MetaAccount,
  message: NormalizedMetaMessage,
): Promise<void> {
  if (!await claimMessageReceipt(env.DB, account.id, message.messageId)) return;

  try {
    const friend = await ensureMetaFriend(env.DB, account, message.customerId);
    const stored = message.attachment
      ? await persistAttachment(env, message.attachment)
      : {
          messageType: 'text',
          content: message.text,
          eventText: message.text,
        } satisfies StoredMetaMessage;

    const duplicateEcho = message.direction === 'outgoing'
      && stored.messageType === 'text'
      && await echoAlreadyLogged(env.DB, friend.id, stored.content, message.occurredAt);
    if (!duplicateEcho) {
      await env.DB
        .prepare(
          `INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          friend.id,
          message.direction,
          stored.messageType,
          stored.content,
          message.occurredAt,
        )
        .run();
    }

    await updateMetaChat(env.DB, friend.id, message.direction, message.occurredAt);

    if (message.direction === 'incoming') {
      const quoteHandled = await tryDeliverCustomerQuote({
        env,
        friendId: friend.id,
        channel: account.channel_type,
        providerMessageId: message.messageId,
        text: message.text,
      });
      if (quoteHandled) return;
      await fireEvent(
        env.DB,
        'message_received',
        {
          friendId: friend.id,
          suppressLineActions: true,
          eventData: {
            text: message.text || stored.eventText,
            matched: false,
            messageType: stored.messageType,
            mediaUrl: stored.mediaUrl,
            fileName: stored.fileName,
            provider: account.channel_type,
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
  } catch (error) {
    await releaseMessageReceipt(env.DB, account.id, message.messageId).catch(() => undefined);
    throw error;
  }
}

metaWebhook.get('/webhook/meta', async (c) => {
  const mode = c.req.query('hub.mode');
  const token = c.req.query('hub.verify_token');
  const challenge = c.req.query('hub.challenge');
  if (
    mode === 'subscribe'
    && challenge
    && token
    && c.env.META_VERIFY_TOKEN
    && token === c.env.META_VERIFY_TOKEN
  ) {
    return c.text(challenge, 200);
  }
  return c.text('Forbidden', 403);
});

metaWebhook.post('/webhook/meta', async (c) => {
  const rawBody = await c.req.text();
  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MetaWebhookPayload;
  } catch {
    return c.text('Bad request', 400);
  }

  const channelType = channelTypeForObject(payload.object);
  if (!channelType) return c.text('Ignored', 200);
  const firstEntryId = payload.entry?.find((entry) => entry.id?.trim())?.id?.trim();
  const signatureAccount = await getMetaAccount(c.env.DB, channelType, firstEntryId);
  if (!signatureAccount?.channel_secret) {
    console.error('No active Meta messaging account is configured for webhook verification', {
      channelType,
      channelId: firstEntryId || null,
    });
    return c.text('Unauthorized', 401);
  }
  if (!await verifyMetaSignature(
    signatureAccount.channel_secret,
    rawBody,
    c.req.header('X-Hub-Signature-256'),
  )) {
    console.error('Meta messaging webhook signature validation failed', {
      channelType,
      channelId: firstEntryId || null,
    });
    return c.text('Unauthorized', 401);
  }

  try {
    for (const entry of payload.entry ?? []) {
      const account = await getMetaAccount(c.env.DB, channelType, entry.id?.trim());
      if (!account || (entry.id && account.channel_id !== entry.id)) {
        console.warn('Ignoring Meta webhook entry for an unregistered channel', {
          channelType,
          channelId: entry.id || null,
        });
        continue;
      }

      const events = [...(entry.messaging ?? []), ...(entry.standby ?? [])];
      for (const event of events) {
        const message = normalizeMetaEvent(event, entry);
        if (message) await persistMetaMessage(c.env, account, message);
      }
    }
    return c.text('EVENT_RECEIVED', 200);
  } catch (error) {
    console.error('Meta messaging webhook processing failed:', error);
    return c.text('Internal error', 500);
  }
});

export {
  metaWebhook,
};
