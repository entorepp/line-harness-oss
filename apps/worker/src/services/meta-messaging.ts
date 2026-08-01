import type { LineAccount } from '@line-crm/db';

const FACEBOOK_GRAPH_API = 'https://graph.facebook.com/v25.0';
const INSTAGRAM_GRAPH_API = 'https://graph.instagram.com/v26.0';
export const META_REPLY_WINDOW_HOURS = 24;
const META_UNDO_HOLD_MAX_MS = 2 * 60 * 1000;

export type MetaMessagingChannelType = 'facebook' | 'instagram';

export type MetaChannelProfile = {
  id: string;
  channelType: MetaMessagingChannelType;
  name: string | null;
  username: string | null;
  pictureUrl: string | null;
};

type MetaGraphError = {
  error?: {
    message?: string;
    code?: number;
    type?: string;
  };
};

export function isMetaMessagingChannel(value: string | null | undefined): value is MetaMessagingChannelType {
  return value === 'facebook' || value === 'instagram';
}

/**
 * Instagram API with Instagram Login uses graph.instagram.com and the
 * instagram_business_* permission family. Messenger continues to use the
 * Facebook Graph host with a Page access token.
 */
export function metaGraphApiBase(channelType: MetaMessagingChannelType): string {
  return channelType === 'instagram' ? INSTAGRAM_GRAPH_API : FACEBOOK_GRAPH_API;
}

export function isAllowedMetaUndoHold(opts: {
  deliveryMode?: string;
  undoGroupId?: string;
  scheduledAt: string;
}): boolean {
  const scheduledTime = new Date(opts.scheduledAt).getTime();
  return opts.deliveryMode === 'undo_hold'
    && Boolean(opts.undoGroupId?.trim())
    && Number.isFinite(scheduledTime)
    && scheduledTime > Date.now()
    && scheduledTime - Date.now() <= META_UNDO_HOLD_MAX_MS;
}

function metaGraphError(body: MetaGraphError, fallback: string): Error {
  const suffix = body.error?.code ? ` (code ${body.error.code})` : '';
  return new Error(`${body.error?.message || fallback}${suffix}`);
}

export async function fetchMetaChannelProfile(account: Pick<LineAccount, 'channel_id' | 'channel_access_token' | 'channel_type'>): Promise<MetaChannelProfile> {
  if (!isMetaMessagingChannel(account.channel_type)) {
    throw new Error('Account is not a Meta messaging channel');
  }

  const fields = account.channel_type === 'facebook'
    ? 'id,name,picture.type(large){url}'
    : 'id,username,name,profile_picture_url';
  const res = await fetch(`${metaGraphApiBase(account.channel_type)}/${account.channel_id}?fields=${encodeURIComponent(fields)}`, {
    headers: { Authorization: `Bearer ${account.channel_access_token}` },
  });
  const body = await res.json() as MetaGraphError & {
    id?: string;
    name?: string;
    username?: string;
    profile_picture_url?: string;
    picture?: { data?: { url?: string } };
  };

  if (!res.ok) {
    throw metaGraphError(body, 'Failed to fetch Meta channel profile');
  }

  return {
    id: body.id || account.channel_id,
    channelType: account.channel_type,
    name: body.name || null,
    username: body.username || null,
    pictureUrl: body.profile_picture_url || body.picture?.data?.url || null,
  };
}

export async function fetchMetaCustomerProfile(opts: {
  channelType: MetaMessagingChannelType;
  customerId: string;
  accessToken: string;
}): Promise<{ displayName: string | null; pictureUrl: string | null; username: string | null }> {
  const fields = opts.channelType === 'facebook'
    ? 'first_name,last_name,profile_pic'
    : 'name,username,profile_pic';
  const res = await fetch(`${metaGraphApiBase(opts.channelType)}/${opts.customerId}?fields=${encodeURIComponent(fields)}`, {
    headers: { Authorization: `Bearer ${opts.accessToken}` },
  });
  const body = await res.json() as MetaGraphError & {
    first_name?: string;
    last_name?: string;
    name?: string;
    username?: string;
    profile_pic?: string;
  };

  if (!res.ok) {
    throw metaGraphError(body, 'Failed to fetch Meta customer profile');
  }

  const facebookName = [body.first_name, body.last_name].filter(Boolean).join(' ').trim();
  return {
    displayName: body.name || facebookName || body.username || null,
    pictureUrl: body.profile_pic || null,
    username: body.username || null,
  };
}

export async function assertMetaReplyWindow(db: D1Database, friendId: string): Promise<void> {
  const row = await db
    .prepare(
      `SELECT created_at
         FROM messages_log
        WHERE friend_id = ? AND direction = 'incoming'
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
    )
    .bind(friendId)
    .first<{ created_at: string }>();

  const lastInboundAt = row?.created_at ? new Date(row.created_at).getTime() : Number.NaN;
  const withinWindow = Number.isFinite(lastInboundAt)
    && Date.now() - lastInboundAt <= META_REPLY_WINDOW_HOURS * 60 * 60 * 1000;
  if (!withinWindow) {
    throw new Error('Meta DMの24時間返信枠外です。お客様から新しいメッセージを受信してから返信してください。');
  }
}

export async function dispatchMetaText(opts: {
  channelType: MetaMessagingChannelType;
  channelId: string;
  accessToken: string;
  recipientId: string;
  text: string;
}): Promise<string | null> {
  const body: Record<string, unknown> = {
    recipient: { id: opts.recipientId },
    message: { text: opts.text },
  };
  if (opts.channelType === 'facebook') {
    body.messaging_type = 'RESPONSE';
  }

  const res = await fetch(`${metaGraphApiBase(opts.channelType)}/${opts.channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const responseBody = await res.json() as MetaGraphError & { message_id?: string };
  if (!res.ok) {
    throw metaGraphError(responseBody, `${opts.channelType} message send failed`);
  }
  return responseBody.message_id || null;
}
