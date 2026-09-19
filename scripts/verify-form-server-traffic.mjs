import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../apps/forms-studio/public/_worker.js', import.meta.url), 'utf8')
  .replace('export default {', 'globalThis.__worker = {')
const proxiedRequests = []
const sandbox = {
  URL,
  Request,
  Response,
  Headers,
  TextEncoder,
  Uint8Array,
  Date,
  crypto,
  console,
  fetch: async (request) => {
    proxiedRequests.push(request)
    if (new URL(request.url).searchParams.get('mock_failure') === '1') {
      return Response.json({ success: false, error: 'Rejected' }, { status: 200 })
    }
    return Response.json({ success: true, data: { id: 'submission-test' } }, { status: 201 })
  },
}
vm.runInNewContext(source, sandbox)
const worker = sandbox.__worker

function createDb() {
  const writes = []
  const preparedSql = []
  return {
    writes,
    preparedSql,
    prepare(sql) {
      preparedSql.push(sql)
      let values = []
      return {
        bind(...next) { values = next; return this },
        async run() { writes.push({ sql, values }); return { success: true } },
        async first() {
          if (sql.includes('FROM accessible_japan_form_sessions')) {
            return {
              first_session_recorded_at: '2026-09-17 00:00:00',
              total_sessions: 5,
              accessible_japan_sessions: 4,
              accessible_japan_started_sessions: 3,
              submitted_sessions: 2,
              active_sessions: 1,
              abandoned_sessions: 2,
              accessible_japan_submitted_sessions: 2,
              accessible_japan_active_sessions: 1,
              accessible_japan_abandoned_sessions: 1,
            }
          }
          return {
            first_recorded_at: '2026-09-16 12:00:00',
            total_arrivals: 7,
            accessible_japan_arrivals: 5,
            confirmed_accessible_japan_arrivals: 4,
            inferred_accessible_japan_arrivals: 1,
            tracked_clicks: 4,
          }
        },
        async all() {
          if (sql.includes('WITH ranked AS')) {
            return { results: [{ field_index: 1, field_key: 'first_name', dropoff_sessions: 1 }] }
          }
          if (sql.includes('COUNT(DISTINCT')) {
            return { results: [{ field_index: 1, field_key: 'first_name', reached_sessions: 3 }] }
          }
          if (sql.includes('GROUP BY source_page_key')) {
            return { results: [{ source_page_key: 'hilton-tokyo', sessions: 3, submitted_sessions: 2 }] }
          }
          if (sql.includes('GROUP BY source, medium, campaign')) {
            return { results: [{
              source: 'accessible_japan',
              medium: 'cta',
              campaign: 'hotel_detail',
              sessions: 4,
              submitted_sessions: 2,
            }] }
          }
          if (sql.includes('FROM accessible_japan_form_sessions')) {
            return { results: [{
              date: '2026-09-17',
              total_sessions: 5,
              accessible_japan_sessions: 4,
              submitted_sessions: 2,
              accessible_japan_submitted_sessions: 2,
              accessible_japan_active_sessions: 1,
              accessible_japan_abandoned_sessions: 1,
            }] }
          }
          if (sql.includes('GROUP BY country_code')) {
            return { results: [{
              country_code: 'US',
              total_arrivals: 2,
              accessible_japan_arrivals: 2,
              inferred_accessible_japan_arrivals: 1,
            }] }
          }
          return { results: [{
            date: '2026-09-16',
            total_arrivals: 7,
            accessible_japan_arrivals: 5,
            confirmed_accessible_japan_arrivals: 4,
            inferred_accessible_japan_arrivals: 1,
            tracked_clicks: 4,
          }] }
        },
      }
    },
  }
}

async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function execute(request, overrides = {}) {
  const db = createDb()
  const pending = []
  const response = await worker.fetch(request, {
    FORM_TRAFFIC_DB: db,
    ACCESSIBLE_JAPAN_REPORT_TOKEN_SHA256: await hash('test-token'),
    ASSETS: { fetch: async () => new Response('asset', { status: 200 }) },
    ...overrides,
  }, { waitUntil: (promise) => pending.push(promise) })
  await Promise.all(pending)
  return { response, db }
}

function findWrite(db, pattern) {
  return db.writes.find(({ sql }) => sql.includes(pattern))
}

function legacyWrite(db) {
  return findWrite(db, 'INSERT INTO accessible_japan_form_traffic')
}

function sessionWrite(db) {
  return findWrite(db, 'INSERT OR IGNORE INTO accessible_japan_form_sessions')
}

function eventWrites(db) {
  return db.writes.filter(({ sql }) => sql.includes('INSERT OR IGNORE INTO accessible_japan_form_session_events'))
}

const formId = '9ab583b2-e42e-4ca2-bcb9-13a3c59f5477'
const form = `https://liffform-studio.pages.dev/public-form?id=${formId}`
const arrival = await execute(new Request(`${form}&utm_source=accessible_japan&utm_medium=cpc&email=private@example.com`, {
  headers: { Referer: 'https://www.accessible-japan.com/private?email=private@example.com' },
}))
assert.equal(arrival.response.status, 200)
assert.match(arrival.response.headers.get('Set-Cookie'), /^aft_session=/)
assert.deepEqual(Array.from(legacyWrite(arrival.db).values.slice(1)), [
  formId, 'form_arrival', 'accessible_japan', 'cpc', null, 'utm', 0,
])
assert.deepEqual(Array.from(sessionWrite(arrival.db).values.slice(1)), [
  formId, 'accessible_japan', 'cpc', 'unknown', null, null, 'utm', 0,
])
assert.doesNotMatch(JSON.stringify(arrival.db.writes), /private@example|accessible-japan\.com\/private/i)

const joshArrival = await execute(new Request(
  `${form}&utm_source=accessiblejapan&utm_medium=cta&utm_campaign=hotel_detail&utm_content=aj-hilton-tokyo&prefill_Hotel+Name=Hilton+Tokyo&email=private@example.com`,
))
assert.equal(joshArrival.response.status, 200)
assert.deepEqual(Array.from(legacyWrite(joshArrival.db).values.slice(1)), [
  formId, 'form_arrival', 'accessible_japan', 'referral', null, 'utm', 0,
])
assert.deepEqual(Array.from(sessionWrite(joshArrival.db).values.slice(1)), [
  formId, 'accessible_japan', 'cta', 'hotel_detail', 'aj-hilton-tokyo', null, 'utm', 0,
])
assert.doesNotMatch(JSON.stringify(joshArrival.db.writes), /private@example|Hilton Tokyo/i)

const hotelOnlyArrival = await execute(new Request(
  `${form}&prefill_Hotel+Name=Hilton+Tokyo&email=private@example.com`,
))
assert.deepEqual(Array.from(sessionWrite(hotelOnlyArrival.db).values.slice(1)), [
  formId, 'accessible_japan', 'cta', 'unknown', 'hilton-tokyo', null, 'hotel_query', 0,
])
assert.doesNotMatch(JSON.stringify(hotelOnlyArrival.db.writes), /private@example|Hilton Tokyo/i)

const explicitOtherSource = await execute(new Request(
  `${form}&utm_source=google&prefill_Hotel+Name=Hilton+Tokyo`,
))
assert.deepEqual(Array.from(sessionWrite(explicitOtherSource.db).values.slice(1)), [
  formId, 'other', 'other', 'other', null, null, 'explicit_other', 0,
])

const inferredForeignArrival = await execute(new Request(form, {
  headers: { 'CF-IPCountry': 'US' },
}))
assert.deepEqual(Array.from(sessionWrite(inferredForeignArrival.db).values.slice(1)), [
  formId, 'accessible_japan', 'referral', 'unknown', null, 'US', 'non_jp_inferred', 0,
])

const testArrival = await execute(new Request(`${form}&aj_test=1`, {
  headers: { 'CF-IPCountry': 'JP' },
}))
assert.equal(legacyWrite(testArrival.db).values.at(-1), 1)
assert.equal(sessionWrite(testArrival.db).values.at(-1), 1)

for (const request of [
  new Request(`${form}&issue=private-issue`),
  new Request(form.replace(formId, 'another-form')),
  new Request(form, { headers: { Purpose: 'prefetch' } }),
]) {
  const ignored = await execute(request)
  assert.equal(ignored.db.writes.length, 0)
}

const redirect = await execute(new Request(
  'https://liffform-studio.pages.dev/go/accessible-japan?prefill_Hotel+Name=Hilton+Tokyo&email=private@example.com',
))
assert.equal(redirect.response.status, 302)
assert.deepEqual(Array.from(legacyWrite(redirect.db).values.slice(1)), [
  formId, 'tracked_click', 'accessible_japan', 'cpc', null, 'tracked_link', 0,
])
const location = new URL(redirect.response.headers.get('Location'))
assert.equal(location.pathname, '/public-form')
assert.equal(location.searchParams.get('id'), formId)
assert.equal(location.searchParams.get('utm_source'), 'accessible_japan')
assert.equal(location.searchParams.get('utm_medium'), 'cpc')
assert.equal(location.searchParams.get('utm_campaign'), 'accessible_japan_forms')
assert.equal(location.searchParams.get('prefill_Hotel Name'), 'Hilton Tokyo')
assert.equal(location.searchParams.has('email'), false)

const cookie = arrival.response.headers.get('Set-Cookie').split(';', 1)[0]
const progress = await execute(new Request(
  'https://liffform-studio.pages.dev/api/form-traffic/events',
  {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventType: 'form_progress', fieldKey: 'hotel_grade', value: 'private' }),
  },
))
assert.equal(progress.response.status, 204)
const progressEvent = eventWrites(progress.db)[0]
assert.deepEqual(Array.from(progressEvent.values.slice(1, 4)), ['form_progress', 'hotel_grade', 6])
assert.doesNotMatch(JSON.stringify(progress.db.writes), /private/i)

const invalidProgress = await execute(new Request(
  'https://liffform-studio.pages.dev/api/form-traffic/events',
  {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventType: 'form_progress', fieldKey: 'private_field' }),
  },
))
assert.equal(invalidProgress.response.status, 400)

const proxyCount = proxiedRequests.length
const submission = await execute(new Request(
  `https://liffform-studio.pages.dev/api/forms/${formId}/submit`,
  {
    method: 'POST',
    headers: {
      Cookie: `${cookie}; preserved_cookie=value`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ answers: { email: 'private@example.com' } }),
  },
))
assert.equal(submission.response.status, 201)
assert.equal(eventWrites(submission.db).length, 1)
assert.match(eventWrites(submission.db)[0].sql, /'form_submit'/)
const proxiedSubmission = proxiedRequests[proxyCount]
assert.equal(new URL(proxiedSubmission.url).origin, 'https://line-flattravel.flat-travel.workers.dev')
assert.doesNotMatch(proxiedSubmission.headers.get('Cookie') || '', /aft_session/)
assert.match(proxiedSubmission.headers.get('Cookie') || '', /preserved_cookie=value/)

const rejectedSubmission = await execute(new Request(
  `https://liffform-studio.pages.dev/api/forms/${formId}/submit?mock_failure=1`,
  {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: { email: 'private@example.com' } }),
  },
))
assert.equal(rejectedSubmission.response.status, 200)
assert.equal(eventWrites(rejectedSubmission.db).length, 0,
  'A 2xx response without backend success must not count as a conversion')

const unauthorized = await execute(new Request(
  'https://liffform-studio.pages.dev/api/shared-reports/accessible-japan-traffic',
))
assert.equal(unauthorized.response.status, 401)
assert.equal(unauthorized.response.headers.get('Cache-Control'), 'private, no-store, max-age=0')

const authorized = await execute(new Request(
  'https://liffform-studio.pages.dev/api/shared-reports/accessible-japan-traffic',
  { headers: { Authorization: 'Bearer test-token' } },
))
assert.equal(authorized.response.status, 200)
const report = await authorized.response.json()
assert.deepEqual(JSON.parse(JSON.stringify(report.data.sessions)), {
  firstRecordedAt: '2026-09-17T00:00:00Z',
  total: 5,
  submitted: 2,
  active: 1,
  abandoned: 2,
  conversionRate: 0.5,
  dropoffRate: 0.5,
  accessibleJapan: 4,
  accessibleJapanStarted: 3,
  accessibleJapanNotStarted: 1,
  accessibleJapanSubmitted: 2,
  accessibleJapanActive: 1,
  accessibleJapanAbandoned: 1,
  accessibleJapanConversionRate: 2 / 3,
  accessibleJapanDropoffRate: 1 / 3,
})
assert.deepEqual(JSON.parse(JSON.stringify(report.data.channels)), [{
  source: 'accessible_japan',
  medium: 'cta',
  campaign: 'hotel_detail',
  sessions: 4,
  submitted: 2,
}])
assert.deepEqual(JSON.parse(JSON.stringify(report.data.sourcePages)), [{
  sourcePageKey: 'hilton-tokyo',
  sessions: 3,
  submitted: 2,
}])
assert.deepEqual(JSON.parse(JSON.stringify(report.data.fieldFunnel)), [{
  fieldIndex: 1,
  fieldKey: 'first_name',
  fieldLabel: 'First / given name',
  reachedSessions: 3,
  dropoffSessions: 1,
}])
const sessionReportSql = authorized.db.preparedSql.join('\n')
assert.match(sessionReportSql, /source = 'accessible_japan' AND attribution_method = 'utm'/)
assert.match(sessionReportSql, /s\.source = 'accessible_japan' AND s\.attribution_method = 'utm'/)
assert.equal(report.data.trackedUrl, 'https://liffform-studio.pages.dev/go/accessible-japan')
assert.equal(report.data.formUrl, form)

console.log('PASS: anonymous session funnel, safe attribution, field dropoff, backend-saved submission, report auth and privacy minimization')
