import type { Env } from '../index.js';
import type { TravelQuoteIntent } from './travel-quote-intent.js';
import { postToSlack } from './slack.js';

export const FLATCARE_ENQUIRY_FORM_ID = 'b20652b4-431c-48f2-876c-8da4c024fd21';
const NEW_LEAD_CHANNEL = 'C0CFMU4KKDK';
const CHAT_URL = 'https://line-crm-web-2ob.pages.dev/chats';
const labels = {
  hotel: 'ホテル', tailor: 'テイラーメイド', package: 'パッケージ',
  flatcare: 'Flatcare', whatsapp: 'WhatsApp（初回）',
  instagram: 'Instagram（初回）', messenger: 'Messenger（初回）',
} as const;
type LeadKind = keyof typeof labels;
type SocialKind = 'whatsapp' | 'instagram' | 'messenger';

export function websiteLeadKind(intent: TravelQuoteIntent): LeadKind | null {
  if (intent.hotelRequestStage === 'supplement' || intent.source === 'partner-portal') return null;
  if (intent.mode === 'journey') return 'package';
  if (intent.mode !== 'private') return null;
  if (intent.source === 'flat-travel-hotel-request') return 'hotel';
  if (intent.source === 'flat-travel-trip-chat' && intent.title === 'Japan travel information enquiry') return null;
  return 'tailor';
}

export function firstSocialLeadClaim(
  env: Env['Bindings'], kind: SocialKind, friendId: string,
  occurredAt: string,
): { id: string; statement: D1PreparedStatement } | null {
  if (!env.SLACK_BOT_TOKEN) return null;
  const receivedAt = Date.parse(occurredAt);
  const age = Date.now() - receivedAt;
  if (!Number.isFinite(age) || age > 86_400_000 || age < -300_000) return null;
  const id = `new-lead:${kind}:${friendId}`;
  // Run before the message INSERT in the same atomic D1 batch. A concurrent
  // webhook then sees either the existing history or the existing claim.
  const statement = env.DB.prepare(
    `INSERT OR IGNORE INTO notifications (id,event_type,title,body,channel,status)
     SELECT ?, 'new_lead', ?, '', 'slack', 'pending'
     WHERE NOT EXISTS (SELECT 1 FROM messages_log WHERE friend_id = ?)`,
  ).bind(id, labels[kind], friendId);
  return { id, statement };
}

export async function deliverNewLead(
  env: Env['Bindings'], kind: LeadKind, id: string, details = '',
): Promise<void> {
  try {
    if (!env.SLACK_BOT_TOKEN) return;
    const delivered = await postToSlack({
      token: env.SLACK_BOT_TOKEN,
      channel: NEW_LEAD_CHANNEL,
      signal: AbortSignal.timeout(4000),
      text: `新規問い合わせ｜${labels[kind]}${details ? `\n${details}` : ''}`,
    });
    await env.DB.prepare("UPDATE notifications SET status = ? WHERE id = ?")
      .bind(delivered ? 'sent' : 'failed', id).run();
  } catch {
    console.error('New lead notification outcome unavailable', { kind });
  }
}

export async function deliverFirstSocialLead(
  env: Env['Bindings'], kind: SocialKind, id: string, friendId: string,
): Promise<void> {
  let url = CHAT_URL;
  try {
    const chat = await env.DB.prepare('SELECT id FROM chats WHERE friend_id = ? LIMIT 1')
      .bind(friendId).first<{ id: string }>();
    if (chat?.id) url += `?chatId=${encodeURIComponent(chat.id)}`;
  } catch { /* The inbox still works if the deep link is unavailable. */ }
  await deliverNewLead(env, kind, id, `<${url}|Flat Harnessで確認>`);
}

export async function notifyNewFormLead(
  env: Env['Bindings'], kind: LeadKind, reference: string,
): Promise<void> {
  try {
    if (!env.SLACK_BOT_TOKEN) return;
    const id = `new-lead:${kind}:${reference}`;
    const claim = await env.DB.prepare(
      `INSERT OR IGNORE INTO notifications (id,event_type,title,body,channel,status)
       VALUES (?, 'new_lead', ?, '', 'slack', 'pending')`,
    ).bind(id, labels[kind]).run();
    if (!claim.meta.changes) return;
    const receipt = /^[a-z\d-]{1,80}$/i.test(reference) ? `受付番号 ${reference}` : '';
    const details = kind === 'flatcare'
      ? [receipt, '<https://liffform-studio.pages.dev/|Forms Studioで確認>'].filter(Boolean).join('\n')
      : receipt;
    await deliverNewLead(env, kind, id, details);
  } catch {
    console.error('New lead notification claim unavailable', { kind });
  }
}
