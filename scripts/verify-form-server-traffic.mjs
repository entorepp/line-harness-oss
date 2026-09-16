import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../apps/forms-studio/public/_worker.js', import.meta.url), 'utf8')
  .replace('export default {', 'globalThis.__worker = {')
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
  fetch: async () => new Response('proxied'),
}
vm.runInNewContext(source, sandbox)
const worker = sandbox.__worker

function createDb() {
  const writes = []
  return {
    writes,
    prepare(sql) {
      let values = []
      return {
        bind(...next) { values = next; return this },
        async run() { writes.push({ sql, values }); return { success: true } },
        async first() {
          return {
            first_recorded_at: '2026-09-16 12:00:00',
            total_arrivals: 7,
            accessible_japan_arrivals: 5,
            tracked_clicks: 4,
          }
        },
        async all() {
          return { results: [{ date: '2026-09-16', total_arrivals: 7, accessible_japan_arrivals: 5, tracked_clicks: 4 }] }
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

const form = 'https://liffform-studio.pages.dev/public-form?id=9ab583b2-e42e-4ca2-bcb9-13a3c59f5477'
const arrival = await execute(new Request(`${form}&utm_source=accessible_japan&utm_medium=cpc&email=private@example.com`, {
  headers: { Referer: 'https://www.accessible-japan.com/private?email=private@example.com' },
}))
assert.equal(arrival.response.status, 200)
assert.equal(arrival.db.writes.length, 1)
assert.deepEqual(Array.from(arrival.db.writes[0].values.slice(1)), [
  '9ab583b2-e42e-4ca2-bcb9-13a3c59f5477', 'form_arrival', 'accessible_japan', 'cpc', 0,
])
assert.doesNotMatch(JSON.stringify(arrival.db.writes), /private@example|accessible-japan\.com\/private/i)

for (const request of [
  new Request(`${form}&issue=private-issue`),
  new Request(form.replace('9ab583b2-e42e-4ca2-bcb9-13a3c59f5477', 'another-form')),
  new Request(form, { headers: { Purpose: 'prefetch' } }),
]) {
  const ignored = await execute(request)
  assert.equal(ignored.db.writes.length, 0)
}

const redirect = await execute(new Request(
  'https://liffform-studio.pages.dev/go/accessible-japan?prefill_Hotel+Name=Hilton+Tokyo&email=private@example.com',
))
assert.equal(redirect.response.status, 302)
assert.equal(redirect.db.writes.length, 1)
const location = new URL(redirect.response.headers.get('Location'))
assert.equal(location.pathname, '/public-form')
assert.equal(location.searchParams.get('id'), '9ab583b2-e42e-4ca2-bcb9-13a3c59f5477')
assert.equal(location.searchParams.get('utm_source'), 'accessible_japan')
assert.equal(location.searchParams.get('utm_medium'), 'cpc')
assert.equal(location.searchParams.get('utm_campaign'), 'accessible_japan_forms')
assert.equal(location.searchParams.get('prefill_Hotel Name'), 'Hilton Tokyo')
assert.equal(location.searchParams.has('email'), false)

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
assert.deepEqual(JSON.parse(JSON.stringify(report.data.daily)), [{
  date: '2026-09-16', totalArrivals: 7, accessibleJapanArrivals: 5, trackedClicks: 4,
}])
assert.equal(report.data.trackedUrl, 'https://liffform-studio.pages.dev/go/accessible-japan')
assert.equal(report.data.formUrl, form)

console.log('PASS: exact-form server tracking, privacy minimization, tracked redirect, report auth and aggregation')
