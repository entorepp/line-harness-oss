import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { jstNow } from '@line-crm/db';
import type { Env } from '../index.js';
import { recordWhatsappDelivery } from '../services/whatsapp-delivery.js';
import { callGraph, callMode, contextForCall, callingContext, callingReadiness, CallingError, CallingProviderError, isTerminal, PERMISSION_TEXT, publicCall, readCall, validateOffer, validateRequestId, type CallRow } from '../services/whatsapp-calling.js';

export const whatsappCalling = new Hono<Env>();
const ROOT = '/api/whatsapp/friends/:id';
const CALL_ROOT = '/api/whatsapp/calling';
whatsappCalling.use(`${CALL_ROOT}/*`, bodyLimit({ maxSize: 40000, onError: c => c.json({ success: false, error: '通話リクエストが大きすぎます' }, 413) }));
whatsappCalling.use(`${CALL_ROOT}/*`, async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
whatsappCalling.use('/api/whatsapp/friends/:id/calling/*', bodyLimit({ maxSize: 40000, onError: c => c.json({ success: false, error: '通話リクエストが大きすぎます' }, 413) }));
// This router is mounted after other WhatsApp routes; limit only matched calling routes.
whatsappCalling.use(`${ROOT}/calling/*`, async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
whatsappCalling.onError((error, c) => c.json({ success: false,
  error: error instanceof CallingError ? error.message : '通話処理を確認できません。再発信せず状態を確認してください。',
  outcome: error instanceof CallingError && error.code === 'CALL_NOT_STARTED' ? 'not_started' : 'unknown',
  code: error instanceof CallingError ? error.code : 'CALL_OUTCOME_UNKNOWN',
}, error instanceof CallingError ? error.status : 502));

async function globalCall(env: Env['Bindings'], id: string) {
  const row = await env.DB.prepare('SELECT * FROM whatsapp_calls WHERE id = ?').bind(id).first<CallRow>();
  if (!row) throw new CallingError('通話が見つかりません', 404);
  return row;
}

whatsappCalling.get(`${CALL_ROOT}/incoming`, async c => {
  const enabled = callMode(c.env) !== 'off' && Boolean(c.env.WHATSAPP_CALLING_ACCOUNTS);
  if (!enabled) return c.json({ success: true, data: { enabled: false, calls: [] } });
  // Meta's unanswered ring expires in 30–60s. A 120s grace also handles a lost
  // terminate webhook, and never terminates a connected/unknown outbound call.
  await c.env.DB.prepare("UPDATE whatsapp_calls SET state = 'ended', offer_sdp = NULL, answer_sdp = NULL WHERE state = 'incoming' AND created_at < ?")
    .bind(Date.now() - 120000).run();
  await c.env.DB.prepare('UPDATE whatsapp_calls SET offer_sdp = NULL, answer_sdp = NULL WHERE created_at < ? AND (offer_sdp IS NOT NULL OR answer_sdp IS NOT NULL)')
    .bind(Date.now() - 120000).run();
  const rows = await c.env.DB.prepare(`SELECT c.*, f.display_name AS recipient_name FROM whatsapp_calls c LEFT JOIN friends f ON f.id = c.friend_id
    WHERE c.direction = 'inbound' AND c.state = 'incoming' AND c.created_at > ? ORDER BY c.created_at LIMIT 20`).bind(Date.now() - 120000).all<CallRow & { recipient_name: string | null }>();
  const calls = [];
  for (const row of rows.results) {
    if ((await contextForCall(c.env, row)).enabled) calls.push({ ...publicCall(row, false), recipientName: row.recipient_name || `+${row.recipient}` });
  }
  return c.json({ success: true, data: { enabled, calls } });
});

whatsappCalling.get(`${CALL_ROOT}/calls/:callId`, async c => {
  const row = await globalCall(c.env, c.req.param('callId'));
  return c.json({ success: true, data: publicCall(row) });
});

whatsappCalling.post(`${CALL_ROOT}/calls/:callId/answer`, async c => {
  const body = await c.req.json<{ ownerId: string; sdp: string }>();
  validateRequestId(body.ownerId);
  validateOffer(body.sdp); // Same audio/ICE/fingerprint requirements apply to an SDP answer.
  const row = await globalCall(c.env, c.req.param('callId'));
  const ctx = await contextForCall(c.env, row);
  if (!ctx.enabled || row.direction !== 'inbound') throw new CallingError('この通話には応答できません', 403);
  if (row.owner_id === body.ownerId) return c.json({ success: true, data: publicCall(row) });
  const claim = await c.env.DB.prepare("UPDATE whatsapp_calls SET state = 'answering', owner_id = ?, updated_at = ? WHERE id = ? AND state = 'incoming' AND owner_id IS NULL AND created_at > ?")
    .bind(body.ownerId, Date.now(), row.id, Date.now() - 90000).run();
  if (claim.meta.changes !== 1) throw new CallingError('別の担当者が応答したか、着信が終了しました', 409);
  try {
    // Direct accept avoids sending microphone audio before a separate pre-accept
    // transition. The browser keeps the microphone muted until this succeeds.
    const result = await callGraph(ctx, 'calls', { messaging_product: 'whatsapp', action: 'accept', call_id: row.provider_call_id,
      session: { sdp_type: 'answer', sdp: body.sdp }, biz_opaque_callback_data: row.id });
    if (result.success !== true) throw new CallingProviderError('accept_unconfirmed', true);
    await c.env.DB.prepare("UPDATE whatsapp_calls SET state = 'accepted', offer_sdp = NULL, updated_at = ? WHERE id = ? AND state = 'answering'")
      .bind(Date.now(), row.id).run();
  } catch (error) {
    await c.env.DB.prepare("UPDATE whatsapp_calls SET state = ?, offer_sdp = NULL, error_code = ?, updated_at = ? WHERE id = ? AND state = 'answering'")
      .bind(error instanceof CallingProviderError && !error.unknown ? 'failed' : 'unknown', error instanceof CallingProviderError ? error.providerCode : 'local', Date.now(), row.id).run();
  }
  return c.json({ success: true, data: publicCall(await globalCall(c.env, row.id)) });
});

whatsappCalling.post(`${CALL_ROOT}/calls/:callId/end`, async c => {
  const row = await globalCall(c.env, c.req.param('callId'));
  if (isTerminal(row.state)) return c.json({ success: true, data: publicCall(row) });
  if (!row.provider_call_id) throw new CallingError('発信結果を確認中です。再発信せず状態を更新してください', 409);
  const ctx = await contextForCall(c.env, row);
  const result = await callGraph(ctx, 'calls', { messaging_product: 'whatsapp', action: row.state === 'incoming' ? 'reject' : 'terminate', call_id: row.provider_call_id });
  if (result.success !== true) throw new CallingProviderError('termination_unconfirmed', true);
  await c.env.DB.prepare("UPDATE whatsapp_calls SET state = 'ended', offer_sdp = NULL, answer_sdp = NULL, updated_at = ? WHERE id = ? AND state NOT IN ('ended','failed','rejected')")
    .bind(Date.now(), row.id).run();
  return c.json({ success: true, data: publicCall(await globalCall(c.env, row.id)) });
});

whatsappCalling.get(`${ROOT}/calling/status`, async c => {
  const ctx = await callingContext(c.env, c.req.param('id'));
  return c.json({ success: true, data: await callingReadiness(c.env, ctx) });
});

whatsappCalling.post(`${ROOT}/calling/permission`, async c => {
  const body = await c.req.json<{ requestId: string; confirmed: boolean }>();
  validateRequestId(body.requestId);
  if (body.confirmed !== true) throw new CallingError('宛先と通話許可の依頼文を確認してください');
  const ctx = await callingContext(c.env, c.req.param('id'));
  const existing = await c.env.DB.prepare('SELECT * FROM whatsapp_call_permission_requests WHERE id = ?').bind(body.requestId).first<any>();
  if (existing) {
    if (existing.friend_id !== ctx.friend.id || existing.line_account_id !== ctx.account.id) throw new CallingError('操作IDが別の宛先で使用されています', 409);
    return c.json({ success: true, data: { id: existing.id, status: existing.status } });
  }
  const readiness = await callingReadiness(c.env, ctx);
  if (!readiness.canRequestPermission) throw new CallingError(!readiness.replyWindowOpen ? '24時間返信枠外です。お客様から返信を受けてから通話許可を依頼してください。' : '現在は通話許可を依頼できません。通話設定・相手の許可・送信上限を確認してください。', 403);
  const now = Date.now();
  const claim = await c.env.DB.prepare(`INSERT OR IGNORE INTO whatsapp_call_permission_requests (id, friend_id, line_account_id, recipient, status, created_at)
    SELECT ?, ?, ?, ?, 'pending', ? WHERE NOT EXISTS (SELECT 1 FROM whatsapp_call_permission_requests WHERE line_account_id = ? AND recipient = ? AND status != 'failed' AND created_at > ?)`)
    .bind(body.requestId, ctx.friend.id, ctx.account.id, ctx.recipient, now, ctx.account.id, ctx.recipient, now - 86400000).run();
  if (claim.meta.changes !== 1) throw new CallingError('通話許可を依頼済み、または処理中です。重ねて送らず状態を確認してください。', 409);
  try {
    const result = await callGraph(ctx, 'messages', { messaging_product: 'whatsapp', recipient_type: 'individual', to: ctx.recipient, type: 'interactive',
      interactive: { type: 'call_permission_request', action: { name: 'call_permission_request' }, body: { text: PERMISSION_TEXT } } });
    const providerId = result.messages?.[0]?.id;
    if (typeof providerId !== 'string') throw new CallingProviderError('missing_message_id', true);
    await c.env.DB.prepare("UPDATE whatsapp_call_permission_requests SET status = 'accepted', provider_message_id = ? WHERE id = ?").bind(providerId, body.requestId).run();
    const messageId = `wa-call-permission-${body.requestId}`;
    await c.env.DB.prepare("INSERT OR IGNORE INTO messages_log (id, friend_id, direction, message_type, content, created_at) VALUES (?, ?, 'outgoing', 'text', ?, ?)")
      .bind(messageId, ctx.friend.id, JSON.stringify({ text: PERMISSION_TEXT }), jstNow()).run();
    await recordWhatsappDelivery({ db: c.env.DB, lineAccountId: ctx.account.id, providerMessageId: providerId, messageLogId: messageId, status: 'accepted' });
    return c.json({ success: true, data: { id: body.requestId, status: 'accepted' } });
  } catch (error) {
    // Never overwrite confirmed provider acceptance when a later local write fails.
    await c.env.DB.prepare("UPDATE whatsapp_call_permission_requests SET status = ?, error_code = ? WHERE id = ? AND status = 'pending'")
      .bind(error instanceof CallingProviderError && !error.unknown ? 'failed' : 'unknown', error instanceof CallingProviderError ? error.providerCode : 'local', body.requestId).run();
    throw error;
  }
});

whatsappCalling.post(`${ROOT}/calling/calls`, async c => {
  const body = await c.req.json<{ requestId: string; sdp: string; confirmed: boolean }>();
  validateRequestId(body.requestId);
  const ctx = await callingContext(c.env, c.req.param('id'));
  const existing = await c.env.DB.prepare('SELECT * FROM whatsapp_calls WHERE id = ?').bind(body.requestId).first<CallRow>();
  if (existing) {
    if (existing.friend_id !== ctx.friend.id || existing.line_account_id !== ctx.account.id) throw new CallingError('操作IDが別の宛先で使用されています', 409);
    return c.json({ success: true, data: publicCall(existing) });
  }
  if (body.confirmed !== true) throw new CallingError('発信先を確認してください');
  validateOffer(body.sdp);
  const readiness = await callingReadiness(c.env, ctx);
  if (!readiness.canCall) throw new CallingError('発信できません。相手の通話許可・通話設定・進行中の通話を確認してください。', 403);
  const now = Date.now();
  const claim = await c.env.DB.prepare("INSERT OR IGNORE INTO whatsapp_calls (id, friend_id, line_account_id, recipient, state, created_at, updated_at) VALUES (?, ?, ?, ?, 'starting', ?, ?)")
    .bind(body.requestId, ctx.friend.id, ctx.account.id, ctx.recipient, now, now).run();
  if (claim.meta.changes !== 1) throw new CallingError('発信処理中または通話中です。重ねて発信せず状態を確認してください。', 409);
  try {
    const result = await callGraph(ctx, 'calls', { messaging_product: 'whatsapp', to: ctx.recipient, action: 'connect',
      session: { sdp_type: 'offer', sdp: body.sdp }, biz_opaque_callback_data: body.requestId });
    const providerId = result.calls?.[0]?.id;
    if (typeof providerId !== 'string' || !providerId.startsWith('wacid.')) throw new CallingProviderError('missing_call_id', true);
    // A signed webhook may have already ended the call before this response.
    await c.env.DB.prepare("UPDATE whatsapp_calls SET provider_call_id = COALESCE(provider_call_id, ?), state = CASE WHEN state = 'starting' THEN 'connecting' ELSE state END, updated_at = ? WHERE id = ?")
      .bind(providerId, Date.now(), body.requestId).run();
  } catch (error) {
    await c.env.DB.prepare("UPDATE whatsapp_calls SET state = ?, error_code = ?, updated_at = ? WHERE id = ? AND state = 'starting'")
      .bind(error instanceof CallingProviderError && !error.unknown ? 'failed' : 'unknown', error instanceof CallingProviderError ? error.providerCode : 'local', Date.now(), body.requestId).run();
    // Return the durable operation id so the browser can reconcile without redialing.
  }
  return c.json({ success: true, data: publicCall(await readCall(c.env.DB, ctx.friend.id, body.requestId)) });
});

whatsappCalling.get(`${ROOT}/calling/calls/:callId`, async c => {
  const row = await readCall(c.env.DB, c.req.param('id'), c.req.param('callId'));
  if (row.answer_sdp && row.created_at < Date.now() - 120000) {
    await c.env.DB.prepare('UPDATE whatsapp_calls SET answer_sdp = NULL WHERE id = ?').bind(row.id).run();
    row.answer_sdp = null;
  }
  return c.json({ success: true, data: publicCall(row) });
});

whatsappCalling.post(`${ROOT}/calling/calls/:callId/terminate`, async c => {
  const row = await readCall(c.env.DB, c.req.param('id'), c.req.param('callId'));
  if (isTerminal(row.state)) return c.json({ success: true, data: publicCall(row) });
  const ctx = await callingContext(c.env, row.friend_id!, false);
  if (row.line_account_id !== ctx.account.id || row.recipient !== ctx.recipient) throw new CallingError('発信時のアカウントと一致しません', 409);
  if (!row.provider_call_id) throw new CallingError('発信結果を確認中です。再発信せず、少し待って状態を更新してください。', 409);
  // Termination remains possible even when the feature is switched off or permission expires.
  const result = await callGraph(ctx, 'calls', { messaging_product: 'whatsapp', action: 'terminate', call_id: row.provider_call_id });
  if (result.success !== true) throw new CallingProviderError('termination_unconfirmed', true);
  await c.env.DB.prepare("UPDATE whatsapp_calls SET state = 'ended', answer_sdp = NULL, updated_at = ? WHERE id = ? AND state NOT IN ('ended','failed','rejected')")
    .bind(Date.now(), row.id).run();
  return c.json({ success: true, data: publicCall(await readCall(c.env.DB, row.friend_id!, row.id)) });
});
