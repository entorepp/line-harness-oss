import type { LineAccount } from '@line-crm/db';

const DEFAULT_WECOM_API_BASE = 'https://qyapi.weixin.qq.com';
const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;
const TOKEN_ERROR_CODES = new Set([40014, 42001]);

export type WeChatKfAccount = Pick<
  LineAccount,
  | 'id'
  | 'wechat_kf_corp_id'
  | 'wechat_kf_secret'
  | 'wechat_kf_open_kfid'
  | 'wechat_kf_access_token'
  | 'wechat_kf_token_expires_at'
  | 'wechat_kf_contact_url'
  | 'wechat_kf_sync_cursor'
  | 'wechat_follow_url'
>;

type WeChatKfEnvironment = {
  WECOM_API_BASE_URL?: string;
};

type WeComApiResponse = {
  errcode?: number;
  errmsg?: string;
};

type WeChatKfAccountInfo = {
  open_kfid?: string;
  name?: string;
  avatar?: string;
};

export type WeChatKfStatus = {
  connected: true;
  corpId: string;
  openKfid: string | null;
  accountName: string | null;
  accountAvatar: string | null;
  availableAccounts: Array<{
    openKfid: string;
    name: string | null;
    avatar: string | null;
  }>;
  tokenExpiresAt: string | null;
  callbackReady: boolean;
  contactUrlReady: boolean;
  followUrlReady: boolean;
};

export type WeChatKfMessage = {
  msgid?: string;
  open_kfid?: string;
  external_userid?: string;
  send_time?: number;
  origin?: number;
  msgtype?: string;
  text?: { content?: string };
  image?: { media_id?: string };
  voice?: { media_id?: string };
  video?: { media_id?: string };
  file?: { media_id?: string };
  link?: {
    title?: string;
    desc?: string;
    url?: string;
    thumb_media_id?: string;
  };
  location?: {
    latitude?: number;
    longitude?: number;
    name?: string;
    address?: string;
  };
  event?: {
    event_type?: string;
    scene?: string;
    scene_param?: string;
    welcome_code?: string;
  };
  servicer_userid?: string;
};

export type WeChatKfSyncResult = {
  nextCursor: string;
  hasMore: boolean;
  messages: WeChatKfMessage[];
};

function apiBase(env: WeChatKfEnvironment): string {
  return (env.WECOM_API_BASE_URL?.trim() || DEFAULT_WECOM_API_BASE).replace(/\/+$/, '');
}

function requireTokenCredentials(account: WeChatKfAccount): {
  corpId: string;
  secret: string;
} {
  const corpId = account.wechat_kf_corp_id?.trim() || '';
  const secret = account.wechat_kf_secret?.trim() || '';
  if (!corpId || !secret) {
    throw new Error('WeChat Customer Service CorpID and Secret are required');
  }
  return { corpId, secret };
}

function requireOpenKfid(account: WeChatKfAccount): string {
  const openKfid = account.wechat_kf_open_kfid?.trim() || '';
  if (!openKfid) {
    throw new Error('WeChat Customer Service open_kfid is required');
  }
  return openKfid;
}

function tokenStillUsable(account: WeChatKfAccount): boolean {
  if (!account.wechat_kf_access_token || !account.wechat_kf_token_expires_at) return false;
  const expiresAt = Date.parse(account.wechat_kf_token_expires_at);
  return Number.isFinite(expiresAt) && expiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS;
}

function weComError(body: WeComApiResponse, fallback: string): Error {
  const code = typeof body.errcode === 'number' ? ` (${body.errcode})` : '';
  return new Error(`${body.errmsg || fallback}${code}`);
}

export async function invalidateWeChatKfAccessToken(
  db: D1Database,
  accountId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE line_accounts
          SET wechat_kf_access_token = NULL,
              wechat_kf_token_expires_at = NULL,
              updated_at = datetime('now', '+9 hours')
        WHERE id = ?`,
    )
    .bind(accountId)
    .run();
}

export async function getWeChatKfAccessToken(
  db: D1Database,
  env: WeChatKfEnvironment,
  account: WeChatKfAccount,
  forceRefresh = false,
): Promise<{ accessToken: string; expiresAt: string }> {
  const { corpId, secret } = requireTokenCredentials(account);
  if (!forceRefresh && tokenStillUsable(account)) {
    return {
      accessToken: account.wechat_kf_access_token!,
      expiresAt: account.wechat_kf_token_expires_at!,
    };
  }

  const query = new URLSearchParams({ corpid: corpId, corpsecret: secret });
  const res = await fetch(`${apiBase(env)}/cgi-bin/gettoken?${query.toString()}`);
  const body = await res.json().catch(() => ({})) as WeComApiResponse & {
    access_token?: string;
    expires_in?: number;
  };
  if (!res.ok || !body.access_token || (body.errcode ?? 0) !== 0) {
    throw weComError(body, `WeCom access token request failed: HTTP ${res.status}`);
  }

  const expiresInSeconds = typeof body.expires_in === 'number' ? body.expires_in : 7200;
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  await db
    .prepare(
      `UPDATE line_accounts
          SET wechat_kf_access_token = ?,
              wechat_kf_token_expires_at = ?,
              updated_at = datetime('now', '+9 hours')
        WHERE id = ?`,
    )
    .bind(body.access_token, expiresAt, account.id)
    .run();

  return { accessToken: body.access_token, expiresAt };
}

async function weComApiRequest<T extends WeComApiResponse>(opts: {
  db: D1Database;
  env: WeChatKfEnvironment;
  account: WeChatKfAccount;
  path: string;
  init?: RequestInit;
  retry?: boolean;
}): Promise<T> {
  const token = await getWeChatKfAccessToken(opts.db, opts.env, opts.account);
  const separator = opts.path.includes('?') ? '&' : '?';
  const res = await fetch(
    `${apiBase(opts.env)}${opts.path}${separator}access_token=${encodeURIComponent(token.accessToken)}`,
    opts.init,
  );
  const body = await res.json().catch(() => ({})) as T;

  if (TOKEN_ERROR_CODES.has(body.errcode ?? 0) && opts.retry !== false) {
    await invalidateWeChatKfAccessToken(opts.db, opts.account.id);
    return weComApiRequest<T>({
      ...opts,
      account: {
        ...opts.account,
        wechat_kf_access_token: null,
        wechat_kf_token_expires_at: null,
      },
      retry: false,
    });
  }

  if (!res.ok || (typeof body.errcode === 'number' && body.errcode !== 0)) {
    throw weComError(body, `WeCom API request failed: HTTP ${res.status}`);
  }
  return body;
}

export async function fetchWeChatKfStatus(
  db: D1Database,
  env: WeChatKfEnvironment,
  account: WeChatKfAccount,
  callbackReady: boolean,
): Promise<WeChatKfStatus> {
  const credentials = requireTokenCredentials(account);
  const token = await getWeChatKfAccessToken(db, env, account);
  const result = await weComApiRequest<WeComApiResponse & {
    account_list?: WeChatKfAccountInfo[];
  }>({
    db,
    env,
    account: {
      ...account,
      wechat_kf_access_token: token.accessToken,
      wechat_kf_token_expires_at: token.expiresAt,
    },
    path: '/cgi-bin/kf/account/list',
  });
  const availableAccounts = (result.account_list || [])
    .filter((item): item is WeChatKfAccountInfo & { open_kfid: string } => Boolean(item.open_kfid))
    .map((item) => ({
      openKfid: item.open_kfid,
      name: item.name || null,
      avatar: item.avatar || null,
    }));
  let selectedOpenKfid = account.wechat_kf_open_kfid?.trim() || '';
  if (!selectedOpenKfid && availableAccounts.length === 1) {
    selectedOpenKfid = availableAccounts[0].openKfid;
    await db
      .prepare(
        `UPDATE line_accounts
            SET wechat_kf_open_kfid = ?,
                updated_at = datetime('now', '+9 hours')
          WHERE id = ?`,
      )
      .bind(selectedOpenKfid, account.id)
      .run();
  }
  const configured = availableAccounts.find(
    (item) => item.openKfid === selectedOpenKfid,
  );
  if (selectedOpenKfid && !configured) {
    throw new Error('Configured open_kfid was not found in this WeChat Customer Service account');
  }

  return {
    connected: true,
    corpId: credentials.corpId,
    openKfid: configured?.openKfid || null,
    accountName: configured?.name || null,
    accountAvatar: configured?.avatar || null,
    availableAccounts,
    tokenExpiresAt: token.expiresAt,
    callbackReady,
    contactUrlReady: Boolean(account.wechat_kf_contact_url),
    followUrlReady: Boolean(account.wechat_follow_url),
  };
}

export async function generateWeChatKfContactUrl(opts: {
  db: D1Database;
  env: WeChatKfEnvironment;
  account: WeChatKfAccount;
  scene?: string;
}): Promise<string> {
  const openKfid = requireOpenKfid(opts.account);
  const result = await weComApiRequest<WeComApiResponse & { url?: string }>({
    db: opts.db,
    env: opts.env,
    account: opts.account,
    path: '/cgi-bin/kf/add_contact_way',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        open_kfid: openKfid,
        scene: (opts.scene?.trim() || `flat-harness-${opts.account.id}`).slice(0, 32),
      }),
    },
  });
  if (!result.url) throw new Error('WeChat Customer Service did not return a contact URL');

  await opts.db
    .prepare(
      `UPDATE line_accounts
          SET wechat_kf_contact_url = ?,
              updated_at = datetime('now', '+9 hours')
        WHERE id = ?`,
    )
    .bind(result.url, opts.account.id)
    .run();
  return result.url;
}

export async function dispatchWeChatKfText(opts: {
  db: D1Database;
  env: WeChatKfEnvironment;
  account: WeChatKfAccount;
  externalUserId: string;
  openKfid?: string;
  text: string;
}): Promise<void> {
  const openKfid = requireOpenKfid(opts.account);
  await weComApiRequest<WeComApiResponse>({
    db: opts.db,
    env: opts.env,
    account: opts.account,
    path: '/cgi-bin/kf/send_msg',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: opts.externalUserId,
        open_kfid: opts.openKfid?.trim() || openKfid,
        msgtype: 'text',
        text: { content: opts.text },
      }),
    },
  });
}

export async function sendWeChatKfWelcome(opts: {
  db: D1Database;
  env: WeChatKfEnvironment;
  account: WeChatKfAccount;
  welcomeCode: string;
}): Promise<void> {
  const followUrl = opts.account.wechat_follow_url?.trim() || '';
  const message = followUrl
    ? {
        code: opts.welcomeCode,
        msgtype: 'msgmenu',
        msgmenu: {
          head_content:
            '感谢您的咨询。为了在本次会话结束后继续接收行程、报价及重要变更通知，请关注我们的官方账号。',
          list: [
            {
              type: 'view',
              view: {
                url: followUrl,
                content: '关注官方账号',
              },
            },
          ],
          tail_content: '关注后请返回本咨询窗口，继续发送您的出行需求。',
        },
      }
    : {
        code: opts.welcomeCode,
        msgtype: 'text',
        text: {
          content:
            '感谢您的咨询。请发送出行日期、人数和轮椅使用情况，我们会尽快为您确认。',
        },
      };

  await weComApiRequest<WeComApiResponse>({
    db: opts.db,
    env: opts.env,
    account: opts.account,
    path: '/cgi-bin/kf/send_msg_on_event',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    },
  });
}

export async function fetchWeChatKfMessages(opts: {
  db: D1Database;
  env: WeChatKfEnvironment;
  account: WeChatKfAccount;
  callbackToken: string;
  cursor?: string | null;
  limit?: number;
}): Promise<WeChatKfSyncResult> {
  const openKfid = requireOpenKfid(opts.account);
  const result = await weComApiRequest<WeComApiResponse & {
    next_cursor?: string;
    has_more?: number;
    msg_list?: WeChatKfMessage[];
  }>({
    db: opts.db,
    env: opts.env,
    account: opts.account,
    path: '/cgi-bin/kf/sync_msg',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cursor: opts.cursor || '',
        token: opts.callbackToken,
        limit: Math.min(Math.max(opts.limit || 100, 1), 1000),
        open_kfid: openKfid,
      }),
    },
  });

  return {
    nextCursor: result.next_cursor || opts.cursor || '',
    hasMore: result.has_more === 1,
    messages: Array.isArray(result.msg_list) ? result.msg_list : [],
  };
}
