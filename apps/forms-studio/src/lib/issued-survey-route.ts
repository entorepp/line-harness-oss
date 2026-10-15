const POST_ORDER_FORM_ID = '72fa9940-164a-4efb-9ad8-e819bfeb8c91'

// Old case links contain only an issue. Resolve its trusted form before routing
// to the custom survey; keep the opaque issue so submission stays case-bound.
export function issuedSurveyRoute(currentUrl: string, formId: string, issueId: string): string | null {
  if (![POST_ORDER_FORM_ID, '8dc19365-8dd7-49e7-92fb-fdd697572771'].includes(formId) || !issueId) return null
  const url = new URL(currentUrl)
  if (url.searchParams.get('issue') !== issueId) return null
  url.pathname = '/public-form'
  url.searchParams.set('id', formId)
  url.searchParams.set('lang', 'en')
  return url.toString()
}
