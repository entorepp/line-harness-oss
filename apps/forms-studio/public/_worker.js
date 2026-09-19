const API_ORIGIN = 'https://line-flattravel.flat-travel.workers.dev';
const ACCESSIBLE_JAPAN_FORM_ID = '9ab583b2-e42e-4ca2-bcb9-13a3c59f5477';
const ACCESSIBLE_JAPAN_TRAFFIC_PATH = '/api/shared-reports/accessible-japan-traffic';
const ACCESSIBLE_JAPAN_TRACKED_PATH = '/go/accessible-japan';
const ACCESSIBLE_JAPAN_SESSION_EVENT_PATH = '/api/form-traffic/events';
const ACCESSIBLE_JAPAN_SESSION_COOKIE = 'aft_session';
const ACCESSIBLE_JAPAN_SESSION_MAX_AGE = 30 * 60;
const ACCESSIBLE_JAPAN_FIELD_INDEX = new Map([
  ['first_name', 1],
  ['last_name', 2],
  ['email', 3],
  ['hotel_interest', 4],
  ['hotel_match_preference', 5],
  ['hotel_grade', 6],
  ['travellers', 7],
  ['room_count', 8],
  ['bed_type', 9],
  ['dates_decided', 10],
  ['city_schedule', 11],
  ['preferred_cities', 12],
  ['approximate_timing', 13],
  ['approximate_duration', 14],
  ['notes', 15],
]);
const ACCESSIBLE_JAPAN_SOURCE_VALUES = new Set([
  'accessiblejapan',
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
  const targetRequest = new Request(targetUrl.toString(), request);
  const headers = new Headers(targetRequest.headers);

  headers.delete('host');
  const cookies = (headers.get('cookie') || '')
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => value.split('=', 1)[0] !== ACCESSIBLE_JAPAN_SESSION_COOKIE);
  if (cookies.length > 0) headers.set('cookie', cookies.join('; '));
  else headers.delete('cookie');

  return new Request(targetRequest, {
    headers,
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

function hasAccessibleJapanHotelContext(url) {
  return [
    'source_hotel_name',
    'hotel_name',
    'prefill_Hotel Name',
    'prefill_hotel_name',
    'prefill_Hotel_Name',
    'source_hotel_slug',
    'hotel_slug',
    'hotel',
  ].some((key) => (url.searchParams.get(key) || '').trim());
}

function getCountryCode(request) {
  const testCountry = request.headers.get('X-Flatcare-Traffic-Test') === '1'
    ? request.headers.get('X-Flatcare-Traffic-Test-Country')
    : null;
  const value = String(testCountry || request.cf?.country || request.headers.get('CF-IPCountry') || '')
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(value) && value !== 'XX' ? value : null;
}

function normalizeCampaign(value) {
  const campaign = String(value || '').trim().toLowerCase().replace(/-/g, '_');
  if (['hotel_detail', 'accessible_japan_forms', 'agent_listing'].includes(campaign)) return campaign;
  return campaign ? 'other' : 'unknown';
}

function normalizeSourcePageKey(url, keys = [
    'source_hotel_slug',
    'hotel_slug',
    'hotel',
    'source_hotel_name',
    'hotel_name',
    'prefill_Hotel Name',
    'prefill_hotel_name',
    'prefill_Hotel_Name',
  ]) {
  for (const key of keys) {
    const normalized = String(url.searchParams.get(key) || '')
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 96);
    if (normalized) return normalized;
  }
  return null;
}

function classifyArrival(request, url) {
  const countryCode = getCountryCode(request);
  const utmSource = (url.searchParams.get('utm_source') || '').trim().toLowerCase();
  if (ACCESSIBLE_JAPAN_SOURCE_VALUES.has(utmSource)) {
    const utmMedium = (url.searchParams.get('utm_medium') || '').trim().toLowerCase();
    return {
      source: 'accessible_japan',
      medium: ['cpc', 'cta'].includes(utmMedium) ? utmMedium : 'referral',
      campaign: normalizeCampaign(url.searchParams.get('utm_campaign')),
      sourcePageKey: normalizeSourcePageKey(url, ['utm_content']),
      attributionMethod: 'utm',
      countryCode,
    };
  }
  if (utmSource) {
    return {
      source: 'other', medium: 'other', campaign: 'other', sourcePageKey: null,
      attributionMethod: 'explicit_other', countryCode,
    };
  }
  if (!utmSource && hasAccessibleJapanHotelContext(url)) {
    return {
      source: 'accessible_japan',
      medium: 'cta',
      campaign: normalizeCampaign(url.searchParams.get('utm_campaign')),
      sourcePageKey: normalizeSourcePageKey(url),
      attributionMethod: 'hotel_query',
      countryCode,
    };
  }

  try {
    const referrer = new URL(request.headers.get('Referer') || '');
    if (['http:', 'https:'].includes(referrer.protocol) && isAccessibleJapanHost(referrer.hostname)) {
      return {
        source: 'accessible_japan',
        medium: 'referral',
        campaign: 'unknown',
        sourcePageKey: null,
        attributionMethod: 'referrer',
        countryCode,
      };
    }
    if (referrer.protocol === 'http:' || referrer.protocol === 'https:') {
      return {
        source: 'other', medium: 'other', campaign: 'other', sourcePageKey: null,
        attributionMethod: 'other_referrer', countryCode,
      };
    }
  } catch { /* Missing or invalid referrers remain direct. */ }

  if (countryCode && countryCode !== 'JP') {
    return {
      source: 'accessible_japan',
      medium: 'referral',
      campaign: 'unknown',
      sourcePageKey: null,
      attributionMethod: 'non_jp_inferred',
      countryCode,
    };
  }

  return {
    source: 'direct', medium: 'direct', campaign: 'unknown', sourcePageKey: null,
    attributionMethod: 'direct', countryCode,
  };
}

function isTestRequest(request, url = new URL(request.url)) {
  return request.headers.get('X-Flatcare-Traffic-Test') === '1'
    || url.searchParams.get('aj_test') === '1';
}

function recordTraffic(env, request, eventType, attribution, testOverride = null) {
  if (!env.FORM_TRAFFIC_DB?.prepare) return Promise.resolve();

  const isTest = testOverride === null
    ? (isTestRequest(request) ? 1 : 0)
    : Number(Boolean(testOverride));
  const countryCode = attribution.countryCode ?? getCountryCode(request);
  const legacyMedium = attribution.medium === 'cta' ? 'referral' : attribution.medium;
  return env.FORM_TRAFFIC_DB.prepare(`
    INSERT INTO accessible_japan_form_traffic
      (id, form_id, event_type, source, medium, country_code, attribution_method, is_test, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    crypto.randomUUID(),
    ACCESSIBLE_JAPAN_FORM_ID,
    eventType,
    attribution.source,
    legacyMedium,
    countryCode,
    attribution.attributionMethod || 'unknown',
    isTest,
  ).run();
}

function readSessionCookie(request) {
  const header = request.headers.get('Cookie') || '';
  for (const pair of header.split(';')) {
    const [name, ...rest] = pair.trim().split('=');
    if (name !== ACCESSIBLE_JAPAN_SESSION_COOKIE) continue;
    const value = rest.join('=');
    return /^[0-9a-f-]{36}$/i.test(value) ? value : null;
  }
  return null;
}

function buildSessionCookie(value) {
  return `${ACCESSIBLE_JAPAN_SESSION_COOKIE}=${value}; Max-Age=${ACCESSIBLE_JAPAN_SESSION_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

async function getSession(request, url, forceNew = false) {
  const existing = readSessionCookie(request);
  const raw = forceNew || !existing ? crypto.randomUUID() : existing;
  return {
    raw,
    id: await sha256(raw),
    isTest: isTestRequest(request, url) ? 1 : 0,
  };
}

function withSessionCookie(response, rawSessionId) {
  const headers = new Headers(response.headers);
  headers.set('Set-Cookie', buildSessionCookie(rawSessionId));
  headers.set('Cache-Control', 'private, no-store, max-age=0');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function recordSessionArrival(env, session, attribution) {
  if (!env.FORM_TRAFFIC_DB?.prepare) return;
  const insertSession = env.FORM_TRAFFIC_DB.prepare(`
    INSERT OR IGNORE INTO accessible_japan_form_sessions
      (session_id, form_id, source, medium, campaign, source_page_key, country_code,
       attribution_method, is_test, started_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).bind(
    session.id,
    ACCESSIBLE_JAPAN_FORM_ID,
    attribution.source,
    attribution.medium,
    attribution.campaign || 'unknown',
    attribution.sourcePageKey || null,
    attribution.countryCode || null,
    attribution.attributionMethod || 'unknown',
    session.isTest,
  ).run();
  await insertSession;
  const touchSession = env.FORM_TRAFFIC_DB.prepare(`
    UPDATE accessible_japan_form_sessions
    SET last_seen_at = datetime('now')
    WHERE session_id = ? AND form_id = ?
  `).bind(session.id, ACCESSIBLE_JAPAN_FORM_ID).run();
  const insertEvent = env.FORM_TRAFFIC_DB.prepare(`
    INSERT OR IGNORE INTO accessible_japan_form_session_events
      (id, session_id, form_id, event_type, field_key, field_index, is_test, occurred_at)
    VALUES (?, ?, ?, 'form_arrival', '', NULL, ?, datetime('now'))
  `).bind(crypto.randomUUID(), session.id, ACCESSIBLE_JAPAN_FORM_ID, session.isTest).run();
  await Promise.all([touchSession, insertEvent]);
}

async function recordSessionEvent(env, sessionId, eventType, fieldKey = '') {
  if (!env.FORM_TRAFFIC_DB?.prepare || !sessionId) return;
  const fieldIndex = fieldKey ? ACCESSIBLE_JAPAN_FIELD_INDEX.get(fieldKey) : null;
  if (eventType === 'form_progress' && !fieldIndex) return;
  await Promise.all([
    env.FORM_TRAFFIC_DB.prepare(`
      UPDATE accessible_japan_form_sessions
      SET last_seen_at = datetime('now')
      WHERE session_id = ? AND form_id = ?
    `).bind(sessionId, ACCESSIBLE_JAPAN_FORM_ID).run(),
    env.FORM_TRAFFIC_DB.prepare(`
      INSERT OR IGNORE INTO accessible_japan_form_session_events
        (id, session_id, form_id, event_type, field_key, field_index, is_test, occurred_at)
      SELECT ?, session_id, form_id, ?, ?, ?, is_test, datetime('now')
      FROM accessible_japan_form_sessions
      WHERE session_id = ? AND form_id = ?
    `).bind(
      crypto.randomUUID(), eventType, fieldKey, fieldIndex,
      sessionId, ACCESSIBLE_JAPAN_FORM_ID,
    ).run(),
  ]);
}

async function recordSessionSubmit(env, sessionId) {
  if (!env.FORM_TRAFFIC_DB?.prepare || !sessionId) return;
  await Promise.all([
    env.FORM_TRAFFIC_DB.prepare(`
      UPDATE accessible_japan_form_sessions
      SET submitted_at = COALESCE(submitted_at, datetime('now')), last_seen_at = datetime('now')
      WHERE session_id = ? AND form_id = ?
    `).bind(sessionId, ACCESSIBLE_JAPAN_FORM_ID).run(),
    env.FORM_TRAFFIC_DB.prepare(`
      INSERT OR IGNORE INTO accessible_japan_form_session_events
        (id, session_id, form_id, event_type, field_key, field_index, is_test, occurred_at)
      SELECT ?, session_id, form_id, 'form_submit', '', NULL, is_test, datetime('now')
      FROM accessible_japan_form_sessions
      WHERE session_id = ? AND form_id = ?
    `).bind(crypto.randomUUID(), sessionId, ACCESSIBLE_JAPAN_FORM_ID).run(),
  ]);
}

async function sessionIdFromRequest(request) {
  const raw = readSessionCookie(request);
  return raw ? sha256(raw) : null;
}

async function handleSessionEvent(request, env) {
  const rawSessionId = readSessionCookie(request);
  if (!rawSessionId) return new Response(null, { status: 204 });
  const sessionId = await sha256(rawSessionId);
  const text = await request.text();
  if (text.length > 1024) return reportResponse({ success: false, error: 'Payload too large' }, 413);
  let payload;
  try { payload = JSON.parse(text); } catch { return reportResponse({ success: false, error: 'Invalid JSON' }, 400); }
  if (!['form_start', 'form_progress'].includes(payload?.eventType)) {
    return reportResponse({ success: false, error: 'Invalid event' }, 400);
  }
  const eventType = payload.eventType;
  const fieldKey = eventType === 'form_progress' && typeof payload?.fieldKey === 'string'
    ? payload.fieldKey
    : '';
  if (eventType === 'form_progress' && !ACCESSIBLE_JAPAN_FIELD_INDEX.has(fieldKey)) {
    return reportResponse({ success: false, error: 'Invalid field' }, 400);
  }
  await recordSessionEvent(env, sessionId, eventType, fieldKey);
  return withSessionCookie(new Response(null, { status: 204 }), rawSessionId);
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
    const [totals, daily, countries, sessionTotals, sessionDaily, channels, sourcePages, fieldProgress, fieldDropoffs] = await Promise.all([
      env.FORM_TRAFFIC_DB.prepare(`
        SELECT
          MIN(occurred_at) AS first_recorded_at,
          SUM(CASE WHEN event_type = 'form_arrival' THEN 1 ELSE 0 END) AS total_arrivals,
          SUM(CASE WHEN event_type = 'form_arrival' AND source = 'accessible_japan' AND attribution_method = 'utm' THEN 1 ELSE 0 END) AS accessible_japan_arrivals,
          SUM(CASE WHEN event_type = 'form_arrival' AND source = 'accessible_japan' AND attribution_method = 'utm' THEN 1 ELSE 0 END) AS confirmed_accessible_japan_arrivals,
          SUM(CASE WHEN event_type = 'form_arrival' AND attribution_method = 'non_jp_inferred' THEN 1 ELSE 0 END) AS inferred_accessible_japan_arrivals,
          SUM(CASE WHEN event_type = 'tracked_click' THEN 1 ELSE 0 END) AS tracked_clicks
        FROM accessible_japan_form_traffic
        WHERE form_id = ? AND is_test = 0
      `).bind(ACCESSIBLE_JAPAN_FORM_ID).first(),
      env.FORM_TRAFFIC_DB.prepare(`
        SELECT
          date(occurred_at, '+9 hours') AS date,
          SUM(CASE WHEN event_type = 'form_arrival' THEN 1 ELSE 0 END) AS total_arrivals,
          SUM(CASE WHEN event_type = 'form_arrival' AND source = 'accessible_japan' AND attribution_method = 'utm' THEN 1 ELSE 0 END) AS accessible_japan_arrivals,
          SUM(CASE WHEN event_type = 'form_arrival' AND source = 'accessible_japan' AND attribution_method = 'utm' THEN 1 ELSE 0 END) AS confirmed_accessible_japan_arrivals,
          SUM(CASE WHEN event_type = 'form_arrival' AND attribution_method = 'non_jp_inferred' THEN 1 ELSE 0 END) AS inferred_accessible_japan_arrivals,
          SUM(CASE WHEN event_type = 'tracked_click' THEN 1 ELSE 0 END) AS tracked_clicks
        FROM accessible_japan_form_traffic
        WHERE form_id = ? AND is_test = 0
        GROUP BY date(occurred_at, '+9 hours')
        ORDER BY date DESC
        LIMIT 366
      `).bind(ACCESSIBLE_JAPAN_FORM_ID).all(),
      env.FORM_TRAFFIC_DB.prepare(`
        SELECT
          country_code,
          SUM(CASE WHEN event_type = 'form_arrival' THEN 1 ELSE 0 END) AS total_arrivals,
          SUM(CASE WHEN event_type = 'form_arrival' AND source = 'accessible_japan' AND attribution_method = 'utm' THEN 1 ELSE 0 END) AS accessible_japan_arrivals,
          SUM(CASE WHEN event_type = 'form_arrival' AND attribution_method = 'non_jp_inferred' THEN 1 ELSE 0 END) AS inferred_accessible_japan_arrivals
        FROM accessible_japan_form_traffic
        WHERE form_id = ? AND is_test = 0 AND country_code IS NOT NULL
        GROUP BY country_code
        ORDER BY total_arrivals DESC, country_code ASC
      `).bind(ACCESSIBLE_JAPAN_FORM_ID).all(),
      env.FORM_TRAFFIC_DB.prepare(`
        SELECT
          MIN(started_at) AS first_session_recorded_at,
          COUNT(*) AS total_sessions,
          SUM(CASE WHEN source = 'accessible_japan' AND attribution_method = 'utm' THEN 1 ELSE 0 END) AS accessible_japan_sessions,
          SUM(CASE WHEN source = 'accessible_japan' AND attribution_method = 'utm' AND EXISTS (
            SELECT 1 FROM accessible_japan_form_session_events e
            WHERE e.session_id = accessible_japan_form_sessions.session_id
              AND e.event_type = 'form_start'
          ) THEN 1 ELSE 0 END) AS accessible_japan_started_sessions,
          SUM(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS submitted_sessions,
          SUM(CASE WHEN submitted_at IS NULL AND last_seen_at > datetime('now', '-30 minutes') THEN 1 ELSE 0 END) AS active_sessions,
          SUM(CASE WHEN submitted_at IS NULL AND last_seen_at <= datetime('now', '-30 minutes') THEN 1 ELSE 0 END) AS abandoned_sessions,
          SUM(CASE WHEN source = 'accessible_japan' AND attribution_method = 'utm' AND submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS accessible_japan_submitted_sessions,
          SUM(CASE WHEN source = 'accessible_japan' AND attribution_method = 'utm' AND submitted_at IS NULL AND last_seen_at > datetime('now', '-30 minutes') THEN 1 ELSE 0 END) AS accessible_japan_active_sessions,
          SUM(CASE WHEN source = 'accessible_japan' AND attribution_method = 'utm' AND submitted_at IS NULL AND last_seen_at <= datetime('now', '-30 minutes') THEN 1 ELSE 0 END) AS accessible_japan_abandoned_sessions
        FROM accessible_japan_form_sessions
        WHERE form_id = ? AND is_test = 0
      `).bind(ACCESSIBLE_JAPAN_FORM_ID).first(),
      env.FORM_TRAFFIC_DB.prepare(`
        SELECT
          date(started_at, '+9 hours') AS date,
          COUNT(*) AS total_sessions,
          SUM(CASE WHEN source = 'accessible_japan' AND attribution_method = 'utm' THEN 1 ELSE 0 END) AS accessible_japan_sessions,
          SUM(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS submitted_sessions,
          SUM(CASE WHEN source = 'accessible_japan' AND attribution_method = 'utm' AND submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS accessible_japan_submitted_sessions,
          SUM(CASE WHEN source = 'accessible_japan' AND attribution_method = 'utm' AND submitted_at IS NULL AND last_seen_at > datetime('now', '-30 minutes') THEN 1 ELSE 0 END) AS accessible_japan_active_sessions,
          SUM(CASE WHEN source = 'accessible_japan' AND attribution_method = 'utm' AND submitted_at IS NULL AND last_seen_at <= datetime('now', '-30 minutes') THEN 1 ELSE 0 END) AS accessible_japan_abandoned_sessions
        FROM accessible_japan_form_sessions
        WHERE form_id = ? AND is_test = 0
          AND source = 'accessible_japan' AND attribution_method = 'utm'
        GROUP BY date(started_at, '+9 hours')
        ORDER BY date DESC
        LIMIT 366
      `).bind(ACCESSIBLE_JAPAN_FORM_ID).all(),
      env.FORM_TRAFFIC_DB.prepare(`
        SELECT source, medium, campaign,
          COUNT(*) AS sessions,
          SUM(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS submitted_sessions
        FROM accessible_japan_form_sessions
        WHERE form_id = ? AND is_test = 0
          AND source = 'accessible_japan' AND attribution_method = 'utm'
        GROUP BY source, medium, campaign
        ORDER BY sessions DESC, source, medium, campaign
      `).bind(ACCESSIBLE_JAPAN_FORM_ID).all(),
      env.FORM_TRAFFIC_DB.prepare(`
        SELECT source_page_key,
          COUNT(*) AS sessions,
          SUM(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS submitted_sessions
        FROM accessible_japan_form_sessions
        WHERE form_id = ? AND is_test = 0
          AND source = 'accessible_japan' AND attribution_method = 'utm'
          AND source_page_key IS NOT NULL
        GROUP BY source_page_key
        ORDER BY sessions DESC, source_page_key
        LIMIT 100
      `).bind(ACCESSIBLE_JAPAN_FORM_ID).all(),
      env.FORM_TRAFFIC_DB.prepare(`
        SELECT e.field_index, e.field_key, COUNT(DISTINCT e.session_id) AS reached_sessions
        FROM accessible_japan_form_session_events e
        INNER JOIN accessible_japan_form_sessions s ON s.session_id = e.session_id
        WHERE e.form_id = ? AND e.is_test = 0 AND e.event_type = 'form_progress'
          AND s.source = 'accessible_japan' AND s.attribution_method = 'utm'
        GROUP BY e.field_index, e.field_key
        ORDER BY field_index ASC
      `).bind(ACCESSIBLE_JAPAN_FORM_ID).all(),
      env.FORM_TRAFFIC_DB.prepare(`
        WITH ranked AS (
          SELECT e.session_id, e.field_index, e.field_key,
            ROW_NUMBER() OVER (
              PARTITION BY e.session_id
              ORDER BY e.occurred_at DESC, e.id DESC
            ) AS position
          FROM accessible_japan_form_session_events e
          INNER JOIN accessible_japan_form_sessions s ON s.session_id = e.session_id
          WHERE e.form_id = ? AND e.is_test = 0 AND e.event_type = 'form_progress'
            AND s.source = 'accessible_japan' AND s.attribution_method = 'utm'
            AND s.submitted_at IS NULL
            AND s.last_seen_at <= datetime('now', '-30 minutes')
        )
        SELECT field_index, field_key, COUNT(*) AS dropoff_sessions
        FROM ranked
        WHERE position = 1
        GROUP BY field_index, field_key
        ORDER BY field_index ASC
      `).bind(ACCESSIBLE_JAPAN_FORM_ID).all(),
    ]);

    const totalSessions = asCount(sessionTotals?.total_sessions);
    const accessibleJapanSessions = asCount(sessionTotals?.accessible_japan_sessions);
    const accessibleJapanStartedSessions = asCount(sessionTotals?.accessible_japan_started_sessions);
    const submittedSessions = asCount(sessionTotals?.submitted_sessions);
    const activeSessions = asCount(sessionTotals?.active_sessions);
    const abandonedSessions = asCount(sessionTotals?.abandoned_sessions);
    const accessibleJapanSubmittedSessions = asCount(sessionTotals?.accessible_japan_submitted_sessions);
    const accessibleJapanActiveSessions = asCount(sessionTotals?.accessible_japan_active_sessions);
    const accessibleJapanAbandonedSessions = asCount(sessionTotals?.accessible_japan_abandoned_sessions);
    const settledSessions = submittedSessions + abandonedSessions;
    const accessibleJapanSettledSessions = accessibleJapanSubmittedSessions + accessibleJapanAbandonedSessions;
    const fieldDropoffByKey = new Map((fieldDropoffs.results || []).map((row) => [
      row.field_key,
      asCount(row.dropoff_sessions),
    ]));
    const fieldLabelByKey = new Map([
      ['first_name', 'First / given name'],
      ['last_name', 'Last / family name'],
      ['email', 'Email address'],
      ['hotel_interest', 'What appealed to you about the hotel?'],
      ['hotel_match_preference', 'How should we use that hotel?'],
      ['hotel_grade', 'Preferred hotel grade'],
      ['travellers', 'Number of travellers'],
      ['room_count', 'Number of rooms'],
      ['bed_type', 'Preferred bed type'],
      ['dates_decided', 'Have you decided your travel dates?'],
      ['city_schedule', 'Cities and dates'],
      ['preferred_cities', 'Cities you would like to visit'],
      ['approximate_timing', 'Approximate travel timing'],
      ['approximate_duration', 'Approximate trip duration'],
      ['notes', 'Additional notes'],
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
        confirmedAccessibleJapanArrivals: asCount(totals?.confirmed_accessible_japan_arrivals),
        inferredAccessibleJapanArrivals: asCount(totals?.inferred_accessible_japan_arrivals),
        trackedClicks: asCount(totals?.tracked_clicks),
        trackedUrl: new URL(ACCESSIBLE_JAPAN_TRACKED_PATH, request.url).origin
          + ACCESSIBLE_JAPAN_TRACKED_PATH,
        formUrl: new URL(`/public-form?id=${ACCESSIBLE_JAPAN_FORM_ID}`, request.url).toString(),
        daily: (daily.results || []).map((row) => ({
          date: row.date,
          totalArrivals: asCount(row.total_arrivals),
          accessibleJapanArrivals: asCount(row.accessible_japan_arrivals),
          confirmedAccessibleJapanArrivals: asCount(row.confirmed_accessible_japan_arrivals),
          inferredAccessibleJapanArrivals: asCount(row.inferred_accessible_japan_arrivals),
          trackedClicks: asCount(row.tracked_clicks),
        })),
        countries: (countries.results || []).map((row) => ({
          countryCode: row.country_code,
          totalArrivals: asCount(row.total_arrivals),
          accessibleJapanArrivals: asCount(row.accessible_japan_arrivals),
          inferredAccessibleJapanArrivals: asCount(row.inferred_accessible_japan_arrivals),
        })),
        sessions: {
          firstRecordedAt: sessionTotals?.first_session_recorded_at
            ? `${String(sessionTotals.first_session_recorded_at).replace(' ', 'T')}Z`
            : null,
          total: totalSessions,
          submitted: submittedSessions,
          active: activeSessions,
          abandoned: abandonedSessions,
          conversionRate: settledSessions > 0 ? submittedSessions / settledSessions : 0,
          dropoffRate: settledSessions > 0 ? abandonedSessions / settledSessions : 0,
          accessibleJapan: accessibleJapanSessions,
          accessibleJapanStarted: accessibleJapanStartedSessions,
          accessibleJapanNotStarted: Math.max(0, accessibleJapanSessions - accessibleJapanStartedSessions),
          accessibleJapanSubmitted: accessibleJapanSubmittedSessions,
          accessibleJapanActive: accessibleJapanActiveSessions,
          accessibleJapanAbandoned: accessibleJapanAbandonedSessions,
          accessibleJapanConversionRate: accessibleJapanSettledSessions > 0
            ? accessibleJapanSubmittedSessions / accessibleJapanSettledSessions
            : 0,
          accessibleJapanDropoffRate: accessibleJapanSettledSessions > 0
            ? accessibleJapanAbandonedSessions / accessibleJapanSettledSessions
            : 0,
        },
        sessionDaily: (sessionDaily.results || []).map((row) => ({
          date: row.date,
          total: asCount(row.total_sessions),
          submitted: asCount(row.submitted_sessions),
          accessibleJapan: asCount(row.accessible_japan_sessions),
          accessibleJapanSubmitted: asCount(row.accessible_japan_submitted_sessions),
          accessibleJapanActive: asCount(row.accessible_japan_active_sessions),
          accessibleJapanAbandoned: asCount(row.accessible_japan_abandoned_sessions),
        })),
        channels: (channels.results || []).map((row) => ({
          source: row.source,
          medium: row.medium,
          campaign: row.campaign,
          sessions: asCount(row.sessions),
          submitted: asCount(row.submitted_sessions),
        })),
        sourcePages: (sourcePages.results || []).map((row) => ({
          sourcePageKey: row.source_page_key,
          sessions: asCount(row.sessions),
          submitted: asCount(row.submitted_sessions),
        })),
        fieldFunnel: (fieldProgress.results || []).map((row) => ({
          fieldIndex: asCount(row.field_index),
          fieldKey: row.field_key,
          fieldLabel: fieldLabelByKey.get(row.field_key) || row.field_key,
          reachedSessions: asCount(row.reached_sessions),
          dropoffSessions: fieldDropoffByKey.get(row.field_key) || 0,
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

    if (url.pathname === ACCESSIBLE_JAPAN_SESSION_EVENT_PATH) {
      if (request.method !== 'POST') {
        return reportResponse({ success: false, error: 'Method not allowed' }, 405);
      }
      return handleSessionEvent(request, env);
    }

    if (url.pathname.replace(/\/$/, '') === ACCESSIBLE_JAPAN_TRACKED_PATH) {
      if (request.method !== 'GET') {
        return new Response('Method not allowed', { status: 405 });
      }
      schedule(context, recordTraffic(
        env,
        request,
        'tracked_click',
        {
          source: 'accessible_japan', medium: 'cpc', campaign: 'accessible_japan_forms',
          sourcePageKey: null, attributionMethod: 'tracked_link',
        },
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

    const isAccessibleJapanSubmit = request.method === 'POST'
      && url.pathname === `/api/forms/${ACCESSIBLE_JAPAN_FORM_ID}/submit`;
    if (isAccessibleJapanSubmit) {
      const sessionId = await sessionIdFromRequest(request);
      const response = await fetch(buildApiRequest(request));
      const result = response.ok
        ? await response.clone().json().catch(() => null)
        : null;
      if (result?.success === true && sessionId) {
        schedule(context, recordSessionSubmit(env, sessionId));
      }
      return response;
    }

    if (url.pathname.startsWith('/api/')) {
      return fetch(buildApiRequest(request));
    }

    if (isTrackedFormRequest(request, url) && !isPrefetch(request)) {
      const attribution = classifyArrival(request, url);
      const session = await getSession(request, url, isTestRequest(request, url));
      schedule(context, Promise.all([
        recordTraffic(env, request, 'form_arrival', attribution, session.isTest),
        recordSessionArrival(env, session, attribution),
      ]));
      const surveyPath = CUSTOM_FORM_PATHS.get(url.searchParams.get('id'));
      const assetUrl = surveyPath ? new URL(surveyPath, url) : url;
      const response = await env.ASSETS.fetch(new Request(assetUrl, request));
      return withSessionCookie(response, session.raw);
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
