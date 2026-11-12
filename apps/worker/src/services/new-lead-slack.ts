import type { Env } from '../index.js';
import { normalizeCityDateEntries } from '@line-crm/shared';
import type { FlatworkerDraftSummary, TravelQuoteIntent } from './travel-quote-intent.js';
import { postToSlack } from './slack.js';

export const FLATCARE_ENQUIRY_FORM_ID = 'b20652b4-431c-48f2-876c-8da4c024fd21';
export const NEW_LEAD_CHANNEL = 'C0CFMU4KKDK';
const CASES_URL = 'https://travelworker-web.pages.dev/cases';
const CHAT_URL = 'https://line-crm-web-2ob.pages.dev/chats';
const labels = {
  hotel: 'ホテル', tailor: 'テイラーメイド', package: 'パッケージ',
  flatcare: 'Flatcare', accessibleJapan: 'Accessible Japan・プランニングフォーム', agency: '代理店', form: '問い合わせフォーム', whatsapp: 'WhatsApp（初回）',
  line: 'LINE（初回）', instagram: 'Instagram（初回）', messenger: 'Messenger（初回）',
} as const;
type LeadKind = keyof typeof labels;
type SocialKind = 'whatsapp' | 'instagram' | 'messenger' | 'line';

export function websiteLeadKind(intent: TravelQuoteIntent): LeadKind | null {
  if (intent.hotelRequestStage === 'supplement') return null;
  if (intent.source === 'partner-portal' || intent.mode === 'agent') return 'agency';
  if (intent.mode === 'journey') return 'package';
  if (intent.mode !== 'private') return null;
  if (intent.source === 'flat-travel-hotel-request') return 'hotel';
  return 'tailor';
}

export function firstSocialLeadClaim(
  env: Env['Bindings'], kind: SocialKind, friendId: string,
  occurredAt: string | number,
): { id: string; statement: D1PreparedStatement } | null {
  if (!env.SLACK_BOT_TOKEN) return null;
  const receivedAt = typeof occurredAt === 'number' ? occurredAt : Date.parse(occurredAt);
  const age = Date.now() - receivedAt;
  if (!Number.isFinite(age) || age > 86_400_000 || age < -300_000) return null;
  const id = `new-lead:${kind}:${friendId}`;
  // Run before the message INSERT in the same atomic D1 batch. A concurrent
  // webhook then sees either the existing history or the existing claim.
  const statement = env.DB.prepare(
    `INSERT OR IGNORE INTO notifications (id,event_type,title,body,channel,status)
     SELECT ?, 'new_lead', ?, '', 'slack', 'pending'
     WHERE NOT EXISTS (SELECT 1 FROM messages_log WHERE friend_id = ?${kind === 'line' ? " AND direction = 'incoming'" : ''})`,
  ).bind(id, labels[kind], friendId);
  return { id, statement };
}

export async function deliverNewLead(
  env: Env['Bindings'], kind: LeadKind, id: string, details = '',
): Promise<boolean> {
  try {
    if (!env.SLACK_BOT_TOKEN) return false;
    const delivered = await postToSlack({
      token: env.SLACK_BOT_TOKEN,
      channel: NEW_LEAD_CHANNEL,
      signal: AbortSignal.timeout(4000),
      text: `新規問い合わせ｜${labels[kind]}${details ? `\n${details}` : ''}`,
    });
    await env.DB.prepare("UPDATE notifications SET status = ? WHERE id = ?")
      .bind(delivered ? 'sent' : 'failed', id).run();
    return delivered;
  } catch {
    console.error('New lead notification outcome unavailable', { kind });
    return false;
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
  let name: string | null = null;
  try {
    const profile = await env.DB.prepare('SELECT display_name, line_user_id FROM friends WHERE id = ?')
      .bind(friendId).first<{ display_name: string | null; line_user_id: string }>();
    const candidate = profile?.display_name;
    name = candidate && profile?.line_user_id !== candidate
      && !profile?.line_user_id.endsWith(`:${candidate}`) ? candidate : null;
  } catch { /* Deliver the receipt even if the optional profile read fails. */ }
  await deliverNewLead(env, kind, id, [
    `<${url}|Flat Harnessで確認>`,
    `流入元 ${labels[kind]}`,
    `顧客名 ${slackText(name) || '未取得'}`,
    '旅行開始日 未確認',
    `<${CASES_URL}|FlatWorker>（案件未連携）`,
  ].join('\n'));
}

export async function notifyNewFormLead(
  env: Env['Bindings'], kind: LeadKind, reference: string, details = '',
): Promise<boolean> {
  try {
    if (!env.SLACK_BOT_TOKEN) return false;
    const id = `new-lead:${kind}:${reference}`;
    const claim = await env.DB.prepare(
      `INSERT OR IGNORE INTO notifications (id,event_type,title,body,channel,status)
       VALUES (?, 'new_lead', ?, '', 'slack', 'pending')`,
    ).bind(id, labels[kind]).run();
    if (!claim.meta.changes) return false;
    const receipt = /^[a-z\d-]{1,80}$/i.test(reference) ? `受付番号 ${reference}` : '';
    const defaultDetails = kind === 'flatcare'
      ? [receipt, '<https://liffform-studio.pages.dev/|Forms Studioで確認>'].filter(Boolean).join('\n')
      : receipt;
    return await deliverNewLead(env, kind, id, details || defaultDetails);
  } catch {
    console.error('New lead notification claim unavailable', { kind });
    return false;
  }
}

// Keep user values on one escaped Slack line and prevent mention/link injection.
function slackText(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 240).replace(/[\r\n\t]/g, ' ')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
}

export function leadDetails(input: {
  reference: string; source: string; name?: unknown; start?: unknown; caseId?: string;
}): string {
  const caseLink = input.caseId
    ? `<${CASES_URL}/${encodeURIComponent(input.caseId)}|FlatWorkerで案件を開く>`
    : `<${CASES_URL}|FlatWorker>（案件連携を確認）`;
  return [caseLink, `流入元 ${slackText(input.source)}`,
    `顧客名 ${slackText(input.name) || '未入力'}`,
    `旅行開始日 ${slackText(input.start) || '未定・要確認'}`,
    `受付番号 ${slackText(input.reference)}`].join('\n');
}

export function websiteLeadDetails(intent: TravelQuoteIntent, draft: FlatworkerDraftSummary): string {
  const first = intent.attribution?.firstTouch;
  const last = intent.attribution?.lastTouch;
  const source = first?.utm?.source || first?.referrerOrigin || last?.utm?.source || last?.referrerOrigin;
  const month = intent.agreementSnapshot.tailorMade?.choices.startMonth;
  return leadDetails({reference: intent.quoteReference, caseId: draft.caseId,
    source: `${intent.source === 'partner-portal' ? '代理店ポータル' : 'Flat Travel公式サイト'} / ${labels[websiteLeadKind(intent) || 'tailor']}${source ? ` / ${source}` : ''} / 連絡方法 ${intent.channel}`,
    name: intent.customerName,
    start: intent.startDate || intent.agreementSnapshot.itinerary.startDate
      || (typeof month === 'string' ? `${month}（日付未定）` : ''),
  });
}

export function planningFormLeadDetails(reference: string, data: Record<string, unknown>, caseId?: string): string {
  const starts = normalizeCityDateEntries(data.city_schedule).map(row => row.startDate).filter(Boolean).sort();
  return leadDetails({reference, caseId, source: 'Accessible Japan / Flat Travel Planning Form',
    name: [data.first_name, data.last_name].filter(value => typeof value === 'string').join(' '),
    start: data.dates_decided === 'No' ? data.approximate_timing : starts[0] || data.approximate_timing,
  });
}

// Existing public enquiry/consultation and agent-kit forms. Supplier surveys,
// applications, pre-departure answers and post-trip feedback have separate owners.
const ENQUIRY_FORM_IDS = new Set([
  '5a9ad125-9f3c-4a7d-b3fe-22f6cb430daa', 'fdbc9106-9b21-43ac-b840-52d741242a56',
  'cf538373-a378-42a3-9620-35d5b3985214', '7d7c9b75-5a6b-4bc7-9811-90b78377eaeb',
  'bd1729f5-21c3-4d91-9e49-0799caabcb81', 'bb8dfeb9-efbd-4c89-8ab4-74d7d26c32ca',
  '57f80920-5089-4d14-911b-26a425ed189f', '8241952c-7a79-4875-ab25-5a955a602996',
  '765379b3-1409-47d2-a3db-ab7893c189ed', '1f080381-963d-461d-9351-6024d1d28815',
  'bc2c0771-9637-432d-8bb4-c5cabdf8eea9', 'e2a59745-9887-4999-b990-6b9068cc6a17',
  'dfc5c2e7-f3b5-4783-afb8-b3e365aef6dc', '85097b92-8295-4d07-80b8-43b4d76a9051',
  '75358e99-6c2a-4510-b8bb-c202f1616ff3', 'e0bdfa18-d830-4d8f-8e05-719296a09713',
  'ead00f4d-e4ab-41b8-bbf6-9664a1130e47', '24b74ba1-fc4a-47a2-995d-d75e3a579e57',
  'cd7a38e7-3909-45ea-9072-742f08607dde', '514279b7-3426-43bc-9226-9fcd13113ee7',
]);

export function isPublicEnquiryForm(formId: string, issued: boolean): boolean {
  return !issued && ENQUIRY_FORM_IDS.has(formId);
}
