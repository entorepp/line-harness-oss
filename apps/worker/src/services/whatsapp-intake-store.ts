import type { Env } from '../index.js';
import { newIntake, type IntakeState } from './whatsapp-intake.js';
import { intakeQualification, submittedEnquirySignal } from './whatsapp-intake-qualification.js';

export type IntakeSession = { id: string; friend_id: string; line_account_id: string; phone_id: string; recipient: string; status: IntakeState['phase']; version: number;
  state_ciphertext: string | null; initial_message_log_id: string | null; initial_consumed: number; test_unqualified_override: number; lock_token: string | null; lock_started_at: number | null;
  model_calls: number; handoff_notification: string; last_incoming_at: number; expires_at: number; created_at: number; updated_at: number };
export type IntakeTurn = { id: string; seq: number; session_id: string; trigger_key: string; trigger_type: string; message_log_id: string | null; incoming_at: number;
  status: string; reply_ciphertext: string | null; provider_message_id: string | null; sent_at: string | null };
export const activeIntake = (status: string) => ['consent', 'collecting', 'review', 'recommended'].includes(status);
export const intakeMode = (env: Env['Bindings']) => ['test', 'live'].includes(env.WHATSAPP_INTAKE_MODE || '') ? env.WHATSAPP_INTAKE_MODE! : 'off';
export async function intakeAllowed(env: Env['Bindings'], account: string, phone: string, recipient: string): Promise<boolean> {
  if (intakeMode(env) === 'off' || !env.OPENAI_API_KEY || (env.WHATSAPP_INTAKE_ENCRYPTION_KEY || '').length < 24 ||
    !(env.WHATSAPP_INTAKE_ACCOUNTS || '').split(',').includes(`${account}:${phone}`) || !/^[1-9]\d{7,14}$/.test(recipient)) return false;
  if (intakeMode(env) === 'live') return true;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(recipient));
  const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  return (env.WHATSAPP_INTAKE_TEST_PHONE_HASHES || '').split(',').includes(hash);
}
async function aesKey(secret: string) {
  if (secret.length < 24) throw new Error('intake_encryption_unconfigured');
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`wa-intake-v1:${secret}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptIntake(value: unknown, secret: string, scope: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const input = new TextEncoder().encode(JSON.stringify(value));
  if (input.length > 16000) throw new Error('intake_state_oversized');
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(scope) }, await aesKey(secret), input));
  const payload = new Uint8Array(iv.length + data.length); payload.set(iv); payload.set(data, iv.length);
  return 'v1.' + btoa(String.fromCharCode(...payload));
}
export async function decryptIntake<T>(value: string, secret: string, scope: string): Promise<T> {
  if (!value.startsWith('v1.') || value.length > 24000) throw new Error('intake_state_invalid');
  const data = Uint8Array.from(atob(value.slice(3)), c => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12), additionalData: new TextEncoder().encode(scope) }, await aesKey(secret), data.slice(12));
  return JSON.parse(new TextDecoder().decode(plain));
}
export async function readIntakeState(env: Env['Bindings'], row: IntakeSession): Promise<IntakeState> {
  if (!row.state_ciphertext || row.expires_at <= Date.now()) throw new Error('intake_state_expired');
  const state = await decryptIntake<IntakeState>(row.state_ciphertext, env.WHATSAPP_INTAKE_ENCRYPTION_KEY!, row.id);
  if (state.version !== 1 || !state.slots || !['en', 'tc', 'sc', 'kr'].includes(state.locale)) throw new Error('intake_state_invalid');
  if (state.phase !== row.status && row.status === 'human') state.reason = 'staff_takeover';
  state.phase = row.status;
  return state;
}
export async function getIntakeSession(env: Env['Bindings'], friendId: string) {
  return env.DB.prepare('SELECT * FROM whatsapp_intake_sessions WHERE friend_id = ?').bind(friendId).first<IntakeSession>();
}

/** Existing staff send entry points call this before sending. A submitted AI send cannot be unsent. */
export async function takeOverIntake(env: Env['Bindings'], friendId: string): Promise<void> {
  if (intakeMode(env) === 'off') return;
  const row = await getIntakeSession(env, friendId); if (!row) return;
  if (activeIntake(row.status) || row.status === 'human') await env.DB.prepare("UPDATE whatsapp_intake_sessions SET status='human',version=version+1,lock_token=NULL,lock_started_at=NULL,updated_at=? WHERE id=?")
    .bind(Date.now(), row.id).run();
  await env.DB.prepare("UPDATE whatsapp_intake_turns SET status='skipped',error_code='staff_takeover' WHERE session_id=? AND status IN ('pending','processing')").bind(row.id).run();
  const sending = await env.DB.prepare("SELECT id FROM whatsapp_intake_turns WHERE session_id=? AND status='sending' LIMIT 1").bind(row.id).first();
  if (sending) throw new Error('AI返信の送信処理中です。送信状態を確認してから、もう一度送ってください。有人対応への切り替えは保存済みです。');
}

export async function reserveIntake(env: Env['Bindings'], input: { friendId: string; accountId: string; phoneId: string; recipient: string; incomingAt: number; text: string }): Promise<{ owned: boolean; sessionId?: string }> {
  if (!(await intakeAllowed(env, input.accountId, input.phoneId, input.recipient))) return { owned: false };
  const start = Date.parse(env.WHATSAPP_INTAKE_START_AT || ''); const now = Date.now();
  if (!Number.isFinite(start) || input.incomingAt < start || input.incomingAt < now - 600000 || input.incomingAt > now + 60000) return { owned: false };
  const eligible = await env.DB.prepare('SELECT f.is_following,la.is_active FROM friends f JOIN line_accounts la ON la.id=f.line_account_id WHERE f.id=? AND f.line_account_id=? AND la.channel_id=? AND REPLACE(f.line_user_id,\'+\',\'\')=?')
    .bind(input.friendId, input.accountId, input.phoneId, input.recipient).first<{ is_following: number; is_active: number }>();
  if (eligible?.is_following !== 1 || eligible.is_active !== 1) { await takeOverIntake(env, input.friendId).catch(() => undefined); return { owned: true }; }
  if (submittedEnquirySignal(input.text)) { await takeOverIntake(env, input.friendId).catch(() => undefined); return { owned: true }; }
  let row = await getIntakeSession(env, input.friendId);
  const testCommand = intakeMode(env) === 'test' && /^AI[\s-]?(?:TEST|テスト)[.!。\s]*$/iu.test(input.text.trim());
  if (row && !activeIntake(row.status)) {
    if (!testCommand || row.lock_token) return { owned: true };
    const ciphertext = await encryptIntake(newIntake('en', true), env.WHATSAPP_INTAKE_ENCRYPTION_KEY!, row.id);
    await env.DB.prepare("UPDATE whatsapp_intake_turns SET status='skipped',error_code='explicit_test_reset' WHERE session_id=? AND status IN ('pending','processing')").bind(row.id).run();
    const reset = await env.DB.prepare("UPDATE whatsapp_intake_sessions SET status='consent',state_ciphertext=?,version=version+1,initial_message_log_id=NULL,initial_consumed=0,test_unqualified_override=1,handoff_notification='none',expires_at=?,updated_at=? WHERE id=? AND version=? AND lock_token IS NULL")
      .bind(ciphertext, now + 30 * 86400000, now, row.id, row.version).run();
    if (!reset.meta.changes) return { owned: true };
    row = await getIntakeSession(env, input.friendId);
  }
  if (!row && intakeMode(env) === 'live') {
    const history = await env.DB.prepare('SELECT 1 FROM messages_log m JOIN friends f ON f.id=m.friend_id WHERE f.line_account_id=? AND f.line_user_id IN (?,?) LIMIT 1')
      .bind(input.accountId, input.recipient, `+${input.recipient}`).first();
    if (history) return { owned: false };
  }
  // A literal test command on the hashed owner-approved test recipient simulates
  // an unqualified lead despite any historical test CRM links. Never applies live.
  const testOverride = intakeMode(env) === 'test' && (testCommand || row?.test_unqualified_override === 1);
  const qualification = testOverride ? 'unqualified' : await intakeQualification(env, input.friendId);
  if (qualification !== 'unqualified') {
    console.info('WhatsApp intake excluded', { friendId: input.friendId, reason: qualification });
    await takeOverIntake(env, input.friendId).catch(() => undefined);
    return { owned: true };
  }
  if (!row) {
    if (/^(?:stop|unsubscribe|停止|配信停止|取消訂閱|取消订阅|수신\s*거부)[.!。\s]*$/i.test(input.text.trim())) return { owned: true };
    const id = crypto.randomUUID();
    const ciphertext = await encryptIntake(newIntake('en', true), env.WHATSAPP_INTAKE_ENCRYPTION_KEY!, id);
    await env.DB.prepare(`INSERT OR IGNORE INTO whatsapp_intake_sessions
      (id,friend_id,line_account_id,phone_id,recipient,status,state_ciphertext,expires_at,created_at,updated_at,test_unqualified_override)
      SELECT ?,?,?,?,?,'consent',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM friends WHERE id=? AND is_following=1)
      AND (?='test' OR NOT EXISTS(SELECT 1 FROM messages_log m JOIN friends f ON f.id=m.friend_id WHERE f.line_account_id=? AND f.line_user_id IN (?,?)))`)
      .bind(id, input.friendId, input.accountId, input.phoneId, input.recipient, ciphertext, now + 30 * 86400000, now, now, testOverride ? 1 : 0,
        input.friendId, intakeMode(env), input.accountId, input.recipient, `+${input.recipient}`).run();
    row = await getIntakeSession(env, input.friendId);
  }
  if (!row || row.line_account_id !== input.accountId || row.phone_id !== input.phoneId || row.recipient !== input.recipient) return { owned: false };
  if (row.expires_at <= now) {
    await env.DB.prepare("UPDATE whatsapp_intake_sessions SET status='human',state_ciphertext=NULL,version=version+1,updated_at=? WHERE id=?").bind(now, row.id).run();
    await env.DB.prepare('UPDATE whatsapp_intake_turns SET reply_ciphertext=NULL WHERE session_id=?').bind(row.id).run();
    return { owned: true };
  }
  if (activeIntake(row.status) && row.lock_token && (row.lock_started_at || 0) < now - 60000) {
    const state = await readIntakeState(env, row); state.phase = 'human'; state.reason = 'orphaned_event';
    const ciphertext = await encryptIntake(state, env.WHATSAPP_INTAKE_ENCRYPTION_KEY!, row.id);
    await env.DB.prepare("UPDATE whatsapp_intake_sessions SET status='human',state_ciphertext=?,version=version+1,lock_token=NULL,lock_started_at=NULL,updated_at=? WHERE id=? AND version=? AND lock_token=?")
      .bind(ciphertext, now, row.id, row.version, row.lock_token).run();
    await env.DB.prepare("UPDATE whatsapp_intake_turns SET status=CASE WHEN status='sending' THEN 'unknown' ELSE 'skipped' END,error_code='orphaned_event' WHERE session_id=? AND status IN ('pending','processing','sending')").bind(row.id).run();
    return { owned: true, sessionId: row.id };
  }
  return { owned: true, ...(activeIntake(row.status) || (row.status === 'human' && row.handoff_notification === 'none') ? { sessionId: row.id } : {}) };
}
export async function enqueueIntake(env: Env['Bindings'], sessionId: string, triggerKey: string, messageLogId: string | null, incomingAt: number, triggerType = 'signed_inbound'): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT OR IGNORE INTO whatsapp_intake_turns(id,session_id,trigger_key,trigger_type,message_log_id,incoming_at,created_at)
    SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM whatsapp_intake_sessions WHERE id=? AND status IN ('consent','collecting','review','recommended'))`)
    .bind(id, sessionId, triggerKey, triggerType, messageLogId, incomingAt, Date.now(), sessionId).run();
  if (messageLogId) await env.DB.prepare('UPDATE whatsapp_intake_sessions SET initial_message_log_id=COALESCE(initial_message_log_id,?) WHERE id=?').bind(messageLogId, sessionId).run();
  return sessionId;
}
