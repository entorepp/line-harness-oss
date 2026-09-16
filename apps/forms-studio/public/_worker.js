const API_ORIGIN = 'https://line-flattravel.flat-travel.workers.dev';
const ACCESSIBLE_JAPAN_FORM_ID = '9ab583b2-e42e-4ca2-bcb9-13a3c59f5477';
const ACCESSIBLE_JAPAN_TRAFFIC_PATH = '/api/shared-reports/accessible-japan-traffic';
const ACCESSIBLE_JAPAN_TRACKED_PATH = '/go/accessible-japan';
const ACCESSIBLE_JAPAN_SOURCE_VALUES = new Set([
  'accessible_japan',
  'accessible-japan',
  'accessible-japan.com',
  'www.accessible-japan.com',
]);
const FORWARDED_ATTRIBUTION_KEYS = [
  'source_hotel_name',
  'hotel_name',
  'prefill_Hotel Name',
  'prefill_hotel_name',
  'prefill_Hotel_Name',
  'source_hotel_slug',
  'hotel_slug',
  'hotel',
  'utm_content',
  'utm_term',
];
const CUSTOM_FORM_PATHS = new Map([
  ['96ff4bc9-40df-4b10-a3db-486f82374b30', '/tokyo-transport-survey/'],
  ['82119557-3c07-4f17-ab39-193d1fb35df3', '/kyoto-transport-survey/'],
  ['f01bcdfc-4b53-44c4-9fbf-9bf5ce2707cb', '/osaka-transport-survey/'],
  ['db018579-e461-43cc-84c5-2cdfad0e8d5b', '/kanazawa-transport-survey/'],
  ['1528b3da-2966-4c7c-945d-38e9ea322204', '/hiroshima-transport-survey/'],
  ['eef7e0b9-c0b0-49d8-8a30-bd34a6cf2c92', '/fuji-odawara-transport-survey/'],
  ['e5a619c2-b729-4d9a-9151-b8e5f7d86382', '/fuji-mishima-transport-survey/'],
  ['96a7fa63-8f10-4e8d-881c-4eef2c32c04b', '/fuji-shizuoka-transport-survey/'],
  ['72fa9940-164a-4efb-9ad8-e819bfeb8c91', '/post-order-survey/'],
]);

function buildApiRequest(request) {
  const sourceUrl = new URL(request.url);
  const targetUrl = new URL(sourceUrl.pathname + sourceUrl.search, API_ORIGIN);
  const headers = new Headers(request.headers);

  headers.delete('host');

  return new Request(targetUrl.toString(), {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'manual',
  });
}

function isAccessibleJapanHost(hostname) {
  const value = hostname.toLowerCase();
  return value === 'accessible-japan.com' || value.endsWith('.accessible-japan.com');
}

function isTrackedFormRequest(request, url) {
  return request.method === 'GET'
    && url.pathname.replace(/\/$/, '') === '/public-form'
    && url.searchParams.get('id') === ACCESSIBLE_JAPAN_FORM_ID
    && !url.searchParams.has('issue');
}

function isPrefetch(request) {
  return [request.headers.get('Purpose'), request.headers.get('Sec-Purpose')]
    .some((value) => value?.toLowerCase().includes('prefetch'));
}

function classifyArrival(request, url) {
  const utmSource = (url.searchParams.get('utm_source') || '').trim().toLowerCase();
  if (ACCESSIBLE_JAPAN_SOURCE_VALUES.has(utmSource)) {
    return {
      source: 'accessible_japan',
      medium: (url.searchParams.get('utm_medium') || '').trim().toLowerCase() === 'cpc'
        ? 'cpc'
        : 'referral',
    };
  }

  try {
    const referrer = new URL(request.headers.get('Referer') || '');
    if (['http:', 'https:'].includes(referrer.protocol) && isAccessibleJapanHost(referrer.hostname)) {
      return { source: 'accessible_japan', medium: 'referral' };
    }
    if (referrer.protocol === 'http:' || referrer.protocol === 'https:') {
      return { source: 'other', medium: 'other' };
    }
  } catch { /* Missing or invalid referrers remain direct. */ }

  return { source: 'direct', medium: 'direct' };
}

function recordTraffic(env, request, eventType, attribution) {
  if (!env.FORM_TRAFFIC_DB?.prepare) return Promise.resolve();

  const isTest = request.headers.get('X-Flatcare-Traffic-Test') === '1' ? 1 : 0;
  return env.FORM_TRAFFIC_DB.prepare(`
    INSERT INTO accessible_japan_form_traffic
      (id, form_id, event_type, source, medium, is_test, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    crypto.randomUUID(),
    ACCESSIBLE_JAPAN_FORM_ID,
    eventType,
    attribution.source,
    attribution.medium,
    isTest,
  ).run();
}

function schedule(context, promise) {
  const guarded = promise.catch((error) => {
    console.error('Accessible Japan traffic recording failed:', error);
  });
  if (context?.waitUntil) context.waitUntil(guarded);
}

function normalizeForwardedValue(value) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function buildTrackedDestination(sourceUrl) {
  const target = new URL('/public-form', sourceUrl.origin);
  target.searchParams.set('id', ACCESSIBLE_JAPAN_FORM_ID);
  target.searchParams.set('utm_source', 'accessible_japan');
  target.searchParams.set('utm_medium', 'cpc');
  target.searchParams.set('utm_campaign', 'accessible_japan_forms');

  for (const key of FORWARDED_ATTRIBUTION_KEYS) {
    const value = normalizeForwardedValue(sourceUrl.searchParams.get(key) || '');
    if (value) target.searchParams.set(key, value);
  }

  return target;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function equalHash(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function hasReportAccess(request, env) {
  const expectedHash = (env.ACCESSIBLE_JAPAN_REPORT_TOKEN_SHA256 || '').trim().toLowerCase();
  const authorization = request.headers.get('Authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  return Boolean(expectedHash && token && equalHash(await sha256(token), expectedHash));
}

function reportResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function asCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function getTrafficReport(request, env) {
  if (!await hasReportAccess(request, env)) {
    return reportResponse({ success: false, error: 'Unauthorized' }, 401);
  }
  if (!env.FORM_TRAFFIC_DB?.prepare) {
    return reportResponse({ success: false, error: 'Traffic reporting is not configured' }, 503);
  }

  try {
    const [totals, daily] = await Promise.all([
      env.FORM_TRAFFIC_DB.prepare(`
        SELECT
          MIN(occurred_at) AS first_recorded_at,
          SUM(CASE WHEN event_type = 'form_arrival' THEN 1 ELSE 0 END) AS total_arrivals,
          SUM(CASE WHEN event_type = 'form_arrival' AND source = 'accessible_japan' THEN 1 ELSE 0 END) AS accessible_japan_arrivals,
          SUM(CASE WHEN event_type = 'tracked_click' THEN 1 ELSE 0 END) AS tracked_clicks
        FROM accessible_japan_form_traffic
        WHERE form_id = ? AND is_test = 0
      `).bind(ACCESSIBLE_JAPAN_FORM_ID).first(),
      env.FORM_TRAFFIC_DB.prepare(`
        SELECT
          date(occurred_at, '+9 hours') AS date,
          SUM(CASE WHEN event_type = 'form_arrival' THEN 1 ELSE 0 END) AS total_arrivals,
          SUM(CASE WHEN event_type = 'form_arrival' AND source = 'accessible_japan' THEN 1 ELSE 0 END) AS accessible_japan_arrivals,
          SUM(CASE WHEN event_type = 'tracked_click' THEN 1 ELSE 0 END) AS tracked_clicks
        FROM accessible_japan_form_traffic
        WHERE form_id = ? AND is_test = 0
        GROUP BY date(occurred_at, '+9 hours')
        ORDER BY date DESC
        LIMIT 366
      `).bind(ACCESSIBLE_JAPAN_FORM_ID).all(),
    ]);

    return reportResponse({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        firstRecordedAt: totals?.first_recorded_at
          ? `${String(totals.first_recorded_at).replace(' ', 'T')}Z`
          : null,
        totalArrivals: asCount(totals?.total_arrivals),
        accessibleJapanArrivals: asCount(totals?.accessible_japan_arrivals),
        trackedClicks: asCount(totals?.tracked_clicks),
        trackedUrl: new URL(ACCESSIBLE_JAPAN_TRACKED_PATH, request.url).origin
          + ACCESSIBLE_JAPAN_TRACKED_PATH,
        formUrl: new URL(`/public-form?id=${ACCESSIBLE_JAPAN_FORM_ID}`, request.url).toString(),
        daily: (daily.results || []).map((row) => ({
          date: row.date,
          totalArrivals: asCount(row.total_arrivals),
          accessibleJapanArrivals: asCount(row.accessible_japan_arrivals),
          trackedClicks: asCount(row.tracked_clicks),
        })),
      },
    });
  } catch (error) {
    console.error('Accessible Japan traffic report failed:', error);
    return reportResponse({ success: false, error: 'Traffic report unavailable' }, 500);
  }
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);

    if (url.pathname === ACCESSIBLE_JAPAN_TRAFFIC_PATH) {
      if (request.method !== 'GET') {
        return reportResponse({ success: false, error: 'Method not allowed' }, 405);
      }
      return getTrafficReport(request, env);
    }

    if (url.pathname.replace(/\/$/, '') === ACCESSIBLE_JAPAN_TRACKED_PATH) {
      if (request.method !== 'GET') {
        return new Response('Method not allowed', { status: 405 });
      }
      schedule(context, recordTraffic(
        env,
        request,
        'tracked_click',
        { source: 'accessible_japan', medium: 'cpc' },
      ));
      return new Response(null, {
        status: 302,
        headers: {
          Location: buildTrackedDestination(url).toString(),
          'Cache-Control': 'private, no-store, max-age=0',
          'Referrer-Policy': 'no-referrer',
          'X-Robots-Tag': 'noindex, nofollow, noarchive',
        },
      });
    }

    if (url.pathname.startsWith('/api/')) {
      return fetch(buildApiRequest(request));
    }

    if (isTrackedFormRequest(request, url) && !isPrefetch(request)) {
      schedule(context, recordTraffic(env, request, 'form_arrival', classifyArrival(request, url)));
    }

    const surveyPath = url.pathname === '/public-form'
      ? CUSTOM_FORM_PATHS.get(url.searchParams.get('id'))
      : null;
    if (surveyPath) {
      const assetUrl = new URL(surveyPath, url);
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    return env.ASSETS.fetch(request);
  },
};
