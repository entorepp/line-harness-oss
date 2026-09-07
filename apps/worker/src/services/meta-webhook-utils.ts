import type { MetaMessagingChannelType } from './meta-messaging.js';

const JST_OFFSET_MS = 9 * 60 * 60_000;

export type MetaAttachment = {
  type?: string;
  payload?: {
    url?: string;
    title?: string;
    sticker_id?: number;
    coordinates?: { lat?: number; long?: number };
  };
};

export type MetaMessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    quick_reply?: { payload?: string };
    attachments?: MetaAttachment[];
  };
  postback?: {
    mid?: string;
    title?: string;
    payload?: string;
  };
};

export type MetaEntry = {
  id?: string;
  time?: number;
  messaging?: MetaMessagingEvent[];
  standby?: MetaMessagingEvent[];
};

export type MetaWebhookPayload = {
  object?: 'page' | 'instagram' | string;
  entry?: MetaEntry[];
};

export type NormalizedMetaMessage = {
  messageId: string;
  customerId: string;
  direction: 'incoming' | 'outgoing';
  occurredAt: string;
  text: string;
  attachment: MetaAttachment | null;
};

function toJstString(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  return `${jst.toISOString().slice(0, -1)}+09:00`;
}

function occurredAt(timestamp: number | undefined): string {
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    return toJstString(new Date(timestamp));
  }
  return toJstString(new Date());
}

export function channelTypeForObject(object: string | undefined): MetaMessagingChannelType | null {
  if (object === 'page') return 'facebook';
  if (object === 'instagram') return 'instagram';
  return null;
}

export function normalizeMetaEvent(
  event: MetaMessagingEvent,
  entry: MetaEntry,
): NormalizedMetaMessage | null {
  const isEcho = event.message?.is_echo === true;
  const customerId = (isEcho ? event.recipient?.id : event.sender?.id)?.trim();
  if (!customerId || event.message?.is_deleted) return null;

  const text = event.message?.text?.trim()
    || event.postback?.title?.trim()
    || event.postback?.payload?.trim()
    || '';
  const attachment = event.message?.attachments?.[0] || null;
  if (!text && !attachment) return null;

  const rawMessageId = event.message?.mid?.trim() || event.postback?.mid?.trim();
  const fallbackId = [
    'meta',
    entry.id || 'unknown',
    event.timestamp || entry.time || 0,
    customerId,
    event.postback?.payload || attachment?.payload?.url || text,
  ].join(':');

  return {
    messageId: rawMessageId || fallbackId,
    customerId,
    direction: isEcho ? 'outgoing' : 'incoming',
    occurredAt: occurredAt(event.timestamp || entry.time),
    text,
    attachment,
  };
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
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function verifyMetaSignature(
  secret: string,
  rawBody: string,
  header: string | undefined,
): Promise<boolean> {
  if (!header) return false;
  const [algorithm, received] = header.split('=');
  if (algorithm !== 'sha256' || !received) return false;
  return timingSafeEqual(await signHmacSha256(secret, rawBody), received);
}
