import { Buffer } from 'node:buffer';
import { createDecipheriv } from 'node:crypto';
import type { LineAccount } from '@line-crm/db';

const DEFAULT_WECHAT_API_BASE = 'https://api.weixin.qq.com';
const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;
const TOKEN_ERROR_CODES = new Set([40014, 42001]);

type WeChatAccount = Pick<
  LineAccount,
  | 'id'
  | 'channel_id'
  | 'channel_access_token'
  | 'channel_secret'
  | 'wechat_encoding_aes_key'
  | 'wechat_access_token'
  | 'wechat_qr_ticket'
  | 'wechat_qr_url'
  | 'token_expires_at'
>;

type WeChatApiEnvironment = {
  WECHAT_API_BASE_URL?: string;
};

type WeChatApiResponse = {
  errcode?: number;
  errmsg?: string;
};

export type WeChatStatus = {
  appId: string;
  connected: true;
  apiDomainIpCount: number;
  tokenExpiresAt: string | null;
  encryptedModeReady: boolean;
  qrReady: boolean;
};

export type WeChatQr = {
  ticket: string;
  url: string;
  imageUrl: string;
};

function apiBase(env: WeChatApiEnvironment): string {
  return (env.WECHAT_API_BASE_URL?.trim() || DEFAULT_WECHAT_API_BASE).replace(/\/+$/, '');
}

function tokenStillUsable(account: WeChatAccount): boolean {
  if (!account.wechat_access_token || !account.token_expires_at) return false;
  const expiresAt = Date.parse(account.token_expires_at);
  return Number.isFinite(expiresAt) && expiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS;
}

function wechatError(body: WeChatApiResponse, fallback: string): Error {
  const code = typeof body.errcode === 'number' ? ` (${body.errcode})` : '';
  return new Error(`${body.errmsg || fallback}${code}`);
}

export async function invalidateWeChatAccessToken(db: D1Database, accountId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE line_accounts
          SET wechat_access_token = NULL,
              token_expires_at = NULL,
              updated_at = datetime('now', '+9 hours')
        WHERE id = ?`,
    )
    .bind(accountId)
    .run();
}

export async function getWeChatAccessToken(
  db: D1Database,
  env: WeChatApiEnvironment,
  account: WeChatAccount,
  forceRefresh = false,
): Promise<{ accessToken: string; expiresAt: string }> {
  if (!forceRefresh && tokenStillUsable(account)) {
    return {
      accessToken: account.wechat_access_token!,
      expiresAt: account.token_expires_at!,
    };
  }

  const res = await fetch(`${apiBase(env)}/cgi-bin/stable_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credential',
      appid: account.channel_id,
      secret: account.channel_access_token,
      force_refresh: forceRefresh,
    }),
  });
  const body = await res.json().catch(() => ({})) as WeChatApiResponse & {
    access_token?: string;
    expires_in?: number;
  };

  if (!res.ok || !body.access_token) {
    throw wechatError(body, `WeChat access token request failed: HTTP ${res.status}`);
  }

  const expiresInSeconds = typeof body.expires_in === 'number' ? body.expires_in : 7200;
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  await db
    .prepare(
      `UPDATE line_accounts
          SET wechat_access_token = ?,
              token_expires_at = ?,
              updated_at = datetime('now', '+9 hours')
        WHERE id = ?`,
    )
    .bind(body.access_token, expiresAt, account.id)
    .run();

  return { accessToken: body.access_token, expiresAt };
}

async function wechatApiRequest<T extends WeChatApiResponse>(opts: {
  db: D1Database;
  env: WeChatApiEnvironment;
  account: WeChatAccount;
  path: string;
  init?: RequestInit;
  retry?: boolean;
}): Promise<T> {
  const { accessToken } = await getWeChatAccessToken(opts.db, opts.env, opts.account, false);
  const separator = opts.path.includes('?') ? '&' : '?';
  const res = await fetch(
    `${apiBase(opts.env)}${opts.path}${separator}access_token=${encodeURIComponent(accessToken)}`,
    opts.init,
  );
  const body = await res.json().catch(() => ({})) as T;

  if (TOKEN_ERROR_CODES.has(body.errcode ?? 0) && opts.retry !== false) {
    await invalidateWeChatAccessToken(opts.db, opts.account.id);
    const refreshedAccount = {
      ...opts.account,
      wechat_access_token: null,
      token_expires_at: null,
    };
    return wechatApiRequest<T>({ ...opts, account: refreshedAccount, retry: false });
  }

  if (!res.ok || (typeof body.errcode === 'number' && body.errcode !== 0)) {
    throw wechatError(body, `WeChat API request failed: HTTP ${res.status}`);
  }
  return body;
}

export async function fetchWeChatStatus(
  db: D1Database,
  env: WeChatApiEnvironment,
  account: WeChatAccount,
): Promise<WeChatStatus> {
  const token = await getWeChatAccessToken(db, env, account);
  const result = await wechatApiRequest<WeChatApiResponse & { ip_list?: string[] }>({
    db,
    env,
    account: { ...account, wechat_access_token: token.accessToken, token_expires_at: token.expiresAt },
    path: '/cgi-bin/get_api_domain_ip',
  });

  return {
    appId: account.channel_id,
    connected: true,
    apiDomainIpCount: Array.isArray(result.ip_list) ? result.ip_list.length : 0,
    tokenExpiresAt: token.expiresAt,
    encryptedModeReady: Boolean(account.wechat_encoding_aes_key),
    qrReady: Boolean(account.wechat_qr_ticket && account.wechat_qr_url),
  };
}

export async function generateWeChatQr(
  db: D1Database,
  env: WeChatApiEnvironment,
  account: WeChatAccount,
): Promise<WeChatQr> {
  const scene = `flat-harness-${account.id}`.slice(0, 64);
  const result = await wechatApiRequest<WeChatApiResponse & { ticket?: string; url?: string }>({
    db,
    env,
    account,
    path: '/cgi-bin/qrcode/create',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action_name: 'QR_LIMIT_STR_SCENE',
        action_info: { scene: { scene_str: scene } },
      }),
    },
  });

  if (!result.ticket || !result.url) {
    throw new Error('WeChat QR API did not return a ticket and URL');
  }

  await db
    .prepare(
      `UPDATE line_accounts
          SET wechat_qr_ticket = ?,
              wechat_qr_url = ?,
              updated_at = datetime('now', '+9 hours')
        WHERE id = ?`,
    )
    .bind(result.ticket, result.url, account.id)
    .run();

  return {
    ticket: result.ticket,
    url: result.url,
    imageUrl: `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(result.ticket)}`,
  };
}

export async function dispatchWeChatText(opts: {
  db: D1Database;
  env: WeChatApiEnvironment;
  account: WeChatAccount;
  to: string;
  text: string;
}): Promise<void> {
  await wechatApiRequest<WeChatApiResponse>({
    db: opts.db,
    env: opts.env,
    account: opts.account,
    path: '/cgi-bin/message/custom/send',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: opts.to,
        msgtype: 'text',
        text: { content: opts.text },
      }),
    },
  });
}

export async function sha1Hex(parts: string[]): Promise<string> {
  const input = parts.slice().sort().join('');
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function timingSafeStringEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function verifyWeChatSignature(
  token: string,
  timestamp: string,
  nonce: string,
  receivedSignature: string,
  encrypted?: string,
): Promise<boolean> {
  const expected = await sha1Hex(encrypted ? [token, timestamp, nonce, encrypted] : [token, timestamp, nonce]);
  return timingSafeStringEqual(expected, receivedSignature);
}

function removeWeChatPadding(buffer: Buffer): Buffer {
  if (buffer.length === 0) throw new Error('WeChat encrypted payload is empty');
  const padding = buffer[buffer.length - 1];
  if (padding < 1 || padding > 32 || padding > buffer.length) {
    throw new Error('WeChat encrypted payload has invalid padding');
  }
  for (let index = buffer.length - padding; index < buffer.length; index += 1) {
    if (buffer[index] !== padding) throw new Error('WeChat encrypted payload has invalid padding');
  }
  return buffer.subarray(0, buffer.length - padding);
}

export function decryptWeChatPayload(
  encrypted: string,
  encodingAesKey: string,
  expectedAppId: string,
): string {
  const aesKey = Buffer.from(`${encodingAesKey}=`, 'base64');
  if (aesKey.length !== 32) throw new Error('WeChat EncodingAESKey must decode to 32 bytes');

  const decipher = createDecipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16));
  decipher.setAutoPadding(false);
  const decrypted = removeWeChatPadding(Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]));
  if (decrypted.length < 20) throw new Error('WeChat encrypted payload is too short');

  const messageLength = decrypted.readUInt32BE(16);
  const messageStart = 20;
  const messageEnd = messageStart + messageLength;
  if (messageEnd > decrypted.length) throw new Error('WeChat encrypted payload length is invalid');

  const appId = decrypted.subarray(messageEnd).toString('utf8');
  if (appId !== expectedAppId) throw new Error('WeChat encrypted payload AppID mismatch');
  return decrypted.subarray(messageStart, messageEnd).toString('utf8');
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function readWeChatXmlValue(xml: string, tag: string): string | null {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cdata = xml.match(new RegExp(`<${escapedTag}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${escapedTag}>`, 'i'));
  if (cdata) return cdata[1];
  const plain = xml.match(new RegExp(`<${escapedTag}>\\s*([\\s\\S]*?)\\s*</${escapedTag}>`, 'i'));
  return plain ? decodeXmlEntities(plain[1].trim()) : null;
}
