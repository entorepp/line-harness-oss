import { Hono } from 'hono';
import { createChat, getChatByFriendId, jstNow, toJstString, updateChat } from '@line-crm/db';
import type { Env } from '../index.js';
import { fireEvent } from '../services/event-bus.js';

const kakaoWebhook = new Hono<Env>();

type KakaoChannelEvent = 'added' | 'blocked';
type KakaoIdType = 'app_user_id' | 'open_id';

interface KakaoChannelWebhookPayload {
  event?: KakaoChannelEvent;
  id?: string;
  id_type?: KakaoIdType;
  channel_public_id?: string;
  channel_uuid?: string;
  updated_at?: string;
  plus_friend_public_id?: string;
  plus_friend_uuid?: string;
  timestamp?: number;
}

interface KakaoMessageWebhookPayload {
  channelPublicId?: string;
  channel_public_id?: string;
  senderId?: string;
  sender_id?: string;
  userId?: string;
  user_id?: string;
  messageId?: string;
  message_id?: string;
  messageType?: string;
  message_type?: string;
  text?: string;
  content?: string;
  senderName?: string;
  sender_name?: string;
  profileName?: string;
  profile_name?: string;
  timestamp?: number;
  updated_at?: string;
  raw?: unknown;
}

type KakaoAccount = {
  id: string;
  channel_id: string;
  channel_secret: string;
  default_slack_channel: string | null;
};

type KakaoFriend = {
  id: string;
  displayName: string;
};

function buildKakaoUserId(payload: Required<Pick<KakaoChannelWebhookPayload, 'id' | 'id_type' | 'channel_public_id'>>): string {
  return `kakao:${payload.channel_public_id}:${payload.id_type}:${payload.id}`;
}

function normalizeKakaoDate(payload: Pick<KakaoChannelWebhookPayload, 'updated_at' | 'timestamp'>): string {
  const updatedAt = payload.updated_at?.trim();
  if (updatedAt) {
    const parsed = new Date(updatedAt);
    if (!Number.isNaN(parsed.getTime())) return toJstString(parsed);
  }

  if (typeof payload.timestamp === 'number' && Number.isFinite(payload.timestamp)) {
    return toJstString(new Date(payload.timestamp));
  }

  return jstNow();
}

function authHeaderMatches(received: string | undefined, expectedAdminKey: string): boolean {
  const expected = expectedAdminKey.trim();
  if (!received || !expected) return false;
  const expectedHeader = expected.startsWith('KakaoAK ') ? expected : `KakaoAK ${expected}`;
  return received === expectedHeader;
}

function bearerHeaderMatches(received: string | undefined, expectedSecret: string | undefined): boolean {
  const expected = expectedSecret?.trim();
  if (!received || !expected) return false;
  return received === `Bearer ${expected}` || received === expected;
}

async function resolveKakaoAccount(
  db: D1Database,
  channelPublicId: string,
): Promise<KakaoAccount | null> {
  return db
    .prepare(
      `SELECT id, channel_id, channel_secret, default_slack_channel
         FROM line_accounts
        WHERE channel_type = 'kakao'
          AND channel_id = ?
          AND is_active = 1
        LIMIT 1`,
    )
    .bind(channelPublicId)
    .first<KakaoAccount>();
}

function normalizeSenderId(payload: KakaoMessageWebhookPayload): string | null {
  return (
    payload.senderId ||
    payload.sender_id ||
    payload.userId ||
    payload.user_id ||
    null
  )?.trim() || null;
}

function normalizeMessageText(payload: KakaoMessageWebhookPayload): string | null {
  return (payload.text || payload.content || null)?.trim() || null;
}

function normalizeChannelPublicId(payload: KakaoMessageWebhookPayload): string | null {
  return (payload.channelPublicId || payload.channel_public_id || null)?.trim() || null;
}

function normalizeSenderName(payload: KakaoMessageWebhookPayload, senderId: string): string {
  return (
    payload.senderName ||
    payload.sender_name ||
    payload.profileName ||
    payload.profile_name ||
    `Kakao ${senderId}`
  ).trim();
}

function normalizeMessageType(payload: KakaoMessageWebhookPayload): string {
  const rawType = (payload.messageType || payload.message_type || 'text').trim().toLowerCase();
  return rawType || 'text';
}

function parseKakaoPayload(payload: unknown): KakaoChannelWebhookPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as KakaoChannelWebhookPayload;
  const channelPublicId = data.channel_public_id || data.plus_friend_public_id;
  if (!data.event || !data.id || !data.id_type || !channelPublicId) return null;
  if (data.event !== 'added' && data.event !== 'blocked') return null;
  if (data.id_type !== 'app_user_id' && data.id_type !== 'open_id') return null;

  return {
    ...data,
    channel_public_id: channelPublicId,
    channel_uuid: data.channel_uuid || data.plus_friend_uuid,
  };
}

async function upsertKakaoFriend(
  db: D1Database,
  account: KakaoAccount,
  payload: Required<Pick<KakaoChannelWebhookPayload, 'event' | 'id' | 'id_type' | 'channel_public_id'>> &
    Pick<KakaoChannelWebhookPayload, 'channel_uuid' | 'updated_at' | 'timestamp'>,
): Promise<{ id: string; displayName: string; isFollowing: boolean }> {
  const now = normalizeKakaoDate(payload);
  const lineUserId = buildKakaoUserId(payload);
  const displayName = payload.channel_uuid
    ? `${payload.channel_uuid} ${payload.id}`
    : `Kakao ${payload.id}`;
  const isFollowing = payload.event === 'added';
  const metadata = JSON.stringify({
    provider: 'kakao',
    kakaoId: payload.id,
    kakaoIdType: payload.id_type,
    channelPublicId: payload.channel_public_id,
    channelUuid: payload.channel_uuid ?? null,
    lastChannelEvent: payload.event,
    lastChannelEventAt: now,
  });

  const existing = await db
    .prepare(`SELECT id FROM friends WHERE line_user_id = ? LIMIT 1`)
    .bind(lineUserId)
    .first<{ id: string }>();

  if (!existing) {
    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO friends
           (id, line_user_id, display_name, picture_url, status_message, is_following, line_account_id, slack_channel_id, metadata, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        lineUserId,
        displayName,
        isFollowing ? 1 : 0,
        account.id,
        account.default_slack_channel,
        metadata,
        now,
        now,
      )
      .run();
    return { id, displayName, isFollowing };
  }

  await db
    .prepare(
      `UPDATE friends
          SET display_name = ?,
              is_following = ?,
              line_account_id = ?,
              slack_channel_id = COALESCE(slack_channel_id, ?),
              metadata = ?,
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(
      displayName,
      isFollowing ? 1 : 0,
      account.id,
      account.default_slack_channel,
      metadata,
      now,
      existing.id,
    )
    .run();

  return { id: existing.id, displayName, isFollowing };
}

async function upsertKakaoMessageFriend(
  db: D1Database,
  account: KakaoAccount,
  payload: {
    senderId: string;
    senderName: string;
    messageId: string | null;
    messageType: string;
    occurredAt: string;
  },
): Promise<KakaoFriend> {
  const lineUserId = `kakao:${account.channel_id}:provider:${payload.senderId}`;
  const metadata = JSON.stringify({
    provider: 'kakao',
    kakaoProviderSenderId: payload.senderId,
    lastProviderMessageId: payload.messageId,
    lastProviderMessageType: payload.messageType,
    lastProviderMessageAt: payload.occurredAt,
  });

  const existing = await db
    .prepare(`SELECT id FROM friends WHERE line_user_id = ? LIMIT 1`)
    .bind(lineUserId)
    .first<{ id: string }>();

  if (!existing) {
    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO friends
           (id, line_user_id, display_name, picture_url, status_message, is_following, line_account_id, slack_channel_id, metadata, created_at, updated_at)
         VALUES (?, ?, ?, NULL, NULL, 1, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        lineUserId,
        payload.senderName,
        account.id,
        account.default_slack_channel,
        metadata,
        payload.occurredAt,
        payload.occurredAt,
      )
      .run();
    return { id, displayName: payload.senderName };
  }

  await db
    .prepare(
      `UPDATE friends
          SET display_name = ?,
              is_following = 1,
              line_account_id = ?,
              slack_channel_id = COALESCE(slack_channel_id, ?),
              metadata = ?,
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(
      payload.senderName,
      account.id,
      account.default_slack_channel,
      metadata,
      payload.occurredAt,
      existing.id,
    )
    .run();

  return { id: existing.id, displayName: payload.senderName };
}

async function updateKakaoChatState(db: D1Database, friendId: string, isFollowing: boolean, occurredAt: string): Promise<void> {
  const existingChat = await getChatByFriendId(db, friendId);
  if (!existingChat && isFollowing) {
    const chat = await createChat(db, { friendId });
    await updateChat(db, chat.id, { status: 'in_progress', lastMessageAt: occurredAt });
    return;
  }

  if (existingChat && isFollowing) {
    await updateChat(db, existingChat.id, { lastMessageAt: occurredAt });
  }
}

kakaoWebhook.post('/webhook/kakao', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.text('Bad request', 400);
  }

  const payload = parseKakaoPayload(body);
  if (!payload?.channel_public_id || !payload.id || !payload.id_type || !payload.event) {
    return c.text('Bad request', 400);
  }

  const account = await resolveKakaoAccount(c.env.DB, payload.channel_public_id);
  if (!account) {
    console.error('No active Kakao account found for webhook payload', {
      channelPublicId: payload.channel_public_id,
      event: payload.event,
    });
    return c.text('No Kakao account configured', 404);
  }

  if (!authHeaderMatches(c.req.header('Authorization'), account.channel_secret)) {
    console.error('Kakao webhook authorization failed', {
      accountId: account.id,
      channelPublicId: payload.channel_public_id,
    });
    return c.text('Unauthorized', 401);
  }

  const occurredAt = normalizeKakaoDate(payload);
  const friend = await upsertKakaoFriend(c.env.DB, account, {
    event: payload.event,
    id: payload.id,
    id_type: payload.id_type,
    channel_public_id: payload.channel_public_id,
    channel_uuid: payload.channel_uuid,
    updated_at: payload.updated_at,
    timestamp: payload.timestamp,
  });
  await updateKakaoChatState(c.env.DB, friend.id, friend.isFollowing, occurredAt);

  console.log('Kakao channel webhook received', {
    accountId: account.id,
    channelPublicId: payload.channel_public_id,
    event: payload.event,
    idType: payload.id_type,
  });

  return c.text('OK', 200);
});

kakaoWebhook.post('/webhook/kakao/messages', async (c) => {
  if (!bearerHeaderMatches(c.req.header('Authorization'), c.env.KAKAO_MESSAGE_WEBHOOK_SECRET)) {
    return c.text('Unauthorized', 401);
  }

  let body: KakaoMessageWebhookPayload;
  try {
    body = await c.req.json<KakaoMessageWebhookPayload>();
  } catch {
    return c.text('Bad request', 400);
  }

  const channelPublicId = normalizeChannelPublicId(body);
  const senderId = normalizeSenderId(body);
  const text = normalizeMessageText(body);
  if (!channelPublicId || !senderId || !text) {
    return c.json({ success: false, error: 'channelPublicId, senderId, and text are required' }, 400);
  }

  const account = await resolveKakaoAccount(c.env.DB, channelPublicId);
  if (!account) {
    return c.text('No Kakao account configured', 404);
  }

  const messageType = normalizeMessageType(body);
  if (messageType !== 'text') {
    return c.json({ success: false, error: 'Only text Kakao provider messages are supported for now' }, 400);
  }

  const occurredAt = normalizeKakaoDate(body);
  const messageId = (body.messageId || body.message_id || null)?.trim() || null;
  const friend = await upsertKakaoMessageFriend(c.env.DB, account, {
    senderId,
    senderName: normalizeSenderName(body, senderId),
    messageId,
    messageType,
    occurredAt,
  });

  const logId = crypto.randomUUID();
  await c.env.DB
    .prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
       VALUES (?, ?, 'incoming', 'text', ?, NULL, NULL, ?)`,
    )
    .bind(logId, friend.id, text, occurredAt)
    .run();

  const chat = await getChatByFriendId(c.env.DB, friend.id);
  if (chat) {
    await updateChat(c.env.DB, chat.id, { status: chat.status === 'resolved' ? 'unread' : chat.status, lastMessageAt: occurredAt });
  } else {
    const created = await createChat(c.env.DB, { friendId: friend.id });
    await updateChat(c.env.DB, created.id, { status: 'unread', lastMessageAt: occurredAt });
  }

  await fireEvent(
    c.env.DB,
    'message_received',
    { friendId: friend.id, eventData: { text, messageType: 'text', provider: 'kakao', messageId } },
    undefined,
    account.id,
    { token: c.env.SLACK_BOT_TOKEN, googleTranslateApiKey: c.env.GOOGLE_TRANSLATE_API_KEY },
  );

  return c.json({ success: true, data: { messageId: logId, friendId: friend.id } }, 202);
});

export { kakaoWebhook };
