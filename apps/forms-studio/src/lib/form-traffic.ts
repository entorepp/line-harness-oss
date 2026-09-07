export const TRAFFIC_FORM_ID = '9ab583b2-e42e-4ca2-bcb9-13a3c59f5477'
export const TRAFFIC_ORIGIN = 'https://liffform-studio.pages.dev'
export const TRAFFIC_CONSENT_KEY = 'liffform.analytics-consent.v1'

export type TrafficContext = {
  type: 'liffform:page-view'
  page_referrer: string
  campaign_source: string
  campaign_medium: string
  campaign_name: string
}

// Only campaign constants and a referrer origin cross into the analytics frame.
// Form answers, issue IDs, hotel names, URL paths, queries and fragments do not.
export function buildTrafficContext(href: string, referrer: string): TrafficContext | null {
  let url: URL
  try { url = new URL(href) } catch { return null }
  if (url.origin !== TRAFFIC_ORIGIN || url.pathname.replace(/\/$/, '') !== '/public-form'
    || url.searchParams.get('id') !== TRAFFIC_FORM_ID || url.searchParams.has('issue')) return null

  let referrerOrigin = ''
  let accessibleJapanReferrer = false
  try {
    const ref = new URL(referrer)
    if (ref.protocol === 'https:' && !ref.username && !ref.password
      && /^[a-z0-9.-]+$/i.test(ref.hostname) && ref.hostname.length <= 253) {
      referrerOrigin = ref.origin === TRAFFIC_ORIGIN ? '' : ref.origin + '/'
      accessibleJapanReferrer = ref.hostname === 'accessible-japan.com'
        || ref.hostname.endsWith('.accessible-japan.com')
    }
  } catch { /* Missing or invalid referrers remain direct/unknown. */ }

  const source = url.searchParams.get('utm_source')?.toLowerCase() || ''
  const isAccessibleJapan = ['accessible_japan', 'accessible-japan', 'accessible-japan.com', 'www.accessible-japan.com'].includes(source)
    || (!source && accessibleJapanReferrer)
  const paid = isAccessibleJapan && url.searchParams.get('utm_medium')?.toLowerCase() === 'cpc'
  return {
    type: 'liffform:page-view',
    page_referrer: referrerOrigin,
    campaign_source: isAccessibleJapan ? 'accessible_japan' : '',
    campaign_medium: isAccessibleJapan ? (paid ? 'cpc' : 'referral') : '',
    campaign_name: isAccessibleJapan ? 'accessible_japan_forms' : '',
  }
}
