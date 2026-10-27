import { Hono } from 'hono';
import type { Env } from '../index.js';
import { newIntake } from '../services/whatsapp-intake.js';
import { enqueueIntake, encryptIntake, getIntakeSession, intakeAllowed, intakeMode, readIntakeState, reserveIntake, takeOverIntake } from '../services/whatsapp-intake-store.js';
import { processIntake, recoverIntakeReceipts } from '../services/whatsapp-intake-runtime.js';
import { callingContext } from '../services/whatsapp-calling.js';
import { getWhatsappReplyWindow } from '../services/whatsapp-reply-window.js';

const whatsappIntake = new Hono<Env>();
whatsappIntake.get('/api/whatsapp/intake/:friendId', async c => {
  const friendId = c.req.param('friendId');
  if (intakeMode(c.env) === 'off') return c.json({ mode: 'off', session: null });
  const row = await getIntakeSession(c.env, friendId);
  if (!row) return c.json({ mode: intakeMode(c.env), session: null, replyWindow: await getWhatsappReplyWindow(c.env.DB, friendId) });
  await recoverIntakeReceipts(c.env, row.id).catch(() => undefined);
  let state = null;
  try { state = await readIntakeState(c.env, row); } catch { /* Do not expose crypto/provider errors. */ }
  const turns = await c.env.DB.prepare('SELECT id,status,provider_message_id,sent_at,error_code,model,model_called,input_tokens,output_tokens,elapsed_ms FROM whatsapp_intake_turns WHERE session_id=? ORDER BY seq DESC LIMIT 20').bind(row.id).all();
  return c.json({ mode: intakeMode(c.env), session: { id: row.id, version: row.version, phase: row.status, state, modelCalls: row.model_calls, handoffNotification: row.handoff_notification,
    lockActive: Boolean(row.lock_token), expired: row.expires_at <= Date.now() }, turns: turns.results || [], replyWindow: await getWhatsappReplyWindow(c.env.DB, friendId) });
});
whatsappIntake.post('/api/whatsapp/intake/:friendId/takeover', async c => {
  try { await takeOverIntake(c.env, c.req.param('friendId')); return c.json({ success: true }); }
  catch { return c.json({ success: false, error: 'intake_send_in_flight', message: '有人対応への切り替えは保存済みです。進行中の送信状態を確認してください。' }, 409); }
});
// Explicit owner-authorized bootstrap/reset for allowlisted test recipients only.
// It never fabricates an incoming message or opens a 24-hour reply window.
whatsappIntake.post('/api/whatsapp/intake/:friendId/test-start', async c => {
  if (intakeMode(c.env) !== 'test') return c.json({ error: 'test_mode_required' }, 403);
  const body = await c.req.json().catch(() => null) as { requestId?: string; confirmed?: boolean; reset?: boolean; expectedVersion?: number } | null;
  if (!body || body.confirmed !== true || typeof body.requestId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(body.requestId)) return c.json({ error: 'explicit_test_confirmation_required' }, 400);
  const friendId = c.req.param('friendId');
  const ctx = await callingContext(c.env, friendId);
  if (!(await intakeAllowed(c.env, ctx.account.id, ctx.account.channel_id, ctx.recipient))) return c.json({ error: 'test_recipient_not_allowed' }, 403);
  const window = await getWhatsappReplyWindow(c.env.DB, friendId);
  if (!window.canSend) return c.json({ error: 'customer_reply_required', replyWindow: window }, 409);
  let row = await getIntakeSession(c.env, friendId);
  const key = `staff-test:${body.requestId}`;
  if (row) {
    const previous = await c.env.DB.prepare('SELECT id,status FROM whatsapp_intake_turns WHERE session_id=? AND trigger_key=?').bind(row.id, key).first();
    if (previous) return c.json({ duplicate: true, sessionId: row.id, turn: previous });
    if (body.reset !== true || body.expectedVersion !== row.version) return c.json({ error: 'versioned_test_reset_required', version: row.version }, 409);
    if (row.lock_token) return c.json({ error: 'test_session_busy' }, 409);
    const ciphertext = await encryptIntake(newIntake('en', true), c.env.WHATSAPP_INTAKE_ENCRYPTION_KEY!, row.id);
    const saved = await c.env.DB.prepare("UPDATE whatsapp_intake_sessions SET status='consent',state_ciphertext=?,version=version+1,initial_message_log_id=NULL,initial_consumed=0,handoff_notification='none',expires_at=?,updated_at=? WHERE id=? AND version=? AND lock_token IS NULL")
      .bind(ciphertext, Date.now() + 30 * 86400000, Date.now(), row.id, row.version).run();
    if (!saved.meta.changes) return c.json({ error: 'test_session_changed' }, 409);
  } else {
    const reservation = await reserveIntake(c.env, { friendId, accountId: ctx.account.id, phoneId: ctx.account.channel_id, recipient: ctx.recipient, incomingAt: Date.now(), text: '' });
    if (!reservation.sessionId) return c.json({ error: 'test_enrollment_ineligible' }, 409);
    row = await getIntakeSession(c.env, friendId);
  }
  if (!row) return c.json({ error: 'test_enrollment_ineligible' }, 409);
  await enqueueIntake(c.env, row.id, key, null, Date.now(), 'staff_test');
  c.executionCtx.waitUntil(processIntake(c.env, row.id).catch(() => console.error('WhatsApp intake test stopped')));
  return c.json({ queued: true, sessionId: row.id, providerAccepted: false }, 202);
});
export { whatsappIntake };
