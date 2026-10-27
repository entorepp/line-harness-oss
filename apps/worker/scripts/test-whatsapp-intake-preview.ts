import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { advanceIntake, newIntake, planIntake, type CatalogueItem, type IntakeState, type Locale, type Slots } from '../src/services/whatsapp-intake.js';

// Entirely synthetic: these are deliberately not real, published products or prices.
const NOW = Date.parse('2026-10-27T00:00:00Z');
const FUTURE = '2026-10-28T00:00:00Z';
const baseSlots: Slots = {
  timing: 'November 2027, exact dates not decided', duration: { value: 7, unit: 'days' }, cities: ['Tokyo', 'Kyoto'],
  party: { adults: 2, children: 0 }, budget: { amount: 600000, currency: 'JPY', basis: 'party_total', scope: 'trip' }, support: ['none'], residency: 'overseas', preference: 'package',
};
function collecting(locale: Locale = 'en') { return advanceIntake(newIntake(locale, true), { type: 'consent', allowed: true }); }
function completed(overrides: Partial<Slots> = {}, locale: Locale = 'en') {
  let s = collecting(locale);
  for (const [slot, value] of Object.entries({ ...baseSlots, ...overrides })) s = advanceIntake(s, { type: 'selection', slot: slot as keyof Slots, value });
  return s;
}
function confirmed(overrides: Partial<Slots> = {}, locale: Locale = 'en') {
  const s = completed(overrides, locale); return advanceIntake(s, { type: 'confirm', revision: s.revision });
}
function product(overrides: Partial<CatalogueItem> = {}): CatalogueItem {
  return { id: 'synthetic-package', title: 'SYNTHETIC seven-day example', kind: 'package', locale: 'en', url: 'https://flat-travel.com/en/tours/__synthetic_fixture__',
    publication: { status: 'published', revision: 'synthetic-not-a-cms-revision', validUntil: FUTURE }, cities: ['Tokyo', 'Kyoto'], minDays: 7, maxDays: 7,
    supportEvidence: {}, referencePrice: { amount: 500000, currency: 'JPY', basis: 'party_total', scope: 'trip', party: { adults: 2, children: 0 }, validUntil: FUTURE }, ...overrides };
}
function interpreted(s: IntakeState, result: unknown, text = 'November 2027') { return advanceIntake(s, { type: 'interpreted', text, result }); }
const answer = (facts: unknown, confidence = 0.95) => ({ intent: 'answer', confidence, facts });
const plan = (s: IntakeState, items: CatalogueItem[] = [product()]) => planIntake(s, items, NOW);
const originalFetch = globalThis.fetch;
globalThis.fetch = (() => { throw new Error('Offline prototype must never access the network'); }) as typeof fetch;

test('consent precedes collecting any travel or support facts', () => {
  const s = newIntake('en', true);
  assert.equal(plan(s).action, 'consent');
  assert.deepEqual(advanceIntake(s, { type: 'selection', slot: 'support', value: ['power_wheelchair'] }).slots, {});
  assert.equal(plan(advanceIntake(s, { type: 'consent', allowed: false })).reason, 'ai_consent_declined');
  assert.equal(plan(collecting()).question, 'residency');
});
test('existing customers stay human without collecting new facts', () => {
  const s = newIntake('en', false);
  assert.equal(plan(s).reason, 'existing_customer');
  assert.deepEqual(advanceIntake(s, { type: 'selection', slot: 'timing', value: 'November 2027' }), s);
});
test('multi-field free text fills known slots once and preserves month-only wording', () => {
  const s = interpreted(collecting(), answer({ timing: { value: 'November 2027', evidence: 'November 2027' }, duration: { value: { value: 7, unit: 'days' }, evidence: '7 days' } }), 'November 2027 for 7 days');
  assert.equal(s.slots.timing, 'November 2027'); assert.deepEqual(s.slots.duration, { value: 7, unit: 'days' });
  assert.equal(plan(s).question, 'residency'); assert.equal(Object.hasOwn(s.slots, 'startDate'), false);
});
test('summary confirmation is required before any candidate is selected', () => {
  const s = completed(); assert.equal(plan(s).action, 'review'); assert.deepEqual(plan(s).candidates, []);
  assert.equal(plan(advanceIntake(s, { type: 'confirm', revision: s.revision })).action, 'recommend');
  assert.equal(plan(advanceIntake(collecting(), { type: 'confirm', revision: 1 })).action, 'ask');
});
test('correction invalidates previous confirmation including after recommendation', () => {
  const before = completed(); const s = advanceIntake(before, { type: 'selection', slot: 'cities', value: ['Tokyo'] });
  assert.equal(advanceIntake(s, { type: 'confirm', revision: before.revision }).phase, 'review');
  const corrected = advanceIntake(confirmed(), { type: 'selection', slot: 'budget', value: { ...baseSlots.budget, amount: 400000 } });
  assert.equal(corrected.phase, 'review'); assert.equal(plan(corrected).candidates.length, 0);
});
test('source state is immutable', () => {
  const s = collecting(); const snapshot = structuredClone(s); advanceIntake(s, { type: 'selection', slot: 'cities', value: ['Tokyo'] }); assert.deepEqual(s, snapshot);
});
for (const text of ['STOP', 'unsubscribe', '停止', '取消訂閱', '取消订阅', '수신 거부']) test(`opt-out bypasses model output: ${text}`, () => {
  const s = interpreted(collecting(), null, text); assert.equal(plan(s).action, 'stop'); assert.equal(plan(s).message, '');
  assert.equal(advanceIntake(s, { type: 'consent', allowed: true }).phase, 'stopped');
});
for (const text of ['human', 'talk to an agent', '人工', '專人', '专人', '担当者', '상담원']) test(`human control bypasses model output: ${text}`, () => {
  assert.equal(plan(interpreted(collecting(), null, text)).action, 'handoff');
});
test('staff takeover is sticky and explicit opt-out still stops all output', () => {
  const s = advanceIntake(collecting(), { type: 'staff_takeover' });
  assert.deepEqual(interpreted(s, answer({ timing: { value: 'November 2027', evidence: 'November 2027' } })), s);
  assert.equal(plan(interpreted(s, null, 'STOP')).action, 'stop');
});
for (const intent of ['human', 'urgent', 'existing_booking']) test(`${intent} interpretation hands off at low confidence`, () => {
  assert.equal(plan(interpreted(collecting(), { intent, confidence: 0.01, facts: {} })).reason, intent);
});
test('one unclear answer retries the pending question; second hands off with known facts', () => {
  const first = interpreted(collecting(), { intent: 'other', confidence: 0.99, facts: {} });
  assert.equal(plan(first).question, 'residency'); const second = interpreted(first, null); assert.equal(plan(second).reason, 'repeated_uncertainty');
});
test('a valid answer resets uncertainty', () => {
  const first = interpreted(collecting(), null);
  const good = advanceIntake(first, { type: 'selection', slot: 'timing', value: 'Not decided' });
  assert.equal(good.unclearCount, 0); assert.equal(plan(interpreted(good, null)).question, 'residency');
});
for (const confidence of [0.89, NaN, Infinity, -1, 1.1, '0.99']) test(`invalid or provisional low confidence cannot supply facts: ${String(confidence)}`, () => {
  assert.deepEqual(interpreted(collecting(), { intent: 'answer', confidence, facts: { timing: { value: 'November 2027', evidence: 'November 2027' } } }).slots, {});
});
test('hallucinated evidence, unknown fields and mixed-validity patches are atomic failures', () => {
  for (const facts of [
    { timing: { value: 'December 2027', evidence: 'December 2027' } },
    { customerSent: { value: true, evidence: 'November' } },
    { timing: { value: 'November 2027', evidence: 'November 2027' }, duration: { value: { value: -7, unit: 'days' }, evidence: 'November' } },
  ]) assert.deepEqual(interpreted(collecting(), answer(facts)).slots, {});
});
for (const [slot, value] of [
  ['party', { adults: 0, children: 2 }], ['party', { adults: 1.5, children: 0 }], ['party', { adults: 2, children: 0, email: 'private@example.invalid' }],
  ['budget', { ...baseSlots.budget, amount: NaN }], ['budget', { ...baseSlots.budget, amount: -100 }], ['budget', { ...baseSlots.budget, currency: 'XXX' }],
  ['cities', []], ['cities', ['Tokyo', 'Tokyo']], ['duration', { value: 0, unit: 'days' }], ['duration', { value: 7, unit: 'weeks' }], ['support', ['none', 'step_free']], ['support', []], ['support', ['medical_diagnosis']],
] as const) test(`invalid ${slot} input cannot become a customer fact: ${JSON.stringify(value)}`, () => {
  assert.deepEqual(advanceIntake(collecting(), { type: 'selection', slot, value }).slots, {});
});
test('specialist support hands off immediately with requirements and missing questions', () => {
  const s = advanceIntake(collecting(), { type: 'selection', slot: 'support', value: ['hoist'] });
  assert.equal(plan(s).reason, 'specialist_support'); assert.deepEqual(plan(s).summary.support, ['hoist']); assert.ok(plan(s).missing.includes('timing'));
});
for (const locale of ['en', 'tc', 'sc', 'kr'] as const) test(`localized questions and summary: ${locale}`, () => {
  assert.ok(plan(collecting(locale)).message.length > 10);
  assert.equal(plan(completed({}, locale)).action, 'review');
  const p = product({ locale, url: `https://flat-travel.com/${locale}/tours/__synthetic_fixture__` });
  assert.equal(planIntake(confirmed({}, locale), [p], NOW).action, 'recommend');
});
test('unknown timing/duration/budget stay unknown rather than becoming fixed dates or zero price', () => {
  const s = confirmed({ timing: 'Not decided', duration: { value: null, unit: 'days' }, budget: { amount: null, currency: null, basis: null, scope: null } });
  assert.equal(plan(s).action, 'recommend'); assert.equal(s.slots.duration!.value, null);
});
test('only a current matching published candidate survives; absent catalogue hands off', () => {
  const s = confirmed();
  const p = plan(s); assert.equal(p.action, 'recommend'); assert.equal(p.candidates[0].budgetComparison, 'reference_within_budget');
  assert.equal(p.candidates[0].availability, 'unverified'); assert.equal(p.candidates[0].personalFit, 'unverified'); assert.equal(p.candidates[0].booking, 'not_booked');
  assert.equal(p.requiresHumanBeforeBooking, true); assert.equal(plan(s, []).reason, 'no_verified_catalogue_match');
});
for (const overrides of [
  { publication: { status: 'draft', revision: 'fake', validUntil: FUTURE } },
  { publication: { status: 'published', revision: '', validUntil: FUTURE } },
  { publication: { status: 'published', revision: 'fake', validUntil: '2026-10-26' } },
  { publication: { status: 'published', revision: 'fake', validUntil: 'invalid' } },
  { cities: ['Tokyo', 'Kyoto', 'Osaka'] }, { minDays: 8, maxDays: 9 }, { minDays: -1 },
  { locale: 'tc' }, { url: 'https://evil.invalid/en/tours/fake' }, { url: 'javascript:alert(1)' },
  { url: 'https://flat-travel.com/en/tours/fake?secret=1' }, { url: 'https://token@flat-travel.com/en/tours/fake' },
] as Partial<CatalogueItem>[]) test(`unverified/mismatched catalogue excluded: ${JSON.stringify(overrides)}`, () => {
  assert.equal(plan(confirmed(), [product(overrides)]).action, 'handoff');
});
test('no price conversions or party/scope assumptions; expired prices are unverified', () => {
  for (const changes of [{ currency: 'USD' }, { basis: 'per_person' }, { scope: 'hotels' }, { party: { adults: 3, children: 0 } }, { validUntil: '2026-10-26' }, { amount: NaN }]) {
    const p = product(); p.referencePrice = { ...p.referencePrice!, ...changes } as CatalogueItem['referencePrice'];
    assert.equal(plan(confirmed(), [p]).candidates[0].budgetComparison, 'unverified');
  }
  assert.equal(plan(confirmed({ budget: { ...baseSlots.budget, amount: 400000 } })).action, 'handoff');
});
test('published accessibility evidence is required for every requested capability', () => {
  const s = confirmed({ support: ['manual_wheelchair', 'accessible_bathroom'] });
  assert.equal(plan(s).action, 'handoff');
  const p = product({ supportEvidence: { manual_wheelchair: 'https://flat-travel.com/en/tours/__synthetic_fixture__', accessible_bathroom: 'https://flat-travel.com/en/tours/__synthetic_fixture__' } });
  assert.equal(plan(s, [p]).action, 'recommend'); assert.equal(plan(s, [p]).candidates[0].personalFit, 'unverified');
});
test('hotel-only requests cannot become package pitches or multi-city single-hotel bookings', () => {
  const s = confirmed({ cities: ['Tokyo'], preference: 'hotel', budget: { amount: 30000, currency: 'JPY', basis: 'room_night', scope: 'hotels' } });
  const hotel = product({ id: 'synthetic-hotel', kind: 'hotel', cities: ['Tokyo'], minDays: 1, maxDays: 181, url: 'https://flat-travel.com/en/hotels/__synthetic_fixture__' });
  assert.equal(plan(s).action, 'handoff'); assert.equal(plan(s, [hotel]).candidates[0].kind, 'hotel');
  assert.equal(plan(confirmed({ preference: 'hotel' }), [hotel]).action, 'handoff');
});
test('days and nights remain distinct', () => {
  assert.equal(plan(confirmed({ duration: { value: 6, unit: 'nights' } })).action, 'recommend');
  assert.equal(plan(confirmed({ duration: { value: 7, unit: 'nights' } })).action, 'handoff');
});
test('city preferences do not silently impose a route order', () => {
  assert.equal(plan(confirmed({ cities: ['Kyoto', 'Tokyo'] })).action, 'recommend');
});
test('either preference includes both product types when both are eligible, max three unique options', () => {
  const p = product({ cities: ['Tokyo'] });
  const hotel = product({ id: 'hotel', kind: 'hotel', cities: ['Tokyo'], url: 'https://flat-travel.com/en/hotels/__synthetic_fixture__' });
  const s = confirmed({ cities: ['Tokyo'], preference: 'either' });
  const list = plan(s, [p, { ...p, id: 'two' }, { ...p, id: 'three' }, hotel, p]).candidates;
  assert.equal(list.length, 3); assert.ok(list.some(v => v.kind === 'hotel')); assert.equal(new Set(list.map(v => v.id)).size, 3);
});
test('conversation policy has no database, provider or credential side effects', () => {
  const entry = readFileSync('src/index.ts', 'utf8'); const hook = readFileSync('src/routes/wa-webhook.ts', 'utf8');
  assert.ok(!entry.includes('whatsapp-intake-preview')); assert.ok(!hook.includes('whatsapp-intake-preview'));
  const code = readFileSync('src/services/whatsapp-intake.ts', 'utf8');
  assert.ok(!/fetch\s*\(|env\.|\.prepare\(|sendInboundWelcome\(/.test(code));
});
test.after(() => { globalThis.fetch = originalFetch; });
