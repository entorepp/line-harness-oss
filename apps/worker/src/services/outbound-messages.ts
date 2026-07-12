import { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';
import type { Env } from '../index.js';
import { dispatchKakaoBizMessage } from './kakao.js';

export interface MessagingFriendContext {
  id: string;
  line_user_id: string;
  line_account_id: string | null;
  channel_access_token: string | null;
  channel_id: string | null;
  channel_type: string | null;
}

export interface OutboundMessageInput {
  messageType?: string;
  content: string;
  fileName?: string | null;
  fileSize?: string | null;
  fileIcon?: string | null;
}

export interface DispatchedMessage {
  messageType: string;
  storedContent: string;
}

interface StickerPayload {
  packageId: string;
  stickerId: string;
}

interface ImagePayload {
  url: string;
  originalContentUrl: string;
  previewImageUrl: string;
}

interface FilePayload {
  url: string;
  fileName: string;
  fileSize: string;
  fileIcon: string;
}

function safeJsonParse(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }

  return null;
}

function normalizeImageContent(content: string): ImagePayload {
  const parsed = safeJsonParse(content);
  const originalContentUrl =
    typeof parsed?.originalContentUrl === 'string'
      ? parsed.originalContentUrl
      : typeof parsed?.url === 'string'
        ? parsed.url
        : content;
  const previewImageUrl =
    typeof parsed?.previewImageUrl === 'string'
      ? parsed.previewImageUrl
      : originalContentUrl;

  return {
    url: typeof parsed?.url === 'string' ? parsed.url : originalContentUrl,
    originalContentUrl,
    previewImageUrl,
  };
}

function normalizeFileContent(input: OutboundMessageInput): FilePayload {
  const parsed = safeJsonParse(input.content);
  const url =
    typeof parsed?.url === 'string'
      ? parsed.url
      : input.content;

  return {
    url,
    fileName:
      typeof parsed?.fileName === 'string'
        ? parsed.fileName
        : input.fileName || 'ファイル',
    fileSize:
      typeof parsed?.fileSize === 'string'
        ? parsed.fileSize
        : input.fileSize || '',
    fileIcon:
      typeof parsed?.fileIcon === 'string'
        ? parsed.fileIcon
        : input.fileIcon || '\u{1F4CE}',
  };
}

function parseStickerText(content: string): StickerPayload | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const parsed = safeJsonParse(trimmed);
  if (
    parsed &&
    typeof parsed.packageId === 'string' &&
    typeof parsed.stickerId === 'string'
  ) {
    return { packageId: parsed.packageId, stickerId: parsed.stickerId };
  }

  const namedPackage = trimmed.match(/packageId["'\s:=]+(\d+)/i)?.[1];
  const namedSticker = trimmed.match(/stickerId["'\s:=]+(\d+)/i)?.[1];
  if (namedPackage && namedSticker) {
    return { packageId: namedPackage, stickerId: namedSticker };
  }

  const pair = trimmed.match(/(\d+)\D+(\d+)/);
  if (pair) {
    return { packageId: pair[1], stickerId: pair[2] };
  }

  return null;
}

function normalizeStickerContent(content: string): StickerPayload {
  const parsed = parseStickerText(content);
  if (!parsed) {
    throw new Error('Sticker content must include packageId and stickerId');
  }

  return parsed;
}

function extractKakaoRecipientId(lineUserId: string): string {
  const providerMatch = lineUserId.match(/^kakao:[^:]+:provider:(.+)$/);
  if (providerMatch?.[1]) return providerMatch[1];

  const channelWebhookMatch = lineUserId.match(/^kakao:[^:]+:[^:]+:(.+)$/);
  if (channelWebhookMatch?.[1]) return channelWebhookMatch[1];

  return lineUserId;
}

function buildFileMessage(payload: FilePayload): Message {
  return {
    type: 'flex',
    altText: `${payload.fileIcon} ${payload.fileName}`,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: payload.fileIcon, size: 'xxl', flex: 0 },
          {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'text',
                text: payload.fileName,
                size: 'sm',
                weight: 'bold',
                wrap: true,
                maxLines: 2,
              },
              ...(payload.fileSize
                ? [{ type: 'text', text: payload.fileSize, size: 'xs', color: '#999999' }]
                : []),
            ],
            flex: 1,
            margin: 'md',
            justifyContent: 'center',
          },
        ],
        paddingAll: 'lg',
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            action: { type: 'uri', label: 'ダウンロード', uri: payload.url },
            style: 'primary',
            color: '#06C755',
          },
        ],
      },
    },
  };
}

export function buildLineMessage(input: OutboundMessageInput): Message {
  const messageType = input.messageType ?? 'text';

  if (messageType === 'text') {
    return { type: 'text', text: input.content };
  }

  if (messageType === 'image') {
    const image = normalizeImageContent(input.content);
    return {
      type: 'image',
      originalContentUrl: image.originalContentUrl,
      previewImageUrl: image.previewImageUrl,
    };
  }

  if (messageType === 'flex') {
    try {
      const contents = JSON.parse(input.content);
      return { type: 'flex', altText: 'Message', contents };
    } catch {
      return { type: 'text', text: input.content };
    }
  }

  if (messageType === 'sticker') {
    const sticker = normalizeStickerContent(input.content);
    return {
      type: 'sticker',
      packageId: sticker.packageId,
      stickerId: sticker.stickerId,
    };
  }

  if (messageType === 'file') {
    return buildFileMessage(normalizeFileContent(input));
  }

  return { type: 'text', text: input.content };
}

export function serializeOutboundContent(input: OutboundMessageInput): string {
  const messageType = input.messageType ?? 'text';

  if (messageType === 'image') {
    return JSON.stringify(normalizeImageContent(input.content));
  }

  if (messageType === 'file') {
    return JSON.stringify(normalizeFileContent(input));
  }

  if (messageType === 'sticker') {
    return JSON.stringify(normalizeStickerContent(input.content));
  }

  return input.content;
}

export function summarizeOutboundMessage(messageType: string, storedContent: string): string {
  if (messageType === 'text') return storedContent;

  if (messageType === 'image') {
    const parsed = safeJsonParse(storedContent);
    const url = typeof parsed?.url === 'string' ? parsed.url : storedContent;
    return `[画像] ${url}`;
  }

  if (messageType === 'file') {
    const parsed = safeJsonParse(storedContent);
    const fileName = typeof parsed?.fileName === 'string' ? parsed.fileName : 'ファイル';
    const url = typeof parsed?.url === 'string' ? parsed.url : '';
    return `[ファイル] ${fileName}${url ? ` ${url}` : ''}`;
  }

  if (messageType === 'sticker') {
    try {
      const sticker = normalizeStickerContent(storedContent);
      return `[スタンプ] package:${sticker.packageId} sticker:${sticker.stickerId}`;
    } catch {
      return '[スタンプ]';
    }
  }

  if (messageType === 'flex') {
    return '[Flex Message]';
  }

  return `[${messageType}]`;
}

export async function getMessagingFriendContext(
  db: D1Database,
  friendId: string,
): Promise<MessagingFriendContext | null> {
  return db
    .prepare(
      `SELECT f.id, f.line_user_id, f.line_account_id, la.channel_access_token, la.channel_id, la.channel_type
         FROM friends f
         LEFT JOIN line_accounts la ON la.id = f.line_account_id
        WHERE f.id = ?`,
    )
    .bind(friendId)
    .first<MessagingFriendContext>();
}

export async function dispatchOutboundMessage(opts: {
  env: Env['Bindings'];
  friend: MessagingFriendContext;
  input: OutboundMessageInput;
}): Promise<DispatchedMessage> {
  const messageType = opts.input.messageType ?? 'text';

  if (opts.friend.channel_type === 'whatsapp') {
    if (messageType !== 'text') {
      throw new Error('WhatsApp account currently supports only text for manual or scheduled sends');
    }

    const waToken = opts.friend.channel_access_token;
    const waPhoneNumberId = opts.friend.channel_id;
    if (!waToken || !waPhoneNumberId) {
      throw new Error('No WhatsApp credentials configured');
    }

    const GRAPH_API = 'https://graph.facebook.com/v22.0';
    const res = await fetch(`${GRAPH_API}/${waPhoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${waToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: opts.friend.line_user_id,
        type: 'text',
        text: { body: opts.input.content },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`WhatsApp send failed: ${text}`);
    }

    return {
      messageType,
      storedContent: serializeOutboundContent(opts.input),
    };
  }

  if (opts.friend.channel_type === 'kakao') {
    if (messageType !== 'text') {
      throw new Error('Kakao account currently supports only text for manual or scheduled sends');
    }

    if (!opts.friend.line_account_id || !opts.friend.channel_id) {
      throw new Error('No Kakao account configured for this recipient');
    }

    await dispatchKakaoBizMessage({
      env: opts.env,
      account: { id: opts.friend.line_account_id, channel_id: opts.friend.channel_id },
      to: extractKakaoRecipientId(opts.friend.line_user_id),
      text: opts.input.content,
    });

    return {
      messageType,
      storedContent: serializeOutboundContent(opts.input),
    };
  }

  const accessToken =
    opts.friend.channel_access_token || opts.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('No LINE access token configured for this account');
  }

  const lineClient = new LineClient(accessToken);
  await lineClient.pushMessage(opts.friend.line_user_id, [buildLineMessage(opts.input)]);

  return {
    messageType,
    storedContent: serializeOutboundContent(opts.input),
  };
}
