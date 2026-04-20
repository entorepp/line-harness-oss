import { Hono } from 'hono';
import { createChat, getChatByFriendId, jstNow, toJstString, updateChat } from '@line-crm/db';
import type { Env } from '../index.js';

const waWebhook = new Hono<Env>();
const GRAPH_API = 'https://graph.facebook.com/v22.0';

type WaDirection = 'incoming' | 'outgoing';
type BridgeWaDirection = WaDirection | 'outbound';

interface WaForwardedMessage {
  from: string;
  to?: string;
  senderName: string;
  type: string;
  text?: string;
  mediaUrl?: string;
  mimeType?: string;
  fileName?: string;
  messageId: string;
  slackChannelId?: string;
  accountId?: string;
  lineAccountId?: string;
  channelId?: string;
  phoneNumberId?: string;
  whatsappPhoneNumberId?: string;
  direction?: BridgeWaDirection;
  timestamp?: string;
}

interface NormalizedWaMessage extends WaForwardedMessage {
  direction: WaDirection;
  occurredAt: string;
}

interface MetaWebhookPayload {
  object?: string;
  entry?: MetaWebhookEntry[];
}

interface MetaWebhookEntry {
  id?: string;
  changes?: MetaWebhookChange[];
}

interface MetaWebhookChange {
  field?: string;
  value?: MetaWebhookValue;
}

interface MetaContact {
  profile?: {
    name?: string;
    username?: string;
  };
  wa_id?: string;
}

interface MetaWebhookValue {
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  contacts?: MetaContact[];
  messages?: MetaMessage[];
  message_echoes?: MetaMessage[];
  statuses?: unknown[];
}

interface MetaMessage {
  from?: string;
  to?: string;
  id?: string;
  type?: string;
  timestamp?: string;
  text?: {
    body?: string;
  };
  button?: {
    text?: string;
  };
  reaction?: {
    emoji?: string;
  };
  interactive?: {
    button_reply?: {
      title?: string;
      id?: string;
    };
    list_reply?: {
      title?: string;
      id?: string;
      description?: string;
    };
  };
  location?: {
    latitude?: number;
    longitude?: number;
    name?: string;
    address?: string;
  };
  image?: MetaMediaObject;
  audio?: MetaMediaObject;
  video?: MetaMediaObject;
  document?: MetaMediaObject;
  sticker?: MetaMediaObject;
}

interface MetaMediaObject {
  id?: string;
  mime_type?: string;
  filename?: string;
}

interface CoexistenceEventPayload {
  id?: string;
  event?: string;
  data?: CoexistenceEventData;
}

interface CoexistenceEventData {
  id?: string;
  messaging_product?: string;
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  history?: CoexistenceHistoryChunk[];
  state_sync?: CoexistenceStateSyncItem[];
}

interface CoexistenceHistoryChunk {
  metadata?: {
    phase?: string;
    chunk_order?: number;
    progress?: string;
  };
  threads?: CoexistenceHistoryThread[];
  errors?: Array<{
    code?: number;
    title?: string;
    message?: string;
  }>;
}

interface CoexistenceHistoryThread {
  id?: string;
  messages?: MetaMessage[];
}

interface CoexistenceStateSyncItem {
  type?: string;
  action?: string;
  contact?: {
    full_name?: string;
    first_name?: string;
    phone_number?: string;
  };
  metadata?: {
    timestamp?: string;
  };
}

interface ResolvedWhatsAppAccount {
  id: string;
  channel_id: string;
  channel_access_token: string;
  channel_secret: string;
  default_slack_channel: string | null;
}

interface StoredMedia {
  url: string;
  fileName: string;
  fileSize: string;
  fileIcon: string;
}

function isMetaWebhookPayload(payload: unknown): payload is MetaWebhookPayload {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      (payload as MetaWebhookPayload).object === 'whatsapp_business_account',
  );
}

function isCoexistenceEventPayload(payload: unknown): payload is CoexistenceEventPayload {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      typeof (payload as CoexistenceEventPayload).event === 'string' &&
      (payload as CoexistenceEventPayload).data &&
      typeof (payload as CoexistenceEventPayload).data === 'object',
  );
}

function resolveContactIdentifier(contact?: MetaContact | null): string {
  const waId = contact?.wa_id?.trim();
  if (waId) return waId;

  const username = contact?.profile?.username?.trim();
  if (username) return username;

  return '';
}

function resolveContactDisplayName(contact: MetaContact | null | undefined, fallback: string): string {
  const name = contact?.profile?.name?.trim();
  if (name) return name;

  const username = contact?.profile?.username?.trim();
  if (username) return username;

  return fallback;
}

function resolveOccurredAt(timestamp?: string): string {
  const trimmed = timestamp?.trim();
  if (!trimmed) return jstNow();

  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const millis = trimmed.length > 10 ? numeric : numeric * 1000;
      return toJstString(new Date(millis));
    }
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return toJstString(parsed);
  }

  return jstNow();
}

function isLaterTimestamp(candidate: string, baseline: string | null | undefined): boolean {
  if (!baseline) return true;
  return new Date(candidate).getTime() >= new Date(baseline).getTime();
}

function inferMetaText(message: MetaMessage): string {
  if (typeof message.text?.body === 'string' && message.text.body.trim()) {
    return message.text.body.trim();
  }

  if (typeof message.button?.text === 'string' && message.button.text.trim()) {
    return message.button.text.trim();
  }

  if (typeof message.reaction?.emoji === 'string' && message.reaction.emoji.trim()) {
    return `[reaction] ${message.reaction.emoji.trim()}`;
  }

  if (
    typeof message.interactive?.button_reply?.title === 'string' &&
    message.interactive.button_reply.title.trim()
  ) {
    return message.interactive.button_reply.title.trim();
  }

  if (
    typeof message.interactive?.list_reply?.title === 'string' &&
    message.interactive.list_reply.title.trim()
  ) {
    return message.interactive.list_reply.title.trim();
  }

  if (message.location) {
    const lines = [
      message.location.name,
      message.location.address,
      typeof message.location.latitude === 'number' &&
      typeof message.location.longitude === 'number'
        ? `${message.location.latitude}, ${message.location.longitude}`
        : undefined,
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

    if (lines.length > 0) {
      return lines.join('\n');
    }
  }

  return '';
}

function getMetaMediaObject(message: MetaMessage): MetaMediaObject | null {
  switch (message.type) {
    case 'image':
      return message.image ?? null;
    case 'audio':
      return message.audio ?? null;
    case 'video':
      return message.video ?? null;
    case 'document':
      return message.document ?? null;
    case 'sticker':
      return message.sticker ?? null;
    default:
      return null;
  }
}

function getExtension(fileName: string, mimeType: string): string {
  const dotIdx = fileName.lastIndexOf('.');
  if (dotIdx !== -1) return fileName.slice(dotIdx + 1).toLowerCase();

  const sub = mimeType.split('/')[1] || '';
  if (sub === 'jpeg') return 'jpg';
  if (sub === 'webp') return 'webp';
  if (sub === 'mpeg') return 'mp3';
  if (sub === 'mp4') return 'mp4';
  if (sub === 'ogg') return 'ogg';
  if (sub === 'pdf') return 'pdf';
  if (sub === 'plain') return 'txt';
  if (sub === 'vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  return sub || 'bin';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function getFileIcon(ext: string): string {
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return '\u{1F5BC}';
  if (ext === 'pdf') return '\u{1F4C4}';
  if (['doc', 'docx'].includes(ext)) return '\u{1F4DD}';
  if (['ppt', 'pptx', 'xls', 'xlsx', 'csv'].includes(ext)) return '\u{1F4CA}';
  if (['mp4', 'mov', 'avi'].includes(ext)) return '\u{1F3AC}';
  if (['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) return '\u{1F3B5}';
  return '\u{1F4CE}';
}

function normalizeStoredWaMessage(
  msg: Pick<WaForwardedMessage, 'type' | 'text' | 'mediaUrl'>,
  media?: StoredMedia | null,
): {
  messageType: string;
  content: string;
} {
  const text = msg.text?.trim() || '';
  const mediaUrl = media?.url || msg.mediaUrl?.trim() || '';

  switch (msg.type) {
    case 'image':
    case 'sticker':
      if (mediaUrl) {
        return {
          messageType: 'image',
          content: JSON.stringify({
            url: mediaUrl,
            originalContentUrl: mediaUrl,
            previewImageUrl: mediaUrl,
          }),
        };
      }
      break;
    case 'video':
    case 'audio':
      if (mediaUrl) {
        return {
          messageType: msg.type,
          content: JSON.stringify({ url: mediaUrl }),
        };
      }
      break;
    case 'document':
    case 'file':
      if (mediaUrl) {
        return {
          messageType: 'file',
          content: JSON.stringify({
            url: mediaUrl,
            fileName: media?.fileName || text || 'WhatsApp file',
            fileSize: media?.fileSize || '',
            fileIcon: media?.fileIcon || '\u{1F4CE}',
          }),
        };
      }
      break;
    default:
      break;
  }

  return {
    messageType: 'text',
    content: text || mediaUrl || `[${msg.type}]`,
  };
}

async function resolveWhatsAppAccountId(
  db: D1Database,
  msg: Pick<
    WaForwardedMessage,
    'lineAccountId' | 'accountId' | 'phoneNumberId' | 'whatsappPhoneNumberId' | 'channelId'
  >,
): Promise<ResolvedWhatsAppAccount | null> {
  const requestedAccountId = msg.lineAccountId || msg.accountId;
  if (requestedAccountId) {
    const account = await db
      .prepare(
        `SELECT id, channel_id, channel_access_token, channel_secret, default_slack_channel
           FROM line_accounts
          WHERE id = ? AND channel_type = 'whatsapp' AND is_active = 1`,
      )
      .bind(requestedAccountId)
      .first<ResolvedWhatsAppAccount>();
    if (account) return account;
  }

  const phoneNumberId = msg.phoneNumberId || msg.whatsappPhoneNumberId || msg.channelId;
  if (phoneNumberId) {
    const account = await db
      .prepare(
        `SELECT id, channel_id, channel_access_token, channel_secret, default_slack_channel
           FROM line_accounts
          WHERE channel_id = ? AND channel_type = 'whatsapp' AND is_active = 1`,
      )
      .bind(phoneNumberId)
      .first<ResolvedWhatsAppAccount>();
    if (account) return account;
  }

  return db
    .prepare(
      `SELECT id, channel_id, channel_access_token, channel_secret, default_slack_channel
         FROM line_accounts
        WHERE channel_type = 'whatsapp' AND is_active = 1
        LIMIT 1`,
    )
    .first<ResolvedWhatsAppAccount>();
}

function extractWebhookPhoneNumberId(payload: unknown): string | null {
  if (isMetaWebhookPayload(payload)) {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const phoneNumberId = change.value?.metadata?.phone_number_id?.trim();
        if (phoneNumberId) return phoneNumberId;
      }
    }
  }

  if (isCoexistenceEventPayload(payload)) {
    const phoneNumberId = payload.data?.metadata?.phone_number_id?.trim();
    if (phoneNumberId) return phoneNumberId;
  }

  return null;
}

async function resolveWhatsAppAccountForPayload(
  db: D1Database,
  payload: unknown,
): Promise<ResolvedWhatsAppAccount | null> {
  const phoneNumberId = extractWebhookPhoneNumberId(payload);
  return resolveWhatsAppAccountId(db, { phoneNumberId: phoneNumberId ?? undefined });
}

async function signHmacSha256(secret: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  let mismatch = 0;
  for (let idx = 0; idx < left.length; idx += 1) {
    mismatch |= left.charCodeAt(idx) ^ right.charCodeAt(idx);
  }
  return mismatch === 0;
}

async function verifyMetaSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | undefined,
): Promise<boolean> {
  if (!signatureHeader) return false;

  const [prefix, receivedSignature] = signatureHeader.split('=');
  if (prefix !== 'sha256' || !receivedSignature) return false;

  const expectedSignature = await signHmacSha256(secret, rawBody);
  return timingSafeEqual(expectedSignature, receivedSignature);
}

async function downloadMetaMedia(
  env: Env['Bindings'],
  account: ResolvedWhatsAppAccount,
  requestUrl: string,
  mediaId: string,
  mimeTypeHint: string,
  fileNameHint: string,
): Promise<StoredMedia | null> {
  const metadataRes = await fetch(`${GRAPH_API}/${mediaId}`, {
    headers: {
      Authorization: `Bearer ${account.channel_access_token}`,
    },
  });

  if (!metadataRes.ok) {
    const reason = await metadataRes.text().catch(() => '');
    throw new Error(`Failed to resolve WhatsApp media ${mediaId}: ${reason}`);
  }

  const metadata = (await metadataRes.json()) as {
    url?: string;
    mime_type?: string;
    file_size?: number;
  };
  if (!metadata.url) {
    return null;
  }

  const mediaRes = await fetch(metadata.url, {
    headers: {
      Authorization: `Bearer ${account.channel_access_token}`,
    },
  });
  if (!mediaRes.ok) {
    const reason = await mediaRes.text().catch(() => '');
    throw new Error(`Failed to download WhatsApp media ${mediaId}: ${reason}`);
  }

  const arrayBuffer = await mediaRes.arrayBuffer();
  const mimeType =
    mediaRes.headers.get('content-type') || metadata.mime_type || mimeTypeHint || 'application/octet-stream';
  const fileName = fileNameHint || `${mediaId}.${getExtension('', mimeType)}`;
  const ext = getExtension(fileName, mimeType);
  const key = `${crypto.randomUUID()}.${ext}`;

  await env.UPLOADS.put(key, arrayBuffer, {
    metadata: {
      contentType: mimeType,
      originalName: fileName,
      size: arrayBuffer.byteLength,
    },
  });

  const baseUrl = env.WORKER_URL || new URL(requestUrl).origin;
  return {
    url: `${baseUrl}/api/files/${key}`,
    fileName,
    fileSize: formatFileSize(arrayBuffer.byteLength),
    fileIcon: getFileIcon(ext),
  };
}

async function ensureWaFriend(
  db: D1Database,
  account: ResolvedWhatsAppAccount,
  externalId: string,
  displayName: string,
  slackChannelId?: string | null,
): Promise<{ id: string; slack_channel_id: string | null }> {
  const now = jstNow();
  const friend = await db
    .prepare(`SELECT id, slack_channel_id FROM friends WHERE line_user_id = ? AND line_account_id = ? LIMIT 1`)
    .bind(externalId, account.id)
    .first<{ id: string; slack_channel_id: string | null }>();

  const nextSlackChannelId = slackChannelId ?? account.default_slack_channel ?? null;
  if (!friend) {
    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO friends (id, line_user_id, display_name, is_following, line_account_id, slack_channel_id, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
      )
      .bind(id, externalId, displayName, account.id, nextSlackChannelId, now, now)
      .run();
    return { id, slack_channel_id: nextSlackChannelId };
  }

  await db
    .prepare(
      `UPDATE friends
          SET display_name = ?,
              line_account_id = ?,
              slack_channel_id = COALESCE(?, slack_channel_id),
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(displayName, account.id, nextSlackChannelId, now, friend.id)
    .run();

  return {
    id: friend.id,
    slack_channel_id: nextSlackChannelId ?? friend.slack_channel_id,
  };
}

async function updateChatForWaMessage(
  db: D1Database,
  friendId: string,
  direction: WaDirection,
  occurredAt: string,
): Promise<void> {
  const existingChat = await getChatByFriendId(db, friendId);
  if (!existingChat) {
    const chat = await createChat(db, { friendId });
    await updateChat(db, chat.id, {
      status: direction === 'incoming' ? 'unread' : 'in_progress',
      lastMessageAt: occurredAt,
    });
    return;
  }

  const isNewestMessage = isLaterTimestamp(occurredAt, existingChat.last_message_at);
  const nextLastMessageAt = isNewestMessage ? occurredAt : existingChat.last_message_at ?? occurredAt;
  const nextStatus = isNewestMessage
    ? direction === 'incoming'
      ? existingChat.status === 'resolved'
        ? 'unread'
        : existingChat.status
      : 'in_progress'
    : existingChat.status;

  await updateChat(db, existingChat.id, {
    status: nextStatus,
    lastMessageAt: nextLastMessageAt,
  });
}

function resolveCounterpartyId(msg: NormalizedWaMessage): string | null {
  const incomingFrom = msg.from.trim();
  if (msg.direction === 'incoming') {
    return incomingFrom || null;
  }

  const outgoingTo = msg.to?.trim();
  if (outgoingTo) return outgoingTo;

  return null;
}

async function persistWaMessage(
  db: D1Database,
  msg: NormalizedWaMessage,
  account: ResolvedWhatsAppAccount,
  media?: StoredMedia | null,
): Promise<void> {
  const counterpartyId = resolveCounterpartyId(msg);
  if (!counterpartyId) {
    console.warn('Skipping WhatsApp webhook message without counterparty id', {
      direction: msg.direction,
      messageId: msg.messageId,
      type: msg.type,
    });
    return;
  }

  const friend = await ensureWaFriend(
    db,
    account,
    counterpartyId,
    msg.senderName?.trim() || counterpartyId,
    msg.slackChannelId || null,
  );

  const stored = normalizeStoredWaMessage(msg, media);
  const duplicate = await db
    .prepare(
      `SELECT id
         FROM messages_log
        WHERE friend_id = ?
          AND direction = ?
          AND message_type = ?
          AND content = ?
          AND created_at = ?
        LIMIT 1`,
    )
    .bind(friend.id, msg.direction, stored.messageType, stored.content, msg.occurredAt)
    .first<{ id: string }>();

  if (!duplicate) {
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), friend.id, msg.direction, stored.messageType, stored.content, msg.occurredAt)
      .run();
  }

  await updateChatForWaMessage(db, friend.id, msg.direction, msg.occurredAt);
}

function normalizeBridgeMessage(msg: WaForwardedMessage): NormalizedWaMessage | null {
  if (!msg.from?.trim() || !msg.messageId?.trim() || !msg.type?.trim()) {
    return null;
  }

  return {
    ...msg,
    from: msg.from.trim(),
    to: msg.to?.trim(),
    senderName: msg.senderName?.trim() || msg.from.trim(),
    type: msg.type.trim(),
    messageId: msg.messageId.trim(),
    direction: msg.direction === 'outgoing' || msg.direction === 'outbound' ? 'outgoing' : 'incoming',
    occurredAt: resolveOccurredAt(msg.timestamp),
  };
}

function extractMetaWebhookMessages(payload: MetaWebhookPayload): NormalizedWaMessage[] {
  const normalized: NormalizedWaMessage[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id?.trim();

      if (change.field === 'messages' && value?.messages?.length) {
        for (const message of value.messages) {
          const media = getMetaMediaObject(message);
          const contact =
            value.contacts?.find((item) => item.wa_id === message.from) ??
            value.contacts?.find((item) => resolveContactIdentifier(item) === message.from) ??
            value.contacts?.[0];
          const from = message.from?.trim() || resolveContactIdentifier(contact);
          if (!from || !message.id?.trim() || !message.type?.trim()) continue;

          normalized.push({
            from,
            senderName: resolveContactDisplayName(contact, from),
            type: message.type.trim(),
            text: inferMetaText(message),
            mediaUrl: media?.id,
            messageId: message.id.trim(),
            phoneNumberId,
            whatsappPhoneNumberId: phoneNumberId,
            fileName: media?.filename,
            mimeType: media?.mime_type,
            direction: 'incoming',
            timestamp: message.timestamp,
            occurredAt: resolveOccurredAt(message.timestamp),
          });
        }
      }

      if (change.field === 'smb_message_echoes' && value?.message_echoes?.length) {
        for (const message of value.message_echoes) {
          const media = getMetaMediaObject(message);
          const contact =
            value.contacts?.find((item) => item.wa_id === message.to) ??
            value.contacts?.find((item) => resolveContactIdentifier(item) === message.to) ??
            value.contacts?.[0];
          const to = message.to?.trim() || resolveContactIdentifier(contact);
          const from = message.from?.trim() || value.metadata?.display_phone_number?.trim() || 'business';
          if (!to || !message.id?.trim() || !message.type?.trim()) continue;

          normalized.push({
            from,
            to,
            senderName: resolveContactDisplayName(contact, to),
            type: message.type.trim(),
            text: inferMetaText(message),
            mediaUrl: media?.id,
            messageId: message.id.trim(),
            phoneNumberId,
            whatsappPhoneNumberId: phoneNumberId,
            fileName: media?.filename,
            mimeType: media?.mime_type,
            direction: 'outgoing',
            timestamp: message.timestamp,
            occurredAt: resolveOccurredAt(message.timestamp),
          });
        }
      }
    }
  }

  return normalized;
}

function extractHistoryMessages(payload: CoexistenceEventPayload): NormalizedWaMessage[] {
  const normalized: NormalizedWaMessage[] = [];
  const phoneNumberId = payload.data?.metadata?.phone_number_id?.trim();

  for (const chunk of payload.data?.history ?? []) {
    if (chunk.errors?.length) continue;

    for (const thread of chunk.threads ?? []) {
      const counterpartyId = thread.id?.trim();
      if (!counterpartyId) continue;

      for (const message of thread.messages ?? []) {
        if (!message.id?.trim() || !message.type?.trim()) continue;

        const media = getMetaMediaObject(message);
        const explicitTo = message.to?.trim();
        const explicitFrom = message.from?.trim();
        const direction: WaDirection =
          explicitTo === counterpartyId ? 'outgoing' : explicitFrom === counterpartyId ? 'incoming' : 'outgoing';

        normalized.push({
          from: direction === 'incoming' ? explicitFrom || counterpartyId : explicitFrom || 'business',
          to: direction === 'outgoing' ? explicitTo || counterpartyId : message.to?.trim(),
          senderName: counterpartyId,
          type: message.type.trim(),
          text: inferMetaText(message),
          mediaUrl: media?.id,
          messageId: message.id.trim(),
          phoneNumberId,
          whatsappPhoneNumberId: phoneNumberId,
          fileName: media?.filename,
          mimeType: media?.mime_type,
          direction,
          timestamp: message.timestamp,
          occurredAt: resolveOccurredAt(message.timestamp),
        });
      }
    }
  }

  return normalized;
}

async function syncCoexistenceContacts(
  db: D1Database,
  account: ResolvedWhatsAppAccount,
  payload: CoexistenceEventPayload,
): Promise<void> {
  for (const item of payload.data?.state_sync ?? []) {
    if (item.type !== 'contact') continue;

    const phoneNumber = item.contact?.phone_number?.trim();
    if (!phoneNumber) continue;

    const displayName =
      item.contact?.full_name?.trim() ||
      item.contact?.first_name?.trim() ||
      phoneNumber;

    await ensureWaFriend(db, account, phoneNumber, displayName);
  }
}

waWebhook.get('/webhook/whatsapp', async (c) => {
  const mode = c.req.query('hub.mode');
  const token = c.req.query('hub.verify_token');
  const challenge = c.req.query('hub.challenge');

  if (
    mode === 'subscribe' &&
    token &&
    challenge &&
    c.env.WA_BRIDGE_SECRET &&
    token === c.env.WA_BRIDGE_SECRET
  ) {
    return c.text(challenge, 200);
  }

  return c.text('Forbidden', 403);
});

waWebhook.post('/webhook/whatsapp', async (c) => {
  const rawBody = await c.req.text();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.text('Bad request', 400);
  }

  const db = c.env.DB;
  const authHeader = c.req.header('Authorization');
  const signatureHeader = c.req.header('X-Hub-Signature-256');
  const bridgeAuthorized =
    Boolean(c.env.WA_BRIDGE_SECRET) &&
    authHeader === `Bearer ${c.env.WA_BRIDGE_SECRET}`;
  const bridgePassthrough =
    bridgeAuthorized && (isMetaWebhookPayload(payload) || isCoexistenceEventPayload(payload));

  try {
    if (bridgeAuthorized && !bridgePassthrough) {
      const msg = normalizeBridgeMessage(payload as WaForwardedMessage);
      if (!msg) {
        return c.text('Bad request', 400);
      }

      const account = await resolveWhatsAppAccountId(db, msg);
      if (!account) {
        console.error('No active WhatsApp account found for wa-bridge payload');
        return c.text('No WhatsApp account configured', 500);
      }

      console.log('WA bridge webhook received', {
        accountId: account.id,
        phoneNumberId: account.channel_id,
        direction: msg.direction,
        from: msg.from,
        to: msg.to ?? null,
        type: msg.type,
        messageId: msg.messageId,
      });

      await persistWaMessage(db, msg, account);
      return c.text('OK', 200);
    }

    const account = await resolveWhatsAppAccountForPayload(db, payload);
    if ((isMetaWebhookPayload(payload) || isCoexistenceEventPayload(payload)) && !account) {
      console.error('No active WhatsApp account found for webhook payload');
      return c.text('No WhatsApp account configured', 500);
    }

    if (!bridgeAuthorized && account?.channel_secret) {
      const signatureValid = await verifyMetaSignature(account.channel_secret, rawBody, signatureHeader);
      if (!signatureValid) {
        console.error('WA webhook signature validation failed', {
          phoneNumberId: extractWebhookPhoneNumberId(payload),
        });
        return c.text('Unauthorized', 401);
      }
    }

    if (isMetaWebhookPayload(payload) && account) {
      const messages = extractMetaWebhookMessages(payload);
      console.log('WA Meta webhook received', {
        source: bridgeAuthorized ? 'bridge' : 'meta',
        accountId: account.id,
        phoneNumberId: account.channel_id,
        incomingCount: messages.filter((msg) => msg.direction === 'incoming').length,
        echoCount: messages.filter((msg) => msg.direction === 'outgoing').length,
      });
      for (const msg of messages) {
        const mediaId = msg.mediaUrl?.trim();
        let storedMedia: StoredMedia | null = null;

        if (mediaId && ['image', 'audio', 'video', 'document', 'sticker'].includes(msg.type)) {
          try {
            storedMedia = await downloadMetaMedia(
              c.env,
              account,
              c.req.url,
              mediaId,
              msg.mimeType?.trim() || 'application/octet-stream',
              msg.fileName?.trim() || '',
            );
          } catch (err) {
            console.error(`Failed to persist WhatsApp media ${mediaId}:`, err);
          }
        }

        await persistWaMessage(db, msg, account, storedMedia);
      }

      return c.text('OK', 200);
    }

    if (isCoexistenceEventPayload(payload) && account) {
      console.log('WA coexistence webhook received', {
        source: bridgeAuthorized ? 'bridge' : 'meta',
        accountId: account.id,
        phoneNumberId: account.channel_id,
        event: payload.event,
        historyChunkCount: payload.data?.history?.length ?? 0,
        stateSyncCount: payload.data?.state_sync?.length ?? 0,
      });

      if (payload.event === 'history') {
        const messages = extractHistoryMessages(payload);
        for (const msg of messages) {
          const mediaId = msg.mediaUrl?.trim();
          let storedMedia: StoredMedia | null = null;

          if (mediaId && ['image', 'audio', 'video', 'document', 'sticker'].includes(msg.type)) {
            try {
              storedMedia = await downloadMetaMedia(
                c.env,
                account,
                c.req.url,
                mediaId,
                msg.mimeType?.trim() || 'application/octet-stream',
                msg.fileName?.trim() || '',
              );
            } catch (err) {
              console.error(`Failed to persist WhatsApp history media ${mediaId}:`, err);
            }
          }

          await persistWaMessage(db, msg, account, storedMedia);
        }

        return c.text('OK', 200);
      }

      if (payload.event === 'smb_app_state_sync') {
        await syncCoexistenceContacts(db, account, payload);
        return c.text('OK', 200);
      }

      return c.text('OK', 200);
    }

    return c.text('Unauthorized', 401);
  } catch (err) {
    console.error('WhatsApp webhook error:', err);
    return c.text('Internal error', 500);
  }
});

export { waWebhook };
