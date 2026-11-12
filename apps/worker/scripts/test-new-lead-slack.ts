import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { ACCESSIBLE_JAPAN_FORM_ID } from '@line-crm/shared';
import { forms } from '../src/routes/forms.js';
import { webhook } from '../src/routes/webhook.js';
import { FLATCARE_ENQUIRY_FORM_ID, NEW_LEAD_CHANNEL, notifyNewFormLead, planningFormLeadDetails } from '../src/services/new-lead-slack.js';

const sql = new DatabaseSync(':memory:');
sql.exec(readFileSync('../../packages/db/schema.sql', 'utf8'));
sql.exec('ALTER TABLE auto_replies ADD COLUMN line_account_id TEXT');
const db = {
  prepare(query: string) {
    const statement = sql.prepare(query);
    let args: any[] = [];
    return {
      bind(...values: any[]) { args = values; return this; },
      async first() { return statement.get(...args) || null; },
      async all() { return { results: statement.all(...args) }; },
      async run() { return { meta: { changes: Number(statement.run(...args).changes) } }; },
    };
  },
  async batch(statements: any[]) {
    sql.exec('BEGIN');
    try {
      const result = [];
      for (const statement of statements) result.push(await statement.run());
      sql.exec('COMMIT');
      return result;
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
  },
};
const fields = ['first_name', 'last_name', 'contact_name', 'city_schedule', 'dates_decided', 'approximate_timing', 'private_note']
  .map(name => ({ name, label: name, type: name === 'city_schedule' ? 'city_dates' : 'text' }));
for (const id of [ACCESSIBLE_JAPAN_FORM_ID, FLATCARE_ENQUIRY_FORM_ID, '514279b7-3426-43bc-9226-9fcd13113ee7', 'supplier-survey']) {
  sql.prepare('INSERT INTO forms(id,name,fields) VALUES(?,?,?)').run(id, id, JSON.stringify(fields));
}
sql.prepare('INSERT INTO form_issues(id,form_id,name,slack_channel_id) VALUES(?,?,?,?)')
  .run('existing-case', ACCESSIBLE_JAPAN_FORM_ID, 'FlatWorker受注前アンケート', 'C_EXISTING_CASE');
const posts: any[] = [];
const env: any = {
  DB: db, SLACK_BOT_TOKEN: 'test-slack-token', LINE_CHANNEL_SECRET: 'test-line-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'test-line-token', WORKER_URL: 'https://worker.test',
  ACCESSIBLE_JAPAN_QUOTE_INTAKE_URL: 'https://backend.test/api/integrations/accessible-japan-quote-intents',
  ACCESSIBLE_JAPAN_QUOTE_INTAKE_TOKEN: 'test-intake-token',
};
let backendFailure = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://slack.com/api/chat.postMessage') {
    posts.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true });
  }
  if (url.startsWith('https://backend.test/') && backendFailure) return Response.json({}, {status: 500});
  if (url.startsWith('https://backend.test/')) return Response.json({ status: 'searching', caseId: 'persisted-case-123' }, { status: 202 });
  if (url.includes('api.line.me/v2/bot/profile/')) return Response.json({displayName: 'LINE Fixture'});
  throw new Error(`Unexpected network ${url}`);
};
const data = { first_name: 'Test <!channel>', last_name: 'Traveller', contact_name: 'Corporate Fixture',
  city_schedule: [{ city: 'Kyoto', startDate: '2027-05-09', endDate: '2027-05-12' },
    { city: 'Tokyo', startDate: '2027-05-02', endDate: '2027-05-09' }],
  dates_decided: 'Yes', private_note: 'PRIVATE_MEDICAL_DETAIL',
};
async function submit(id: string, issueId?: string) {
  const jobs: Promise<unknown>[] = [];
  const before = posts.length;
  const response = await forms.fetch(new Request(`https://worker.test/api/forms/${id}/submit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data, issueId }),
  }), env, { waitUntil(job: Promise<unknown>) { jobs.push(job); }, passThroughOnException() {} } as any);
  assert.equal(response.status, 201, await response.clone().text());
  await Promise.all(jobs);
  return { response: await response.json() as any, notices: posts.slice(before) };
}
try {
  const aj = await submit(ACCESSIBLE_JAPAN_FORM_ID);
  assert.equal(aj.notices.length, 1, 'AJ initial submission has one staff notice');
  assert.equal(aj.notices[0].channel, NEW_LEAD_CHANNEL);
  for (const expected of ['Accessible Japan', '/cases/persisted-case-123', 'Test &lt;!channel&gt; Traveller', '2027-05-02']) {
    assert.ok(aj.notices[0].text.includes(expected), expected);
  }
  assert.ok(!aj.notices[0].text.includes('PRIVATE_MEDICAL_DETAIL'));
  assert.equal(sql.prepare('SELECT slack_channel_id FROM form_submissions WHERE id = ?').get(aj.response.data.id)?.slack_channel_id, NEW_LEAD_CHANNEL);
  await Promise.all([notifyNewFormLead(env, 'accessibleJapan', aj.response.data.id), notifyNewFormLead(env, 'accessibleJapan', aj.response.data.id)]);
  assert.equal(posts.length, 1, 'Same submission cannot notify twice');
  backendFailure = true;
  const failedBackend = await submit(ACCESSIBLE_JAPAN_FORM_ID);
  assert.equal(failedBackend.notices.length, 1);
  assert.equal(failedBackend.notices[0].channel, NEW_LEAD_CHANNEL);
  assert.match(failedBackend.notices[0].text, /案件連携を確認/);
  backendFailure = false;
  const existing = await submit(ACCESSIBLE_JAPAN_FORM_ID, 'existing-case');
  assert.equal(existing.notices.length, 1);
  assert.equal(existing.notices[0].channel, 'C_EXISTING_CASE');
  const corp = await submit(FLATCARE_ENQUIRY_FORM_ID);
  assert.equal(corp.notices.length, 1);
  assert.equal(corp.notices[0].channel, NEW_LEAD_CHANNEL);
  assert.match(corp.notices[0].text, /Corporate Fixture/);
  const generic = await submit('514279b7-3426-43bc-9226-9fcd13113ee7');
  assert.equal(generic.notices.length, 1);
  assert.equal(generic.notices[0].channel, NEW_LEAD_CHANNEL);
  const supplier = await submit('supplier-survey');
  assert.equal(supplier.notices.length, 1);
  assert.equal(supplier.notices[0].channel, 'C0AL6RG7V9Q');
  assert.match(planningFormLeadDetails('fixture', { ...data, dates_decided: 'No', approximate_timing: 'Spring 2027' }), /旅行開始日 Spring 2027/);
  assert.match(planningFormLeadDetails('fixture', {}), /旅行開始日 未定・要確認/);

  // Exercise the signed LINE webhook and actual D1 batch, including replay.
  async function line(messageId: string, userId: string, text: string) {
    const body = JSON.stringify({ events: [{ type: 'message', timestamp: Date.now(), replyToken: 'fixture-reply', source: { type: 'user', userId }, message: { type: 'text', id: messageId, text } }] });
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.LINE_CHANNEL_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))).toString('base64');
    const jobs: Promise<unknown>[] = [];
    const response = await webhook.fetch(new Request('https://worker.test/webhook', {method: 'POST', headers: { 'X-Line-Signature': signature }, body}), env, {waitUntil(job: Promise<unknown>) { jobs.push(job); }} as any);
    assert.equal(response.status, 200);
    await Promise.all(jobs);
  }
  const beforeLine = posts.filter(post => post.channel === NEW_LEAD_CHANNEL).length;
  await line('line-first', 'line-fixture', 'Hello');
  await line('line-first', 'line-fixture', 'Hello');
  await line('line-next', 'line-fixture', 'More details');
  assert.equal(posts.filter(post => post.channel === NEW_LEAD_CHANNEL).length, beforeLine + 1);
  assert.match(posts.findLast(post => post.channel === NEW_LEAD_CHANNEL).text, /LINE Fixture/);
  await line('line-reference', 'line-quote-fixture', 'FTQ-20261112-ABCDEFGH');
  assert.equal(posts.filter(post => post.channel === NEW_LEAD_CHANNEL).length, beforeLine + 1);
  console.log('PASS: saved AJ/corporate/public form routes, existing-case and supplier routing, escaped names, earliest dates, missing dates, duplicate claims and signed LINE first-contact delivery');
} finally { globalThis.fetch = originalFetch; sql.close(); }
