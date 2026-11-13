import type { Env } from '../index.js';
import type { TravelQuoteIntent, FlatworkerDraftSummary } from './travel-quote-intent.js';
import { FormResponseEmailProviderError, sendFormResponseEmailViaTravelworker } from './form-response-email-provider.js';

const RECIPIENT = 'info@flatcare.jp';
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]!));

export async function notifyPackageStaffEmail(env: Env['Bindings'], intent: TravelQuoteIntent, draft: FlatworkerDraftSummary): Promise<void> {
  if (intent.source !== 'accessible-japan-package' || !draft.leadRegistered || !draft.profileStored
      || !['created', 'updated', 'existing'].includes(draft.status)
      || draft.customerSent || draft.priceConfirmed || draft.booked) return;

  const requestId = `package-staff:${intent.quoteReference}`;
  const reserved = await env.DB.prepare(
    `INSERT OR IGNORE INTO notifications (id, event_type, title, body, channel, status, metadata, created_at)
     VALUES (?, 'package_staff_email', 'Package enquiry email', 'Internal notification', 'email', 'sending', ?, datetime('now', '+9 hours'))`,
  ).bind(requestId, JSON.stringify({reference: intent.quoteReference, recipient: RECIPIENT})).run();
  if (!(reserved.meta.changes || 0)) return;

  const choices = intent.agreementSnapshot.tailorMade?.choices;
  const subject = `[Accessible Japan enquiry] ${intent.quoteReference}`;
  const text = [
    'New Accessible Japan package or tailor-made enquiry',
    `Reference: ${intent.quoteReference}`,
    `Name: ${intent.customerName}`,
    `Email: ${intent.email}`,
    `Journey: ${intent.title || intent.tourId || 'Tailor-made'}`,
    `Travel timing: ${intent.startDate || choices?.startMonth || 'To be discussed'}`,
    `Travellers: ${intent.travellers || 'To be discussed'}`,
    `Route: ${intent.route.join(' → ')}`,
    `Interests: ${Array.isArray(choices?.themes) ? choices.themes.join(', ') : choices?.themes || 'See enquiry in FlatWorker'}`,
    `FlatWorker: ${draft.caseUrl || draft.caseId}`,
    'Review the saved enquiry in FlatWorker for selected options, free-text requests and access requirements.',
  ].join('\n');
  const html = `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${subject}\n${text}\n${html}`));
  const bodySha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  try {
    const result = await sendFormResponseEmailViaTravelworker({env, requestId, submissionId: intent.quoteReference,
      recipientRole: 'package_staff', recipientEmail: RECIPIENT, recipientName: 'Flatcare enquiries',
      subject, text, html, bodySha256, policyVersion: 'form-response-email-v1'});
    await env.DB.prepare('UPDATE notifications SET status = ?, metadata = json_set(metadata, \'$.providerMessageId\', ?) WHERE id = ?')
      .bind('sent', result.messageId, requestId).run();
  } catch (error) {
    const status = error instanceof FormResponseEmailProviderError ? error.outcome : 'unknown';
    await env.DB.prepare('UPDATE notifications SET status = ? WHERE id = ?').bind(status, requestId).run();
    console.error('Package staff email requires review', requestId, status);
  }
}
