import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { normalizeLeadAttribution } from '../src/services/lead-attribution.js';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { travelQuoteIntents } from '../src/routes/travel-quote-intents.js';
import { FLATWORKER_TRAVEL_QUOTE_TIMEOUT_MS, syncTravelQuoteToFlatworker } from '../src/services/flatworker-travel-quote.js';
import { parseTravelQuoteIntent, travelQuoteNotificationCopy, travelQuoteReceiptMetadata as travelQuoteReceiptMetadataForTest } from '../src/services/travel-quote-intent.js';

assert.equal(FLATWORKER_TRAVEL_QUOTE_TIMEOUT_MS, 45_000);

const rows: Array<Record<string, any>> = [];
const slackPosts: Array<Record<string, any>> = [];
const flatworkerPosts: Array<Record<string, any>> = [];

function statement(sql: string) {
  let bindings: any[] = [];
  return {
    bind(...values: any[]) {
      bindings = values;
      return this;
    },
    async run() {
      if (sql.startsWith('INSERT OR IGNORE INTO notifications')) {
        const [id, title, body, metadata] = bindings;
        if (rows.some((item) => item.id === id)) return { success: true, meta: { changes: 0 } };
        rows.push({
          id,
          event_type: 'travel_quote_intent',
          title,
          body,
          channel: 'slack',
          status: 'pending',
          metadata,
        });
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.startsWith('UPDATE notifications SET status')) {
        const [status, id] = bindings;
        const row = rows.find((item) => item.id === id);
        if (row) row.status = status;
        return { success: true, meta: { changes: row ? 1 : 0 } };
      }
      if (sql.startsWith('UPDATE notifications SET title')) {
        const [title, body, metadata, fallbackMetadata, id] = bindings;
        const row = rows.find((item) => item.id === id);
        if (row) Object.assign(row, { title, body, metadata: JSON.stringify({...JSON.parse(metadata), attribution: JSON.parse(row.metadata).attribution || JSON.parse(fallbackMetadata).attribution}) });
        return { success: true, meta: { changes: row ? 1 : 0 } };
      }
      throw new Error(`Unexpected run() SQL: ${sql}`);
    },
  };
}

const app = new Hono();
app.route('/', travelQuoteIntents);
const env = { DB: { prepare: statement }, SLACK_BOT_TOKEN: 'test-slack-token', FLATWORKER_API_BASE_URL: 'https://travelworker.example', FLATWORKER_TRAVEL_QUOTE_TOKEN: 'travel-quote-token' } as any;

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  if (String(input) === 'https://slack.com/api/chat.postMessage') {
    slackPosts.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (String(input) === 'https://travelworker.example/api/integrations/travel-quote-intents') {
    const requestBody = JSON.parse(String(init?.body || '{}'));
    flatworkerPosts.push({ headers: init?.headers, body: requestBody });
    if (requestBody.quoteReference === 'FTQ-20260801-FF12AA34') return new Response(JSON.stringify({ error: 'test failure' }), { status: 503, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ status: flatworkerPosts.length === 1 ? 'created' : 'existing', caseId: 'flat-travel-ftq-20260801-ab12cd34', caseUrl: 'https://travelworker-web.pages.dev/cases/flat-travel-ftq-20260801-ab12cd34', profileStored: Boolean(requestBody.customerName), automationReadiness: { status: 'needs_data', blockingIssueCount: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return originalFetch(input, init);
}) as typeof fetch;

async function request(payload: Record<string, unknown>, origin = 'https://flat-travel-design-preview.flat-travel.workers.dev') {
  return app.fetch(new Request('https://line-flattravel.flat-travel.workers.dev/api/travel/quote-intents', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, 'cf-connecting-ip': '203.0.113.10' },
    body: JSON.stringify(payload),
  }), env);
}

const payload = {
  attribution: {schemaVersion:'flat-travel-attribution-v1',status:'captured',firstTouch:{utm:{source:'whatsapp',medium:'messaging',campaign:'wa_travel_scenario_v2',content:'whole_trip'},landingPath:'/en'},lastTouch:{utm:{source:'whatsapp',medium:'messaging',campaign:'wa_travel_scenario_v2',content:'whole_trip'},landingPath:'/en'},route:['/en','/en/tailor-made']},
  quoteReference: 'FTQ-20260801-AB12CD34',
  mode: 'journey',
  channel: 'whatsapp',
  source: 'flat-travel-design-preview',
  tourId: 'C16',
  title: 'Tokyo 4-day modern tour',
  startDate: '2026-11-10',
  days: 4,
  travellers: 2,
  route: ['Tokyo'],
  packageTotalJpy: 480000,
  priceStatus: 'Estimate only',
  profileSchemaVersion: 'flat-travel-traveller-v3',
  customerName: 'Alex Traveller',
  givenName: 'Alex',
  familyName: 'Traveller',
  email: 'system-test@example.com',
  bodyHeightCm: 178.5,
  bodyWeightKg: 81.5,
  wheelchairBrand: 'Permobil',
  wheelchairModel: 'M3 Corpus',
  wheelchairWeightKg: 207.4,
  mobilityDeviceType: 'Power wheelchair',
  assistanceMethod: 'companion',
  boardingPreference: 'Remain seated in wheelchair',
  supportNeeds: ['Transfers', 'Bathroom support'],
  supportNote: 'Transfer board required',
  profileConsentVersion: 'flat-travel-profile-v1',
  profileConsentedAt: '2026-08-01T10:00:00.000Z',
  agreementSnapshot: {
    schemaVersion: 'flat-travel-agreement-v1',
    capturedAt: '2026-08-01T10:00:00.000Z',
    agreementBasis: 'customer_selected_package',
    agreementStatus: 'selected_for_quote',
    itinerary: { title: 'Tokyo 4-day modern tour', tourId: 'C16', startDate: '2026-11-10', days: 4, travellers: 2, route: ['Tokyo'] },
    customer: { name: 'Alex Traveller', mobilityDeviceType: 'Power wheelchair', wheelchairBrand: 'Permobil', wheelchairModel: 'M3 Corpus', supportNote: '' },
    hotels: [{ stayId: 'tokyo-1', sanityId: 'FT-H-TOKYO', didaHotelId: '1588010', city: 'Tokyo', nights: 3, checkInDate: '2026-11-10', checkOutDate: '2026-11-13', name: 'Tokyo Hotel', roomType: 'Accessible Twin', rooms: [{ requestedRoomType: 'accessible', adultsPerRoom: 2, roomCount: 1, roomName: 'Accessible Twin', bedType: 'Twin', inventoryCount: 1, estimateJpy: 240000, availabilityStatus: 'priced_for_selected_dates', physicalAccessibilityConfirmed: false }], mealPlan: 'Breakfast included', cancellationPolicy: 'Free cancellation until 2026-11-05', cancellationType: 'free_cancellation_until', cancellationDeadline: '2026-11-05', roomSizeM2: 32, bathroomInfo: 'Roll-in shower', toiletInfo: 'Grab bars', selectionType: 'listed', selectionStatus: 'customer_selected', availabilityStatus: 'priced_for_selected_dates', accessibilityStatus: 'requires_human_confirmation', priceStatus: 'live_rate', rateSource: 'dida_live', didaSaleAvailable: true, liveCheckedAt: '2026-08-01T10:00:00.000Z', request: '', estimateJpy: 240000, costEvidence: {supplierCostJpy:192000,markupPercent:25,checkedAt:'2026-08-01T10:00:00.000Z',source:'dida_observed_jpy_v1'} }],
    railAndTransfers: [
      { id: 'transfer-1', sanityId: 'FT-M-TOKYO-STATION', dayStart: 2, dayEnd: 2, serviceDate: '2026-11-11', origin: 'Tokyo hotel', destination: 'Tokyo Station', mode: 'Taxi / private vehicle', preferredTimeSlot: '08-10', preferredTimeLabel: '8–10 AM', selectionStatus: 'customer_selected', supplierStatus: 'requires_confirmation', unitPriceJpy: 35000, priceBasis: 'perVehicle', passengerCapacity: 4, bidirectional: true, estimateJpy: 35000, displayGroupId: 'tokyo-kyoto', displayGroupOrigin: 'Tokyo', displayGroupDestination: 'Kyoto', displayGroupSequence: 1, displayGroupMemberCount: 3, timeControlMovement: false },
      { id: 'rail-1', sanityId: 'FT-M-TOKYO-KYOTO', dayStart: 2, dayEnd: 2, serviceDate: '2026-11-11', origin: 'Tokyo Station', destination: 'Kyoto Station', mode: 'Shinkansen / rail', preferredTimeSlot: '08-10', preferredTimeLabel: '8–10 AM', selectionStatus: 'customer_selected', supplierStatus: 'requires_confirmation', unitPriceJpy: 13970, priceBasis: 'perPerson', passengerCapacity: 4, bidirectional: false, estimateJpy: 27940, displayGroupId: 'tokyo-kyoto', displayGroupOrigin: 'Tokyo', displayGroupDestination: 'Kyoto', displayGroupSequence: 2, displayGroupMemberCount: 3, timeControlMovement: true },
      { id: 'transfer-2', sanityId: 'FT-M-KYOTO-STATION', dayStart: 2, dayEnd: 2, serviceDate: '2026-11-11', origin: 'Kyoto Station', destination: 'Kyoto hotel', mode: 'Taxi / private vehicle', preferredTimeSlot: '08-10', preferredTimeLabel: '8–10 AM', selectionStatus: 'customer_selected', supplierStatus: 'requires_confirmation', unitPriceJpy: 35000, priceBasis: 'perVehicle', passengerCapacity: 4, bidirectional: true, estimateJpy: 35000, displayGroupId: 'tokyo-kyoto', displayGroupOrigin: 'Tokyo', displayGroupDestination: 'Kyoto', displayGroupSequence: 3, displayGroupMemberCount: 3, timeControlMovement: false },
    ],
    selections: [{
      id: 'tour-1', sanityId: 'FT-T-TOKYO', title: 'Tokyo Highlights', dayLabel: 'Day 2', kind: 'Experience', selectionStatus: 'customer_selected', estimateJpy: 100000,
      bundleId: 'tokyo-guide-bundle', customerBundleLabel: 'Tokyo Highlights — charter with guide', customerPriceJpy: 100000,
      componentTariffs: [
        { tariffId: 'FT-CHARTER-TOKYO-1D', role: 'charter', label: 'Tokyo accessible charter', category: 'charter', unitPriceJpy: 60000, priceBasis: 'perArrangement', quantity: 1 },
        { tariffId: 'FT-GUIDE-EN-TOKYO-1D', role: 'guide', label: 'English-speaking guide', category: 'activity', unitPriceJpy: 40000, priceBasis: 'perArrangement', quantity: 1 },
      ],
    }],
    supportSelections: [
      { tariffId: 'FT-SUPPORT-WHILL-F', sanityId: 'journey-support-whill-model-f', title: 'WHILL Model F rental', category: 'equipment_rental', pricingModel: 'durationBand', durationDays: 4, areaCount: 1, customerPriceJpy: 50000, priceStatus: 'calculated', hotelBookingRequired: true, deliveryAndPickupIncluded: true },
    ],
    includedItems: ['Hotels', 'Breakfast'],
    excludedItems: ['International flights'],
    estimate: { currency: 'JPY', total: 480000, kind: 'planning_estimate', priceConfirmed: false },
    tailorMade: null,
    openConfirmations: ['Hotel physical accessibility fit', 'Exact Shinkansen service and seats'],
  },
  createdAt: '2026-08-01T10:00:00.000Z',
};

const created = await request(payload);
assert.equal(created.status, 202);
assert.deepEqual(await created.json(), { success: true, duplicate: false, slackNotified: true, reference: payload.quoteReference, flatworkerDraft: { status: 'created', caseId: 'flat-travel-ftq-20260801-ab12cd34', caseUrl: 'https://travelworker-web.pages.dev/cases/flat-travel-ftq-20260801-ab12cd34', profileStored: true, automationReadiness: { status: 'needs_data', blockingIssueCount: 2 } } });
assert.equal(rows.length, 1);
assert.equal(JSON.parse(String(rows[0].metadata)).attribution.lastTouch.utm.source, 'whatsapp');
assert.equal((flatworkerPosts[0].body.attribution as any).lastTouch.utm.source, 'whatsapp');
assert.equal((flatworkerPosts[0].body.attribution as any).lastTouch.utm.content, 'whole_trip');
assert.equal((flatworkerPosts[0].body.attribution as any).lastTouch.utm.campaign, 'wa_travel_scenario_v2');
assert.equal(rows[0].event_type, 'travel_quote_intent');
assert.equal(rows[0].channel, 'slack');
assert.equal(rows[0].status, 'sent');
assert.match(rows[0].body, /Tokyo 4-day modern tour/);
assert.match(rows[0].body, /顧客が選択したホテル/);
assert.match(rows[0].body, /Accessible Twin/);
assert.match(rows[0].body, /8–10 AM/);
assert.match(rows[0].body, /含まないもの/);
assert.match(rows[0].body, /FlatWorker: created/);
assert.match(rows[0].body, /連絡CTA: WhatsApp（WA CTA）/);
assert.match(rows[0].body, /相談段階: 旅行条件・見積相談/);
assert.doesNotMatch(rows[0].body, /情報収集段階のため/);

const earlyLead = parseTravelQuoteIntent({ ...payload,
  source: 'flat-travel-trip-chat', mode: 'private', channel: 'email',
  title: 'Japan travel information enquiry', tourId: null,
  startDate: null, days: null, travellers: null, route: [], packageTotalJpy: null,
  priceStatus: 'not_quoted',
  agreementSnapshot: { ...payload.agreementSnapshot,
    itinerary: { title: 'Japan travel information enquiry', tourId: '', startDate: null, days: null, travellers: null, route: [] },
    hotels: [], railAndTransfers: [], selections: [], supportSelections: [],
    estimate: { currency: 'JPY', total: null, kind: 'not_quoted', priceConfirmed: false },
  },
});
assert.equal(earlyLead.ok, true);
if (earlyLead.ok) {
  for (const named of [false, true]) {
    const body = travelQuoteNotificationCopy(earlyLead.value, undefined, named).body;
    assert.match(body, /受付経路: Flat Travel公式サイト・旅行相談チャット/);
    assert.match(body, /相談段階: 情報収集（Just researching Japan）/);
    assert.match(body, /未入力項目: 日程・人数・行程（情報収集段階のため、担当者がこれからヒアリング）/);
    assert.match(body, /連絡CTA: Email（メールCTA）/);
  }
  const planning = travelQuoteNotificationCopy({ ...earlyLead.value, title: 'Japan travel planning enquiry' }).body;
  assert.match(planning, /相談段階: 旅行相談（詳細は担当者確認）/);
  assert.doesNotMatch(planning, /Just researching Japan|情報収集段階のため/);
}
assert.match(rows[0].body, /FlatWorkerへ暗号化保存済み/);
assert.match(rows[0].body, /自動見積: データ不足 2件/);
assert.doesNotMatch(rows[0].body, /Alex|Traveller|Permobil|M3 Corpus|Transfer board|Power wheelchair|companion|Remain seated|178\.5|81\.5|207\.4/);
assert.equal(JSON.parse(rows[0].metadata).agreementSnapshot.hotels[0].name, 'Tokyo Hotel');
assert.equal(JSON.parse(rows[0].metadata).profileStored, true);
assert.doesNotMatch(rows[0].metadata, /Alex|Traveller|Permobil|M3 Corpus|Transfer board|Power wheelchair|companion|Remain seated|178\.5|81\.5|207\.4/);
assert.equal(slackPosts.length, 1);
assert.match(String(slackPosts[0].text), /FTQ-20260801-AB12CD34/);
assert.match(String(slackPosts[0].text), /顧客名: Alex Traveller/);
assert.doesNotMatch(String(slackPosts[0].text), /Permobil|M3 Corpus|Transfer board|Power wheelchair|companion|Remain seated|178\.5|81\.5|207\.4/);
assert.equal(flatworkerPosts.length, 1);
assert.equal(flatworkerPosts[0].body.agreementSnapshot.railAndTransfers[0].preferredTimeSlot, '08-10');
assert.equal(flatworkerPosts[0].body.agreementSnapshot.railAndTransfers.length, 3);
assert.deepEqual(flatworkerPosts[0].body.agreementSnapshot.railAndTransfers.map((movement: any) => movement.displayGroupSequence), [1, 2, 3]);
assert.equal(flatworkerPosts[0].body.agreementSnapshot.railAndTransfers[1].timeControlMovement, true);
assert.equal(flatworkerPosts[0].body.agreementSnapshot.hotels[0].cancellationType, 'free_cancellation_until');
assert.deepEqual(flatworkerPosts[0].body.agreementSnapshot.hotels[0].rooms, [{ requestedRoomType: 'accessible', adultsPerRoom: 2, roomCount: 1, roomName: 'Accessible Twin', bedType: 'Twin', inventoryCount: 1, estimateJpy: 240000, availabilityStatus: 'priced_for_selected_dates', physicalAccessibilityConfirmed: false }]);
assert.equal(flatworkerPosts[0].body.agreementSnapshot.hotels[0].rateSource, 'dida_live');
assert.deepEqual(flatworkerPosts[0].body.agreementSnapshot.hotels[0].costEvidence,{supplierCostJpy:192000,markupPercent:25,checkedAt:'2026-08-01T10:00:00.000Z',source:'dida_observed_jpy_v1'});
for(const patch of [{supplierCostJpy:1},{supplierCostJpy:Infinity},{markupPercent:40},{checkedAt:'invalid'},{source:'untrusted'}]){
 const invalid=structuredClone(flatworkerPosts[0].body);Object.assign(invalid.agreementSnapshot.hotels[0].costEvidence,patch);
 const parsed=parseTravelQuoteIntent(invalid);assert(parsed.ok);if(parsed.ok)assert.equal(parsed.value.agreementSnapshot.hotels[0].costEvidence,null);
}

assert.equal(flatworkerPosts[0].body.agreementSnapshot.hotels[0].didaSaleAvailable, true);
assert.equal(flatworkerPosts[0].body.agreementSnapshot.hotels[0].liveCheckedAt, '2026-08-01T10:00:00.000Z');
assert.equal(flatworkerPosts[0].body.agreementSnapshot.hotels[0].sanityId, 'FT-H-TOKYO');
assert.equal(flatworkerPosts[0].body.agreementSnapshot.railAndTransfers[1].sanityId, 'FT-M-TOKYO-KYOTO');
assert.equal(flatworkerPosts[0].body.agreementSnapshot.railAndTransfers[1].unitPriceJpy, 13970);
assert.equal(flatworkerPosts[0].body.agreementSnapshot.railAndTransfers[1].fixedUnitPriceJpy, 13970);
assert.equal(flatworkerPosts[0].body.agreementSnapshot.railAndTransfers[1].priceBasis, 'perPerson');
assert.equal(flatworkerPosts[0].body.agreementSnapshot.railAndTransfers[1].passengerCapacity, 4);
assert.equal(flatworkerPosts[0].body.agreementSnapshot.railAndTransfers[1].bidirectional, false);
assert.equal(flatworkerPosts[0].body.agreementSnapshot.selections[0].sanityId, 'FT-T-TOKYO');
assert.equal(flatworkerPosts[0].body.agreementSnapshot.selections[0].componentTariffs[1].tariffId, 'FT-GUIDE-EN-TOKYO-1D');
assert.equal(flatworkerPosts[0].body.agreementSnapshot.selections[0].customerPriceJpy, 100000);
assert.equal(flatworkerPosts[0].body.agreementSnapshot.supportSelections[0].tariffId, 'FT-SUPPORT-WHILL-F');
assert.equal(flatworkerPosts[0].body.agreementSnapshot.supportSelections[0].customerPriceJpy, 50000);
assert.equal(flatworkerPosts[0].body.customerName, 'Alex Traveller');
assert.equal(flatworkerPosts[0].body.givenName, 'Alex');
assert.equal(flatworkerPosts[0].body.familyName, 'Traveller');
assert.equal(flatworkerPosts[0].body.email, 'system-test@example.com');
assert.equal(flatworkerPosts[0].body.bodyHeightCm, 178.5);
assert.equal(flatworkerPosts[0].body.bodyWeightKg, 81.5);
assert.equal(flatworkerPosts[0].body.wheelchairWeightKg, 207.4);
assert.equal(flatworkerPosts[0].body.assistanceMethod, 'companion');
assert.equal(flatworkerPosts[0].body.boardingPreference, 'Remain seated in wheelchair');
assert.deepEqual(flatworkerPosts[0].body.supportNeeds, ['Transfers', 'Bathroom support']);
assert.doesNotMatch(rows[0].metadata, /system-test@example\.com/);

const duplicate = await request({...payload, attribution: undefined});
assert.equal(JSON.parse(String(rows[0].metadata)).attribution.lastTouch.utm.source, "whatsapp");
assert.equal(duplicate.status, 200);
assert.deepEqual(await duplicate.json(), { success: true, duplicate: true, slackNotified: null, reference: payload.quoteReference, flatworkerDraft: { status: 'existing', caseId: 'flat-travel-ftq-20260801-ab12cd34', caseUrl: 'https://travelworker-web.pages.dev/cases/flat-travel-ftq-20260801-ab12cd34', profileStored: true, automationReadiness: { status: 'needs_data', blockingIssueCount: 2 } } });
assert.equal(rows.length, 1);
assert.equal(slackPosts.length, 1);
assert.equal(flatworkerPosts.length, 2);

const forbidden = await request(payload, 'https://example.com');
assert.equal(forbidden.status, 403);
assert.equal(rows.length, 1);

const malformed = await request({ ...payload, quoteReference: 'bad-reference' });
assert.equal(malformed.status, 400);
assert.equal(rows.length, 1);

const missingProfile = await request({
  ...payload,
  quoteReference: 'FTQ-20260801-ZZ12YY34',
  profileSchemaVersion: '',
  customerName: '',
  givenName: '',
  familyName: '',
  email: '',
  bodyHeightCm: null,
  bodyWeightKg: null,
  wheelchairBrand: '',
  wheelchairModel: '',
  wheelchairWeightKg: null,
  mobilityDeviceType: '',
  assistanceMethod: '',
  boardingPreference: '',
  supportNeeds: [],
  supportNote: '',
  profileConsentVersion: '',
  profileConsentedAt: '',
  agreementSnapshot: { ...payload.agreementSnapshot, customer: {} },
});
assert.equal(missingProfile.status, 202);
assert.equal(rows.length, 2);
assert.match(rows[1].body, /顧客プロフィール: FlatWorkerで要確認/);

const missingConsent = await request({ ...payload, quoteReference: 'FTQ-20260801-CC12DD34', profileConsentVersion: '', profileConsentedAt: '' });
assert.equal(missingConsent.status, 400);

const missingPowerWeights = parseTravelQuoteIntent({ ...payload, bodyWeightKg: null, wheelchairWeightKg: null });
assert.equal(missingPowerWeights.ok, false);
const powerWithoutWheelchairWeight = parseTravelQuoteIntent({ ...payload, wheelchairWeightKg: null });
assert.equal(powerWithoutWheelchairWeight.ok, true);
const manualWithoutWeights = parseTravelQuoteIntent({ ...payload, mobilityDeviceType: 'Manual wheelchair', bodyWeightKg: null, wheelchairWeightKg: null });
assert.equal(manualWithoutWeights.ok, true);
const manualWithoutModel = parseTravelQuoteIntent({ ...payload, mobilityDeviceType: 'Manual wheelchair', wheelchairModel: '', bodyWeightKg: null, wheelchairWeightKg: null });
assert.equal(manualWithoutModel.ok, true);
const missingFamilyName = parseTravelQuoteIntent({ ...payload, familyName: '' });
assert.equal(missingFamilyName.ok, false);
const legacySingleName = parseTravelQuoteIntent({ ...payload, givenName: '', familyName: '' });
assert.equal(legacySingleName.ok, true);

const legacyMovementPricePayload = structuredClone(payload);
delete legacyMovementPricePayload.agreementSnapshot.railAndTransfers[1].unitPriceJpy;
legacyMovementPricePayload.agreementSnapshot.railAndTransfers[1].fixedUnitPriceJpy = 13970;
const legacyMovementPrice = parseTravelQuoteIntent(legacyMovementPricePayload);
assert.equal(legacyMovementPrice.ok, true);
if (legacyMovementPrice.ok) {
  assert.equal(legacyMovementPrice.value.agreementSnapshot.railAndTransfers[1].unitPriceJpy, 13970);
}

for (const [field, expectedError] of [
  ['unitPriceJpy', 'Journey movement tariff required'],
  ['priceBasis', 'Journey movement pricing basis required'],
  ['bidirectional', 'Journey movement direction contract required'],
] as const) {
  const invalid = structuredClone(payload);
  delete invalid.agreementSnapshot.railAndTransfers[0][field];
  const result = parseTravelQuoteIntent(invalid);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, expectedError);
}

const missingCapacity = structuredClone(payload);
missingCapacity.agreementSnapshot.railAndTransfers[0].priceBasis = 'perVehicle';
delete missingCapacity.agreementSnapshot.railAndTransfers[0].passengerCapacity;
const missingCapacityResult = parseTravelQuoteIntent(missingCapacity);
assert.equal(missingCapacityResult.ok, false);
if (!missingCapacityResult.ok) assert.equal(missingCapacityResult.error, 'Journey movement capacity required');

const bundleMismatch = structuredClone(payload);
bundleMismatch.agreementSnapshot.selections[0].customerPriceJpy = 99999;
const bundleMismatchResult = parseTravelQuoteIntent(bundleMismatch);
assert.equal(bundleMismatchResult.ok, false);
if (!bundleMismatchResult.ok) assert.equal(bundleMismatchResult.error, 'Journey bundle customer price must equal component tariffs');

const missingSupportPrice = structuredClone(payload);
delete missingSupportPrice.agreementSnapshot.supportSelections[0].customerPriceJpy;
const missingSupportPriceResult = parseTravelQuoteIntent(missingSupportPrice);
assert.equal(missingSupportPriceResult.ok, false);
if (!missingSupportPriceResult.ok) assert.equal(missingSupportPriceResult.error, 'Journey support tariff contract invalid');

const failedIntake = await request({ ...payload, quoteReference: 'FTQ-20260801-FF12AA34' });
assert.equal(failedIntake.status, 503);
const failedBody = await failedIntake.json() as any;
assert.equal(failedBody.success, false);
assert.equal(failedBody.flatworkerDraft.status, 'failed');
assert.equal(rows.length, 3);
assert.match(rows[2].id, /^travel-quote-intake-failed:/);
assert.doesNotMatch(rows[2].metadata, /Alex|Traveller|Permobil|M3 Corpus|Transfer board|Power wheelchair|companion|Remain seated|178\.5|81\.5|207\.4/);


// Staff copy uses the validated submitted name; mentions cannot notify a channel.
const nameOnlyCopy = parseTravelQuoteIntent(payload);
assert.equal(nameOnlyCopy.ok, true);
if (nameOnlyCopy.ok) {
  const intent = nameOnlyCopy.value;
  assert.match(travelQuoteNotificationCopy({ ...intent, customerName: '<!channel> A&B' }, undefined, true).body, /顧客名: &lt;!channel&gt; A&amp;B/);
  assert.match(travelQuoteNotificationCopy({ ...intent, customerName: '' }, undefined, true).body, /顧客名: 未入力/);
  assert.doesNotMatch(travelQuoteNotificationCopy(intent).body, /Alex Traveller/);
  const legacy = parseTravelQuoteIntent({ ...payload, givenName: '', familyName: '' });
  assert.equal(legacy.ok, true);
  if (legacy.ok) assert.match(travelQuoteNotificationCopy(legacy.value, undefined, true).body, /顧客名: Alex Traveller/);
}

console.log('travel quote intent route: create, deduplicate, validate, staff name and redaction passed');

const untrusted = normalizeLeadAttribution({schemaVersion:'flat-travel-attribution-v1',status:'captured',lastTouch:{utm:{source:'meta',campaign:'person@example.com',content:'09012345678'},referrerOrigin:'https://example.com/path?email=private'},route:['/en?email=private',...Array(40).fill('/en')]});
assert.deepEqual(untrusted.lastTouch.utm,{source:'meta'});
assert.equal(untrusted.lastTouch.referrerOrigin,'https://example.com');
assert.equal(untrusted.route.length,30);
assert.equal(normalizeLeadAttribution(null).status,'unavailable');
const sqlSource=readFileSync('src/routes/travel-quote-intents.ts','utf8');
const sql=sqlSource.match(/`(UPDATE notifications SET title[^`]+)`/)![1];
const db=new DatabaseSync(':memory:');
db.exec('CREATE TABLE notifications(id TEXT,title TEXT,body TEXT,metadata TEXT)');
db.prepare('INSERT INTO notifications VALUES(?,?,?,?)').run('test','','',JSON.stringify({attribution:untrusted}));
const incoming=JSON.stringify({attribution:{status:'unavailable'},changed:true});
db.prepare(sql).run('','',incoming,incoming,'test');
const persisted=JSON.parse(String(db.prepare('SELECT metadata FROM notifications').get()!.metadata));
assert.deepEqual(persisted.attribution,untrusted);assert.equal(persisted.changed,true);
console.log('Attribution redaction, forwarding, D1 receipt and actual SQLite duplicate SQL passed');

// Monthly tailor-made requests must survive the actual API sanitizer and staff copy.
const monthlyPayload = {
  ...payload, mode: 'private', source: 'private-travel-studio', startDate: null,
  route: ['Nagasaki', 'Fukuoka'],
  agreementSnapshot: {
    ...payload.agreementSnapshot,
    itinerary: { ...payload.agreementSnapshot.itinerary, startDate: '', route: ['Nagasaki', 'Fukuoka'] },
    tailorMade: { choices: { startMonth: '2027-11', destinations: ['Nagasaki', 'Fukuoka'], cityStays: 'Nagasaki: 3 days; Fukuoka: 2 days' }, budgetUsd: 15000 },
  },
};
const monthly = parseTravelQuoteIntent(monthlyPayload);
assert.ok(monthly.ok);
if (monthly.ok) {
  assert.equal(monthly.value.startDate, null);
  assert.equal(monthly.value.agreementSnapshot.tailorMade?.choices.startMonth, '2027-11');
  assert.equal(monthly.value.agreementSnapshot.tailorMade?.choices.cityStays, 'Nagasaki: 3 days; Fukuoka: 2 days');
  const copy = travelQuoteNotificationCopy(monthly.value).body;
  assert.match(copy, /2027年11月のご希望（日付未定）/);
  assert.match(copy, /Nagasaki → Fukuoka/);
}
for (const month of ['', 'November', '2027-00', '2027-13']) {
  assert.equal(parseTravelQuoteIntent({ ...monthlyPayload, agreementSnapshot: { ...monthlyPayload.agreementSnapshot,
    tailorMade: { choices: { startMonth: month }, budgetUsd: null },
  } }).ok, false);
}
assert.equal(parseTravelQuoteIntent({ ...monthlyPayload, startDate: '2027-11-12' }).ok, true);
assert.equal(parseTravelQuoteIntent({ ...monthlyPayload, startDate: '2027-02-30' }).ok, false);
assert.equal(parseTravelQuoteIntent({ ...monthlyPayload, source: 'flat-travel-trip-chat', agreementSnapshot: { ...monthlyPayload.agreementSnapshot, tailorMade: null } }).ok, true);
console.log('Tailor month, additional destinations, missing dates and research-only compatibility passed');
const monthlyResponse = await request({ ...monthlyPayload, quoteReference: 'FT-20261024-MONTH123' });
assert.equal(monthlyResponse.status, 202);
assert.equal(flatworkerPosts.at(-1)?.body.agreementSnapshot.tailorMade.choices.startMonth, '2027-11');
assert.deepEqual(flatworkerPosts.at(-1)?.body.route, ['Nagasaki', 'Fukuoka']);
assert.equal(flatworkerPosts.at(-1)?.body.startDate, null);
assert.match(String(slackPosts.at(-1)?.text), /2027年11月のご希望（日付未定）/);
console.log('Monthly request forwarded through actual route to mocked FlatWorker and Slack');

// The public site restores these fields from its server-side tariff source.
// Losing them previously accepted the enquiry but produced an unpriced draft.
for (const stage of ['arrival', 'departure']) {
  const airport = {
    id: 'c21-airport-' + stage, sanityId: 'FT-M-AIR35000',
    origin: stage === 'arrival' ? 'Narita Airport (NRT)' : 'The Capitol Hotel Tokyu',
    destination: stage === 'arrival' ? 'The Capitol Hotel Tokyu' : 'Narita Airport (NRT)',
    category: 'transfer', quoteTariffKey: 'fujisakura_transfer',
    tariffHotelAddress: '東京都千代田区永田町', tariffHotelCity: 'Tokyo',
    journeyStage: stage, supplierId: 'registered-fujisakura', vehicleCount: 1,
    unitPriceJpy: 47000, priceBasis: 'perArrangement', passengerCapacity: null,
    bidirectional: true, estimateJpy: 47000,
  };
  const result = await request({ ...payload,
    quoteReference: stage === 'arrival' ? 'FTQ-20261026-A1B2C3D4' : 'FTQ-20261026-E5F6A7B8',
    agreementSnapshot: { ...payload.agreementSnapshot, railAndTransfers: [airport] },
  });
  assert.equal(result.status, 202);
  const forwarded = flatworkerPosts.at(-1)?.body.agreementSnapshot.railAndTransfers[0];
  for (const [key, value] of Object.entries(airport)) assert.deepEqual(forwarded[key], value, key);
  assert.equal(flatworkerPosts.at(-1)?.body.agreementSnapshot.hotels[0].estimateJpy, 240000);
}
console.log('Airport tariff identity and hotel price survive the actual intake relay in both directions');

// Public enquiries can be submitted before the traveller knows the chair identity.
for (const device of ['Manual wheelchair','Power wheelchair','Mobility scooter']) {
  const optionalChair = structuredClone(payload);
  optionalChair.mobilityDeviceType = device;
  optionalChair.wheelchairBrand = ''; optionalChair.wheelchairModel = '';
  optionalChair.boardingPreference = 'Not sure yet';
  optionalChair.bodyWeightKg = 80;
  const result = parseTravelQuoteIntent(optionalChair);
  assert.equal(result.ok, true, JSON.stringify(result));
  if(result.ok){assert.equal(result.value.wheelchairBrand,'');assert.equal(result.value.wheelchairModel,'');}
}
console.log('Optional wheelchair identity accepted without placeholders; consent and safety fields preserved');

// Individually rounded room tariffs retain observed costs and their own meals.
const mixedCosts:any=structuredClone(payload);
const mixedHotel=mixedCosts.agreementSnapshot.hotels[0];
mixedHotel.estimateJpy=100002;
mixedHotel.costEvidence={supplierCostJpy:80000.8,markupPercent:25,checkedAt:new Date().toISOString(),source:'dida_observed_jpy_v1',roomCosts:[{supplierCostJpy:40000.4,sellingPriceJpy:50001},{supplierCostJpy:40000.4,sellingPriceJpy:50001}]};
mixedHotel.rooms=[{...mixedHotel.rooms[0],estimateJpy:50001,mealPlan:'Breakfast included'},{...mixedHotel.rooms[0],estimateJpy:50001,mealPlan:'Room only'}];
const mixedParsed=parseTravelQuoteIntent(mixedCosts);assert(mixedParsed.ok);
if(mixedParsed.ok){assert.deepEqual(mixedParsed.value.agreementSnapshot.hotels[0].costEvidence,mixedHotel.costEvidence);assert.deepEqual(mixedParsed.value.agreementSnapshot.hotels[0].rooms.map(r=>r.mealPlan),['Breakfast included','Room only']);}
for(const patch of [{supplierCostJpy:true},{supplierCostJpy:1},{sellingPriceJpy:1}]){
 const invalid=structuredClone(mixedCosts);Object.assign(invalid.agreementSnapshot.hotels[0].costEvidence.roomCosts[0],patch);
 const parsed=parseTravelQuoteIntent(invalid);assert(parsed.ok);if(parsed.ok)assert.equal(parsed.value.agreementSnapshot.hotels[0].costEvidence,null);
}
console.log('PASS: observed mixed-room cost, individual rounding and meal preservation; malformed cost evidence rejected');

// Receipt stage and its opaque capability survive the actual authenticated relay.
for(const stage of ['initial','supplement'] as const){
 const input={...payload,mode:'private',source:'flat-travel-hotel-request',hotelRequestStage:stage,hotelSupplementToken:'a1'.repeat(32)};
 const parsed=parseTravelQuoteIntent(input);assert(parsed.ok);
 if(parsed.ok){assert.equal(parsed.value.hotelRequestStage,stage);assert.equal(parsed.value.hotelSupplementToken,input.hotelSupplementToken);const persisted=JSON.stringify(travelQuoteReceiptMetadataForTest(parsed.value,{status:'created',caseId:'fixture-case',profileStored:true}));assert(!persisted.includes(input.hotelSupplementToken));}
}
for(const patch of [{hotelSupplementToken:'short'},{hotelRequestStage:'unknown'},{source:'model-tour-search'}])assert.equal(parseTravelQuoteIntent({...payload,mode:'private',source:'flat-travel-hotel-request',hotelRequestStage:'initial',hotelSupplementToken:'a1'.repeat(32),...patch}).ok,false);
console.log('PASS: hotel receipt stage/capability validation and PII-free receipt metadata');
const relayFetch=globalThis.fetch;
try{
 for(const stage of ['initial','supplement'] as const){
  const parsed=parseTravelQuoteIntent({...payload,mode:'private',source:'flat-travel-hotel-request',hotelRequestStage:stage,hotelSupplementToken:'a1'.repeat(32)});assert(parsed.ok);if(!parsed.ok)continue;
  let forwarded:any;let compatible=true;
  globalThis.fetch=async(url,init)=>{assert.equal(String(url),'https://travelworker.example/api/integrations/travel-quote-intents');forwarded=JSON.parse(String(init?.body));assert.equal(new Headers(init?.headers).get('x-flat-travel-quote-token'),'travel-quote-token');return Response.json({status:'updated',caseId:'fixture-case',profileStored:true,...(compatible?{hotelRequestStage:stage}:{})});};
  const result=await syncTravelQuoteToFlatworker(parsed.value,env);assert.equal(result.hotelRequestStage,stage);assert.equal(forwarded.hotelRequestStage,stage);assert.equal(forwarded.hotelSupplementToken,'a1'.repeat(32));
  compatible=false;const old=await syncTravelQuoteToFlatworker(parsed.value,env);assert.equal(old.status,'failed');assert.equal(old.errorCode,'hotel_supplement_backend_unsupported');
 }
}finally{globalThis.fetch=relayFetch;}
console.log('PASS: real relay preserves receipt stage and capability; old backend receipts fail closed');
