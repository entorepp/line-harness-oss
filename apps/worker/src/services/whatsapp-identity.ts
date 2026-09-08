import type { Env } from '../index.js';

type Evidence = { type: 'journey_reference' | 'email_handoff' | 'customer_email' | 'form_submission'; value: string };
export type IdentityResult = {
  status: 'linked' | 'unlinked' | 'review_required' | 'unavailable';
  reason?: string;
  email?: string;
  whatsappNumber?: string;
  customerName?: string;
  evidenceSource?: string;
  reference?: string;
  cases?: { caseId: string; title: string; url: string }[];
};

export function extractIdentityEvidence(text: string): Evidence | null {
  // References identify a prior receipt; hotel names, names and generic CTAs do not.
  const references = [...new Set(text.match(/\b(?:FTH-[A-F0-9]{32}|(?:FTQ|FT)-\d{8}-[A-Z0-9]{8}|FTR-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/gi) || [])];
  if (references.length > 1) return null;
  if (references.length === 1) {
    const ref = references[0];
    return { type: /^FTH-/i.test(ref) ? 'email_handoff' : /^FTR-/i.test(ref) ? 'form_submission' : 'journey_reference', value: /^FTR-/i.test(ref) ? ref.slice(4).toLowerCase() : ref.toUpperCase() };
  }
  if (/\b(?:FTH|FTQ|FT|FTR)-/i.test(text)) return null;
  const emails = [...new Set((text.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}/gi) || []).map(value => value.toLowerCase()))];
  if (emails.length !== 1) return null;
  // Avoid signatures, forwarded mail and another person's address. In particular
  // Andrea's exact "The email was ..." is an explicit customer statement.
  const declaration = /\b(?:(?:my|the)\s+e-?mail(?:\s+address)?\s*(?:is|was|:)|you can (?:email|reach|contact) me at)\s*([A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i.exec(text);
  if (!declaration || declaration[1].toLowerCase() !== emails[0] || /\b(?:not|wrong|old|previous)\b/i.test(text.slice(Math.max(0, declaration.index - 40), declaration.index + declaration[0].length))) return null;
  return { type: 'customer_email', value: emails[0] };
}

async function contact(env: Env['Bindings'], friendId: string) {
  const row = await env.DB.prepare(`SELECT f.id, f.line_user_id, f.line_account_id
    FROM friends f JOIN line_accounts a ON a.id = f.line_account_id
    WHERE f.id = ? AND a.channel_type = 'whatsapp' AND a.is_active = 1`).bind(friendId)
    .first<{ id: string; line_user_id: string; line_account_id: string }>();
  if (!row || !/^\+?[1-9][0-9]{6,14}$/.test(row.line_user_id)) return null;
  return { accountId: row.line_account_id, friendId: row.id, whatsappNumber: '+' + row.line_user_id.replace(/^\+/, '') };
}

async function callIdentity(env: Env['Bindings'], mode: 'read' | 'link', payload: Record<string, unknown>): Promise<IdentityResult> {
  const base = env.FLATWORKER_API_BASE_URL?.replace(/\/+$/, '');
  const token = env.FLATWORKER_TRAVEL_QUOTE_TOKEN?.trim();
  if (!base || !token) return { status: 'unavailable' };
  try {
    const response = await fetch(`${base}/api/integrations/whatsapp-identity/${mode}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Flat-Travel-Quote-Token': token },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { status: 'unavailable' };
    const result = await response.json() as IdentityResult;
    if (!['linked', 'unlinked', 'review_required'].includes(result.status)) return { status: 'unavailable' };
    return result;
  } catch {
    // Never log request/response bodies, contact details or capability references.
    return { status: 'unavailable' };
  }
}

export async function readWhatsappIdentity(env: Env['Bindings'], friendId: string): Promise<IdentityResult> {
  const current = await contact(env, friendId);
  return current ? callIdentity(env, 'read', current) : { status: 'unlinked' };
}

export async function linkWhatsappIdentity(env: Env['Bindings'], friendId: string, providerMessageId: string, text: string): Promise<IdentityResult> {
  const evidence = extractIdentityEvidence(text);
  if (!evidence) return { status: 'unlinked', reason: 'no_unique_customer_evidence' };
  const current = await contact(env, friendId);
  if (!current) return { status: 'unlinked' };
  return callIdentity(env, 'link', { ...current, providerMessageId, evidence });
}

export async function reconcileWhatsappIdentity(env: Env['Bindings'], friendId: string): Promise<IdentityResult> {
  // Explicit staff action only. Never send/replay the original webhook or events.
  const rows = await env.DB.prepare(`SELECT id, content FROM messages_log
    WHERE friend_id = ? AND direction = 'incoming' AND message_type = 'text'
    ORDER BY created_at DESC LIMIT 200`).bind(friendId).all<{ id: string; content: string }>();
  const candidates = rows.results.map(row => ({ row, evidence: extractIdentityEvidence(row.content) })).filter(item => item.evidence);
  const identities = new Set(candidates.map(item => JSON.stringify(item.evidence)));
  if (identities.size > 1) return { status: 'review_required', reason: 'multiple_inbound_identities' };
  if (!candidates.length) {
    const saved = await readWhatsappIdentity(env, friendId);
    if (saved.status !== 'unlinked') return saved;
    const channel = await env.DB.prepare(`SELECT f.slack_channel_id, a.default_slack_channel,
      (SELECT COUNT(*) FROM friends linked WHERE linked.slack_channel_id = f.slack_channel_id) AS friend_count
      FROM friends f JOIN line_accounts a ON a.id = f.line_account_id
      WHERE f.id = ? AND a.channel_type = 'whatsapp' AND a.is_active = 1`).bind(friendId)
      .first<{ slack_channel_id: string | null; default_slack_channel: string | null; friend_count: number }>();
    if (!channel?.slack_channel_id || channel.slack_channel_id === channel.default_slack_channel) return saved;
    if (channel.friend_count !== 1) return { status: 'review_required', reason: 'shared_case_channel' };
    const current = await contact(env, friendId);
    if (!current) return saved;
    return callIdentity(env, 'link', { ...current, providerMessageId: `staff-channel:${friendId}:${channel.slack_channel_id}`,
      evidence: { type: 'staff_case_channel', value: channel.slack_channel_id } });
  }
  const candidate = candidates[0].row;
  return linkWhatsappIdentity(env, friendId, `stored:${candidate.id}`, candidate.content);
}
