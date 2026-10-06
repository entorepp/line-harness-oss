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
    .filter((value) => ![ACCESSIBLE_JAPAN_SESSION_COOKIE, 'af_visit'].includes(value.split('=', 1)[0]));
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

const formsWorker = {
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
// BEGIN GENERATED ACQUISITION FUNNEL
// Shared source. Generated copies in both runtimes must be byte-identical.
function createAcquisitionFunnel(options) {
  const prefix = '/__acquisition';
  const uuid = value => /^[a-f0-9-]{36}$/i.test(value || '');
  const token = value => /^[a-z0-9][a-z0-9_.-]{0,95}$/i.test(value || '') && !/\d{7}/.test(value) ? value.toLowerCase() : '';
  const sourceOf = value => {
    const s = token(value);
    return ['accessiblejapan','accessible_japan','accessible-japan','accessible-japan.com','www.accessible-japan.com'].includes(s) ? 'accessible_japan' : s;
  };
  const response = (body, status=200) => Response.json(body, {status, headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex','Referrer-Policy':'no-referrer'}});
  const dbOf = env => env.ACQUISITION_DB || env.FORM_TRAFFIC_DB;
  const cookie = request => (request.headers.get('Cookie') || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('af_visit='))?.slice(9) || '';
  const enabled = (request, env) => env.FUNNEL_V1_ENABLED === 'true' && new URL(request.url).origin === options.origin;
  const safePath = pathname => options.surface === 'form' ? '/public-form' : /^\/(en|tc|kr|sc)(\/[a-z0-9_-]+){0,5}\/?$/i.test(pathname) && !/\d{7}|@|case|receipt|share|partner/i.test(pathname) ? pathname.slice(0,180) : '/other';
  const allowedEvents = new Set(['page_visible','interaction','form_start','field_visible','field_complete','field_interaction','submit_attempt','validation_error','submit_error','link_click']);
  const formFields = new Set(['first_name','last_name','email','hotel_interest','hotel_match_preference','hotel_grade','travellers','room_count','bed_type','dates_decided','city_schedule','preferred_cities','approximate_timing','approximate_duration','notes']);
  const placements = new Set(['top','mid','bottom','inline','sticky','sidebar']);
  function entryContext(url) {
    const content=token(url.searchParams.get('utm_content'));
    return {
      page:token(url.searchParams.get('aj_page')) || (!placements.has(content)?content:''),
      placement:placements.has(url.searchParams.get('aj_placement'))?url.searchParams.get('aj_placement'):placements.has(content)?content:'',
      variant:token(url.searchParams.get('aj_variant')),
    };
  }
  function visitCookie(id) {return `af_visit=${id}; Max-Age=1800; Path=/; HttpOnly; Secure; SameSite=Lax`;}
  async function recordReceipt(db,page,body) {
    const receipt=options.receipt?.(body);
    // Only bounded backend-issued IDs, hashed before persistence. Never accept
    // a receipt from the browser events endpoint or store the response body.
    if(typeof receipt!=='string'||!(/^[a-f0-9-]{36}$/i.test(receipt)||/^FTQ?-\d{8}-[A-Z0-9]{8}$/.test(receipt)))return;
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(options.surface+':'+receipt));
    const hash=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
    await db.prepare('INSERT OR IGNORE INTO acquisition_conversion_receipts(receipt_hash,visit_id,page_id,surface) VALUES (?,?,?,?)').bind(hash,page.visit_id,page.id,options.surface).run();
  }
  const allowedSteps = new Set(['first_name','last_name','email','hotel_interest','hotel_match_preference','hotel_grade','travellers','room_count','bed_type','dates_decided','city_schedule','preferred_cities','approximate_timing','approximate_duration','notes','places','experiences','trip_shape','support','final_note','contact','journey','search','navigation','other','scroll','click','keyboard','touch','form_link','site_link','external_link','internal_link']);
  // Both client and server apply this projection. No arbitrary text, URLs or answer values.
  function cleanAction(input) {
    if (!input || typeof input !== 'object') return null;
    const events=['search_submit','search_change','search_results','control_click','field_focus','price_display','step_view','page_hidden','page_resume'];
    if(!events.includes(input.event))return null;
    const result={event:input.event};
    const d=input.data||{},data={};
    const enums={
      screen:['home','journey_list','journey_detail','extra_support','traveller_details','tailor_made','other'],
      button_id:['search','areas_open','areas_close','areas_clear','area_select','date_open','date_select','month_select','date_mode','date_previous','date_next','date_clear','party_select','explore_journey','gate_continue','gate_close','gate_previous','gate_next','adjust_search','tailor_no_match','back_itinerary','next_extra_support','next_traveller_details','review_request','request_hotel_quote','price_retry','hotel_choose','room_choose','hotel_details','activity_details','quickview_close','tailor_next','tailor_back','tailor_step','contact_whatsapp','contact_email','contact_instagram','contact_messenger','nav_home','nav_journeys','nav_tailor','nav_hotels','nav_destinations','nav_guides','nav_other','menu','consent','other_control'],
      form_id:['journey_search','journey_gate'],
      field_id:['areas','travel_month','travel_date','party','contact','other'],
      date_mode:['exact','flexible','any'],party_size_bucket:['1','2','3','4','5_plus','any'],
      price_state:['from_price','priced','loading','request','date','unavailable'],
      price_basis:['per_person_from','party_total'],
      list_id:['home_featured','catalogue','search_results'],
    };
    for(const [key,values] of Object.entries(enums))if(values.includes(d[key]))data[key]=d[key];
    // Product IDs are public catalogue identities, not user/customer identifiers.
    if(/^c\d{1,3}(?:-osaka)?$/i.test(d.journey_id||''))data.journey_id=d.journey_id.toLowerCase();
    if(/^(20\d{2})-(0[1-9]|1[0-2])$/.test(d.travel_month||''))data.travel_month=d.travel_month;
    const areas=new Set(['tokyo','kyoto','osaka','hakone','fuji','fuji-hakone','hiroshima','nara','kanazawa','takayama','nikko','nagoya','kobe','fukuoka','sapporo','okinawa','kamakura','yokohama','himeji','okayama','naoshima','miyajima','beppu','yufuin','nagasaki','kumamoto','kagoshima','ise','toba','wakayama','koyasan','shirakawa-go','matsumoto','nagano','karuizawa','toyama','fukui','shizuoka','atami','izu','kawaguchiko','shiga','otsu','tsuruga','gifu','sendai','aomori','aichi','ehime','gunma','hokkaido','hyogo','ibaraki','ishikawa','iwate','kagawa','kochi','miyagi','miyazaki','niigata','oita','saga','saitama','shimane','tochigi','tokushima','tottori','yamagata','yamaguchi','yamanashi']);
    if(Array.isArray(d.area_ids))data.area_ids=[...new Set(d.area_ids.filter(v=>areas.has(v)))].sort().slice(0,16);
    for(const [key,max] of Object.entries({result_count:200,item_position:200,price_jpy:100000000,render_revision:500,step_number:5}))if(Number.isInteger(d[key])&&d[key]>=0&&d[key]<=max)data[key]=d[key];
    if(data.price_jpy!==undefined&&!['from_price','priced'].includes(data.price_state))delete data.price_jpy;
    result.data=data;return result;
  }
  function siteDiagnostics(config,send) {
    let seq=0,scheduled=false,lastResults='',lastPrice='',revision=0;
    const started=Date.now(), focusSeen=new Set();
    const screen=()=>{const p=location.pathname||'';return /\/extra-support\/?$/.test(p)?'extra_support':/\/enquiry\/?$/.test(p)?'traveller_details':/\/journeys\/[^/]+/.test(p)?'journey_detail':/\/journeys\/?$/.test(p)?'journey_list':/\/tailor-made\/?$/.test(p)?'tailor_made':/^\/(en|tc|sc|kr)\/?$/.test(p)?'home':'other'};
    const journey=node=>node?.closest?.('[data-tour],[data-view-journey],[data-tour-id]')?.getAttribute('data-tour')||node?.closest?.('[data-view-journey]')?.getAttribute('data-view-journey')||String(node?.closest?.('a[href]')?.getAttribute('href')||location.pathname).match(/\/journeys\/(c\d{1,3}(?:-osaka)?)(?:[/?#]|$)/i)?.[1]||'';
    function record(event,data={}) {
      if(seq>=500)return;
      const action=cleanAction({event,data:{screen:screen(),...data}});if(!action)return;
      send({...action,id:crypto.randomUUID(),seq:++seq,elapsed_ms:Math.min(86400000,Math.max(0,Date.now()-started))});
    }
    function searchData(form) {
      form=form||document.querySelector('[data-journey-search],#tour-search-form');
      if(!form)return {};
      const val=name=>form.querySelector('[name="'+name+'"]')?.value||'';
      const exact=val('travelExactDate'),flex=val('travelMonth'),people=val('people');
      return {form_id:'journey_search',area_ids:Array.from(form.querySelectorAll('input[name="area"]:checked')).map(e=>e.value),date_mode:exact?'exact':flex?'flexible':'any',travel_month:(exact||flex).slice(0,7),party_size_bucket:people==='5+'?'5_plus':['1','2','3','4'].includes(people)?people:'any'};
    }
    const searchForm=el=>el?.closest?.('[data-journey-search],#tour-search-form');
    const field=el=>{if(searchForm(el))return ({area:'areas',travelMonth:'travel_month',travelExactDate:'travel_date',people:'party'})[el.name]||'other';return el?.closest?.('#mtf-inline-profile-form,[data-private-profile],[data-ftai-root]')?'contact':'other'};
    const buttons=[
      ['[data-journey-search] button[type="submit"],#tour-search-form button[type="submit"]','search'],
      ['#journey-area-trigger','areas_open'],['.mtf-area-popover-close,[data-close-journey-areas]','areas_close'],['[data-clear-journey-areas]','areas_clear'],['.mtf-area-option','area_select'],
      ['#travel-month-trigger','date_open'],['[data-travel-date],[data-gate-calendar-date]','date_select'],['[data-travel-month]','month_select'],['[data-timing-mode]','date_mode'],['#travel-period-previous','date_previous'],['#travel-period-next','date_next'],['#travel-month-clear','date_clear'],['#people,#gate-people','party_select'],
      ['[data-view-journey],[data-tour],a.fts-journey-card','explore_journey'],['#open-journey-from-gate','gate_continue'],['#close-search-gate,[data-close-search-gate]','gate_close'],['#gate-calendar-previous','gate_previous'],['#gate-calendar-next','gate_next'],['[data-adjust-search]','adjust_search'],['[data-tailor-made-no-match]','tailor_no_match'],
      ['[data-journey-step="1"]','back_itinerary'],['[data-journey-step="2"],[data-journey-action="extra-support"]','next_extra_support'],['[data-journey-step="3"],[data-journey-action="traveller-details"]','next_traveller_details'],['#mtf-inline-profile-form button[type="submit"],[data-journey-action="review-request"]','review_request'],['[data-journey-action="hotel-quote"]','request_hotel_quote'],['[data-retry-price],#retry-price,[data-retry-stay]','price_retry'],['[data-hotel-choice]','hotel_choose'],['[data-hotel-room-choice]','room_choose'],['[data-hotel-detail]','hotel_details'],['[data-one-day-tour]','activity_details'],['[data-close-modal],#close-modal','quickview_close'],
      ['[data-private-next]','tailor_next'],['[data-private-back]','tailor_back'],['[data-private-progress-step]','tailor_step'],['[data-contact-channel="whatsapp"]','contact_whatsapp'],['[data-contact-channel="email"]','contact_email'],['[data-contact-channel="instagram"]','contact_instagram'],['[data-contact-channel="messenger"]','contact_messenger'],['[data-flat-consent-choice],[data-flat-consent-settings]','consent'],['[data-menu-toggle],.fts-menu-toggle','menu']
    ];
    document.addEventListener('click',e=>{if(!e.isTrusted)return;const target=e.target;let id=buttons.find(([selector])=>target?.closest?.(selector))?.[1];
      if(!id){const a=target?.closest?.('a[href]');if(a){try{const p=new URL(a.href,location.href).pathname;id=/\/journeys\/c\d+/i.test(p)?'explore_journey':/\/journeys\/?$/.test(p)?'nav_journeys':/\/tailor-made\/?$/.test(p)?'nav_tailor':/\/accessible-hotels/.test(p)?'nav_hotels':/\/destinations/.test(p)?'nav_destinations':/\/travel-guides/.test(p)?'nav_guides':/^\/(en|tc|sc|kr)\/?$/.test(p)?'nav_home':'nav_other'}catch{}}}
      if(!id&&target?.closest?.('button,a[href],summary,[role="button"]'))id='other_control';
      if(id)record('control_click',{button_id:id,journey_id:journey(target)});
      if(id==='gate_continue'){const month=(document.querySelector('#gate-start-date')?.value||'').slice(0,7),party=document.querySelector('#gate-people')?.value;record('search_submit',{form_id:'journey_gate',date_mode:month?'exact':'any',travel_month:month,party_size_bucket:party==='5+'?'5_plus':party,journey_id:journey(target)})}
      // Run after UI handlers, but capture navigation submissions synchronously below.
      if(searchForm(target))setTimeout(()=>{record('search_change',searchData());schedule()},0);
    },true);
    document.addEventListener('focusin',e=>{if(!e.isTrusted||!e.target?.matches?.('input:not([type=hidden]),select,textarea'))return;const id=field(e.target),key=screen()+':'+id;if(focusSeen.has(key))return;focusSeen.add(key);record('field_focus',{field_id:id})},true);
    document.addEventListener('change',e=>{if(e.isTrusted&&searchForm(e.target))record('search_change',searchData())},true);
    document.addEventListener('submit',e=>{if(e.isTrusted&&searchForm(e.target))record('search_submit',searchData(e.target))},true);
    function shown(el){return el&&!el.closest('[hidden]')&&el.getBoundingClientRect().height>0}
    function inspect(){scheduled=false;if(document.visibilityState!=='visible')return;
      const results=document.querySelector('#tour-available'),catalogue=document.querySelector('#tour-cards'),home=document.querySelector('.fts-home-journey-grid');
      const container=shown(results)?document.querySelector('#available-cards'):shown(catalogue)?catalogue:shown(home)?home:null;
      if(container){const list_id=container.id==='available-cards'?'search_results':container===home?'home_featured':'catalogue';
        const cards=Array.from(container.querySelectorAll('.mtf-available-card,.mtf-card,.fts-journey-card'));
        const products=cards.map((card,i)=>{const n=card.querySelector('[data-currency-jpy]'),amount=Number(n?.getAttribute('data-currency-jpy'));return {journey_id:journey(card.querySelector('[data-view-journey],[data-tour],a[href]')||card),item_position:i+1,price_state:amount>0?'from_price':'unavailable',price_basis:'per_person_from',...(amount>0?{price_jpy:Math.round(amount)}:{})}});
        const conditions=list_id==='search_results'?searchData():{};
        const key=JSON.stringify([list_id,conditions,products]);if(key!==lastResults){lastResults=key;revision++;record('search_results',{...conditions,list_id,result_count:cards.length,render_revision:revision});products.forEach(p=>record('price_display',{...p,list_id,render_revision:revision}))}
      }
      const price=document.querySelector('#price-value'),mobile=document.querySelector('#mobile-price-total');if(price&&(shown(price)||shown(mobile))){const state=price.dataset.mode,amount=Number((price.querySelector('[data-currency-jpy]')||document.querySelector('#mobile-price-cta [data-currency-jpy]'))?.getAttribute('data-currency-jpy'));
        const info={journey_id:journey(),price_state:state,price_basis:'party_total',...(state==='priced'&&amount>0?{price_jpy:Math.round(amount)}:{})};const key=JSON.stringify(info);if(key!==lastPrice){lastPrice=key;record('price_display',info)}}
    }
    function schedule(){if(!scheduled){scheduled=true;setTimeout(inspect,120)}}
    window.addEventListener('flat-travel:route-change',()=>{record('step_view',{journey_id:journey()});schedule()});
    window.addEventListener('pagehide',()=>record('page_hidden'));
    window.addEventListener('pageshow',e=>{if(e.persisted)record('page_resume');schedule()});
    document.addEventListener('visibilitychange',()=>{record(document.visibilityState==='hidden'?'page_hidden':'page_resume');schedule()});
    document.addEventListener('DOMContentLoaded',()=>{record('step_view',{journey_id:journey()});schedule()});
    const observer=new MutationObserver(schedule);observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','data-mode','data-currency-jpy']});schedule();
  }
  async function insertEvent(db,page,event,step='') {
    await db.prepare('INSERT OR IGNORE INTO acquisition_events(page_id,event,step) VALUES (?,?,?)').bind(page,event,step).run();
  }
  async function getPage(db,id,request) {
    if (!uuid(id)) return null;
    return db.prepare(`SELECT p.id,p.visit_id FROM acquisition_pages p JOIN acquisition_visits v ON v.id=p.visit_id WHERE p.id=? AND v.surface=? AND p.received_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 hours')`).bind(id,options.surface).first();
  }
  async function api(request,env) {
    const url=new URL(request.url), db=dbOf(env);
    if (url.pathname === prefix+'/actions' && options.surface==='site') {
      if(request.method!=='POST')return response({error:'method'},405);
      if(request.headers.get('Origin')!==options.origin)return response({error:'origin'},403);
      if(Number(request.headers.get('Content-Length')||0)>16384)return response({error:'size'},413);
      const raw=await request.text();if(raw.length>16384)return response({error:'size'},413);
      let b;try{b=JSON.parse(raw)}catch{return response({error:'json'},400)}
      if(!Array.isArray(b?.actions)||b.actions.length>20)return response({error:'actions'},400);
      const page=await getPage(db,b.pageId,request);if(!page)return response({error:'page'},404);
      if(cookie(request)!==page.visit_id)return response({error:'visit'},403);
      let accepted=0;
      for(const a of b.actions){
        const safe=cleanAction(a);
        if(!safe||!uuid(a.id)||!Number.isInteger(a.seq)||a.seq<1||a.seq>500||!Number.isInteger(a.elapsed_ms)||a.elapsed_ms<0||a.elapsed_ms>86400000)continue;
        await db.prepare('INSERT OR IGNORE INTO acquisition_actions(id,page_id,sequence,elapsed_ms,event,data_json) VALUES (?,?,?,?,?,?)').bind(a.id,page.id,a.seq,a.elapsed_ms,safe.event,JSON.stringify(safe.data)).run();accepted++;
      }
      return response({ok:true,accepted});
    }
    if (url.pathname === prefix+'/events') {
      if(request.method!=='POST')return response({error:'method'},405);
      if(request.headers.get('Origin')!==options.origin)return response({error:'origin'},403);
      if(Number(request.headers.get('Content-Length')||0)>4096)return response({error:'size'},413);
      const raw=await request.text(); if(raw.length>4096)return response({error:'size'},413);
      let b;try{b=JSON.parse(raw)}catch{return response({error:'json'},400)}
      if(!Array.isArray(b.events)||b.events.length>12)return response({error:'events'},400);
      const page=await getPage(db,b.pageId,request);if(!page)return response({error:'page'},404);
      if(cookie(request)!==page.visit_id)return response({error:'visit'},403);
      const events=b.events.filter(e=>e&&allowedEvents.has(e.event)).map(e=>({event:e.event,step:allowedSteps.has(e.step)?e.step:'',id:e.id}));
      for(const e of events){
        if(['field_visible','field_complete'].includes(e.event)&&!formFields.has(e.step))continue;
        if(e.event==='link_click') {if(uuid(e.id)&&['form_link','site_link','internal_link','external_link'].includes(e.step))await db.prepare('INSERT OR IGNORE INTO acquisition_clicks(id,page_id,destination) VALUES (?,?,?)').bind(e.id,page.id,e.step).run();}
        else await insertEvent(db,page.id,e.event,e.step);
      }
      await db.prepare("UPDATE acquisition_visits SET last_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(page.visit_id).run();
      const result=response({ok:true,accepted:events.length});result.headers.set('Set-Cookie',visitCookie(page.visit_id));return result;
    }
    if(url.pathname===prefix+'/report') {
      if(request.method!=='GET')return response({error:'method'},405);
      if(!options.authorize || !await options.authorize(request,env))return response({error:'unauthorized'},401);
      const end=new Date(url.searchParams.get('end')||Date.now());
      const start=new Date(url.searchParams.get('start')||end.getTime()-86400000);
      if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start||end-start>31*86400000)return response({error:'range'},400);
      const source=sourceOf(url.searchParams.get('source')||'');
      const base=`WITH cohort AS (SELECT * FROM acquisition_visits WHERE is_test=0 AND created_at>=? AND created_at<? AND (?='' OR source=?))`;
      const bindings=[start.toISOString(),end.toISOString(),source,source];
      const summary=await db.prepare(`${base}, stages AS (SELECT v.id,v.surface,v.source,
       (SELECT count(*) FROM acquisition_pages p WHERE p.visit_id=v.id AND p.kind='tracked_link') tracked_requests,
       (SELECT count(*) FROM acquisition_pages p WHERE p.visit_id=v.id AND p.kind='document') document_requests,
       (SELECT count(*) FROM acquisition_pages p WHERE p.visit_id=v.id AND p.kind='document' AND p.tagged=1) tagged_requests,
       EXISTS(SELECT 1 FROM acquisition_pages p JOIN acquisition_events e ON e.page_id=p.id WHERE p.visit_id=v.id AND e.event='page_visible') visible,
       EXISTS(SELECT 1 FROM acquisition_pages p JOIN acquisition_events e ON e.page_id=p.id WHERE p.visit_id=v.id AND e.event='interaction') interacted,
       EXISTS(SELECT 1 FROM acquisition_pages p JOIN acquisition_events e ON e.page_id=p.id WHERE p.visit_id=v.id AND e.event='form_start') form_started,
       EXISTS(SELECT 1 FROM acquisition_pages p JOIN acquisition_events e ON e.page_id=p.id WHERE p.visit_id=v.id AND e.event='submit_attempt') attempted,
       EXISTS(SELECT 1 FROM acquisition_pages p JOIN acquisition_events e ON e.page_id=p.id WHERE p.visit_id=v.id AND e.event='submit_success') submitted
       FROM cohort v) SELECT surface,source,count(*) visits,sum(tracked_requests) tracked_link_requests,sum(document_requests) document_requests,sum(tagged_requests) utm_request_receipts,sum(visible) visible_visits,sum(interacted) interacted_visits,sum(form_started) form_started_visits,sum(attempted) submit_attempt_visits,sum(submitted) submitted_visits FROM stages GROUP BY surface,source`).bind(...bindings).all();
      const paths=await db.prepare(`${base} SELECT v.surface,p.path,count(*) document_requests,
       sum(EXISTS(SELECT 1 FROM acquisition_events e WHERE e.page_id=p.id AND e.event='page_visible')) visible_pages,
       sum(EXISTS(SELECT 1 FROM acquisition_events e WHERE e.page_id=p.id AND e.event='interaction')) interacted_pages
       FROM cohort v JOIN acquisition_pages p ON p.visit_id=v.id WHERE p.kind='document' GROUP BY v.surface,p.path ORDER BY document_requests DESC LIMIT 100`).bind(...bindings).all();
      const steps=await db.prepare(`${base} SELECT v.surface,e.event,e.step,count(DISTINCT v.id) visits FROM cohort v JOIN acquisition_pages p ON p.visit_id=v.id JOIN acquisition_events e ON e.page_id=p.id GROUP BY v.surface,e.event,e.step ORDER BY visits DESC LIMIT 100`).bind(...bindings).all();
      const links=await db.prepare(`${base} SELECT v.surface,p.path,c.destination,count(*) clicks,count(DISTINCT v.id) visits FROM cohort v JOIN acquisition_pages p ON p.visit_id=v.id JOIN acquisition_clicks c ON c.page_id=p.id GROUP BY v.surface,p.path,c.destination`).bind(...bindings).all();
      const entries=await db.prepare(`${base}, stages AS (
       SELECT v.*,c.entry_page,c.placement,c.variant,c.form_version,c.measurement_version,
       (SELECT count(*) FROM acquisition_pages p WHERE p.visit_id=v.id AND p.kind='tracked_link') tracked_requests,
       EXISTS(SELECT 1 FROM acquisition_pages p JOIN acquisition_events e ON e.page_id=p.id WHERE p.visit_id=v.id AND e.event='page_visible') visible,
       EXISTS(SELECT 1 FROM acquisition_pages p JOIN acquisition_events e ON e.page_id=p.id WHERE p.visit_id=v.id AND e.event='form_start') started,
       EXISTS(SELECT 1 FROM acquisition_pages p JOIN acquisition_events e ON e.page_id=p.id WHERE p.visit_id=v.id AND e.event='submit_success') submitted,
       (SELECT count(*) FROM acquisition_conversion_receipts r WHERE r.visit_id=v.id) receipts
       FROM cohort v LEFT JOIN acquisition_visit_context c ON c.visit_id=v.id)
       SELECT surface,campaign,COALESCE(entry_page,'') entry_page,COALESCE(placement,'') placement,COALESCE(variant,'') variant,COALESCE(form_version,'') form_version,COALESCE(measurement_version,'legacy') measurement_version,
       count(*) visits,sum(tracked_requests>0) tracked_visits,sum(tracked_requests) tracked_link_requests,sum(visible) visible_visits,sum(started) started_visits,sum(submitted) submitted_visits,sum(receipts) saved_receipts,
       sum(CASE WHEN tracked_requests>0 THEN receipts ELSE 0 END) tracked_saved_receipts,
       sum(tracked_requests>0 AND submitted) tracked_submitted_visits,sum(visible AND submitted) visible_submitted_visits
       FROM stages GROUP BY surface,campaign,entry_page,placement,variant,form_version,measurement_version ORDER BY visits DESC LIMIT 300`).bind(...bindings).all();
      return response({entries:entries.results,links:links.results,schemaVersion:'acquisition-v2',start:start.toISOString(),end:end.toISOString(),source,cohort:'visits first received within range; subsequent stages observed up to query time; tracked redirects are not partner-billed clicks; receipt counts are submissions, not unique people',summary:summary.results,paths:paths.results,steps:steps.results});
    }
    return response({error:'not_found'},404);
  }
  async function receive(request,env,kind='document') {
    const db=dbOf(env),url=new URL(request.url),explicitTest=url.searchParams.get('af_test')==='1'||url.searchParams.get('aj_test')==='1';
    const incomingSource=sourceOf(url.searchParams.get('utm_source')||'');
    const incomingMedium=token(url.searchParams.get('utm_medium'));
    const incomingCampaign=token(url.searchParams.get('utm_campaign'));
    const incomingContent=token(url.searchParams.get('utm_content'));
    const entry=entryContext(url);
    let id=cookie(request), visit=uuid(id) ? await db.prepare("SELECT * FROM acquisition_visits WHERE id=? AND surface=? AND last_seen_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 minutes')").bind(id,options.surface).first() : null;
    const prior=visit&&incomingSource?await db.prepare('SELECT * FROM acquisition_visit_context WHERE visit_id=?').bind(visit.id).first():null;
    const test=explicitTest||Boolean(visit?.is_test);
    // A second tagged creative is a new acquisition; never relabel earlier actions.
    // Untagged internal navigation keeps the original attribution and visit cookie.
    const changedAttribution=incomingSource && visit && (incomingSource!==visit.source||incomingMedium!==visit.medium||incomingCampaign!==visit.campaign||incomingContent!==visit.content||(prior&&(entry.page!==prior.entry_page||entry.placement!==prior.placement||entry.variant!==prior.variant)));
    if(!visit || (explicitTest&&!visit.is_test) || changedAttribution) {
      id=crypto.randomUUID();
      await db.prepare('INSERT INTO acquisition_visits(id,surface,source,medium,campaign,content,is_test) VALUES (?,?,?,?,?,?,?)').bind(id,options.surface,incomingSource||'unattributed',incomingMedium,incomingCampaign,incomingContent,Number(test)).run();
      await db.prepare('INSERT INTO acquisition_visit_context(visit_id,entry_page,placement,variant,form_version) VALUES (?,?,?,?,?)').bind(id,entry.page,entry.placement,entry.variant,options.formVersion||'').run();
    } else await db.prepare("UPDATE acquisition_visits SET last_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(id).run();
    const page=crypto.randomUUID();
    await db.prepare('INSERT INTO acquisition_pages(id,visit_id,path,kind,tagged) VALUES (?,?,?,?,?)').bind(page,id,safePath(url.pathname),kind,Number(Boolean(incomingSource))).run();
    return {id,page};
  }
  function client(pageId) {
    // Diagnostic values use the same bounded projection in browser and server.
    return `(()=>{const __name=(value)=>value;const cleanAction=${cleanAction.toString()};const siteDiagnostics=${siteDiagnostics.toString()};(${browserCollector.toString()})(${JSON.stringify({pageId,endpoint:prefix+'/events',submitPath:options.submitPath,surface:options.surface})});})();`;
  }
  async function run(request,env,context,next) {
    if(!enabled(request,env)) return next(request);
    const url=new URL(request.url),db=dbOf(env);
    if(url.pathname.startsWith(prefix+'/'))return api(request,env);
    if(url.pathname===options.linkPath && request.method==='GET') {
      const targetKey=url.searchParams.get('target');
      const destination=options.linkDestinations&&Object.hasOwn(options.linkDestinations,targetKey)?options.linkDestinations[targetKey]:options.destination;
      const target=new URL(destination,options.origin);
      for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','aj_page','aj_placement','aj_variant',...(options.forwardKeys||[])])if(url.searchParams.has(key))target.searchParams.set(key,url.searchParams.get(key).slice(0,240));
      if(!target.searchParams.has('utm_source'))target.searchParams.set('utm_source','accessible_japan');
      if(url.searchParams.get('af_test')==='1'||url.searchParams.get('aj_test')==='1')target.searchParams.set('af_test','1');
      if(/prefetch/i.test((request.headers.get('Purpose')||'')+(request.headers.get('Sec-Purpose')||'')))return new Response(null,{status:302,headers:{Location:target.href,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
      const tracked=new Request(new URL(url.pathname+'?'+target.searchParams,url.origin),request);
      let ids;try{ids=await receive(tracked,env,'tracked_link')}catch{console.error('acquisition_redirect_write_failed')}
      return new Response(null,{status:302,headers:{Location:target.href,'Cache-Control':'private, no-store',...(ids?{'Set-Cookie':visitCookie(ids.id)}:{}),'X-Robots-Tag':'noindex','Referrer-Policy':'no-referrer'}});
    }
    if(url.pathname===options.submitPath && request.method==='POST') {
      const res=await next(request);let body;try{body=await res.clone().json()}catch{}
      const id=request.headers.get('X-Acquisition-Page');
      if(id && request.headers.get('Origin')===options.origin) {
        try {const page=await getPage(db,id,request);if(page&&cookie(request)===page.visit_id){
          const saved=res.ok&&options.saved(body);
          await insertEvent(db,page.id,saved?'submit_success':'submit_error');
          if(saved)await recordReceipt(db,page,body);
        }}catch{console.error('acquisition_submit_write_failed')}
      }
      return res;
    }
    if(request.method!=='GET'||!options.document(url)||/prefetch/i.test((request.headers.get('Purpose')||'')+(request.headers.get('Sec-Purpose')||'')))return next(request);
    // Receive before rendering: record even when the page fails. Never cache a page ID.
    let ids;try{ids=await receive(request,env)}catch{console.error('acquisition_receive_write_failed')}
    let res;try{res=await next(request)}catch(error){if(ids)await db.prepare('UPDATE acquisition_pages SET response_status=500 WHERE id=?').bind(ids.page).run();throw error}
    if(!ids)return res;
    try{await db.prepare('UPDATE acquisition_pages SET response_status=? WHERE id=?').bind(res.status,ids.page).run()}catch{console.error('acquisition_status_write_failed')}
    const headers=new Headers(res.headers);
    headers.append('Set-Cookie',`af_visit=${ids.id}; Max-Age=1800; Path=/; HttpOnly; Secure; SameSite=Lax`);
    headers.set('Cache-Control','private, no-store');headers.set('X-Acquisition-Recorded','v1');
    if(res.status!==200||!(headers.get('Content-Type')||'').includes('text/html'))return new Response(res.body,{status:res.status,headers});
    let html=await res.text();
    for(const name of ['Content-Length','Content-Encoding','ETag'])headers.delete(name);
    const script='<script data-acquisition-v1>'+client(ids.page)+'</script>';
    html=html.includes('</head>')?html.replace('</head>',script+'</head>'):html+script;
    return new Response(html,{status:res.status,headers});
  }
  function browserCollector(config) {
    if(window.__acquisitionV1)return;window.__acquisitionV1=true;
    const nativeFetch=window.fetch.bind(window),seen=new Set(),queue=[];
    let flushing=false,visible=false,tries=0;
    function emit(event,step=''){if(event==='link_click'){queue.push({event,step,id:crypto.randomUUID()});flush();return}const key=event+':'+step;if(seen.has(key))return;seen.add(key);queue.push({event,step});flush()}
    function flush(){if(flushing||!queue.length)return;flushing=true;const batch=queue.splice(0,12);
      nativeFetch(config.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pageId:config.pageId,events:batch}),keepalive:true}).then(r=>{if(!r.ok)throw Error();tries=0}).catch(()=>{if(tries++<2){queue.unshift(...batch);setTimeout(flush,1000)}}).finally(()=>{flushing=false;if(queue.length&&tries===0)flush()})}
    if(config.surface==='form'){
      const fields=new Set(['first_name','last_name','email','hotel_interest','hotel_match_preference','hotel_grade','travellers','room_count','bed_type','dates_decided','city_schedule','preferred_cities','approximate_timing','approximate_duration','notes']);
      const observed=new WeakSet(),inView=new Set(),timers=new Map();
      function inspectField(el){const name=el.getAttribute('data-traffic-field');if(!fields.has(name))return;
        if(el.getAttribute('data-traffic-complete')==='true')emit('field_complete',name);}
      function schedule(el){if(timers.has(el)||document.visibilityState!=='visible')return;
        timers.set(el,setTimeout(()=>{timers.delete(el);if(inView.has(el)&&document.visibilityState==='visible')emit('field_visible',el.getAttribute('data-traffic-field'))},1000));}
      const io=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting&&e.intersectionRatio>=0.1){inView.add(e.target);schedule(e.target)}else{inView.delete(e.target);clearTimeout(timers.get(e.target));timers.delete(e.target)}}),{threshold:0.1}):null;
      function scan(){document.querySelectorAll('[data-traffic-field]').forEach(el=>{if(!fields.has(el.getAttribute('data-traffic-field')))return;if(!observed.has(el)){observed.add(el);io?.observe(el)}inspectField(el)})}
      new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['data-traffic-complete']});
      document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')inView.forEach(schedule);else{timers.forEach(clearTimeout);timers.clear()}});
      window.addEventListener('flat-travel:form-validation',e=>{emit('submit_attempt');for(const name of e.detail?.fields||[])if(fields.has(name))emit('validation_error',name)});
      document.addEventListener('DOMContentLoaded',scan);scan();
    }
    if(config.surface==='site'){
      const pending=[];let sending=false,retries=0;
      const post=actions=>nativeFetch('/__acquisition/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pageId:config.pageId,actions}),keepalive:true});
      function drain(){if(sending||!pending.length)return;sending=true;const batch=pending.splice(0,20);
        post(batch).then(r=>{if(!r.ok)throw Error();retries=0}).catch(()=>{if(retries++<2){pending.unshift(...batch);setTimeout(drain,1000)}}).finally(()=>{sending=false;if(pending.length&&retries===0)drain()})}
      siteDiagnostics(config,a=>{pending.push(a);drain()});
      const flushActions=()=>{while(pending.length)post(pending.splice(0,20)).catch(()=>{})};
      window.addEventListener('pagehide',flushActions);
      document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushActions()});
    }
    function isInquiry(el){return config.surface==='form'||Boolean(el?.closest?.('#mtf-inline-profile-form,[data-private-profile],[data-private-step],[data-ftai-root]'))}
    function step(el){const field=el?.closest?.('[data-traffic-field]');if(field)return field.getAttribute('data-traffic-field');
      if(el?.closest?.('[data-private-profile]'))return 'contact';const section=el?.closest?.('[data-private-step]');
      if(section){const s=section.getAttribute('data-private-step');return ({'0':'places','1':'experiences','2':'trip_shape','3':'support','4':'final_note',places:'places',experiences:'experiences',shape:'trip_shape',timing:'trip_shape',support:'support',note:'final_note',finish:'final_note',review:'final_note'})[s]||'other'}
      if(el?.closest?.('[data-journey-search],#tour-search-form,#mtf-search-gate-form'))return 'search';if(el?.closest?.('form'))return isInquiry(el)?'contact':'other';if(el?.closest?.('nav'))return 'navigation';return 'other'}
    function pageVisible(){if(document.visibilityState!=='visible'||visible)return;
      const main=document.querySelector('main')||document.querySelector('form');if(!main||!main.getBoundingClientRect().height)return;
      if(config.surface==='form'&&!document.querySelector('[data-traffic-field]'))return;
      requestAnimationFrame(()=>requestAnimationFrame(()=>{if(document.visibilityState==='visible'&&!visible){visible=true;emit('page_visible')}}))}
    function action(e){if(!e.isTrusted)return;const s=step(e.target);emit('interaction');
      if(['input','change','focusin'].includes(e.type)&&e.target?.matches?.('input:not([type=hidden]),select,textarea')){if(isInquiry(e.target))emit('form_start');emit('field_interaction',s)}
      if(e.type==='click'){emit('interaction',s);const a=e.target?.closest?.('a[href]');if(a){try{const u=new URL(a.href,location.href);if(/^https?:$/.test(u.protocol))emit('link_click',u.hostname==='liffform-studio.pages.dev'?'form_link':u.hostname==='flat-travel.com'&&u.origin!==location.origin?'site_link':u.origin===location.origin?'internal_link':'external_link')}catch{}}}
      if(e.type==='click'&&e.target?.closest?.('[data-private-step]')){if(isInquiry(e.target))emit('form_start');emit('field_interaction',s)}}
    ['click','input','change','focusin','keydown','touchstart'].forEach(t=>document.addEventListener(t,action,{capture:true,passive:true}));
    window.addEventListener('pagehide',()=>{while(queue.length){const batch=queue.splice(0,12);nativeFetch(config.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pageId:config.pageId,events:batch}),keepalive:true}).catch(()=>{})}});
    window.addEventListener('scroll',e=>{if(e.isTrusted)emit('interaction','scroll')},{passive:true});
    document.addEventListener('submit',e=>{if(e.isTrusted&&isInquiry(e.target))emit('submit_attempt')},true);
    document.addEventListener('invalid',e=>{if(e.isTrusted&&isInquiry(e.target)){emit('submit_attempt');emit('validation_error',step(e.target))}},true);
    document.addEventListener('visibilitychange',pageVisible);
    window.addEventListener('pageshow',pageVisible);document.addEventListener('DOMContentLoaded',pageVisible);
    const observer=new MutationObserver(pageVisible);observer.observe(document.documentElement,{childList:true,subtree:true});
    setTimeout(()=>observer.disconnect(),60000);pageVisible();
    // Correlation only for the existing first-party submit endpoint. No body inspection.
    window.fetch=function(input,init){let u;try{u=new URL(typeof input==='string'?input:input.url,location.href)}catch{return nativeFetch(input,init)}
      const method=(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
      if(u.origin===location.origin&&u.pathname===config.submitPath&&method==='POST'){
        emit('submit_attempt');const headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined));headers.set('X-Acquisition-Page',config.pageId);
        return nativeFetch(input,{...init,headers}).catch(e=>{emit('submit_error');throw e});}
      return nativeFetch(input,init);};
  }
  return {run,client,api};
}

const acquisitionFunnel=createAcquisitionFunnel({
 origin:'https://liffform-studio.pages.dev',surface:'form',
 document:url=>url.pathname==='/public-form'&&url.searchParams.get('id')===ACCESSIBLE_JAPAN_FORM_ID&&!url.searchParams.has('issue'),
 submitPath:'/api/forms/'+ACCESSIBLE_JAPAN_FORM_ID+'/submit',saved:body=>body?.success===true,
 receipt:body=>body?.data?.id,formVersion:'aj-current-20261006',
 linkPath:'/go/aj-form',destination:'/public-form?id='+ACCESSIBLE_JAPAN_FORM_ID,
 forwardKeys:['prefill_Hotel Name','prefill_hotel_interest'],
 authorize:hasReportAccess,
});
export default {fetch(request,env,context){return acquisitionFunnel.run(request,env,context,r=>formsWorker.fetch(r,env,context));}};
