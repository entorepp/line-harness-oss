import { jstNow } from '@line-crm/db';
import type { Env } from '../index.js';
import { callGraph, callingContext, CallingProviderError, permissionAllows } from './whatsapp-calling.js';
import { getWhatsappReplyWindow } from './whatsapp-reply-window.js';
import { recordWhatsappDelivery } from './whatsapp-delivery.js';

export const WELCOME_TEXT = "Thank you for contacting Flat Travel! Our team will review your enquiry and get back to you about your quotation. Please wait for our team's reply.";
export const WELCOME_PERMISSION_TEXT = WELCOME_TEXT + ' We may also call you on WhatsApp to discuss the details. If you are happy to receive a call, please allow calls below.';
type Incoming = { friendId: string; accountId: string; phoneId: string; recipient: string; providerMessageId: string; timestamp: number; messageType: string; text?: string };
type Welcome = { id: string; friend_id: string; line_account_id: string; phone_id: string; recipient: string; incoming_message_id: string; incoming_at: number; status: string; provider_message_id: string | null; message_text: string | null; permission_requested: number; created_at: number; sent_at: string | null };
const scoped = (env: Env['Bindings'], accountId: string, phoneId: string) => env.WHATSAPP_INBOUND_WELCOME_ENABLED === 'true' && (env.WHATSAPP_INBOUND_WELCOME_ACCOUNTS || '').split(',').includes(`${accountId}:${phoneId}`);
function fresh(env: Env['Bindings'], timestamp: number) {
  const start = Date.parse(env.WHATSAPP_INBOUND_WELCOME_START_AT || '');
  return Number.isFinite(start) && timestamp >= start && timestamp <= Date.now() + 60_000 && timestamp >= Date.now() - 10 * 60_000;
}

// Called only for directly signed Meta messages, before persisting first history.
export async function claimInboundWelcome(env: Env['Bindings'], input: Incoming): Promise<string | null> {
  if (!scoped(env, input.accountId, input.phoneId) || !fresh(env, input.timestamp) ||
      (/^(?:stop|unsubscribe|cancel|opt[ -]?out|配信停止|停止)[.!。\s]*$/i.test(input.text?.trim() || '')) ||
      !['text','image','audio','video','document','location','contacts','sticker'].includes(input.messageType) ||
      !/^[1-9]\d{7,14}$/.test(input.recipient)) return null;
  await env.DB.prepare(`INSERT OR IGNORE INTO whatsapp_inbound_welcomes
    (id, friend_id, line_account_id, phone_id, recipient, incoming_message_id, incoming_at, status, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, 'pending', ?
    WHERE EXISTS (SELECT 1 FROM friends WHERE id = ? AND is_following = 1)
    AND NOT EXISTS (SELECT 1 FROM messages_log m JOIN friends f ON f.id = m.friend_id
      WHERE f.line_account_id = ? AND f.line_user_id IN (?, ?))`)
    .bind(crypto.randomUUID(), input.friendId, input.accountId, input.phoneId, input.recipient, input.providerMessageId, input.timestamp, Date.now(),
      input.friendId, input.accountId, input.recipient, `+${input.recipient}`).run();
  const row = await env.DB.prepare('SELECT id FROM whatsapp_inbound_welcomes WHERE line_account_id = ? AND recipient = ? AND incoming_message_id = ?')
    .bind(input.accountId, input.recipient, input.providerMessageId).first<{ id: string }>();
  return row?.id || null;
}
async function recoverReceipt(env: Env['Bindings'], row: Welcome) {
  if (row.status !== 'accepted' || !row.provider_message_id || !row.message_text || !row.sent_at) return;
  const messageId = `wa-welcome-${row.id}`;
  await env.DB.prepare("INSERT OR IGNORE INTO messages_log (id, friend_id, direction, message_type, content, created_at) VALUES (?, ?, 'outgoing', 'text', ?, ?)")
    .bind(messageId, row.friend_id, row.message_text, row.sent_at).run();
  await recordWhatsappDelivery({ db: env.DB, lineAccountId: row.line_account_id, providerMessageId: row.provider_message_id, messageLogId: messageId, status: 'accepted' });
  if (row.permission_requested) await env.DB.prepare("UPDATE whatsapp_call_permission_requests SET status = 'accepted', provider_message_id = ? WHERE id = ?")
    .bind(row.provider_message_id, row.id).run();
}

export async function sendInboundWelcome(env: Env['Bindings'], id: string): Promise<void> {
  let started = false; let permissionClaimed = false;
  try {
    const row = await env.DB.prepare('SELECT * FROM whatsapp_inbound_welcomes WHERE id = ?').bind(id).first<Welcome>();
    if (!row) return;
    if (row.status === 'accepted') { await recoverReceipt(env, row); return; }
    const claimed = await env.DB.prepare("UPDATE whatsapp_inbound_welcomes SET status = 'preparing' WHERE id = ? AND status = 'pending'").bind(id).run();
    if (claimed.meta.changes !== 1) return;
    const ctx = await callingContext(env, row.friend_id);
    if (!scoped(env, ctx.account.id, ctx.account.channel_id) || ctx.account.id !== row.line_account_id || ctx.account.channel_id !== row.phone_id || ctx.recipient !== row.recipient ||
        !fresh(env, row.incoming_at) || !(await getWhatsappReplyWindow(env.DB, row.friend_id)).canSend) {
      await env.DB.prepare("UPDATE whatsapp_inbound_welcomes SET status = 'skipped', error_code = 'ineligible' WHERE id = ?").bind(id).run();return;
    }
    if (ctx.enabled) {
      const [settings, permission] = await Promise.all([callGraph(ctx, 'settings?include_sip_credentials=false'), callGraph(ctx, `call_permissions?user_wa_id=${ctx.recipient}`)]);
      const alreadyAllowed = permission.permission?.status === 'permanent' || (permission.permission?.status === 'temporary' && Number(permission.permission.expiration_time) * 1000 > Date.now());
      if (settings.calling?.status === 'ENABLED' && !alreadyAllowed && permissionAllows(permission, 'send_call_permission_request')) {
        // The same ledger and atomic exclusion as the staff-initiated request.
        const claim = await env.DB.prepare(`INSERT OR IGNORE INTO whatsapp_call_permission_requests (id, friend_id, line_account_id, recipient, status, created_at)
          SELECT ?, ?, ?, ?, 'pending', ? WHERE NOT EXISTS (SELECT 1 FROM whatsapp_call_permission_requests WHERE line_account_id = ? AND recipient = ? AND status != 'failed' AND created_at > ?)`)
          .bind(id, ctx.friend.id, ctx.account.id, ctx.recipient, Date.now(), ctx.account.id, ctx.recipient, Date.now() - 86400000).run();
        permissionClaimed = claim.meta.changes === 1;
      }
    }
    // Reread mutable recipient/opt-out immediately before the provider write.
    const latest = await callingContext(env, row.friend_id);
    if (!scoped(env, latest.account.id, latest.account.channel_id) || latest.recipient !== row.recipient || latest.account.id !== row.line_account_id || latest.account.channel_id !== row.phone_id) throw new Error('recipient_changed');
    const text = permissionClaimed ? WELCOME_PERMISSION_TEXT : WELCOME_TEXT;
    await env.DB.prepare('UPDATE whatsapp_inbound_welcomes SET message_text = ?, permission_requested = ? WHERE id = ?').bind(text, permissionClaimed ? 1 : 0, id).run();
    started = true;
    const result = await callGraph(latest, 'messages', { messaging_product: 'whatsapp', recipient_type: 'individual', to: latest.recipient,
      ...(permissionClaimed ? { type: 'interactive', interactive: { type: 'call_permission_request', action: { name: 'call_permission_request' }, body: { text } } } : { type: 'text', text: { body: text } }) });
    const providerId = result.messages?.[0]?.id;
    if (typeof providerId !== 'string' || !providerId) throw new CallingProviderError('missing_message_id', true);
    const sentAt = jstNow();
    await env.DB.prepare("UPDATE whatsapp_inbound_welcomes SET status = 'accepted', provider_message_id = ?, sent_at = ? WHERE id = ?").bind(providerId, sentAt, id).run();
    await recoverReceipt(env, { ...row, status: 'accepted', provider_message_id: providerId, message_text: text, permission_requested: permissionClaimed ? 1 : 0, sent_at: sentAt });
  } catch (error) {
    // An uncertain send or a failed receipt write never causes another provider call.
    const status = started && (!(error instanceof CallingProviderError) || error.unknown) ? 'unknown' : 'failed';
    const code = error instanceof CallingProviderError ? error.providerCode : 'local';
    await env.DB.prepare("UPDATE whatsapp_inbound_welcomes SET status = ?, error_code = ? WHERE id = ? AND status = 'preparing'").bind(status, code, id).run();
    if (permissionClaimed) await env.DB.prepare("UPDATE whatsapp_call_permission_requests SET status = ?, error_code = ? WHERE id = ? AND status = 'pending'").bind(status, code, id).run();
    console.error('WhatsApp welcome processing stopped', { id, status, code });
  }
}
