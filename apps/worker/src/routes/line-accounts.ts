import { Hono } from 'hono';
import {
  getLineAccounts,
  getLineAccountById,
  createLineAccount,
  updateLineAccount,
  deleteLineAccount,
} from '@line-crm/db';
import type { LineAccount as DbLineAccount } from '@line-crm/db';
import type { Env } from '../index.js';
import { fetchKakaoStatus } from '../services/kakao.js';
import {
  fetchWeChatKfStatus,
  generateWeChatKfContactUrl,
} from '../services/wechat-kf.js';
import { fetchWeChatStatus, generateWeChatQr } from '../services/wechat.js';
import {
  fetchMetaChannelProfile,
  isMetaMessagingChannel,
} from '../services/meta-messaging.js';

const lineAccounts = new Hono<Env>();
const GRAPH_API = 'https://graph.facebook.com/v25.0';

type WhatsAppBusinessProfile = {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  profile_picture_url?: string;
  websites?: string[];
  vertical?: string;
};

type WhatsAppPhoneStatus = {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  name_status?: string;
  code_verification_status?: string;
  quality_rating?: string;
  messaging_limit_tier?: string;
};

type ChannelType =
  | 'line'
  | 'whatsapp'
  | 'kakao'
  | 'wechat'
  | 'facebook'
  | 'instagram';

function serializeLineAccount(row: DbLineAccount) {
  return {
    id: row.id,
    channelId: row.channel_id,
    name: row.name,
    channelType: row.channel_type || 'line',
    locale: row.locale || 'ja',
    defaultSlackChannel: row.default_slack_channel ?? null,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Intentionally omit channelAccessToken and channelSecret from list responses
  };
}

function serializeLineAccountFull(row: DbLineAccount) {
  return {
    ...serializeLineAccount(row),
    channelAccessToken: row.channel_access_token,
    channelSecret: row.channel_secret,
    wechatEncodingAesKey: row.wechat_encoding_aes_key,
    wechatKfCorpId: row.wechat_kf_corp_id,
    wechatKfSecret: row.wechat_kf_secret,
    wechatKfOpenKfid: row.wechat_kf_open_kfid,
    wechatKfCallbackToken: row.wechat_kf_callback_token,
    wechatKfEncodingAesKey: row.wechat_kf_encoding_aes_key,
    wechatKfContactUrl: row.wechat_kf_contact_url,
    wechatFollowUrl: row.wechat_follow_url,
  };
}

// Fetch bot profile (displayName, pictureUrl) from LINE API
async function fetchBotProfile(accessToken: string): Promise<{ displayName?: string; pictureUrl?: string; basicId?: string }> {
  try {
    const res = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return {};
    const data = await res.json() as { displayName?: string; pictureUrl?: string; basicId?: string };
    return { displayName: data.displayName, pictureUrl: data.pictureUrl, basicId: data.basicId };
  } catch {
    return {};
  }
}

async function fetchWhatsAppPhoneProfile(phoneNumberId: string, accessToken: string): Promise<{ displayName?: string; pictureUrl?: string; basicId?: string }> {
  try {
    const [phoneRes, profileRes] = await Promise.all([
      fetch(`${GRAPH_API}/${phoneNumberId}?fields=display_phone_number,verified_name,name_status,quality_rating`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
      fetch(`${GRAPH_API}/${phoneNumberId}/whatsapp_business_profile?fields=about,profile_picture_url`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    ]);

    const phone = phoneRes.ok
      ? await phoneRes.json() as { display_phone_number?: string; verified_name?: string; name_status?: string }
      : {};
    const profile = profileRes.ok
      ? await profileRes.json() as { data?: Array<{ about?: string; profile_picture_url?: string }> }
      : {};
    const businessProfile = profile.data?.[0];

    return {
      displayName: phone.verified_name || phone.display_phone_number,
      pictureUrl: businessProfile?.profile_picture_url,
      basicId: phone.name_status || phone.display_phone_number,
    };
  } catch {
    return {};
  }
}

async function fetchMetaMessagingAccountProfile(account: DbLineAccount): Promise<{ displayName?: string; pictureUrl?: string; basicId?: string }> {
  try {
    const profile = await fetchMetaChannelProfile(account);
    return {
      displayName: profile.name || profile.username || account.name,
      pictureUrl: profile.pictureUrl || undefined,
      basicId: profile.username ? `@${profile.username}` : profile.id,
    };
  } catch {
    return { displayName: account.name, basicId: account.channel_id };
  }
}

async function getWhatsAppAccountOrThrow(db: D1Database, id: string): Promise<DbLineAccount> {
  const account = await getLineAccountById(db, id);
  if (!account) throw new Response('Channel account not found', { status: 404 });
  if (account.channel_type !== 'whatsapp') throw new Response('Account is not WhatsApp', { status: 400 });
  return account;
}

async function getKakaoAccountOrThrow(db: D1Database, id: string): Promise<DbLineAccount> {
  const account = await getLineAccountById(db, id);
  if (!account) throw new Response('Channel account not found', { status: 404 });
  if (account.channel_type !== 'kakao') throw new Response('Account is not Kakao', { status: 400 });
  return account;
}

async function getWeChatAccountOrThrow(db: D1Database, id: string): Promise<DbLineAccount> {
  const account = await getLineAccountById(db, id);
  if (!account) throw new Response('Channel account not found', { status: 404 });
  if (account.channel_type !== 'wechat') throw new Response('Account is not WeChat', { status: 400 });
  return account;
}

async function getMetaMessagingAccountOrThrow(db: D1Database, id: string): Promise<DbLineAccount> {
  const account = await getLineAccountById(db, id);
  if (!account) throw new Response('Channel account not found', { status: 404 });
  if (!isMetaMessagingChannel(account.channel_type)) {
    throw new Response('Account is not Facebook Messenger or Instagram DM', { status: 400 });
  }
  return account;
}

async function fetchWhatsAppBusinessProfile(account: DbLineAccount): Promise<WhatsAppBusinessProfile> {
  const res = await fetch(
    `${GRAPH_API}/${account.channel_id}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`,
    { headers: { Authorization: `Bearer ${account.channel_access_token}` } },
  );
  const data = await res.json() as { data?: WhatsAppBusinessProfile[]; error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message || 'Failed to fetch WhatsApp profile');
  return data.data?.[0] || {};
}

async function fetchWhatsAppPhoneStatus(account: DbLineAccount): Promise<WhatsAppPhoneStatus> {
  const fields = [
    'id',
    'display_phone_number',
    'verified_name',
    'name_status',
    'code_verification_status',
    'quality_rating',
    'messaging_limit_tier',
  ].join(',');
  const res = await fetch(`${GRAPH_API}/${account.channel_id}?fields=${fields}`, {
    headers: { Authorization: `Bearer ${account.channel_access_token}` },
  });
  const data = await res.json() as WhatsAppPhoneStatus & { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message || 'Failed to fetch WhatsApp phone status');
  return data;
}

async function updateWhatsAppBusinessProfile(
  account: DbLineAccount,
  profile: WhatsAppBusinessProfile,
): Promise<WhatsAppBusinessProfile> {
  const res = await fetch(`${GRAPH_API}/${account.channel_id}/whatsapp_business_profile`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${account.channel_access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      ...profile,
    }),
  });
  const data = await res.json() as { success?: boolean; error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message || 'Failed to update WhatsApp profile');
  return fetchWhatsAppBusinessProfile(account);
}

// GET /api/line-accounts - list all (with LINE profile + stats)
lineAccounts.get('/api/line-accounts', async (c) => {
  try {
    const db = c.env.DB;
    const items = await getLineAccounts(db);

    // Get stats for all accounts in parallel
    const results = await Promise.all(
      items.map(async (item) => {
        const isWhatsApp = item.channel_type === 'whatsapp';
        const isKakao = item.channel_type === 'kakao';
        const isWeChat = item.channel_type === 'wechat';
        const isMetaMessaging = isMetaMessagingChannel(item.channel_type);
        const [profile, friendCount, scenarioCount, msgCount] = await Promise.all([
          isWhatsApp
            ? fetchWhatsAppPhoneProfile(item.channel_id, item.channel_access_token)
            : isMetaMessaging
              ? fetchMetaMessagingAccountProfile(item)
            : isKakao || isWeChat
              ? { displayName: item.name, pictureUrl: undefined, basicId: item.channel_id }
              : fetchBotProfile(item.channel_access_token),
          db.prepare(`SELECT COUNT(*) as count FROM friends WHERE is_following = 1 AND line_account_id = ?`).bind(item.id).first<{ count: number }>(),
          db.prepare(
            `SELECT COUNT(*) as count FROM friend_scenarios fs
             INNER JOIN friends f ON f.id = fs.friend_id
             WHERE fs.status = 'active' AND f.line_account_id = ?`,
          ).bind(item.id).first<{ count: number }>(),
          db.prepare(
            `SELECT COUNT(*) as count FROM messages_log ml
             INNER JOIN friends f ON f.id = ml.friend_id
             WHERE ml.direction = 'outgoing' AND (ml.delivery_type IS NULL OR ml.delivery_type = 'push') AND ml.created_at >= date('now', '-30 days') AND f.line_account_id = ?`,
          ).bind(item.id).first<{ count: number }>(),
        ]);

        return {
          ...serializeLineAccount(item),
          displayName: profile.displayName || item.name,
          pictureUrl: profile.pictureUrl || null,
          basicId: profile.basicId || null,
          stats: {
            friendCount: friendCount?.count ?? 0,
            activeScenarios: scenarioCount?.count ?? 0,
            messagesThisMonth: msgCount?.count ?? 0,
          },
        };
      }),
    );
    return c.json({ success: true, data: results });
  } catch (err) {
    console.error('GET /api/line-accounts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/line-accounts/:id - get single (includes secrets)
lineAccounts.get('/api/line-accounts/:id', async (c) => {
  try {
    const account = await getLineAccountById(c.env.DB, c.req.param('id'));
    if (!account) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    return c.json({ success: true, data: serializeLineAccountFull(account) });
  } catch (err) {
    console.error('GET /api/line-accounts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

lineAccounts.get('/api/line-accounts/:id/whatsapp-profile', async (c) => {
  try {
    const account = await getWhatsAppAccountOrThrow(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: await fetchWhatsAppBusinessProfile(account) });
  } catch (err) {
    if (err instanceof Response) {
      return c.json({ success: false, error: await err.text() }, err.status as 400 | 404);
    }
    console.error('GET /api/line-accounts/:id/whatsapp-profile error:', err);
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' }, 500);
  }
});

lineAccounts.get('/api/line-accounts/:id/whatsapp-status', async (c) => {
  try {
    const account = await getWhatsAppAccountOrThrow(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: await fetchWhatsAppPhoneStatus(account) });
  } catch (err) {
    if (err instanceof Response) {
      return c.json({ success: false, error: await err.text() }, err.status as 400 | 404);
    }
    console.error('GET /api/line-accounts/:id/whatsapp-status error:', err);
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' }, 500);
  }
});

lineAccounts.put('/api/line-accounts/:id/whatsapp-profile', async (c) => {
  try {
    const account = await getWhatsAppAccountOrThrow(c.env.DB, c.req.param('id'));
    const body = await c.req.json<WhatsAppBusinessProfile>();
    return c.json({ success: true, data: await updateWhatsAppBusinessProfile(account, body) });
  } catch (err) {
    if (err instanceof Response) {
      return c.json({ success: false, error: await err.text() }, err.status as 400 | 404);
    }
    console.error('PUT /api/line-accounts/:id/whatsapp-profile error:', err);
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' }, 500);
  }
});

lineAccounts.get('/api/line-accounts/:id/kakao-status', async (c) => {
  try {
    const account = await getKakaoAccountOrThrow(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: await fetchKakaoStatus(account) });
  } catch (err) {
    if (err instanceof Response) {
      return c.json({ success: false, error: await err.text() }, err.status as 400 | 404);
    }
    console.error('GET /api/line-accounts/:id/kakao-status error:', err);
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' }, 500);
  }
});

lineAccounts.get('/api/line-accounts/:id/meta-status', async (c) => {
  try {
    const account = await getMetaMessagingAccountOrThrow(c.env.DB, c.req.param('id'));
    const profile = await fetchMetaChannelProfile(account);
    const workerUrl = (c.env.WORKER_URL || new URL(c.req.url).origin).replace(/\/+$/, '');
    return c.json({
      success: true,
      data: {
        ...profile,
        connected: true,
        webhookUrl: `${workerUrl}/webhook/meta`,
        replyWindowHours: 24,
      },
    });
  } catch (err) {
    if (err instanceof Response) {
      return c.json({ success: false, error: await err.text() }, err.status as 400 | 404);
    }
    console.error('GET /api/line-accounts/:id/meta-status error:', err);
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' }, 500);
  }
});

lineAccounts.get('/api/line-accounts/:id/wechat-status', async (c) => {
  try {
    const account = await getWeChatAccountOrThrow(c.env.DB, c.req.param('id'));
    const status = await fetchWeChatStatus(c.env.DB, c.env, account);
    return c.json({
      success: true,
      data: {
        ...status,
        webhookUrl: `${c.env.WORKER_URL || new URL(c.req.url).origin}/webhook/wechat/${account.id}`,
        landingUrl: `${c.env.WORKER_URL || new URL(c.req.url).origin}/wechat/${account.id}`,
      },
    });
  } catch (err) {
    if (err instanceof Response) {
      return c.json({ success: false, error: await err.text() }, err.status as 400 | 404);
    }
    console.error('GET /api/line-accounts/:id/wechat-status error:', err);
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' }, 500);
  }
});

lineAccounts.post('/api/line-accounts/:id/wechat-qr', async (c) => {
  try {
    const account = await getWeChatAccountOrThrow(c.env.DB, c.req.param('id'));
    const qr = await generateWeChatQr(c.env.DB, c.env, account);
    const baseUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
    return c.json({
      success: true,
      data: {
        ...qr,
        imageUrl: `${baseUrl}/wechat/${account.id}/qr.png`,
        landingUrl: `${baseUrl}/wechat/${account.id}`,
      },
    });
  } catch (err) {
    if (err instanceof Response) {
      return c.json({ success: false, error: await err.text() }, err.status as 400 | 404);
    }
    console.error('POST /api/line-accounts/:id/wechat-qr error:', err);
    return c.json({ success: false, error: err instanceof Error ? err.message : 'Internal server error' }, 500);
  }
});

lineAccounts.get('/api/line-accounts/:id/wechat-kf-status', async (c) => {
  try {
    const account = await getWeChatAccountOrThrow(c.env.DB, c.req.param('id'));
    const baseUrl = (c.env.WORKER_URL || new URL(c.req.url).origin).replace(/\/+$/, '');
    const callbackReady = Boolean(
      account.wechat_kf_callback_token?.trim()
        && account.wechat_kf_encoding_aes_key?.trim(),
    );
    const configured = Boolean(
      account.wechat_kf_corp_id?.trim()
        && account.wechat_kf_secret?.trim(),
    );
    const common = {
      configured,
      openKfidReady: Boolean(account.wechat_kf_open_kfid?.trim()),
      callbackReady,
      contactUrlReady: Boolean(account.wechat_kf_contact_url),
      followUrlReady: Boolean(account.wechat_follow_url),
      callbackUrl: `${baseUrl}/webhook/wechat-kf/${account.id}`,
      directUrl: `${baseUrl}/wechat/${account.id}/contact`,
      landingUrl: `${baseUrl}/wechat/${account.id}`,
    };
    if (!configured) {
      return c.json({ success: true, data: { connected: false, ...common } });
    }
    const status = await fetchWeChatKfStatus(c.env.DB, c.env, account, callbackReady);
    return c.json({
      success: true,
      data: { ...common, ...status, openKfidReady: Boolean(status.openKfid) },
    });
  } catch (err) {
    if (err instanceof Response) {
      return c.json({ success: false, error: await err.text() }, err.status as 400 | 404);
    }
    console.error('GET /api/line-accounts/:id/wechat-kf-status error:', err);
    return c.json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    }, 500);
  }
});

lineAccounts.post('/api/line-accounts/:id/wechat-kf-link', async (c) => {
  try {
    const account = await getWeChatAccountOrThrow(c.env.DB, c.req.param('id'));
    const body: { scene?: string } = await c.req
      .json<{ scene?: string }>()
      .catch(() => ({}));
    const contactUrl = await generateWeChatKfContactUrl({
      db: c.env.DB,
      env: c.env,
      account,
      scene: body.scene,
    });
    const baseUrl = (c.env.WORKER_URL || new URL(c.req.url).origin).replace(/\/+$/, '');
    return c.json({
      success: true,
      data: {
        providerUrl: contactUrl,
        directUrl: `${baseUrl}/wechat/${account.id}/contact`,
        landingUrl: `${baseUrl}/wechat/${account.id}`,
      },
    });
  } catch (err) {
    if (err instanceof Response) {
      return c.json({ success: false, error: await err.text() }, err.status as 400 | 404);
    }
    console.error('POST /api/line-accounts/:id/wechat-kf-link error:', err);
    return c.json({
      success: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    }, 500);
  }
});

// POST /api/line-accounts - create
lineAccounts.post('/api/line-accounts', async (c) => {
  try {
    const body = await c.req.json<{
      channelId: string;
      name: string;
      channelAccessToken: string;
      channelSecret?: string;
      channelType?: ChannelType;
      locale?: string;
      defaultSlackChannel?: string | null;
      wechatEncodingAesKey?: string | null;
    }>();

    const channelType: ChannelType =
      body.channelType === 'whatsapp'
        ? 'whatsapp'
        : body.channelType === 'kakao'
          ? 'kakao'
          : body.channelType === 'wechat'
            ? 'wechat'
            : body.channelType === 'facebook'
              ? 'facebook'
              : body.channelType === 'instagram'
                ? 'instagram'
          : 'line';

    const secretRequired = channelType !== 'whatsapp';
    if (!body.channelId || !body.name || !body.channelAccessToken || (secretRequired && !body.channelSecret)) {
      return c.json(
        {
          success: false,
          error:
            channelType === 'whatsapp'
              ? 'channelId, name, and channelAccessToken are required'
              : channelType === 'kakao'
                ? 'channelId, name, channelAccessToken, and channelSecret are required for Kakao'
                : channelType === 'wechat'
                  ? 'AppID, account name, AppSecret, and Token are required for WeChat'
                  : channelType === 'facebook'
                    ? 'Page ID, account name, Page Access Token, and Meta App Secret are required'
                    : channelType === 'instagram'
                      ? 'Instagram Professional Account ID, account name, access token, and Meta App Secret are required'
                : 'channelId, name, channelAccessToken, and channelSecret are required',
        },
        400,
      );
    }

    if (channelType === 'wechat') {
      if (body.channelSecret!.length < 3 || body.channelSecret!.length > 32) {
        return c.json({ success: false, error: 'WeChat Token must be 3 to 32 characters' }, 400);
      }
      if (!body.wechatEncodingAesKey || body.wechatEncodingAesKey.trim().length !== 43) {
        return c.json({ success: false, error: 'WeChat EncodingAESKey must be 43 characters' }, 400);
      }
    }

    const account = await createLineAccount(c.env.DB, {
      ...body,
      channelType,
      channelSecret: body.channelSecret ?? '',
      wechatEncodingAesKey: channelType === 'wechat' ? body.wechatEncodingAesKey?.trim() || null : null,
    });
    return c.json({ success: true, data: serializeLineAccountFull(account) }, 201);
  } catch (err) {
    console.error('POST /api/line-accounts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/line-accounts/:id - update
lineAccounts.put('/api/line-accounts/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      channelAccessToken?: string;
      channelSecret?: string;
      channelType?: ChannelType;
      locale?: string;
      defaultSlackChannel?: string | null;
      wechatEncodingAesKey?: string | null;
      wechatKfCorpId?: string | null;
      wechatKfSecret?: string | null;
      wechatKfOpenKfid?: string | null;
      wechatKfCallbackToken?: string | null;
      wechatKfEncodingAesKey?: string | null;
      wechatFollowUrl?: string | null;
      isActive?: boolean;
    }>();

    if (
      body.wechatKfEncodingAesKey !== undefined
      && body.wechatKfEncodingAesKey !== null
      && body.wechatKfEncodingAesKey.trim()
      && body.wechatKfEncodingAesKey.trim().length !== 43
    ) {
      return c.json({
        success: false,
        error: 'WeChat Customer Service EncodingAESKey must be 43 characters',
      }, 400);
    }
    if (
      body.wechatKfCallbackToken !== undefined
      && body.wechatKfCallbackToken !== null
      && body.wechatKfCallbackToken.trim()
      && (body.wechatKfCallbackToken.trim().length < 3
        || body.wechatKfCallbackToken.trim().length > 32)
    ) {
      return c.json({
        success: false,
        error: 'WeChat Customer Service callback Token must be 3 to 32 characters',
      }, 400);
    }
    if (body.wechatFollowUrl?.trim()) {
      try {
        const url = new URL(body.wechatFollowUrl.trim());
        if (url.protocol !== 'https:') throw new Error('not https');
      } catch {
        return c.json({
          success: false,
          error: 'Official Account follow URL must be a valid HTTPS URL',
        }, 400);
      }
    }

    const existing = await getLineAccountById(c.env.DB, id);
    if (!existing) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    const kfCorpId = body.wechatKfCorpId?.trim() || null;
    const kfSecret = body.wechatKfSecret?.trim() || null;
    const kfOpenKfid = body.wechatKfOpenKfid?.trim() || null;
    const kfCredentialsChanged =
      (body.wechatKfCorpId !== undefined && kfCorpId !== existing.wechat_kf_corp_id)
      || (body.wechatKfSecret !== undefined && kfSecret !== existing.wechat_kf_secret)
      || (body.wechatKfOpenKfid !== undefined && kfOpenKfid !== existing.wechat_kf_open_kfid);
    const kfIdentityChanged =
      (body.wechatKfCorpId !== undefined && kfCorpId !== existing.wechat_kf_corp_id)
      || (body.wechatKfOpenKfid !== undefined && kfOpenKfid !== existing.wechat_kf_open_kfid);
    const updated = await updateLineAccount(c.env.DB, id, {
      name: body.name,
      channel_access_token: body.channelAccessToken,
      channel_secret: body.channelSecret,
      channel_type: body.channelType,
      locale: body.locale,
      default_slack_channel: body.defaultSlackChannel,
      wechat_encoding_aes_key: body.wechatEncodingAesKey,
      wechat_access_token: body.channelAccessToken !== undefined ? null : undefined,
      token_expires_at: body.channelAccessToken !== undefined ? null : undefined,
      wechat_kf_corp_id:
        body.wechatKfCorpId !== undefined ? kfCorpId : undefined,
      wechat_kf_secret:
        body.wechatKfSecret !== undefined ? kfSecret : undefined,
      wechat_kf_open_kfid:
        body.wechatKfOpenKfid !== undefined ? kfOpenKfid : undefined,
      wechat_kf_callback_token:
        body.wechatKfCallbackToken !== undefined
          ? body.wechatKfCallbackToken?.trim() || null
          : undefined,
      wechat_kf_encoding_aes_key:
        body.wechatKfEncodingAesKey !== undefined
          ? body.wechatKfEncodingAesKey?.trim() || null
          : undefined,
      wechat_kf_access_token: kfCredentialsChanged ? null : undefined,
      wechat_kf_token_expires_at: kfCredentialsChanged ? null : undefined,
      wechat_kf_contact_url: kfIdentityChanged ? null : undefined,
      wechat_kf_sync_cursor: kfIdentityChanged ? null : undefined,
      wechat_follow_url:
        body.wechatFollowUrl !== undefined ? body.wechatFollowUrl?.trim() || null : undefined,
      is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
    });

    if (!updated) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    return c.json({ success: true, data: serializeLineAccountFull(updated) });
  } catch (err) {
    console.error('PUT /api/line-accounts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/line-accounts/:id - delete
lineAccounts.delete('/api/line-accounts/:id', async (c) => {
  try {
    await deleteLineAccount(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/line-accounts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { lineAccounts };
