import { Hono } from 'hono';
import { createChat, getChatByFriendId, jstNow, toJstString, updateChat } from '@line-crm/db';
import type { Env } from '../index.js';
import { fireEvent } from '../services/event-bus.js';
import { tryDeliverCustomerQuote } from '../services/quote-chat-delivery.js';
import {
  decryptWeChatPayload,
  dispatchWeChatText,
  readWeChatXmlValue,
  verifyWeChatSignature,
} from '../services/wechat.js';

const wechatWebhook = new Hono<Env>();

type WeChatAccount = {
  id: string;
  channel_id: string;
  name: string;
  channel_access_token: string;
  channel_secret: string;
  wechat_encoding_aes_key: string | null;
  wechat_access_token: string | null;
  wechat_qr_ticket: string | null;
  wechat_qr_url: string | null;
  wechat_kf_contact_url: string | null;
  wechat_follow_url: string | null;
  token_expires_at: string | null;
  locale: string;
  default_slack_channel: string | null;
};

type NormalizedWeChatMessage = {
  openId: string;
  originalAccountId: string;
  messageId: string | null;
  messageType: string;
  storedContent: string;
  eventText: string;
  occurredAt: string;
  isFollowing: boolean;
  shouldPersist: boolean;
  metadata: Record<string, unknown>;
};

async function resolveWeChatAccount(db: D1Database, id: string): Promise<WeChatAccount | null> {
  return db
    .prepare(
      `SELECT id, channel_id, name, channel_access_token, channel_secret,
              wechat_encoding_aes_key, wechat_access_token,
              wechat_qr_ticket, wechat_qr_url, wechat_kf_contact_url, wechat_follow_url,
              token_expires_at, locale, default_slack_channel
         FROM line_accounts
        WHERE id = ? AND channel_type = 'wechat' AND is_active = 1
        LIMIT 1`,
    )
    .bind(id)
    .first<WeChatAccount>();
}

function normalizeOccurredAt(value: string | null): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return jstNow();
  return toJstString(new Date(seconds * 1000));
}

function normalizeMessage(xml: string): NormalizedWeChatMessage | null {
  const openId = readWeChatXmlValue(xml, 'FromUserName')?.trim();
  const originalAccountId = readWeChatXmlValue(xml, 'ToUserName')?.trim();
  const rawMessageType = readWeChatXmlValue(xml, 'MsgType')?.trim().toLowerCase();
  if (!openId || !originalAccountId || !rawMessageType) return null;

  const occurredAt = normalizeOccurredAt(readWeChatXmlValue(xml, 'CreateTime'));
  const messageId = readWeChatXmlValue(xml, 'MsgId')?.trim() || null;
  const metadata: Record<string, unknown> = {
    provider: 'wechat',
    openId,
    originalAccountId,
    messageId,
    rawMessageType,
  };

  if (rawMessageType === 'text') {
    const text = readWeChatXmlValue(xml, 'Content')?.trim() || '';
    return {
      openId,
      originalAccountId,
      messageId,
      messageType: 'text',
      storedContent: text || '[空のテキストメッセージ]',
      eventText: text || '[空のテキストメッセージ]',
      occurredAt,
      isFollowing: true,
      shouldPersist: true,
      metadata,
    };
  }

  if (rawMessageType === 'image') {
    const url = readWeChatXmlValue(xml, 'PicUrl')?.trim() || '';
    const mediaId = readWeChatXmlValue(xml, 'MediaId')?.trim() || '';
    return {
      openId,
      originalAccountId,
      messageId,
      messageType: 'image',
      storedContent: JSON.stringify({ url, mediaId }),
      eventText: '📷 画像を送信',
      occurredAt,
      isFollowing: true,
      shouldPersist: true,
      metadata: { ...metadata, mediaId },
    };
  }

  if (rawMessageType === 'voice') {
    const mediaId = readWeChatXmlValue(xml, 'MediaId')?.trim() || '';
    const format = readWeChatXmlValue(xml, 'Format')?.trim() || '';
    const recognition = readWeChatXmlValue(xml, 'Recognition')?.trim() || '';
    return {
      openId,
      originalAccountId,
      messageId,
      messageType: 'audio',
      storedContent: JSON.stringify({ mediaId, format, recognition }),
      eventText: recognition || '🎵 音声を送信',
      occurredAt,
      isFollowing: true,
      shouldPersist: true,
      metadata: { ...metadata, mediaId, format },
    };
  }

  if (rawMessageType === 'video' || rawMessageType === 'shortvideo') {
    const mediaId = readWeChatXmlValue(xml, 'MediaId')?.trim() || '';
    const thumbMediaId = readWeChatXmlValue(xml, 'ThumbMediaId')?.trim() || '';
    return {
      openId,
      originalAccountId,
      messageId,
      messageType: 'video',
      storedContent: JSON.stringify({ mediaId, thumbMediaId }),
      eventText: '🎥 動画を送信',
      occurredAt,
      isFollowing: true,
      shouldPersist: true,
      metadata: { ...metadata, mediaId, thumbMediaId },
    };
  }

  if (rawMessageType === 'location') {
    const location = {
      latitude: readWeChatXmlValue(xml, 'Location_X'),
      longitude: readWeChatXmlValue(xml, 'Location_Y'),
      scale: readWeChatXmlValue(xml, 'Scale'),
      label: readWeChatXmlValue(xml, 'Label'),
    };
    return {
      openId,
      originalAccountId,
      messageId,
      messageType: 'location',
      storedContent: JSON.stringify(location),
      eventText: `📍 ${location.label || '位置情報を送信'}`,
      occurredAt,
      isFollowing: true,
      shouldPersist: true,
      metadata: { ...metadata, ...location },
    };
  }

  if (rawMessageType === 'link') {
    const title = readWeChatXmlValue(xml, 'Title')?.trim() || '';
    const description = readWeChatXmlValue(xml, 'Description')?.trim() || '';
    const url = readWeChatXmlValue(xml, 'Url')?.trim() || '';
    const content = [title, description, url].filter(Boolean).join('\n');
    return {
      openId,
      originalAccountId,
      messageId,
      messageType: 'text',
      storedContent: content || '[リンク]',
      eventText: content || '[リンク]',
      occurredAt,
      isFollowing: true,
      shouldPersist: true,
      metadata: { ...metadata, url },
    };
  }

  if (rawMessageType === 'event') {
    const event = readWeChatXmlValue(xml, 'Event')?.trim().toLowerCase() || 'unknown';
    const eventKey = readWeChatXmlValue(xml, 'EventKey')?.trim() || '';
    const ticket = readWeChatXmlValue(xml, 'Ticket')?.trim() || '';
    const isFollowing = event !== 'unsubscribe';
    const label = event === 'subscribe'
      ? 'フォロー'
      : event === 'unsubscribe'
        ? 'フォロー解除'
        : event === 'scan'
          ? 'QRコードをスキャン'
          : event;
    return {
      openId,
      originalAccountId,
      messageId: null,
      messageType: 'text',
      storedContent: `[WeChatイベント] ${label}${eventKey ? ` (${eventKey})` : ''}`,
      eventText: `[WeChatイベント] ${label}`,
      occurredAt,
      isFollowing,
      shouldPersist: event !== 'unsubscribe',
      metadata: { ...metadata, event, eventKey, ticket },
    };
  }

  return {
    openId,
    originalAccountId,
    messageId,
    messageType: 'text',
    storedContent: `[WeChat ${rawMessageType}]`,
    eventText: `[WeChat ${rawMessageType}]`,
    occurredAt,
    isFollowing: true,
    shouldPersist: true,
    metadata,
  };
}

async function upsertWeChatFriend(
  db: D1Database,
  account: WeChatAccount,
  message: NormalizedWeChatMessage,
): Promise<{ id: string; displayName: string }> {
  const externalId = `wechat:${account.channel_id}:${message.openId}`;
  const displayName = `WeChat ${message.openId.slice(-6)}`;
  const metadata = JSON.stringify({
    ...message.metadata,
    provider: 'wechat',
    appId: account.channel_id,
    lastMessageAt: message.occurredAt,
  });
  const existing = await db
    .prepare(`SELECT id FROM friends WHERE line_user_id = ? AND line_account_id = ? LIMIT 1`)
    .bind(externalId, account.id)
    .first<{ id: string }>();

  if (!existing) {
    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO friends
           (id, line_user_id, display_name, is_following, line_account_id, slack_channel_id, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        externalId,
        displayName,
        message.isFollowing ? 1 : 0,
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
          SET is_following = ?,
              line_account_id = ?,
              slack_channel_id = COALESCE(slack_channel_id, ?),
              metadata = ?,
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(
      message.isFollowing ? 1 : 0,
      account.id,
      account.default_slack_channel,
      metadata,
      message.occurredAt,
      existing.id,
    )
    .run();
  return { id: existing.id, displayName };
}

async function persistWeChatMessage(
  env: Env['Bindings'],
  account: WeChatAccount,
  message: NormalizedWeChatMessage,
): Promise<void> {
  const friend = await upsertWeChatFriend(env.DB, account, message);
  if (!message.shouldPersist) return;

  const duplicate = await env.DB
    .prepare(
      `SELECT id FROM messages_log
        WHERE friend_id = ? AND direction = 'incoming' AND message_type = ?
          AND content = ? AND created_at = ? LIMIT 1`,
    )
    .bind(friend.id, message.messageType, message.storedContent, message.occurredAt)
    .first<{ id: string }>();

  if (!duplicate) {
    await env.DB
      .prepare(
        `INSERT INTO messages_log
           (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
         VALUES (?, ?, 'incoming', ?, ?, NULL, NULL, ?)`,
      )
      .bind(crypto.randomUUID(), friend.id, message.messageType, message.storedContent, message.occurredAt)
      .run();
  }

  const chat = await getChatByFriendId(env.DB, friend.id);
  if (chat) {
    await updateChat(env.DB, chat.id, {
      status: chat.status === 'resolved' ? 'unread' : chat.status,
      lastMessageAt: message.occurredAt,
    });
  } else {
    const created = await createChat(env.DB, { friendId: friend.id });
    await updateChat(env.DB, created.id, { status: 'unread', lastMessageAt: message.occurredAt });
  }

  if (!duplicate) {
    const quoteHandled = await tryDeliverCustomerQuote({
      env,
      friendId: friend.id,
      channel: 'wechat',
      providerMessageId: message.messageId || '',
      text: message.metadata.rawMessageType === 'text' ? message.eventText : '',
    });
    if (quoteHandled) return;
    await fireEvent(
      env.DB,
      'message_received',
      {
        friendId: friend.id,
        suppressLineActions: true,
        eventData: {
          text: message.eventText,
          messageType: message.messageType,
          provider: 'wechat',
          messageId: message.messageId,
        },
      },
      undefined,
      account.id,
      { token: env.SLACK_BOT_TOKEN, googleTranslateApiKey: env.GOOGLE_TRANSLATE_API_KEY },
    );
  }
}

wechatWebhook.get('/webhook/wechat/:accountId', async (c) => {
  const account = await resolveWeChatAccount(c.env.DB, c.req.param('accountId'));
  if (!account) return c.text('WeChat account not found', 404);

  const timestamp = c.req.query('timestamp') || '';
  const nonce = c.req.query('nonce') || '';
  const echo = c.req.query('echostr') || '';
  const encryptedMode = c.req.query('encrypt_type') === 'aes' || Boolean(c.req.query('msg_signature'));
  const signature = encryptedMode ? c.req.query('msg_signature') || '' : c.req.query('signature') || '';
  if (!timestamp || !nonce || !echo || !signature) return c.text('Bad request', 400);

  const valid = await verifyWeChatSignature(
    account.channel_secret,
    timestamp,
    nonce,
    signature,
    encryptedMode ? echo : undefined,
  );
  if (!valid) return c.text('Unauthorized', 401);

  if (encryptedMode) {
    if (!account.wechat_encoding_aes_key) return c.text('EncodingAESKey is not configured', 500);
    try {
      return c.text(decryptWeChatPayload(echo, account.wechat_encoding_aes_key, account.channel_id));
    } catch (err) {
      console.error('WeChat encrypted verification failed:', err);
      return c.text('Invalid encrypted challenge', 400);
    }
  }
  return c.text(echo);
});

wechatWebhook.post('/webhook/wechat/:accountId', async (c) => {
  const account = await resolveWeChatAccount(c.env.DB, c.req.param('accountId'));
  if (!account) return c.text('WeChat account not found', 404);

  const timestamp = c.req.query('timestamp') || '';
  const nonce = c.req.query('nonce') || '';
  const rawBody = await c.req.text();
  const encrypted = readWeChatXmlValue(rawBody, 'Encrypt')?.trim() || '';
  const encryptedMode = c.req.query('encrypt_type') === 'aes' || Boolean(encrypted);
  const signature = encryptedMode ? c.req.query('msg_signature') || '' : c.req.query('signature') || '';
  if (!timestamp || !nonce || !signature) return c.text('Bad request', 400);

  const valid = await verifyWeChatSignature(
    account.channel_secret,
    timestamp,
    nonce,
    signature,
    encryptedMode ? encrypted : undefined,
  );
  if (!valid) return c.text('Unauthorized', 401);

  let xml = rawBody;
  if (encryptedMode) {
    if (!encrypted || !account.wechat_encoding_aes_key) return c.text('Bad encrypted request', 400);
    try {
      xml = decryptWeChatPayload(encrypted, account.wechat_encoding_aes_key, account.channel_id);
    } catch (err) {
      console.error('WeChat message decryption failed:', err);
      return c.text('Bad encrypted request', 400);
    }
  }

  const message = normalizeMessage(xml);
  if (!message) return c.text('Bad request', 400);

  try {
    await persistWeChatMessage(c.env, account, message);
    if (message.metadata.event === 'subscribe') {
      c.executionCtx.waitUntil(
        dispatchWeChatText({
          db: c.env.DB,
          env: c.env,
          account,
          to: message.openId,
          text:
            '感谢关注“无障碍旅游就选自在旅游”。请返回咨询窗口，继续发送您的出行日期、人数和轮椅使用情况。',
        }).catch((err) => {
          console.error('WeChat subscribe auto reply failed:', err);
        }),
      );
    }
    return c.text('success');
  } catch (err) {
    console.error('WeChat webhook persistence failed:', err);
    return c.text('Internal error', 500);
  }
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function resolveOfficialAccountUrl(value: string | null): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    if (url.hostname !== 'mp.weixin.qq.com') return null;
    return url;
  } catch {
    return null;
  }
}

wechatWebhook.get('/wechat/:accountId/qr.png', async (c) => {
  const account = await resolveWeChatAccount(c.env.DB, c.req.param('accountId'));
  if (!account?.wechat_qr_ticket) return c.text('QR code is not ready', 404);

  const upstream = await fetch(
    `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(account.wechat_qr_ticket)}`,
  );
  if (!upstream.ok) return c.text('QR code fetch failed', 502);
  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

wechatWebhook.get('/wechat/:accountId/follow', async (c) => {
  const account = await resolveWeChatAccount(c.env.DB, c.req.param('accountId'));
  if (!account) return c.text('WeChat account not found', 404);

  const destination = resolveOfficialAccountUrl(account.wechat_follow_url);
  if (!destination) {
    return c.redirect(`/wechat/${encodeURIComponent(account.id)}`, 302);
  }
  return c.redirect(destination.toString(), 302);
});

wechatWebhook.get('/wechat/:accountId', async (c) => {
  const account = await resolveWeChatAccount(c.env.DB, c.req.param('accountId'));
  if (!account || (!account.wechat_kf_contact_url && !account.wechat_qr_ticket)) {
    return c.html('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>WeChat</title><p>WeChat contact is not ready.</p></html>', 404);
  }

  const name = escapeHtml(account.name);
  const qrUrl = `/wechat/${encodeURIComponent(account.id)}/qr.png`;
  const followUrl = `/wechat/${encodeURIComponent(account.id)}/follow`;
  const contactUrl = `/wechat/${encodeURIComponent(account.id)}/contact`;
  const hasContactUrl = Boolean(account.wechat_kf_contact_url);
  const hasFollowUrl = Boolean(resolveOfficialAccountUrl(account.wechat_follow_url));
  const hasQr = Boolean(account.wechat_qr_ticket);
  return c.html(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${name} - WeChat</title>
  <style>
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f7f4;color:#13241a;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Noto Sans SC",sans-serif;padding:24px}.card{width:min(100%,420px);background:#fff;border:1px solid #e2ebe5;border-radius:24px;padding:34px 28px;text-align:center;box-shadow:0 18px 50px rgba(18,55,34,.08)}.mark{width:56px;height:56px;border-radius:18px;background:#07c160;color:#fff;display:grid;place-items:center;font-size:28px;font-weight:800;margin:0 auto 18px}h1{font-size:22px;margin:0 0 10px}.lead{font-size:14px;line-height:1.7;color:#607066;margin:0 0 20px}.qr{width:min(100%,240px);aspect-ratio:1;border:1px solid #e6ece8;border-radius:18px;padding:10px;background:#fff}.button{display:block;margin:0 0 12px;padding:15px 18px;border-radius:12px;background:#07c160;color:#fff;text-decoration:none;font-weight:700}.button.secondary{background:#fff;color:#087a43;border:1px solid #9bd9b8}.divider{display:flex;align-items:center;gap:12px;color:#9aa69e;font-size:12px;margin:18px 0 16px}.divider:before,.divider:after{content:"";height:1px;background:#e6ece8;flex:1}.note{font-size:12px;color:#8a978f;line-height:1.6;margin:16px 0 0}
  </style>
</head>
<body><main class="card"><div class="mark">微</div><h1>${name}</h1><p class="lead">关注 Flat Travel 官方账号，继续接收行程、报价和重要变更通知。</p>${hasFollowUrl ? `<a class="button" href="${followUrl}">打开 Flat Travel 官方账号</a>` : ''}${hasContactUrl ? `<a class="button secondary" href="${contactUrl}">先直接咨询客服</a>` : ''}${hasQr ? `<div class="divider">${hasFollowUrl ? '无法打开时请扫码关注' : '请在 WeChat 中识别二维码关注'}</div>` : ''}${hasQr ? `<img class="qr" src="${qrUrl}" alt="${name} WeChat QR code">` : ''}<p class="note">手机：请在 WeChat 内打开本页<br>外部浏览器无法唤起时，请保存二维码后在 WeChat 中识别</p></main></body>
</html>`);
});

export { wechatWebhook };
