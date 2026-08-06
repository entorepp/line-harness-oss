import type { TravelQuoteIntent, FlatworkerDraftSummary } from './travel-quote-intent.js';

type FlatworkerTravelQuoteEnvironment = {
  FLATWORKER_API_BASE_URL?: string;
  FLATWORKER_TRAVEL_QUOTE_TOKEN?: string;
};

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
    if (!response.ok) return { status: 'failed', caseId };
    const body = await response.json() as Record<string, unknown>;
    const status = new Set(['created', 'updated', 'existing']).has(String(body.status))
      ? String(body.status) as FlatworkerDraftSummary['status']
      : 'updated';
    return {
      status,
      caseId: String(body.caseId || caseId),
      ...(typeof body.caseUrl === 'string' && body.caseUrl ? { caseUrl: body.caseUrl } : {}),
    };
  } catch {
    return { status: 'failed', caseId };
  }
}
