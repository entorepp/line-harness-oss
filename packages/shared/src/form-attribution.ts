export const ACCESSIBLE_JAPAN_FORM_ID = '9ab583b2-e42e-4ca2-bcb9-13a3c59f5477';

export const ACCESSIBLE_JAPAN_ATTRIBUTION_DATA_KEYS = [
  'source_partner',
  'source_hotel_name',
  'source_hotel_slug',
  'source_page_url',
  'source_attribution_method',
  'source_attribution_confidence',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;

export type AccessibleJapanAttributionMethod =
  | 'hotel_query'
  | 'utm_content'
  | 'referrer_path'
  | 'referrer_origin'
  | 'unknown';

export type AccessibleJapanAttributionConfidence =
  | 'name_and_slug_params'
  | 'single_hotel_param'
  | 'utm_content_only'
  | 'referrer_path_only'
  | 'origin_only'
  | 'unknown';

export type AccessibleJapanAttribution = {
  partner: 'Accessible Japan';
  sourceHotelName: string;
  sourceHotelSlug: string;
  sourcePageUrl: string;
  attributionMethod: AccessibleJapanAttributionMethod;
  attributionConfidence: AccessibleJapanAttributionConfidence;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
};

const ACCESSIBLE_JAPAN_HOST = 'accessible-japan.com';
const MAX_TEXT_LENGTH = 240;
const MAX_URL_LENGTH = 1000;

type RuntimeUrl = {
  protocol: string;
  hostname: string;
  origin: string;
  pathname: string;
  searchParams: {
    get(name: string): string | null;
  };
};

type RuntimeUrlConstructor = new (value: string) => RuntimeUrl;

function parseUrl(value: string): RuntimeUrl {
  const RuntimeUrl = (globalThis as unknown as { URL: RuntimeUrlConstructor }).URL;
  return new RuntimeUrl(value);
}

function normalizeText(value: unknown, maxLength = MAX_TEXT_LENGTH): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeSlug(value: unknown): string {
  const normalized = normalizeText(value, 180);
  if (!normalized) return '';

  const withoutEdges = normalized.replace(/^\/+|\/+$/g, '');
  if (!withoutEdges || withoutEdges.includes('/') || withoutEdges.includes('?') || withoutEdges.includes('#')) {
    return '';
  }

  try {
    return decodeURIComponent(withoutEdges).slice(0, 180);
  } catch {
    return withoutEdges.slice(0, 180);
  }
}

function isAccessibleJapanHostname(hostname: string): boolean {
  const lowered = hostname.toLowerCase();
  return lowered === ACCESSIBLE_JAPAN_HOST || lowered.endsWith(`.${ACCESSIBLE_JAPAN_HOST}`);
}

function normalizeAccessibleJapanUrl(value: unknown): string {
  const raw = normalizeText(value, MAX_URL_LENGTH);
  if (!raw) return '';

  try {
    const url = parseUrl(raw);
    if (!['http:', 'https:'].includes(url.protocol) || !isAccessibleJapanHostname(url.hostname)) {
      return '';
    }
    return `${url.origin}${url.pathname}`.slice(0, MAX_URL_LENGTH);
  } catch {
    return '';
  }
}

function slugFromAccessibleJapanUrl(value: string): string {
  if (!value) return '';

  try {
    const url = parseUrl(value);
    const segments = url.pathname.split('/').filter(Boolean);
    return normalizeSlug(segments.at(-1));
  } catch {
    return '';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readFirst(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = normalizeText(record[key]);
    if (value) return value;
  }
  return '';
}

export function buildAccessibleJapanAttributionInput(
  formUrl: string,
  documentReferrer = '',
): Record<string, string> {
  let url: RuntimeUrl;
  try {
    url = parseUrl(formUrl);
  } catch {
    return { referrer: documentReferrer };
  }

  const readParam = (...keys: string[]) => {
    for (const key of keys) {
      const value = url.searchParams.get(key)?.trim();
      if (value) return value;
    }
    return '';
  };

  return {
    hotelName: readParam(
      'source_hotel_name',
      'hotel_name',
      'prefill_Hotel Name',
      'prefill_hotel_name',
      'prefill_Hotel_Name',
    ),
    hotelSlug: readParam('source_hotel_slug', 'hotel_slug', 'hotel'),
    sourcePageUrl: readParam('source_url', 'source_page_url', 'landing_url'),
    referrer: documentReferrer,
    utmSource: readParam('utm_source'),
    utmMedium: readParam('utm_medium'),
    utmCampaign: readParam('utm_campaign'),
    utmContent: readParam('utm_content'),
    utmTerm: readParam('utm_term'),
  };
}

export function normalizeAccessibleJapanAttribution(value: unknown): AccessibleJapanAttribution {
  const record = asRecord(value);
  const utmSource = readFirst(record, ['utmSource', 'utm_source']);
  const utmMedium = readFirst(record, ['utmMedium', 'utm_medium']);
  const utmCampaign = readFirst(record, ['utmCampaign', 'utm_campaign']);
  const utmContent = readFirst(record, ['utmContent', 'utm_content']);
  const utmTerm = readFirst(record, ['utmTerm', 'utm_term']);
  const sourceHotelName = readFirst(record, ['hotelName', 'sourceHotelName', 'source_hotel_name']);
  const explicitHotelSlug = normalizeSlug(readFirst(record, [
    'hotelSlug',
    'sourceHotelSlug',
    'source_hotel_slug',
  ]));
  const explicitSourcePageUrl = normalizeAccessibleJapanUrl(readFirst(record, [
    'sourcePageUrl',
    'source_page_url',
    'sourceUrl',
    'source_url',
  ]));
  const referrerUrl = normalizeAccessibleJapanUrl(record.referrer);
  const sourcePageUrl = explicitSourcePageUrl || referrerUrl;
  const referrerSlug = slugFromAccessibleJapanUrl(sourcePageUrl);
  const sourceHotelSlug = explicitHotelSlug || normalizeSlug(utmContent) || referrerSlug;

  let attributionMethod: AccessibleJapanAttributionMethod = 'unknown';
  let attributionConfidence: AccessibleJapanAttributionConfidence = 'unknown';

  if (sourceHotelName && explicitHotelSlug) {
    attributionMethod = 'hotel_query';
    attributionConfidence = 'name_and_slug_params';
  } else if (sourceHotelName || explicitHotelSlug) {
    attributionMethod = 'hotel_query';
    attributionConfidence = 'single_hotel_param';
  } else if (normalizeSlug(utmContent)) {
    attributionMethod = 'utm_content';
    attributionConfidence = 'utm_content_only';
  } else if (referrerSlug) {
    attributionMethod = 'referrer_path';
    attributionConfidence = 'referrer_path_only';
  } else if (sourcePageUrl) {
    attributionMethod = 'referrer_origin';
    attributionConfidence = 'origin_only';
  }

  return {
    partner: 'Accessible Japan',
    sourceHotelName,
    sourceHotelSlug,
    sourcePageUrl,
    attributionMethod,
    attributionConfidence,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
  };
}

export function accessibleJapanAttributionToSubmissionData(
  attribution: AccessibleJapanAttribution,
): Record<string, string> {
  return {
    source_partner: attribution.partner,
    source_hotel_name: attribution.sourceHotelName,
    source_hotel_slug: attribution.sourceHotelSlug,
    source_page_url: attribution.sourcePageUrl,
    source_attribution_method: attribution.attributionMethod,
    source_attribution_confidence: attribution.attributionConfidence,
    utm_source: attribution.utmSource,
    utm_medium: attribution.utmMedium,
    utm_campaign: attribution.utmCampaign,
    utm_content: attribution.utmContent,
    utm_term: attribution.utmTerm,
  };
}

export function stripAccessibleJapanAttributionData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const reservedKeys = new Set<string>(ACCESSIBLE_JAPAN_ATTRIBUTION_DATA_KEYS);
  return Object.fromEntries(Object.entries(data).filter(([key]) => !reservedKeys.has(key)));
}
