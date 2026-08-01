import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { travelQuoteIntents } from '../src/routes/travel-quote-intents.js';

const rows: Array<Record<string, any>> = [];
const slackPosts: Array<Record<string, any>> = [];

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
      throw new Error(`Unexpected run() SQL: ${sql}`);
    },
  };
}

const app = new Hono();
app.route('/', travelQuoteIntents);
const env = { DB: { prepare: statement }, SLACK_BOT_TOKEN: 'test-slack-token' } as any;

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  if (String(input) === 'https://slack.com/api/chat.postMessage') {
    slackPosts.push(JSON.parse(String(init?.body || '{}')));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
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
  createdAt: '2026-08-01T10:00:00.000Z',
};

const created = await request(payload);
assert.equal(created.status, 202);
assert.deepEqual(await created.json(), { success: true, duplicate: false, slackNotified: true, reference: payload.quoteReference });
assert.equal(rows.length, 1);
assert.equal(rows[0].event_type, 'travel_quote_intent');
assert.equal(rows[0].channel, 'slack');
assert.equal(rows[0].status, 'sent');
assert.match(rows[0].body, /Tokyo 4-day modern tour/);
assert.match(rows[0].body, /Traveller: Alex Traveller/);
assert.match(rows[0].body, /Wheelchair: Permobil M3 Corpus/);
assert.match(rows[0].body, /Selected channel: whatsapp/);
assert.equal(slackPosts.length, 1);
assert.match(String(slackPosts[0].text), /FTQ-20260801-AB12CD34/);

const duplicate = await request(payload);
assert.equal(duplicate.status, 200);
assert.deepEqual(await duplicate.json(), { success: true, duplicate: true, slackNotified: null, reference: payload.quoteReference });
assert.equal(rows.length, 1);
assert.equal(slackPosts.length, 1);

const forbidden = await request(payload, 'https://example.com');
assert.equal(forbidden.status, 403);
assert.equal(rows.length, 1);

const malformed = await request({ ...payload, quoteReference: 'bad-reference' });
assert.equal(malformed.status, 400);
assert.equal(rows.length, 1);

const missingProfile = await request({ ...payload, quoteReference: 'FTQ-20260801-ZZ12YY34', customerName: '' });
assert.equal(missingProfile.status, 400);
assert.equal(rows.length, 1);

console.log('travel quote intent route: create, deduplicate, validate, and origin guard passed');
