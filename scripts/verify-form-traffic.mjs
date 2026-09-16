import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { buildTrafficContext, TRAFFIC_ORIGIN, TRAFFIC_FORM_ID } from '../apps/forms-studio/src/lib/form-traffic.ts'

const base = `${TRAFFIC_ORIGIN}/public-form?id=${TRAFFIC_FORM_ID}`
const script = readFileSync(new URL('../apps/forms-studio/public/form-traffic.js', import.meta.url), 'utf8')
const aj = buildTrafficContext(`${base}&utm_source=accessible_japan&utm_medium=cpc&email=person@example.com&prefill_Hotel+Name=Private+Hotel#secret`, 'https://www.accessible-japan.com/hotels/private?email=person@example.com#secret')
assert.deepEqual(aj, {
  type: 'liffform:page-view', page_referrer: 'https://www.accessible-japan.com/',
  campaign_source: 'accessible_japan', campaign_medium: 'cpc', campaign_name: 'accessible_japan_forms',
  traffic_type: '',
})
const joshUtm = buildTrafficContext(`${base}&utm_source=accessiblejapan&utm_medium=cta&utm_campaign=hotel_detail`, '')
assert.deepEqual(joshUtm, {
  type: 'liffform:page-view', page_referrer: '',
  campaign_source: 'accessible_japan', campaign_medium: 'cta', campaign_name: 'hotel_detail',
  traffic_type: '',
})
assert.equal(buildTrafficContext(base, 'https://accessible-japan.com/hotel/').campaign_medium, 'referral')
assert.equal(buildTrafficContext(base, '').campaign_source, '')
assert.deepEqual(buildTrafficContext(base + '&prefill_Hotel+Name=Hilton+Tokyo', ''), {
  type: 'liffform:page-view', page_referrer: '',
  campaign_source: 'accessible_japan', campaign_medium: 'cta', campaign_name: 'accessible_japan_forms',
  traffic_type: '',
})
assert.equal(buildTrafficContext(base + '&aj_test=1', '').traffic_type, 'internal')
assert.equal(buildTrafficContext(base + '&utm_source=google&prefill_Hotel+Name=Hilton+Tokyo', '').campaign_source, '')
assert.equal(buildTrafficContext(base, 'https://accessible-japan.com.evil.example/hotel').campaign_source, '')
assert.equal(buildTrafficContext(base, 'https://www.google.com/search?q=person%40example.com').page_referrer, 'https://www.google.com/')
assert.equal(buildTrafficContext(base, 'https://person@example.com/path').page_referrer, '')
assert.equal(buildTrafficContext(base, 'javascript:alert(1)').page_referrer, '')
assert.equal(buildTrafficContext(base + '&issue=private-issue', ''), null)
assert.equal(buildTrafficContext(base.replace(TRAFFIC_FORM_ID, 'another-form'), ''), null)
assert.equal(buildTrafficContext(base.replace(TRAFFIC_ORIGIN, 'https://preview.liffform-studio.pages.dev'), ''), null)
assert.equal(buildTrafficContext(base.replace('/public-form', '/shared-report'), ''), null)

function runtime({ origin = TRAFFIC_ORIGIN, standalone = false } = {}) {
  const appended = []
  const handlers = {}
  const parent = {}
  const window = { location: { origin }, parent, addEventListener: (name, fn) => { handlers[name] = fn } }
  if (standalone) window.parent = window
  vm.runInNewContext(script, { window, URL, Date, document: {
    createElement: () => ({}), head: { appendChild: (element) => appended.push(element) },
  } })
  return { appended, window, message: (data, overrides = {}) => handlers.message?.({ data, origin, source: parent, ...overrides }) }
}

const rt = runtime()
assert.equal(rt.window['ga-disable-G-WNH9JBCLFH'], undefined,
  'The dedicated form stream must remain enabled in the form frame')
assert.equal(rt.appended.length, 0, 'Loading the frame alone must not contact Google')
rt.message(aj, { origin: 'https://attacker.example' })
rt.message(aj, { source: {} })
rt.message({ ...aj, type: 'other' })
assert.equal(rt.appended.length, 0)
rt.message({ ...aj, page_referrer: 'https://www.accessible-japan.com/private?email=person@example.com#secret', email: 'person@example.com', campaign_name: 'private-name' })
rt.message(aj)
assert.equal(rt.appended.length, 1, 'Only one tag and page view per loaded document')
assert.equal(rt.appended[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-WNH9JBCLFH')
assert.equal(rt.appended[0].referrerPolicy, 'no-referrer')
const commands = rt.window.dataLayer.map((args) => Array.from(args))
const config = commands.find(([name]) => name === 'config')[2]
const pageViews = commands.filter(([name, event]) => name === 'event' && event === 'page_view')
assert.equal(pageViews.length, 1)
assert.equal(config.send_page_view, false)
assert.equal(config.allow_google_signals, false)
assert.equal(config.allow_ad_personalization_signals, false)
assert.equal(config.page_referrer, 'https://www.accessible-japan.com/')
assert.equal(config.page_location, base)
assert.equal(commands[0][2].analytics_storage, 'granted')
assert.equal(commands[0][2].ad_user_data, 'denied')
assert.doesNotMatch(JSON.stringify(commands), /person@example|private|secret|prefill|email|issue=/i)
rt.message({ type: 'liffform:analytics-event', event_name: 'lead_form_start' })
rt.message({ type: 'liffform:analytics-event', event_name: 'form_progress', field_key: 'hotel_grade', field_value: 'private' })
rt.message({ type: 'liffform:analytics-event', event_name: 'generate_lead' })
rt.message({ type: 'liffform:analytics-event', event_name: 'form_progress', field_key: 'private_field' })
const funnelEvents = rt.window.dataLayer
  .map((args) => Array.from(args))
  .filter(([name, event]) => name === 'event' && ['lead_form_start', 'form_progress', 'generate_lead'].includes(event))
assert.deepEqual(JSON.parse(JSON.stringify(funnelEvents.map(([, event]) => event))), ['lead_form_start', 'form_progress', 'generate_lead'])
assert.deepEqual(JSON.parse(JSON.stringify(funnelEvents[1][2])), {
  send_to: 'G-WNH9JBCLFH', form_id: TRAFFIC_FORM_ID, field_key: 'hotel_grade', form_step: 6, transport_type: 'beacon',
})
assert.doesNotMatch(JSON.stringify(funnelEvents), /private/i)
for (const options of [{ standalone: true }, { origin: 'https://preview.liffform-studio.pages.dev' }]) {
  const disabled = runtime(options)
  disabled.message(aj)
  assert.equal(disabled.appended.length, 0)
}
const direct = runtime()
direct.message(buildTrafficContext(base, ''))
assert.equal(direct.window.dataLayer.length, 6)
const directConfig = Array.from(direct.window.dataLayer[4])[2]
assert.equal(directConfig.campaign_source, undefined, 'Direct visits must not be inferred to come from AJ')
const joshRuntime = runtime()
joshRuntime.message(joshUtm)
const joshConfig = Array.from(joshRuntime.window.dataLayer[4])[2]
assert.equal(joshConfig.campaign_source, 'accessible_japan')
assert.equal(joshConfig.campaign_medium, 'cta')
assert.equal(joshConfig.campaign_name, 'hotel_detail')
console.log('PASS: form scope, consent handshake, campaign attribution, origin checks, preview exclusion, PII sanitization and page-view deduplication')
