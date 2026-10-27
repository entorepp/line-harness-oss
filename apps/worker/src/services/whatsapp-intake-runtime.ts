import { jstNow, updateChat } from '@line-crm/db';
import type { Env } from '../index.js';
import { advanceIntake, type IntakeState } from './whatsapp-intake.js';
import { extractIntake, sensitiveIntakeText } from './whatsapp-intake-ai.js';
import { loadIntakeCatalogue, verifyIntakeCandidateTitles } from './whatsapp-intake-catalogue.js';
import { affirmative, greeting, localIntakeTurn, renderIntakePlan, renderIntakeSummary } from './whatsapp-intake-dialogue.js';
import { activeIntake, decryptIntake, encryptIntake, intakeAllowed, readIntakeState, type IntakeSession, type IntakeTurn } from './whatsapp-intake-store.js';
import { callingContext } from './whatsapp-calling.js';
import { getMessagingFriendContext, dispatchOutboundMessage } from './outbound-messages.js';
import { getWhatsappReplyWindow } from './whatsapp-reply-window.js';
import { recordWhatsappDelivery } from './whatsapp-delivery.js';
import { resolveSlackChannelId } from './slack.js';

async function message(env: Env['Bindings'], id: string | null, friendId: string) {
  if (!id) return null;
  return env.DB.prepare("SELECT content,message_type FROM messages_log WHERE id=? AND friend_id=? AND direction='incoming'").bind(id, friendId).first<{ content: string; message_type: string }>();
}
async function saveState(env: Env['Bindings'], row: IntakeSession, token: string, state: IntakeState, consumed: boolean, incomingAt: number) {
  const ciphertext = await encryptIntake(state, env.WHATSAPP_INTAKE_ENCRYPTION_KEY!, row.id);
  const update = await env.DB.prepare(`UPDATE whatsapp_intake_sessions SET status=?,state_ciphertext=?,version=version+1,initial_consumed=?,last_incoming_at=MAX(last_incoming_at,?),updated_at=?
    WHERE id=? AND version=? AND lock_token=? AND status IN ('consent','collecting','review','recommended')`)
    .bind(state.phase, ciphertext, consumed ? 1 : row.initial_consumed, incomingAt, Date.now(), row.id, row.version, token).run();
  return update.meta.changes === 1;
}
async function handoffNotification(env: Env['Bindings'], row: IntakeSession, state: IntakeState): Promise<void> {
  if (state.phase !== 'human') return;
  const claim = await env.DB.prepare("UPDATE whatsapp_intake_sessions SET handoff_notification='attempting' WHERE id=? AND status='human' AND handoff_notification='none'").bind(row.id).run();
  if (claim.meta.changes !== 1) return;
  const chat = await env.DB.prepare('SELECT id FROM chats WHERE friend_id=? LIMIT 1').bind(row.friend_id).first<{ id: string }>();
  const routing = await env.DB.prepare('SELECT f.slack_channel_id,la.default_slack_channel FROM friends f JOIN line_accounts la ON la.id=f.line_account_id WHERE f.id=?')
    .bind(row.friend_id).first<{ slack_channel_id: string | null; default_slack_channel: string | null }>();
  // No support narrative, name, phone, free-form timing or raw model content in Slack.
  const fields = state.slots;
  const publicCities = new Set(['Tokyo', 'Kyoto', 'Osaka', 'Hiroshima', 'Kanazawa', 'Fuji / Hakone', 'Nagoya', 'Nara', 'Sapporo', 'Fukuoka', 'Okinawa']);
  const safeCities = fields.cities?.map(city => publicCities.has(city) ? city : 'その他の都市（会話で確認）');
  const summary = [safeCities ? `都市: ${safeCities.join(' / ')}` : '', fields.duration ? `日数: ${fields.duration.value ?? '未定'} ${fields.duration.unit}` : '',
    fields.party ? `人数: 成人${fields.party.adults} / 子ども${fields.party.children}` : '', fields.budget ? `予算: ${fields.budget.amount ?? '未定'} ${fields.budget.currency || ''}` : '',
    fields.support ? '支援要件: 既存チャットまたはHarnessの保護されたヒアリング情報で確認' : ''].filter(Boolean).join('\n');
  let ok = false;
  if (env.SLACK_BOT_TOKEN) try {
    const response = await fetch('https://slack.com/api/chat.postMessage', { method: 'POST', headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: resolveSlackChannelId(routing?.slack_channel_id, routing?.default_slack_channel), unfurl_links: false,
        text: `WA AI相談の有人引き継ぎ\n${summary}\nhttps://line-crm-web-2ob.pages.dev/chats${chat ? `?chatId=${encodeURIComponent(chat.id)}` : ''}\nヒアリング済み内容は保護された会話に保存済みです。` }), signal: AbortSignal.timeout(4000) });
    const result: any = await response.json(); ok = response.ok && result.ok === true;
  } catch { /* One attempt; outcome may be unknown. */ }
  await env.DB.prepare('UPDATE whatsapp_intake_sessions SET handoff_notification=? WHERE id=?').bind(ok ? 'accepted' : 'failed_or_unknown', row.id).run();
}
async function stopSession(env: Env['Bindings'], row: IntakeSession, token: string, reason: string) {
  let state: IntakeState;
  try { state = await readIntakeState(env, row); } catch { state = { version: 1, revision: 0, locale: 'en', phase: 'human', slots: {}, unclearCount: 0 }; }
  state.phase = 'human'; state.reason = reason;
  if (await saveState(env, row, token, state, false, row.last_incoming_at)) await handoffNotification(env, row, state);
  await env.DB.prepare("UPDATE whatsapp_intake_turns SET status='skipped',error_code=? WHERE session_id=? AND status IN ('pending','processing')").bind(reason, row.id).run();
}
async function recoverAccepted(env: Env['Bindings'], row: IntakeSession, turn: IntakeTurn) {
  if (turn.status !== 'accepted' || !turn.provider_message_id || !turn.reply_ciphertext || !turn.sent_at) return;
  const text = await decryptIntake<string>(turn.reply_ciphertext, env.WHATSAPP_INTAKE_ENCRYPTION_KEY!, turn.id);
  const logId = `wa-intake-${turn.id}`;
  await env.DB.prepare("INSERT OR IGNORE INTO messages_log(id,friend_id,direction,message_type,content,created_at) VALUES (?,?,'outgoing','text',?,?)").bind(logId, row.friend_id, text, turn.sent_at).run();
  await recordWhatsappDelivery({ db: env.DB, lineAccountId: row.line_account_id, providerMessageId: turn.provider_message_id, messageLogId: logId, status: 'accepted' });
}
async function reserveModel(env: Env['Bindings'], row: IntakeSession, token: string, turnId: string) {
  const session = await env.DB.prepare("UPDATE whatsapp_intake_sessions SET model_calls=model_calls+1 WHERE id=? AND lock_token=? AND model_calls<20 AND status IN ('collecting','review','recommended')")
    .bind(row.id, token).run();
  // Consent can have just been accepted in memory; its persisted state is still consent.
  if (!session.meta.changes && row.status === 'consent') {
    const consented = await env.DB.prepare("UPDATE whatsapp_intake_sessions SET model_calls=model_calls+1 WHERE id=? AND lock_token=? AND model_calls<20 AND status='consent'").bind(row.id, token).run();
    if (!consented.meta.changes) return false;
  } else if (!session.meta.changes) return false;
  const budget = await env.DB.prepare(`INSERT INTO whatsapp_intake_model_budget(line_account_id,utc_day,calls) VALUES (?,?,1)
    ON CONFLICT(line_account_id,utc_day) DO UPDATE SET calls=calls+1 WHERE calls<200 RETURNING calls`)
    .bind(row.line_account_id, new Date().toISOString().slice(0, 10)).first();
  if (!budget) return false;
  await env.DB.prepare('UPDATE whatsapp_intake_turns SET model_called=1 WHERE id=?').bind(turnId).run();
  return true;
}

/** One signed-event continuation owns the queue. No cron, polling or provider retry. */
export async function recoverIntakeReceipts(env: Env['Bindings'], sessionId: string): Promise<void> {
  const row = await env.DB.prepare('SELECT * FROM whatsapp_intake_sessions WHERE id=?').bind(sessionId).first<IntakeSession>();
  if (!row || row.expires_at <= Date.now()) return;
  const turns = await env.DB.prepare("SELECT t.* FROM whatsapp_intake_turns t WHERE t.session_id=? AND t.status='accepted' AND NOT EXISTS(SELECT 1 FROM messages_log m WHERE m.id='wa-intake-'||t.id) ORDER BY seq DESC LIMIT 3").bind(sessionId).all<IntakeTurn>();
  for (const turn of turns.results || []) await recoverAccepted(env, row, turn);
}
export async function processIntake(env: Env['Bindings'], sessionId: string, deadline = Date.now() + 24000): Promise<void> {
  try { await recoverIntakeReceipts(env, sessionId); } catch { console.error('WhatsApp intake receipt recovery deferred'); }
  const initial = await env.DB.prepare('SELECT * FROM whatsapp_intake_sessions WHERE id=?').bind(sessionId).first<IntakeSession>();
  if (initial?.status === 'human') { try { await handoffNotification(env, initial, await readIntakeState(env, initial)); } catch { console.error('WhatsApp intake handoff pending staff inspection'); } return; }
  const token = crypto.randomUUID();
  const lock = await env.DB.prepare(`UPDATE whatsapp_intake_sessions SET lock_token=?,lock_started_at=? WHERE id=? AND lock_token IS NULL AND status IN ('consent','collecting','review','recommended')`)
    .bind(token, Date.now(), sessionId).run();
  if (lock.meta.changes !== 1) return;
  try {
    for (let count = 0; count < 8; count++) {
      const row = await env.DB.prepare('SELECT * FROM whatsapp_intake_sessions WHERE id=?').bind(sessionId).first<IntakeSession>();
      if (!row || row.lock_token !== token || !activeIntake(row.status)) return;
      const turn = await env.DB.prepare("SELECT * FROM whatsapp_intake_turns WHERE session_id=? AND status='pending' ORDER BY seq LIMIT 1").bind(sessionId).first<IntakeTurn>();
      if (!turn) break;
      if (Date.now() > deadline - 10000) { await stopSession(env, row, token, 'processing_budget'); break; }
      const claim = await env.DB.prepare("UPDATE whatsapp_intake_turns SET status='processing' WHERE id=? AND status='pending'").bind(turn.id).run();
      if (claim.meta.changes !== 1) continue;
      if (turn.incoming_at < row.last_incoming_at) { await env.DB.prepare("UPDATE whatsapp_intake_turns SET status='skipped',error_code='out_of_order' WHERE id=?").bind(turn.id).run(); continue; }
      let state = await readIntakeState(env, row); let consumed = Boolean(row.initial_consumed); let silent = false;
      const input = await message(env, turn.message_log_id, row.friend_id);
      const text = input?.content || '';
      const local = localIntakeTurn(state, text);
      if (input && input.message_type !== 'text') { state.phase = 'human'; state.reason = 'unsupported_message'; }
      else if (text.length > 2500 || sensitiveIntakeText(text)) { state.phase = 'human'; state.reason = 'sensitive_or_long_message'; }
      else {
        state = local.state; silent = Boolean(local.silent);
        let modelText = local.handled ? '' : text;
        if (local.consumeInitial && !consumed) {
          consumed = true;
          const initial = await message(env, row.initial_message_log_id, row.friend_id);
          if (initial && initial.message_type === 'text' && initial.content.length <= 2500 && !sensitiveIntakeText(initial.content) && !greeting(initial.content) && !affirmative(initial.content)) modelText = initial.content;
        }
        if (modelText && activeIntake(state.phase) && state.phase !== 'consent') {
          if (!(await reserveModel(env, row, token, turn.id))) { state.phase = 'human'; state.reason = 'model_budget'; }
          else {
            const friend = await env.DB.prepare('SELECT display_name FROM friends WHERE id=?').bind(row.friend_id).first<{ display_name: string }>();
            try {
              const result = await extractIntake(env, state, modelText, [friend?.display_name || ''], deadline - 7000);
              state.locale = result.locale;
              state = advanceIntake(state, { type: 'interpreted', text: result.text, result: result.interpretation });
              await env.DB.prepare('UPDATE whatsapp_intake_turns SET model=?,input_tokens=?,output_tokens=?,elapsed_ms=? WHERE id=?')
                .bind(result.model, result.inputTokens, result.outputTokens, result.elapsedMs, turn.id).run();
            } catch { state.phase = 'human'; state.reason = 'model_unavailable'; }
          }
        }
      }
      let catalogue = [] as Awaited<ReturnType<typeof loadIntakeCatalogue>>;
      if (state.phase === 'recommended' && !silent) {
        try { catalogue = await loadIntakeCatalogue(state, deadline - 6000); } catch { state.phase = 'human'; state.reason = 'catalogue_unavailable'; }
      }
      let rendered = renderIntakePlan(state, catalogue);
      if (rendered.plan.action === 'recommend') {
        try {
          const titles = await verifyIntakeCandidateTitles(rendered.plan.candidates, state.locale, deadline - 6000);
          catalogue = catalogue.map(p => titles.has(p.id) ? { ...p, title: titles.get(p.id)! } : p);
          rendered = renderIntakePlan(state, catalogue);
        } catch { state.phase = 'human'; state.reason = 'public_route_unavailable'; rendered = renderIntakePlan(state); }
      }
      if (rendered.plan.action === 'handoff' && state.phase !== 'human') { state.phase = 'human'; state.reason = rendered.plan.reason; rendered = renderIntakePlan(state); }
      if (!(await saveState(env, row, token, state, consumed, turn.incoming_at))) { await env.DB.prepare("UPDATE whatsapp_intake_turns SET status='skipped',error_code='ownership_changed' WHERE id=? AND status='processing'").bind(turn.id).run(); return; }
      if (!activeIntake(state.phase)) await env.DB.prepare("UPDATE whatsapp_intake_turns SET status='skipped',error_code='conversation_closed' WHERE session_id=? AND id<>? AND status IN ('pending','processing')").bind(row.id, turn.id).run();
      await handoffNotification(env, row, state);
      // Never send a stale question while a newer customer message is queued.
      const pending = activeIntake(state.phase) && await env.DB.prepare("SELECT id FROM whatsapp_intake_turns WHERE session_id=? AND status='pending' LIMIT 1").bind(sessionId).first();
      if (pending || silent || !rendered.text) { await env.DB.prepare("UPDATE whatsapp_intake_turns SET status='processed' WHERE id=? AND status='processing'").bind(turn.id).run(); continue; }
      const latest = await env.DB.prepare('SELECT * FROM whatsapp_intake_sessions WHERE id=?').bind(sessionId).first<IntakeSession>();
      if (!latest || latest.lock_token !== token || latest.version !== row.version + 1 || latest.status !== state.phase) return;
      const ctx = await callingContext(env, row.friend_id);
      if (ctx.account.id !== row.line_account_id || ctx.account.channel_id !== row.phone_id || ctx.recipient !== row.recipient ||
        !(await intakeAllowed(env, ctx.account.id, ctx.account.channel_id, ctx.recipient)) || !(await getWhatsappReplyWindow(env.DB, row.friend_id)).canSend) throw new Error('intake_send_ineligible');
      if (rendered.text.length > 3900) throw new Error('intake_reply_oversized');
      const encryptedReply = await encryptIntake(rendered.text, env.WHATSAPP_INTAKE_ENCRYPTION_KEY!, turn.id);
      const sending = await env.DB.prepare(`UPDATE whatsapp_intake_turns SET status='sending',reply_ciphertext=? WHERE id=? AND status='processing'
        AND EXISTS(SELECT 1 FROM whatsapp_intake_sessions WHERE id=? AND version=? AND lock_token=? AND status=?)`)
        .bind(encryptedReply, turn.id, row.id, latest.version, token, state.phase).run();
      if (sending.meta.changes !== 1) return;
      try {
        const friend = await getMessagingFriendContext(env.DB, row.friend_id);
        if (!friend || friend.channel_type !== 'whatsapp' || friend.line_account_id !== row.line_account_id || friend.channel_id !== row.phone_id || friend.line_user_id.replace(/^\+/, '') !== row.recipient) throw new Error('intake_recipient_changed');
        const result = await dispatchOutboundMessage({ env, friend, input: { messageType: 'text', content: rendered.text }, intakeAutomation: true, signal: AbortSignal.timeout(Math.max(1, Math.min(6000, deadline - Date.now()))) });
        if (!result.providerMessageId) throw new Error('intake_provider_id_missing');
        const sentAt = jstNow();
        await env.DB.prepare("UPDATE whatsapp_intake_turns SET status='accepted',provider_message_id=?,sent_at=? WHERE id=? AND status='sending'").bind(result.providerMessageId, sentAt, turn.id).run();
        await recoverAccepted(env, row, { ...turn, status: 'accepted', provider_message_id: result.providerMessageId, reply_ciphertext: encryptedReply, sent_at: sentAt });
        const chat = await env.DB.prepare('SELECT id FROM chats WHERE friend_id=? LIMIT 1').bind(row.friend_id).first<{ id: string }>();
        if (chat) await updateChat(env.DB, chat.id, { lastMessageAt: sentAt });
      } catch {
        // Provider access may already have occurred. Never retry this outbox.
        await env.DB.prepare("UPDATE whatsapp_intake_turns SET status='unknown',error_code='send_or_receipt_unknown' WHERE id=? AND status='sending'").bind(turn.id).run();
        const current = await env.DB.prepare('SELECT * FROM whatsapp_intake_sessions WHERE id=?').bind(sessionId).first<IntakeSession>();
        if (current?.lock_token === token && activeIntake(current.status)) await stopSession(env, current, token, 'send_outcome_unknown');
        return;
      }
      if (!activeIntake(state.phase)) break;
    }
  } catch {
    const row = await env.DB.prepare('SELECT * FROM whatsapp_intake_sessions WHERE id=?').bind(sessionId).first<IntakeSession>();
    if (row?.lock_token === token && activeIntake(row.status)) await stopSession(env, row, token, 'processing_failed');
    console.error('WhatsApp intake stopped', { sessionId, code: 'processing_failed' });
  } finally {
    await env.DB.prepare('UPDATE whatsapp_intake_sessions SET lock_token=NULL,lock_started_at=NULL WHERE id=? AND lock_token=?').bind(sessionId, token).run();
  }
  // Close the enqueue-vs-unlock race within this same bounded event continuation.
  const pending = await env.DB.prepare("SELECT t.id FROM whatsapp_intake_turns t JOIN whatsapp_intake_sessions s ON s.id=t.session_id WHERE t.session_id=? AND t.status='pending' AND s.lock_token IS NULL AND s.status IN ('consent','collecting','review','recommended') LIMIT 1").bind(sessionId).first();
  if (pending) {
    const row = await env.DB.prepare('SELECT * FROM whatsapp_intake_sessions WHERE id=?').bind(sessionId).first<IntakeSession>();
    if (row && Date.now() < deadline - 12000) await processIntake(env, sessionId, deadline);
    else if (row) {
      const claim = await env.DB.prepare('UPDATE whatsapp_intake_sessions SET lock_token=? WHERE id=? AND lock_token IS NULL').bind(token, row.id).run();
      if (claim.meta.changes) { try { await stopSession(env, row, token, 'burst_handoff'); } finally { await env.DB.prepare('UPDATE whatsapp_intake_sessions SET lock_token=NULL WHERE id=? AND lock_token=?').bind(row.id, token).run(); } }
    }
  }
}
