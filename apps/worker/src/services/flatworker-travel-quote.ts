import type { TravelQuoteIntent, FlatworkerDraftSummary } from './travel-quote-intent.js';

type FlatworkerTravelQuoteEnvironment = {
  FLATWORKER_API_BASE_URL?: string;
  FLATWORKER_TRAVEL_QUOTE_TOKEN?: string;
};

const SAFE_UPSTREAM_MESSAGES = new Set([
  'invalid traveller profile schema',
  'traveller email required',
  'invalid traveller email',
  'journey movement tariff contract is required',
  'journey movement tariff ID is required',
  'journey movement unit price is required',
  'journey movement pricing basis is required',
  'journey movement capacity is required',
  'journey movement direction contract is required',
]);

function caseIdFor(reference: string): string {
  return `flat-travel-${reference.toLowerCase()}`;
}

export async function syncTravelQuoteToFlatworker(
  intent: TravelQuoteIntent,
  env: FlatworkerTravelQuoteEnvironment,
): Promise<FlatworkerDraftSummary> {
  const caseId = caseIdFor(intent.quoteReference);
  const baseUrl = String(env.FLATWORKER_API_BASE_URL || '').trim().replace(/\/+$/, '');
  const token = String(env.FLATWORKER_TRAVEL_QUOTE_TOKEN || '').trim();
  if (!baseUrl || !token) return { status: 'not_configured', caseId };

  try {
    const response = await fetch(`${baseUrl}/api/integrations/travel-quote-intents`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-flat-travel-quote-token': token,
        'x-travelworker-request-id': crypto.randomUUID(),
      },
      body: JSON.stringify(intent),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      let body: Record<string, unknown> = {};
      try { body = await response.json() as Record<string, unknown>; } catch { /* response body is optional */ }
      const message = String(body.message || '').trim().toLowerCase();
      return {
        status: 'failed',
        caseId,
        upstreamStatus: response.status,
        ...(typeof body.error === 'string' && body.error ? { errorCode: body.error.slice(0, 80) } : {}),
        ...(SAFE_UPSTREAM_MESSAGES.has(message) ? { errorMessage: message } : {}),
      };
    }
    const body = await response.json() as Record<string, unknown>;
    const status = new Set(['created', 'updated', 'existing']).has(String(body.status))
      ? String(body.status) as FlatworkerDraftSummary['status']
      : 'updated';
    const readiness = body.automationReadiness && typeof body.automationReadiness === 'object'
      ? body.automationReadiness as Record<string, unknown>
      : {};
    const readinessStatus = new Set(['ready_for_staff_review', 'needs_data']).has(String(readiness.status))
      ? String(readiness.status) as 'ready_for_staff_review' | 'needs_data'
      : 'needs_data';
    return {
      status,
      caseId: String(body.caseId || caseId),
      ...(typeof body.caseUrl === 'string' && body.caseUrl ? { caseUrl: body.caseUrl } : {}),
      profileStored: body.profileStored === true,
      automationReadiness: {
        status: readinessStatus,
        blockingIssueCount: Math.max(0, Math.min(50, Number(readiness.blockingIssueCount) || 0)),
      },
    };
  } catch {
    return { status: 'failed', caseId };
  }
}
