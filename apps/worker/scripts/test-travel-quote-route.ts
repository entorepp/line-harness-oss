import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { travelQuoteIntents } from '../src/routes/travel-quote-intents.js';

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
        const [title, body, metadata, id] = bindings;
        const row = rows.find((item) => item.id === id);
        if (row) Object.assign(row, { title, body, metadata });
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
    return new Response(JSON.stringify({ status: flatworkerPosts.length === 1 ? 'created' : 'existing', caseId: 'flat-travel-ftq-20260801-ab12cd34', caseUrl: 'https://travelworker-web.pages.dev/cases/flat-travel-ftq-20260801-ab12cd34', profileStored: Boolean(requestBody.customerName) }), { status: 200, headers: { 'content-type': 'application/json' } });
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
  customerName: 'Alex Traveller',
  wheelchairBrand: 'Permobil',
  wheelchairModel: 'M3 Corpus',
  mobilityDeviceType: 'Power wheelchair',
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
    hotels: [{ stayId: 'tokyo-1', city: 'Tokyo', nights: 3, checkInDate: '2026-11-10', checkOutDate: '2026-11-13', name: 'Tokyo Hotel', roomType: 'Accessible Twin', mealPlan: 'Breakfast included', roomSizeM2: 32, bathroomInfo: 'Roll-in shower', toiletInfo: 'Grab bars', selectionType: 'listed', selectionStatus: 'customer_selected', availabilityStatus: 'priced_for_selected_dates', accessibilityStatus: 'requires_human_confirmation', priceStatus: 'estimate', request: '', estimateJpy: 240000 }],
    railAndTransfers: [{ id: 'rail-1', dayStart: 2, dayEnd: 2, serviceDate: '2026-11-11', origin: 'Tokyo', destination: 'Kyoto', mode: 'Shinkansen / rail', preferredTimeSlot: '08-10', preferredTimeLabel: '8–10 AM', selectionStatus: 'customer_selected', supplierStatus: 'requires_confirmation' }],
    selections: [{ id: 'tour-1', title: 'Tokyo Highlights', dayLabel: 'Day 2', kind: 'Experience', selectionStatus: 'customer_selected', estimateJpy: 30000 }],
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
assert.deepEqual(await created.json(), { success: true, duplicate: false, slackNotified: true, reference: payload.quoteReference, flatworkerDraft: { status: 'created', caseId: 'flat-travel-ftq-20260801-ab12cd34', caseUrl: 'https://travelworker-web.pages.dev/cases/flat-travel-ftq-20260801-ab12cd34', profileStored: true } });
assert.equal(rows.length, 1);
assert.equal(rows[0].event_type, 'travel_quote_intent');
assert.equal(rows[0].channel, 'slack');
assert.equal(rows[0].status, 'sent');
assert.match(rows[0].body, /Tokyo 4-day modern tour/);
assert.match(rows[0].body, /顧客が選択したホテル/);
assert.match(rows[0].body, /Accessible Twin/);
assert.match(rows[0].body, /8–10 AM/);
assert.match(rows[0].body, /含まないもの/);
assert.match(rows[0].body, /FlatWorker: created/);
assert.match(rows[0].body, /FlatWorkerへ暗号化保存済み/);
assert.doesNotMatch(rows[0].body, /Alex Traveller|Permobil|M3 Corpus|Transfer board|Power wheelchair/);
assert.equal(JSON.parse(rows[0].metadata).agreementSnapshot.hotels[0].name, 'Tokyo Hotel');
assert.equal(JSON.parse(rows[0].metadata).profileStored, true);
assert.doesNotMatch(rows[0].metadata, /Alex Traveller|Permobil|M3 Corpus|Transfer board|Power wheelchair/);
assert.equal(slackPosts.length, 1);
assert.match(String(slackPosts[0].text), /FTQ-20260801-AB12CD34/);
assert.doesNotMatch(String(slackPosts[0].text), /Alex Traveller|Permobil|M3 Corpus|Transfer board|Power wheelchair/);
assert.equal(flatworkerPosts.length, 1);
assert.equal(flatworkerPosts[0].body.agreementSnapshot.railAndTransfers[0].preferredTimeSlot, '08-10');
assert.equal(flatworkerPosts[0].body.customerName, 'Alex Traveller');
assert.deepEqual(flatworkerPosts[0].body.supportNeeds, ['Transfers', 'Bathroom support']);

const duplicate = await request(payload);
assert.equal(duplicate.status, 200);
assert.deepEqual(await duplicate.json(), { success: true, duplicate: true, slackNotified: null, reference: payload.quoteReference, flatworkerDraft: { status: 'existing', caseId: 'flat-travel-ftq-20260801-ab12cd34', caseUrl: 'https://travelworker-web.pages.dev/cases/flat-travel-ftq-20260801-ab12cd34', profileStored: true } });
assert.equal(rows.length, 1);
assert.equal(slackPosts.length, 1);
assert.equal(flatworkerPosts.length, 2);

const forbidden = await request(payload, 'https://example.com');
assert.equal(forbidden.status, 403);
assert.equal(rows.length, 1);

const malformed = await request({ ...payload, quoteReference: 'bad-reference' });
assert.equal(malformed.status, 400);
assert.equal(rows.length, 1);

const missingProfile = await request({ ...payload, quoteReference: 'FTQ-20260801-ZZ12YY34', customerName: '', wheelchairBrand: '', wheelchairModel: '', mobilityDeviceType: '', supportNeeds: [], supportNote: '', profileConsentVersion: '', profileConsentedAt: '', agreementSnapshot: { ...payload.agreementSnapshot, customer: {} } });
assert.equal(missingProfile.status, 202);
assert.equal(rows.length, 2);
assert.match(rows[1].body, /顧客プロフィール: FlatWorkerで要確認/);

const missingConsent = await request({ ...payload, quoteReference: 'FTQ-20260801-CC12DD34', profileConsentVersion: '', profileConsentedAt: '' });
assert.equal(missingConsent.status, 400);

const failedIntake = await request({ ...payload, quoteReference: 'FTQ-20260801-FF12AA34' });
assert.equal(failedIntake.status, 503);
const failedBody = await failedIntake.json() as any;
assert.equal(failedBody.success, false);
assert.equal(failedBody.flatworkerDraft.status, 'failed');
assert.equal(rows.length, 3);
assert.match(rows[2].id, /^travel-quote-intake-failed:/);
assert.doesNotMatch(rows[2].metadata, /Alex Traveller|Permobil|M3 Corpus|Transfer board|Power wheelchair/);

console.log('travel quote intent route: create, deduplicate, validate, and origin guard passed');
