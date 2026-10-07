import { callerName, resolveCallerName } from './whatsapp-call-alert.js';
import { getLineAccountById } from '@line-crm/db';
import type { Env } from '../index.js';
import { getWhatsappReplyWindow } from './whatsapp-reply-window.js';

export const PERMISSION_TEXT = 'May Flat Travel call you on WhatsApp to discuss your travel enquiry? Please choose whether to allow calls below.';
export class CallingError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 502 = 400, readonly code = 'CALL_NOT_STARTED') { super(message); }
}
export class CallingProviderError extends CallingError {
  constructor(readonly providerCode: string, readonly unknown: boolean) {
    super(unknown ? '通信結果を確認できません。再発信せず、通話状態を確認してください。' : `WhatsAppが操作を受け付けませんでした（${providerCode}）`, 502, unknown ? 'PROVIDER_OUTCOME_UNKNOWN' : 'PROVIDER_REJECTED');
  }
}
export type CallRow = { recipient_name?: string | null; id: string; friend_id: string | null; direction: string; offer_sdp: string | null; owner_id: string | null; line_account_id: string; recipient: string; provider_call_id: string | null; state: string; answer_sdp: string | null; event_timestamp: number; duration: number | null; error_code: string | null; created_at: number; updated_at: number };
type Permission = { permission?: { status?: string; expiration_time?: number }; actions?: { action_name?: string; can_perform_action?: boolean }[] };
export const isTerminal = (state: string) => ['ended', 'failed', 'rejected'].includes(state);
export function callMode(env: Env['Bindings']) { return ['test', 'live'].includes(env.WHATSAPP_CALLING_MODE || '') ? env.WHATSAPP_CALLING_MODE! : 'off'; }
export async function callingContext(env: Env['Bindings'], friendId: string, requireActive = true) {
  const friend = await env.DB.prepare('SELECT id, line_user_id, display_name, line_account_id, is_following FROM friends WHERE id = ?').bind(friendId)
    .first<{ id: string; line_user_id: string; display_name: string; line_account_id: string; is_following: number }>();
  if (!friend?.line_account_id || (requireActive && !friend.is_following)) throw new CallingError('有効なお客様が見つかりません', 404);
  const account = await getLineAccountById(env.DB, friend.line_account_id);
  if (!account || (requireActive && !account.is_active) || account.channel_type !== 'whatsapp') throw new CallingError('WhatsAppのチャットでのみ通話できます');
  const recipient = friend.line_user_id.replace(/^\+/, '');
  if (!/^[1-9]\d{7,14}$/.test(recipient)) throw new CallingError('登録済みWhatsApp番号を確認してください');
  const enabled = await callingAllowed(env, account.id, account.channel_id, recipient);
  return { friend, account, recipient, enabled };
}
export async function callingAllowed(env: Env['Bindings'], accountId: string, phoneId: string, recipient: string) {
  const scoped = (env.WHATSAPP_CALLING_ACCOUNTS || '').split(',').includes(`${accountId}:${phoneId}`);
  if (!scoped) return false;
  if (callMode(env) === 'live') return true;
  if (callMode(env) !== 'test') return false;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(recipient));
  const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  return (env.WHATSAPP_CALLING_TEST_PHONE_HASHES || '').split(',').map(x => x.trim().toLowerCase()).includes(hash);
}
export async function contextForCall(env: Env['Bindings'], row: CallRow) {
  const account = await getLineAccountById(env.DB, row.line_account_id);
  if (!account || account.channel_type !== 'whatsapp') throw new CallingError('通話アカウントが見つかりません', 404);
  return { account, recipient: row.recipient, enabled: Boolean(account.is_active) && await callingAllowed(env, account.id, account.channel_id, row.recipient),
    friend: { id: row.friend_id || '', line_account_id: account.id, line_user_id: row.recipient, display_name: '', is_following: 1 } };
}
export type CallingContext = Awaited<ReturnType<typeof callingContext>>;
export async function callGraph(ctx: CallingContext, edge: string, body?: unknown): Promise<any> {
  let response: Response;
  let result: any;
  try {
    response = await fetch(`https://graph.facebook.com/v25.0/${encodeURIComponent(ctx.account.channel_id)}/${edge}`, {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${ctx.account.channel_access_token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
    });
    result = await response.json();
  } catch { throw new CallingProviderError('transport', true); }
  if (!response.ok || result.error) throw new CallingProviderError(String(result.error?.code || response.status), response.status >= 500);
  return result;
}
export function permissionAllows(permission: Permission, action: string, now = Date.now()) {
  if (permission.actions?.find(a => a.action_name === action)?.can_perform_action !== true) return false;
  if (action !== 'start_call') return true;
  return permission.permission?.status === 'permanent' ||
    (permission.permission?.status === 'temporary' && Number(permission.permission.expiration_time) * 1000 > now);
}
export async function callingReadiness(env: Env['Bindings'], ctx: CallingContext) {
  ctx.friend.display_name = await resolveCallerName(env, ctx.friend.id, ctx.friend.display_name) || 'お客様（名前未登録）';
  const replyWindow = await getWhatsappReplyWindow(env.DB, ctx.friend.id);
  const active = await env.DB.prepare("SELECT * FROM whatsapp_calls WHERE line_account_id = ? AND recipient = ? AND state NOT IN ('ended','failed','rejected') LIMIT 1")
    .bind(ctx.account.id, ctx.recipient).first<CallRow>();
  const base = { recipientName: ctx.friend.display_name, recipientPhone: `+${ctx.recipient}`, senderName: ctx.account.name, releaseMode: callMode(env), enabled: ctx.enabled,
    permissionText: PERMISSION_TEXT, replyWindowOpen: replyWindow.canSend, activeCall: active ? publicCall({ ...active, recipient_name: ctx.friend.display_name }, false) : null };
  if (!ctx.enabled) return { ...base, callingEnabled: false, canCall: false, canRequestPermission: false, permissionStatus: 'unknown' };
  const [settings, permission] = await Promise.all([
    callGraph(ctx, 'settings?include_sip_credentials=false'),
    callGraph(ctx, `call_permissions?user_wa_id=${ctx.recipient}`) as Promise<Permission>,
  ]);
  const callingEnabled = settings.calling?.status === 'ENABLED';
  return { ...base, callingEnabled, canCall: callingEnabled && !active && permissionAllows(permission, 'start_call'),
    canRequestPermission: callingEnabled && replyWindow.canSend && permissionAllows(permission, 'send_call_permission_request'),
    permissionStatus: permission.permission?.status || 'unknown' };
}
export function validateRequestId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) throw new CallingError('操作IDが無効です');
}
export function validateOffer(sdp: unknown): asserts sdp is string {
  if (typeof sdp !== 'string' || sdp.length > 32000 || !sdp.startsWith('v=0\r\n') ||
      (sdp.match(/^m=/gm) || []).length !== 1 || !/^m=audio /m.test(sdp) || !/opus\/48000/i.test(sdp) ||
      !/^a=ice-ufrag:/m.test(sdp) || !/^a=ice-pwd:/m.test(sdp) || !/^a=fingerprint:sha-256 /m.test(sdp)) {
    throw new CallingError('音声接続を準備できません。ブラウザとマイクを確認してください');
  }
}
export function publicCall(row: CallRow, includeSdp = true) {
  return { recipientName: callerName(row.recipient_name) || 'お客様（名前未登録）', id: row.id, friendId: row.friend_id, direction: row.direction, ownerId: row.owner_id, recipientPhone: `+${row.recipient}`, state: row.state, providerCallId: row.provider_call_id, duration: row.duration, errorCode: row.error_code,
    createdAt: row.created_at, updatedAt: row.updated_at,
    offerSdp: includeSdp && row.state === 'incoming' && row.created_at > Date.now() - 120000 ? row.offer_sdp : null,
    answerSdp: includeSdp && !isTerminal(row.state) && row.created_at > Date.now() - 120000 ? row.answer_sdp : null };
}
export async function readCall(db: D1Database, friendId: string, id: string) {
  const row = await db.prepare(`SELECT c.*, COALESCE(d.caller_name, f.display_name) AS recipient_name FROM whatsapp_calls c LEFT JOIN whatsapp_call_details d ON d.call_id = c.id LEFT JOIN friends f ON f.id = c.friend_id WHERE c.id = ? AND c.friend_id = ?`).bind(id, friendId).first<CallRow>();
  if (!row) throw new CallingError('通話が見つかりません', 404);
  return row;
}

// Only direct, signed Meta events reach this function. No bridge-only authority.
export async function recordCallingWebhook(env: Env['Bindings'], account: { id: string; channel_id: string }, payload: any) {
  const db = env.DB;
  const alertIds = new Set<string>();
  for (const entry of payload.entry || []) for (const change of entry.changes || []) {
    const value = change.value;
    if (change.field !== 'calls' || value?.metadata?.phone_number_id !== account.channel_id) continue;
    for (const event of [...(value.calls || []), ...(value.statuses || [])]) {
      if (typeof event.id !== 'string' || !event.id.startsWith('wacid.')) continue;
      const incoming = event.direction === 'USER_INITIATED';
      if (event.direction && !['USER_INITIATED','BUSINESS_INITIATED'].includes(event.direction)) continue;
      const recipient = incoming ? event.from : event.to || event.recipient_id;
      if (typeof recipient !== 'string' || !/^[1-9]\d{7,14}$/.test(recipient)) continue;
      const timestamp = Number(event.timestamp);
      if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
      const terminal = event.event === 'terminate' || event.status === 'REJECTED';
      if (incoming && (event.event === 'connect' || terminal) && await callingAllowed(env, account.id, account.channel_id, recipient)) {
        const offer = event.session?.sdp_type === 'offer' && typeof event.session.sdp === 'string' && event.session.sdp.length <= 32000 ? event.session.sdp : null;
        if (!terminal && (!offer || timestamp * 1000 < Date.now() - 90000)) continue;
        const friend = await db.prepare('SELECT id FROM friends WHERE line_account_id = ? AND line_user_id IN (?, ?) LIMIT 1').bind(account.id, recipient, `+${recipient}`).first<{id:string}>();
        // Store a terminal tombstone too: late CONNECT cannot resurrect a missed call.
        await db.prepare(`INSERT OR IGNORE INTO whatsapp_calls (id, friend_id, line_account_id, recipient, provider_call_id, state, direction, offer_sdp, event_timestamp, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'inbound', ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), friend?.id || null, account.id, recipient, event.id, terminal ? 'ended' : 'incoming', terminal ? null : offer, timestamp, timestamp * 1000, Date.now()).run();
        if (!terminal) {
          const pending = await db.prepare("SELECT id FROM whatsapp_calls WHERE line_account_id = ? AND provider_call_id = ? AND state = 'incoming'").bind(account.id, event.id).first<{id: string}>();
          if (pending) alertIds.add(pending.id);
        }
      }
      const state = terminal ? (event.status === 'FAILED' ? 'failed' : event.status === 'REJECTED' ? 'rejected' : 'ended') :
        event.status === 'ACCEPTED' ? 'accepted' : event.status === 'RINGING' ? 'ringing' : event.event === 'connect' ? 'connecting' : null;
      if (!state || (incoming && !terminal)) continue;
      const answer = event.session?.sdp_type === 'answer' && typeof event.session.sdp === 'string' && event.session.sdp.length <= 32000 ? event.session.sdp : null;
      const errorCode = event.errors?.[0]?.code || value.errors?.[0]?.code;
      // SQL state precedence is atomic even when webhook deliveries overlap.
      await db.prepare(`UPDATE whatsapp_calls SET provider_call_id = COALESCE(provider_call_id, ?),
        state = CASE WHEN ? THEN ? WHEN state IN ('accepted','answering','terminating') THEN state
          WHEN state = 'ringing' AND ? = 'connecting' THEN state ELSE ? END,
        answer_sdp = CASE WHEN ? OR created_at < ? THEN NULL ELSE COALESCE(?, answer_sdp) END,
        offer_sdp = CASE WHEN ? THEN NULL ELSE offer_sdp END,
        event_timestamp = MAX(event_timestamp, ?), duration = COALESCE(?, duration), error_code = COALESCE(?, error_code), updated_at = ?
        WHERE line_account_id = ? AND recipient = ? AND (provider_call_id = ? OR (id = ? AND provider_call_id IS NULL)) AND state NOT IN ('ended','failed','rejected')`)
        .bind(event.id, terminal ? 1 : 0, state, state, state, terminal ? 1 : 0, Date.now() - 120000, answer, terminal ? 1 : 0,
          timestamp, Number.isFinite(event.duration) ? event.duration : null, errorCode ? String(errorCode) : null, Date.now(), account.id, recipient, event.id, event.biz_opaque_callback_data || '').run();
    }
  }
  return [...alertIds];
}

export async function expireCallingSdp(db: D1Database) {
  // Reuse the existing minute maintenance tick; never call Meta from this job.
  await db.prepare('UPDATE whatsapp_calls SET offer_sdp = NULL, answer_sdp = NULL WHERE created_at < ? AND (offer_sdp IS NOT NULL OR answer_sdp IS NOT NULL)').bind(Date.now() - 120000).run();
}
