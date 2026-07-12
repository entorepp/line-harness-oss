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

const lineAccounts = new Hono<Env>();
const GRAPH_API = 'https://graph.facebook.com/v22.0';

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

type ChannelType = 'line' | 'whatsapp' | 'kakao';

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
        const [profile, friendCount, scenarioCount, msgCount] = await Promise.all([
          isWhatsApp
            ? fetchWhatsAppPhoneProfile(item.channel_id, item.channel_access_token)
            : isKakao
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
    }>();

    const channelType: ChannelType =
      body.channelType === 'whatsapp'
        ? 'whatsapp'
        : body.channelType === 'kakao'
          ? 'kakao'
          : 'line';

    const secretRequired = channelType === 'line' || channelType === 'kakao';
    if (!body.channelId || !body.name || !body.channelAccessToken || (secretRequired && !body.channelSecret)) {
      return c.json(
        {
          success: false,
          error:
            channelType === 'whatsapp'
              ? 'channelId, name, and channelAccessToken are required'
              : channelType === 'kakao'
                ? 'channelId, name, channelAccessToken, and channelSecret are required for Kakao'
                : 'channelId, name, channelAccessToken, and channelSecret are required',
        },
        400,
      );
    }

    const account = await createLineAccount(c.env.DB, {
      ...body,
      channelType,
      channelSecret: body.channelSecret ?? '',
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
      isActive?: boolean;
    }>();

    const updated = await updateLineAccount(c.env.DB, id, {
      name: body.name,
      channel_access_token: body.channelAccessToken,
      channel_secret: body.channelSecret,
      channel_type: body.channelType,
      locale: body.locale,
      default_slack_channel: body.defaultSlackChannel,
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
