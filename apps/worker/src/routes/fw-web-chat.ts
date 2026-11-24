/**
 * Questions from a FlatWorker quotation page (server-to-server; the customer's browser never calls Harness).
 * Bearer auth is the FW token (middleware/auth.ts). A question lands in the 'web' account's inbox and is
 * announced to Slack exactly like a WhatsApp message; staff answer in the Harness inbox and
 * dispatchOutboundMessage hands the reply back to FW.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createChat, getChatByFriendId, jstNow, updateChat } from '@line-crm/db';
import type { Env } from '../index.js';
import { fireEvent } from '../services/event-bus.js';
import { WEB_CHAT_TEXT_LIMIT, webChatLineUserId, webChatRefValid } from '../services/web-chat.js';

export const fwWebChat = new Hono<Env>();
const BASE = '/api/integrations/fw-web-chat';

const idValid = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(s);
const shortText = (s: unknown, max: number): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
const hash = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
  .map(x => x.toString(16).padStart(2, '0')).join('');

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

interface WebAccount { id: string; default_slack_channel: string | null }

async function upsertWebFriend(db: D1Database, account: WebAccount, input: {
  ref: string; displayName: string; caseId: string; quotePageUrl: string; staffName: string; now: string;
}): Promise<string> {
  const lineUserId = webChatLineUserId(input.ref);
  const metadata = JSON.stringify({ provider: 'web', caseId: input.caseId, quotePageUrl: input.quotePageUrl, staffName: input.staffName });
  const existing = await db.prepare('SELECT id, line_account_id FROM friends WHERE line_user_id = ? LIMIT 1')
    .bind(lineUserId).first<{ id: string; line_account_id: string | null }>();
  if (existing) {
    if (existing.line_account_id !== account.id) throw new Error('web_conversation_conflict');
    await db.prepare('UPDATE friends SET display_name = ?, metadata = ?, is_following = 1, updated_at = ? WHERE id = ?')
      .bind(input.displayName, metadata, input.now, existing.id).run();
    return existing.id;
  }
  const id = crypto.randomUUID();
  // INSERT OR IGNORE: two first questions of the same conversation arriving together make one friend.
  await db.prepare(`INSERT OR IGNORE INTO friends
      (id, line_user_id, display_name, picture_url, status_message, is_following, line_account_id, slack_channel_id, metadata, created_at, updated_at)
    VALUES (?, ?, ?, NULL, NULL, 1, ?, ?, ?, ?, ?)`)
    .bind(id, lineUserId, input.displayName, account.id, account.default_slack_channel, metadata, input.now, input.now).run();
  const row = await db.prepare('SELECT id FROM friends WHERE line_user_id = ? LIMIT 1').bind(lineUserId).first<{ id: string }>();
  if (!row) throw new Error('web_friend_unavailable');
  return row.id;
}

fwWebChat.post(`${BASE}/messages`, bodyLimit({ maxSize: 16 * 1024, onError: c => c.json({ ok: false, error: 'payload_too_large' }, 413) }), async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid_json' }, 400);
  }
  const quotePageUrl = httpsUrl(body.quotePageUrl);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!webChatRefValid(body.ref) || !shortText(body.caseId, 200) || !shortText(body.displayName, 100)
      || (body.staffName !== undefined && body.staffName !== '' && !shortText(body.staffName, 100))
      || !quotePageUrl || !text || text.length > WEB_CHAT_TEXT_LIMIT || !idValid(body.clientMessageId)
      || typeof body.sentAt !== 'string' || !Number.isFinite(Date.parse(body.sentAt))) {
    return c.json({ ok: false, error: 'invalid_message' }, 400);
  }
  const account = await c.env.DB.prepare(
    "SELECT id, default_slack_channel FROM line_accounts WHERE channel_type = 'web' AND is_active = 1 ORDER BY created_at LIMIT 1",
  ).first<WebAccount>();
  if (!account) return c.json({ ok: false, error: 'web_account_unavailable' }, 503);

  const now = jstNow();
  let friendId: string;
  try {
    friendId = await upsertWebFriend(c.env.DB, account, {
      ref: body.ref, displayName: body.displayName.trim(), caseId: body.caseId.trim(), quotePageUrl,
      staffName: typeof body.staffName === 'string' ? body.staffName.trim() : '', now,
    });
  } catch (error) {
    const code = error instanceof Error && error.message === 'web_conversation_conflict' ? 409 : 503;
    return c.json({ ok: false, error: code === 409 ? 'web_conversation_conflict' : 'web_friend_unavailable' }, code);
  }

  // The log row's id comes from the conversation and FW's message ID, so a resent question is stored and announced once.
  const messageId = 'web-' + (await hash(JSON.stringify([body.ref, body.clientMessageId]))).slice(0, 40);
  const inserted = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
     VALUES (?, ?, 'incoming', 'text', ?, NULL, NULL, ?)`,
  ).bind(messageId, friendId, text, now).run();
  if (!inserted.meta?.changes) return c.json({ ok: true, friendId, messageId, duplicate: true });

  const chat = await getChatByFriendId(c.env.DB, friendId);
  if (chat) {
    await updateChat(c.env.DB, chat.id, { status: chat.status === 'resolved' ? 'unread' : chat.status, lastMessageAt: now });
  } else {
    const created = await createChat(c.env.DB, { friendId });
    await updateChat(c.env.DB, created.id, { status: 'unread', lastMessageAt: now });
  }
  await fireEvent(
    c.env.DB,
    'message_received',
    { friendId, eventData: { text, messageType: 'text', provider: 'web', messageId } },
    undefined,
    account.id,
    { token: c.env.SLACK_BOT_TOKEN, googleTranslateApiKey: c.env.GOOGLE_TRANSLATE_API_KEY },
  );
  return c.json({ ok: true, friendId, messageId });
});
