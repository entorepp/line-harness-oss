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

  const source = url.searchParams.get('utm_source')?.trim().toLowerCase() || ''
  const recognizedSource = ['accessiblejapan', 'accessible_japan', 'accessible-japan', 'accessible-japan.com', 'www.accessible-japan.com'].includes(source)
  const hasHotelContext = [
    'source_hotel_name',
    'hotel_name',
    'prefill_Hotel Name',
    'prefill_hotel_name',
    'prefill_Hotel_Name',
    'source_hotel_slug',
    'hotel_slug',
    'hotel',
  ].some((key) => Boolean(url.searchParams.get(key)?.trim()))
  const isAccessibleJapan = recognizedSource || (!source && (hasHotelContext || accessibleJapanReferrer))
  const requestedMedium = url.searchParams.get('utm_medium')?.trim().toLowerCase() || ''
  const campaignMedium = ['cpc', 'cta'].includes(requestedMedium)
    ? requestedMedium
    : hasHotelContext ? 'cta' : 'referral'
  const requestedCampaign = url.searchParams.get('utm_campaign')?.trim().toLowerCase() || ''
  const campaignName = requestedCampaign === 'hotel_detail' ? 'hotel_detail' : 'accessible_japan_forms'
  return {
    type: 'liffform:page-view',
    page_referrer: referrerOrigin,
    campaign_source: isAccessibleJapan ? 'accessible_japan' : '',
    campaign_medium: isAccessibleJapan ? campaignMedium : '',
    campaign_name: isAccessibleJapan ? campaignName : '',
  }
}
