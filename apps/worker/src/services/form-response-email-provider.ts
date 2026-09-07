import type { Env } from '../index.js';

export class FormResponseEmailProviderError extends Error {
  readonly code: string;
  readonly outcome: 'failed' | 'unknown';

  constructor(code: string, outcome: 'failed' | 'unknown') {
    super(code);
    this.code = code;
    this.outcome = outcome;
  }
}

export async function sendFormResponseEmailViaTravelworker(input: {
  env: Env['Bindings'];
  requestId: string;
  submissionId: string;
  recipientRole: 'respondent' | 'agency_contact';
  recipientEmail: string;
  recipientName: string;
  subject: string;
  text: string;
  html: string;
  bodySha256: string;
  policyVersion: string;
}): Promise<{ messageId: string }> {
  const baseUrl = String(input.env.FLATWORKER_API_BASE_URL || '').trim().replace(/\/+$/, '');
  const token = String(input.env.FLATWORKER_TRAVEL_QUOTE_TOKEN || '').trim();
  if (!baseUrl || !token) {
    throw new FormResponseEmailProviderError('E_GMAIL_GATEWAY_NOT_CONFIGURED', 'failed');
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/integrations/form-response-email/send`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Flat-Travel-Quote-Token': token,
        'X-TravelWorker-Request-Id': input.requestId,
      },
      body: JSON.stringify({
        requestId: input.requestId,
        submissionId: input.submissionId,
        recipientRole: input.recipientRole,
        recipientEmail: input.recipientEmail,
        recipientName: input.recipientName,
        subject: input.subject,
        text: input.text,
        html: input.html,
        bodySha256: input.bodySha256,
        policyVersion: input.policyVersion,
        confirmed: true,
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new FormResponseEmailProviderError('E_GMAIL_OUTCOME_UNKNOWN', 'unknown');
  }

  let body: Record<string, unknown> = {};
  try {
    body = await response.json() as Record<string, unknown>;
  } catch {
    if (response.ok) {
      throw new FormResponseEmailProviderError('E_GMAIL_OUTCOME_UNKNOWN', 'unknown');
    }
  }
  const upstreamCode = String(body.error || '').trim();
  if (!response.ok) {
    const explicitlyUnknown = upstreamCode === 'form_response_email_delivery_unknown'
      || (response.status === 409 && ['sending', 'unknown'].includes(String(body.status || '')));
    const safeCode = /^[a-z0-9_]{1,80}$/u.test(upstreamCode)
      ? `E_${upstreamCode.toUpperCase()}`
      : `E_GMAIL_GATEWAY_HTTP_${response.status}`;
    throw new FormResponseEmailProviderError(safeCode, explicitlyUnknown ? 'unknown' : 'failed');
  }
  if (body.status !== 'accepted') {
    throw new FormResponseEmailProviderError('E_GMAIL_OUTCOME_UNKNOWN', 'unknown');
  }
  const rawMessageId = String(body.messageId || '');
  if (!/^[A-Za-z0-9._:@/-]{1,240}$/u.test(rawMessageId)) {
    throw new FormResponseEmailProviderError('E_GMAIL_OUTCOME_UNKNOWN', 'unknown');
  }
  return { messageId: rawMessageId };
}
