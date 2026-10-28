import type { MetaMessagingChannelType } from './meta-messaging.js';

const JST_OFFSET_MS = 9 * 60 * 60_000;

export type MetaAttachment = {
  type?: string;
  payload?: {
    template_type?: string;
    text?: string;
    elements?: unknown[];
    buttons?: unknown[];
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
  attachments?: MetaAttachment[];
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
    attachments: event.message?.attachments || [],
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

// Structured cards have nested URLs, not necessarily payload.url. Never fetch
// these destinations as media or expose opaque postback payloads as customer text.
export function describeMetaAttachment(attachment: MetaAttachment): string {
  const payload = attachment.payload || {};
  const lines: string[] = [];
  const addText = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) lines.push(value.trim().slice(0, 2000));
  };
  const addUrl = (value: unknown) => {
    if (typeof value !== 'string') return;
    try {
      const url = new URL(value);
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) addText(url.href);
    } catch { /* Missing or unsupported URL. */ }
  };
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const buttons = (value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const item of value.slice(0, 10)) {
      const button = record(item);
      addText(button.title);
      addUrl(button.url);
    }
  };
  addText(payload.title);
  addText(payload.text);
  addUrl(payload.url);
  if (Array.isArray(payload.elements)) {
    for (const item of payload.elements.slice(0, 10)) {
      const element = record(item);
      addText(element.title);
      addText(element.subtitle);
      addUrl(element.item_url);
      addUrl(record(element.default_action).url);
      addUrl(element.image_url);
      buttons(element.buttons);
    }
  }
  buttons(payload.buttons);
  const label = attachment.type === 'template' ? '📩 カード形式のメッセージ' : '📎 添付メッセージ';
  return lines.length
    ? `${label}\n${[...new Set(lines)].join('\n')}`
    : `${label}（通知では内容を取得できません。Instagram／Messengerの元DMを確認してください）`;
}
