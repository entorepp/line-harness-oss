import type { Env } from '../index.js';
import { readWhatsappIdentity } from './whatsapp-identity.js';

export const CALL_ALERT_CHANNEL = 'C0AL6RG7V9Q';
const MENTIONS = '<@U0AKAGDNM6J> <@U0BC274KEJX>';
export function callerName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
  // Phone-only/import placeholder labels are not a customer's name.
  return name && !/^(?:WhatsApp\s*[:：-]?\s*)?\+?[\d\s().-]+$/i.test(name) ? name : null;
}
export async function resolveCallerName(env: Env['Bindings'], friendId: string | null, fallback: unknown) {
  if (friendId) {
    const identity = await readWhatsappIdentity(env, friendId);
    if (identity.status === 'linked' && callerName(identity.customerName)) return callerName(identity.customerName);
  }
  return callerName(fallback);
}
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function callAlertBody(callId: string, name: string | null) {
  const label = name ? `${name}さん` : 'お客様（名前未登録）';
  const url = `https://line-crm-web-2ob.pages.dev/calls?wa_call=${encodeURIComponent(callId)}`;
  return { channel: CALL_ALERT_CHANNEL, text: `${MENTIONS}\n☎ WhatsAppで${escape(label)}から電話が来ています。\n<${url}|Harnessで着信を開いて応答>\n画面の「応答」を押すと通話できます。`,
    parse: 'none', unfurl_links: false, unfurl_media: false,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: MENTIONS } },
      { type: 'section', text: { type: 'plain_text', text: `☎ WhatsAppで${label}から電話が来ています。` } },
      { type: 'section', text: { type: 'mrkdwn', text: `<${url}|Harnessで着信を開いて応答>\n画面の「応答」を押すと通話できます。終了済みの場合は通話状態が表示されます。` } },
    ] };
}

// Called through waitUntil only after direct Meta signature validation and call
// persistence. One durable claim = at most one Slack attempt, including timeout.
export async function notifyIncomingCall(env: Env['Bindings'], callId: string) {
  try {
    const claim = await env.DB.prepare(`INSERT OR IGNORE INTO whatsapp_call_details (call_id, slack_status, updated_at)
      SELECT id, 'preparing', ? FROM whatsapp_calls WHERE id = ? AND direction = 'inbound' AND state = 'incoming' AND created_at > ?`)
      .bind(Date.now(), callId, Date.now() - 90000).run();
    if (claim.meta.changes !== 1) return;
    const row = await env.DB.prepare(`SELECT c.friend_id, f.display_name FROM whatsapp_calls c LEFT JOIN friends f ON f.id = c.friend_id WHERE c.id = ?`)
      .bind(callId).first<{ friend_id: string | null; display_name: string | null }>();
    const name = await resolveCallerName(env, row?.friend_id || null, row?.display_name);
    await env.DB.prepare('UPDATE whatsapp_call_details SET caller_name = ?, updated_at = ? WHERE call_id = ?').bind(name, Date.now(), callId).run();
    const active = await env.DB.prepare("SELECT id FROM whatsapp_calls WHERE id = ? AND state = 'incoming' AND created_at > ?").bind(callId, Date.now() - 90000).first();
    if (!active || env.WHATSAPP_CALLING_SLACK_ENABLED !== 'true' || !env.SLACK_BOT_TOKEN) {
      await env.DB.prepare("UPDATE whatsapp_call_details SET slack_status = 'skipped', updated_at = ? WHERE call_id = ?").bind(Date.now(), callId).run();
      return;
    }
    await env.DB.prepare("UPDATE whatsapp_call_details SET slack_status = 'sending', updated_at = ? WHERE call_id = ?").bind(Date.now(), callId).run();
    let state = 'unknown', ts: string | null = null, code: string | null = null;
    try {
      const response = await fetch('https://slack.com/api/chat.postMessage', { method: 'POST',
        headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(callAlertBody(callId, name)), signal: AbortSignal.timeout(8000) });
      const result = await response.json() as { ok?: boolean; ts?: string; error?: string };
      if (response.ok && result.ok && result.ts) { state = 'sent'; ts = result.ts; }
      else { state = response.status >= 500 ? 'unknown' : 'failed'; code = /^[a-z_]+$/.test(result.error || '') ? result.error! : `http_${response.status}`; }
    } catch { code = 'transport'; }
    await env.DB.prepare('UPDATE whatsapp_call_details SET slack_status = ?, slack_ts = ?, error_code = ?, updated_at = ? WHERE call_id = ?')
      .bind(state, ts, code, Date.now(), callId).run();
    if (state !== 'sent') console.warn('WhatsApp call Slack notification not confirmed', { callId, state, code });
  } catch {
    // No provider bodies, names, numbers or secrets in logs; preserve call handling.
    console.error('WhatsApp call notification processing failed', { callId });
  }
}
