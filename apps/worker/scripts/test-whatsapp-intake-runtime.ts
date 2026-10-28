import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { waWebhook } from '../src/routes/wa-webhook.js';
import { whatsappIntake } from '../src/routes/whatsapp-intake.js';
import { chats } from '../src/routes/chats.js';
import { authMiddleware } from '../src/middleware/auth.js';
import { takeOverIntake, decryptIntake, encryptIntake } from '../src/services/whatsapp-intake-store.js';
import { groundedIntakeFact, redactIntakeText, sensitiveIntakeText } from '../src/services/whatsapp-intake-ai.js';
import { advanceIntake, newIntake, planIntake } from '../src/services/whatsapp-intake.js';
import { projectHotels, projectJourneys } from '../src/services/whatsapp-intake-catalogue.js';

const PHONE = '15555550100';
const FULL = 'November 2027 for 7 days. Tokyo and Kyoto. Two adults and zero children. Budget JPY 600,000 total for the whole trip. No support needed. We prefer a package tour.';
const nullableFacts = () => Object.fromEntries(['timing','duration','cities','party','budget','support','preference'].map(k => [k, null]));
const fullFacts = () => ({
  timing: { value: 'November 2027', evidence: 'November 2027' }, duration: { value: { value: 7, unit: 'days' }, evidence: '7 days' }, cities: { value: ['Tokyo','Kyoto'], evidence: 'Tokyo and Kyoto' },
  party: { value: { adults: 2, children: 0 }, evidence: 'Two adults and zero children' }, budget: { value: { amount: 600000, currency: 'JPY', basis: 'party_total', scope: 'trip' }, evidence: 'Budget JPY 600,000 total for the whole trip' },
  support: { value: ['none'], evidence: 'No support needed' }, preference: { value: 'package', evidence: 'We prefer a package tour' },
});
function answer(facts: any = fullFacts(), extra: any = {}) { return { intent: 'answer', uncertain: false, locale: 'en', citiesOperation: 'replace', facts: { ...nullableFacts(), ...facts }, ...extra }; }
const catalogue = () => ({ source: 'Sanity published runtime Journey discovery data', dataset: 'production', fetchedAt: new Date().toISOString(), tours: [{ id: 'C07', title: 'Published fixture Tokyo and Kyoto', days: 7, cities: ['Tokyo','Kyoto','Tokyo'], supportedPartySizes: [1,2,3,4] }] });

async function harness(run: (h: any) => Promise<void>) {
  const sql = new DatabaseSync(':memory:'); sql.exec(readFileSync('../../packages/db/schema.sql','utf8'));
  for (const name of ['027_whatsapp_calls.sql','028_whatsapp_call_details.sql','029_whatsapp_inbound_welcomes.sql','030_browser_security_storage.sql','031_whatsapp_ai_intake.sql','032_whatsapp_intake_choices.sql']) sql.exec(readFileSync('../../packages/db/migrations/'+name,'utf8'));
  sql.exec(readFileSync('../../packages/db/migrations/031_whatsapp_ai_intake.sql','utf8'));
  sql.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,channel_type,whatsapp_business_account_id) VALUES('wa','12345','Test sender','provider-token','app-secret','whatsapp','1234567890')");
  const h: any = { sql, sends: [], models: [], notifications: [], jobs: [], outcome: 'accepted', modelOutput: answer(), failHistory: false, catalogue: catalogue(), beforeModel: null, beforeSend: null, identity: {status:'unlinked'}, linkResult: {status:'unlinked'}, identityReads: 0 };
  const db: any = { prepare(query: string) { const stmt = sql.prepare(query); let params: any[] = []; return { bind(...p: any[]) { params = p; return this; }, async first() { return stmt.get(...params) || null; }, async all() { return { success: true, results: stmt.all(...params) }; }, async run() {
    if (h.failHistory && query.includes('INSERT OR IGNORE INTO messages_log') && String(params[0]).startsWith('wa-intake-')) { h.failHistory = false; throw Error('synthetic local history failure'); }
    return { success: true, meta: { changes: Number(stmt.run(...params).changes) } };
  } }; } };
  h.env = { DB: db, API_KEY: 'staff-key', OPENAI_API_KEY: 'model-key', WHATSAPP_INTAKE_ENCRYPTION_KEY: 'synthetic-encryption-secret-32-bytes', WHATSAPP_INTAKE_MODE: 'test', WHATSAPP_INTAKE_MODEL: 'gpt-5.4-nano', WHATSAPP_INTAKE_ACCOUNTS: 'wa:12345',
    WHATSAPP_INTAKE_TEST_PHONE_HASHES: createHash('sha256').update(PHONE).digest('hex'), WHATSAPP_INTAKE_START_AT: new Date(Date.now()-3600000).toISOString(),
    WHATSAPP_INBOUND_WELCOME_ENABLED: 'true', WHATSAPP_INBOUND_WELCOME_ACCOUNTS: 'wa:12345', WHATSAPP_INBOUND_WELCOME_START_AT: new Date(Date.now()-3600000).toISOString(), SLACK_BOT_TOKEN: 'slack-token', FLATWORKER_API_BASE_URL:'https://travelworker.invalid', FLATWORKER_TRAVEL_QUOTE_TOKEN:'quote-token' };
  const app = new Hono<any>(); app.use('*', authMiddleware); app.route('/',waWebhook); app.route('/',whatsappIntake); app.route('/',chats);
  const execution: any = { waitUntil(p: Promise<unknown>) { h.jobs.push(p); }, passThroughOnException() {} };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input);
    if (url.startsWith('https://travelworker.invalid/api/integrations/whatsapp-identity/')) {
      assert.equal(init.headers['X-Flat-Travel-Quote-Token'],'quote-token');
      if (url.endsWith('/read')) { h.identityReads++; return Response.json(h.identity); }
      return Response.json(h.linkResult);
    }
    if (url === 'https://api.openai.com/v1/responses') {
      const body = JSON.parse(init.body); h.models.push(body); assert.equal(body.store, false); assert.equal(body.tools, undefined); assert.equal(init.headers.Authorization, 'Bearer model-key');
      assert.ok(init.signal instanceof AbortSignal);
      if (h.beforeModel) { const fn = h.beforeModel; h.beforeModel = null; await fn(); }
      if (h.modelOutcome === 'transport') throw Error('synthetic timeout');
      if (h.modelOutcome === 'http') return Response.json({ error: 'synthetic provider rejection' }, { status: 429 });
      return Response.json({ status: 'completed', model: 'gpt-5.4-nano-fixture', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(typeof h.modelOutput === 'function' ? h.modelOutput(body) : h.modelOutput) }] }], usage: { input_tokens: 100, output_tokens: 50 } });
    }
    if (url.startsWith('https://flat-travel.com/__journey-data-v1')) { assert.equal(init.method, undefined); assert.equal(init.headers.Authorization, undefined); assert.ok(!url.includes(PHONE)); return Response.json(new URL(url).searchParams.has('tour') && h.detail ? h.detail : h.catalogue); }
    if (url.startsWith('https://flat-travel.com/en/journeys/')) return new Response('<html lang="en"><head><title>Published fixture Tokyo and Kyoto | Flat Travel</title></head></html>', { headers: { 'Content-Type': 'text/html' } });
    if (url.startsWith('https://flat-travel.com/en/accessible-hotels') || url==='https://flat-travel.com/en/tailor-made') return new Response('<html lang="en"><head><title>Published hotel title | Flat Travel</title></head></html>', { headers: { 'Content-Type': 'text/html' } });
    if (url === 'https://slack.com/api/chat.postMessage') { const payload = JSON.parse(init.body); h.notifications.push(payload); return Response.json({ ok: true }); }
    assert.equal(url, 'https://graph.facebook.com/v25.0/12345/messages');
    const body = JSON.parse(init.body); h.sends.push(body); assert.equal(init.headers.Authorization, 'Bearer provider-token');
    if (h.beforeSend) { const fn = h.beforeSend; h.beforeSend = null; await fn(); }
    if (h.outcome === 'unknown') throw Error('synthetic unknown provider outcome');
    if (h.outcome === 'rejected') return Response.json({ error: { code: 131026 } }, { status: 400 });
    return Response.json({ messages: [{ id: `wamid.out-${h.sends.length}` }] });
  }) as typeof fetch;
  h.flush = async () => { while (h.jobs.length) await Promise.all(h.jobs.splice(0)); };
  let seq = 0;
  h.webhook = async (text: string, opts: any = {}) => {
    const payload = { object: 'whatsapp_business_account', entry: [{ id: '1234567890', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '12345' }, messages: [{ from: opts.phone || PHONE, id: opts.id || `wamid.in-${++seq}`, timestamp: String(opts.timestamp ?? Math.floor(Date.now()/1000)), type: opts.choice ? 'interactive' : 'text', ...(opts.choice ? {interactive:{type:'list_reply',list_reply:{id:opts.choice,title:text}}} : {text: { body: text }}) }] } }] }] };
    const body = JSON.stringify(payload); const signature = createHmac('sha256','app-secret').update(body).digest('hex');
    const response = await app.fetch(new Request('https://test.invalid/webhook/whatsapp', { method: 'POST', body, headers: { 'Content-Type':'application/json', ...(opts.bridge ? { Authorization: 'Bearer bridge-key' } : opts.unsigned ? {} : { 'X-Hub-Signature-256':'sha256='+signature }) } }), h.env, execution);
    if (opts.flush !== false) await h.flush(); return response;
  };
  h.session = () => sql.prepare('SELECT * FROM whatsapp_intake_sessions LIMIT 1').get() as any;
  h.friendId = () => (sql.prepare('SELECT id FROM friends WHERE line_user_id=?').get(PHONE) as any)?.id;
  h.api = (path: string, method = 'GET', body?: any, authorized = true) => app.fetch(new Request('https://test.invalid'+path, { method, headers: { 'Content-Type':'application/json', ...(authorized ? { Authorization: 'Bearer staff-key' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), h.env, execution);
  try { await run(h); } finally { await h.flush(); globalThis.fetch = originalFetch; sql.close(); }
}

test('complete first enquiry -> one extraction -> immediate published proposal -> explicit quotation handoff', async () => harness(async h => {
  assert.equal((await h.webhook(FULL)).status, 200); assert.equal(h.models.length, 1); assert.equal(h.sends.length, 1);
  assert.equal(h.session().status, 'recommended'); assert.match(h.sends[0].text.body, /Hi, this is Flat Travel/);
  assert.doesNotMatch(h.sends[0].text.body, /AI assistant|Reply YES|HUMAN|Visitor type|overseas/i);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM whatsapp_inbound_welcomes').get().n, 0, 'legacy welcome is suppressed');
  assert.match(h.sends[0].text.body, /600000 JPY/); assert.match(h.sends[0].text.body, /https:\/\/flat-travel.com\/en\/journeys\/c07/);
  assert.match(h.sends[0].text.body, /need confirmation/);
  assert.ok(!h.session().state_ciphertext.includes('manual_wheelchair')); assert.ok(!h.session().state_ciphertext.includes('November'));
  await h.webhook('1'); assert.equal(h.models.length, 1); assert.equal(h.session().status, 'recommended'); assert.equal(h.session().handoff_notification, 'none');
  await h.webhook('quotation'); assert.equal(h.session().status, 'human'); assert.equal(h.session().handoff_notification, 'accepted');
  const count = h.sends.length; await h.webhook('One more question'); assert.equal(h.sends.length, count); assert.equal(h.models.length, 1);
  assert.equal(h.notifications.filter((n: any) => n.text.startsWith('WA AI相談')).length, 1);
  const status = await (await h.api(`/api/whatsapp/intake/${h.friendId()}`)).json(); assert.equal(status.session.phase, 'human'); assert.ok(status.turns.some((t: any) => t.provider_message_id));
}));
test('a greeting immediately asks about travel support with no onboarding controls', async () => harness(async h => {
  await h.webhook('Hello'); assert.equal(h.models.length,0); assert.equal(h.sends.length,1);
  assert.equal(h.session().status,'collecting'); const body=h.sends[0].text.body;
  assert.match(body,/Hi, this is Flat Travel/); assert.match(body,/How can we help/);
  assert.doesNotMatch(body,/AI assistant|YES|HUMAN|nationality|residen|overseas/i);
}));
test('three related answers reach a proposal without repeating known details or confirming a summary', async () => harness(async h => {
  h.modelOutput=answer({preference:{value:'package',evidence:'whole trip'},support:{value:['manual_wheelchair'],evidence:'manual wheelchair'}});
  await h.webhook('Please plan the whole trip. I use a manual wheelchair.');
  assert.match(h.sends.at(-1).text.body,/Which cities/); assert.doesNotMatch(h.sends.at(-1).text.body,/mobility needs|hotels only/);
  h.modelOutput=answer({timing:{value:'November 2027',evidence:'November 2027'},duration:{value:{value:7,unit:'days'},evidence:'7 days'},cities:{value:['Tokyo','Kyoto'],evidence:'Tokyo and Kyoto'}});
  await h.webhook('Tokyo and Kyoto in November 2027 for 7 days.');
  assert.match(h.sends.at(-1).text.body,/adults and children/); assert.doesNotMatch(h.sends.at(-1).text.body,/Which cities|When would|How long/);
  h.modelOutput=answer({party:{value:{adults:2,children:0},evidence:'Two adults and zero children'},budget:{value:{amount:600000,currency:'JPY',basis:null,scope:null},evidence:'Budget JPY 600,000'}});
  await h.webhook('Two adults and zero children. Budget JPY 600,000.');
  assert.equal(h.session().status,'recommended'); assert.equal(h.models.length,3); assert.equal(h.sends.length,3);
  assert.match(h.sends.at(-1).text.body,/journeys\/c07/); assert.doesNotMatch(h.sends.at(-1).text.body,/Reply YES|HUMAN/);
  const result=await (await h.api(`/api/whatsapp/intake/${h.friendId()}`)).json();
  assert.equal(result.session.state.slots.budget.basis,null); assert.equal(result.session.state.slots.budget.scope,null);
  assert.equal(h.session().handoff_notification,'none');
}));
test('an old YES-waiting session processes its saved initial enquiry once and drops residency', async () => harness(async h => {
  await h.webhook('Hello'); const row=h.session();
  const old={version:1,revision:0,locale:'en',phase:'consent',slots:{residency:'japan'},unclearCount:0};
  const encrypted=await encryptIntake(old,h.env.WHATSAPP_INTAKE_ENCRYPTION_KEY,row.id);
  h.sql.prepare("UPDATE whatsapp_intake_sessions SET status='consent',state_ciphertext=?,initial_consumed=0").run(encrypted);
  h.sql.prepare('UPDATE messages_log SET content=? WHERE id=?').run(FULL,row.initial_message_log_id);
  await h.webhook('YES'); assert.equal(h.models.length,1); assert.equal(h.session().status,'recommended');
  const result=await (await h.api(`/api/whatsapp/intake/${h.friendId()}`)).json();
  assert.equal(result.session.state.slots.residency,undefined); assert.doesNotMatch(h.sends.at(-1).text.body,/Visitor type|Japan resident|Reply YES/);
  await h.webhook('YES'); assert.equal(h.models.length,1,'saved initial enquiry is never processed twice');
}));
for (const [greet,locale] of [['您好','tc'],['你好','tc'],['안녕하세요','kr']]) test(`localized first question begins directly: ${locale}`, async () => harness(async h => {
  await h.webhook(greet); assert.equal(h.models.length,0); assert.match(h.sends[0].text.body,/Flat Travel/);
  assert.doesNotMatch(h.sends[0].text.body,/AI|YES|同意|동의|居民|거주/);
}));
test('generic travel help never becomes a human request just because the model labels it human', async () => harness(async h => {
  h.modelOutput=answer({preference:{value:'package',evidence:'whole trip'},support:{value:['manual_wheelchair'],evidence:'manual wheelchair'}},{intent:'human'});
  await h.webhook('Please help with the whole trip. I use a manual wheelchair.');
  assert.equal(h.session().status,'collecting'); assert.equal(h.session().handoff_notification,'none');
  assert.match(h.sends.at(-1).text.body,/Which cities/); assert.equal(h.models.length,1);
}));
test('one ungrounded field is clarified while the other supplied answers remain saved', async () => harness(async h => {
  h.modelOutput=answer({...fullFacts(),budget:{value:{amount:999999,currency:'JPY',basis:null,scope:null},evidence:'Budget JPY 600,000'}});
  await h.webhook(FULL); assert.equal(h.session().status,'collecting'); assert.equal(h.models.length,1);
  assert.match(h.sends.at(-1).text.body,/approximate budget/); assert.doesNotMatch(h.sends.at(-1).text.body,/999999|Which cities|How long/);
  const result=await (await h.api(`/api/whatsapp/intake/${h.friendId()}`)).json();
  assert.deepEqual(result.session.state.slots.cities,['Tokyo','Kyoto']); assert.equal(result.session.state.slots.budget,undefined);
}));
test('model-inferred budget units stay unknown without losing the explicit amount and currency', async () => harness(async h => {
  h.modelOutput=answer({...fullFacts(),budget:{value:{amount:600000,currency:'JPY',basis:'party_total',scope:'trip'},evidence:'Budget JPY 600,000'}});
  await h.webhook(FULL); assert.equal(h.session().status,'recommended'); assert.equal(h.models.length,1);
  const result=await (await h.api(`/api/whatsapp/intake/${h.friendId()}`)).json();
  assert.deepEqual(result.session.state.slots.budget,{amount:600000,currency:'JPY',basis:null,scope:null});
  assert.match(h.sends.at(-1).text.body,/600000 JPY/); assert.doesNotMatch(h.sends.at(-1).text.body,/whole trip|all travellers/);
}));
test('a natural explicit human request still hands off when phrased outside the local controls', async () => harness(async h => {
  h.modelOutput=answer({},{intent:'human'}); await h.webhook('Could a real person reply to me?');
  assert.equal(h.session().status,'human'); assert.equal(h.session().handoff_notification,'accepted');
}));
test('selecting a numbered option preserves its number and public destination without handoff', async () => harness(async h => {
  h.catalogue.tours=['C07','C10','C21'].map(id=>({...h.catalogue.tours[0],id}));
  await h.webhook(FULL); await h.webhook('2');
  assert.equal(h.session().status,'recommended'); assert.equal(h.models.length,1);
  assert.match(h.sends.at(-1).text.body,/2\. Published fixture/); assert.match(h.sends.at(-1).text.body,/journeys\/c10/);
  assert.doesNotMatch(h.sends.at(-1).text.body,/journeys\/c07|journeys\/c21/);
}));
test('simultaneous duplicate webhooks claim one automatic response', async () => harness(async h => {
  await Promise.all([h.webhook('Hello',{id:'same',flush:false}),h.webhook('Hello',{id:'same',flush:false})]); await h.flush();
  assert.equal(h.sends.length,1); assert.equal(h.sql.prepare('SELECT count(*) n FROM whatsapp_intake_turns').get().n,1);
  await h.webhook('Hello',{id:'same'}); assert.equal(h.sends.length,1);
}));
test('unsigned and bridge-only inputs cannot enroll or trigger AI', async () => harness(async h => {
  assert.equal((await h.webhook('Hello',{unsigned:true})).status,401); h.env.WA_BRIDGE_SECRET='bridge-key';
  assert.equal((await h.webhook('Hello',{bridge:true})).status,200); assert.equal(h.session(),undefined); assert.equal(h.models.length,0); assert.equal(h.sends.length,0);
}));
test('test hashes do not enroll another recipient', async () => harness(async h => { await h.webhook('Hello',{phone:'15555550222'}); assert.equal(h.session(),undefined); assert.equal(h.models.length,0); }));
for (const text of [
  'FTR-12345678-1234-4123-8123-123456789abc', 'FT-20261028-ABCDEFGH', 'FTQ-20261028-ABCDEFGH', 'FTH-'+ 'a'.repeat(32),
  'I completed the Accessible Japan travel questionnaire.', 'I submitted my tailor-made enquiry.', 'This is my package tour booking confirmation.',
  'テーラーメイドの予約をしました。', 'I filled the AJ survey.', 'ＦＴＲ－１２３４５６７８－１２３４－４１２３－８１２３－１２３４５６７８９ａｂｃ',
  'I came from the Accessible Japan travel survey.',
]) test(`registered-source enquiry bypasses hearing: ${text.slice(0,45)}`, async () => harness(async h => {
  await h.webhook(text); assert.equal(h.models.length,0); assert.equal(h.sends.length,0); assert.equal(h.session(),undefined);
}));
test('registered case/customer linkage bypasses hearing even without a reference in the message', async () => harness(async h => {
  h.identity={status:'linked',email:'private@example.invalid',customerName:'Private Person',cases:[{caseId:'existing-case',title:'Existing enquiry',url:'https://travelworker.invalid/cases/existing'}]};
  await h.webhook('Hello'); assert.equal(h.models.length,0); assert.equal(h.sends.length,0); assert.equal(h.identityReads,1);
}));
test('uncertain or unavailable qualification fails closed without an AI introduction', async () => harness(async h => {
  h.identity={status:'review_required'}; await h.webhook('Hello'); assert.equal(h.sends.length,0); h.identity={status:'unavailable'}; await h.webhook('Hello again'); assert.equal(h.models.length,0); assert.equal(h.sends.length,0);
}));
test('a generic package interest is still an unqualified enquiry', async () => harness(async h => { h.modelOutput=answer({preference:{value:'package',evidence:'package tour'}}); await h.webhook('I am interested in a package tour.'); assert.equal(h.session().status,'collecting'); assert.match(h.sends[0].text.body,/Flat Travel/); assert.doesNotMatch(h.sends[0].text.body,/AI assistant|YES/); }));
test('a conversion or identity link appearing mid-conversation stops hearing before another question', async () => harness(async h => {
  await h.webhook('Hello'); const n=h.sends.length; await h.webhook('I submitted my tailor-made enquiry. FT-20261028-ABCDEFGH'); assert.equal(h.session().status,'human'); await h.webhook('YES'); assert.equal(h.sends.length,n); assert.equal(h.models.length,0);
}));
test('current-message identity linking completes before any AI task can send', async () => harness(async h => {
  h.linkResult={status:'linked',cases:[{caseId:'case',title:'Trip',url:'https://travelworker.invalid/cases/case'}]}; await h.webhook('My email is registered@example.invalid'); assert.equal(h.sends.length,0); assert.equal(h.models.length,0); assert.equal(h.session().status,'human');
}));
test('a newly registered identity pauses an active interview without a reference', async () => harness(async h => {
  await h.webhook('Hello'); h.identity={status:'linked',cases:[{caseId:'newly-registered',title:'Trip',url:'https://travelworker.invalid/cases/new'}]};
  await h.webhook('YES'); assert.equal(h.session().status,'human'); assert.equal(h.models.length,0); assert.equal(h.sends.length,1);
}));
test('a dedicated existing case channel bypasses hearing without identity enrichment', async () => harness(async h => {
  h.sql.prepare("INSERT INTO friends(id,line_user_id,display_name,line_account_id,is_following,slack_channel_id) VALUES ('existing-case-friend',?,'Example','wa',1,'C-existing-case')").run(PHONE);
  await h.webhook('Hello'); assert.equal(h.identityReads,0); assert.equal(h.models.length,0); assert.equal(h.sends.length,0);
}));
test('the approved test command may simulate a latent lead but never bypasses submitted references', async () => harness(async h => {
  h.identity={status:'linked'}; await h.webhook('AIテスト'); assert.equal(h.session().test_unqualified_override,1); assert.equal(h.sends.length,1); await h.webhook('YES'); assert.equal(h.sends.length,2);
  await h.webhook('FTR-12345678-1234-4123-8123-123456789abc'); assert.equal(h.session().status,'human'); assert.equal(h.sends.length,2);
}));
test('live mode preserves existing conversations and starts only a genuinely new lead', async () => harness(async h => {
  h.env.WHATSAPP_INTAKE_MODE='off'; await h.webhook('Old conversation'); h.env.WHATSAPP_INTAKE_MODE='live'; const before=h.sends.length;
  await h.webhook('New question from existing customer'); assert.equal(h.session(),undefined); assert.equal(h.sends.length,before);
  await h.webhook('Hello',{phone:'15555550222'}); assert.equal(h.session().recipient,'15555550222'); assert.match(h.sends.at(-1).text.body,/Flat Travel/);
}));
test('explicit stop requires no model and never resumes automatically', async () => harness(async h => {
  await h.webhook('Hello'); await h.webhook('STOP'); const n=h.sends.length; assert.equal(h.session().status,'stopped'); await h.webhook('YES'); assert.equal(h.sends.length,n); assert.equal(h.models.length,0);
}));
test('human requests remain available without an onboarding HUMAN prompt', async () => harness(async h => { await h.webhook('Hello'); await h.webhook('HUMAN'); assert.equal(h.session().status,'human'); assert.equal(h.models.length,0); assert.equal(h.session().handoff_notification,'accepted'); }));
test('sensitive content hands off locally without entering a model', async () => harness(async h => { await h.webhook('I want to share my medical records'); assert.equal(h.session().status,'human'); assert.equal(h.models.length,0); }));
test('human takeover while extraction runs wins before the AI send', async () => harness(async h => {
  await h.webhook('Hello'); h.beforeModel=()=>takeOverIntake(h.env,h.friendId()); await h.webhook(FULL); assert.equal(h.session().status,'human'); assert.equal(h.sends.length,1);
}));
test('staff send uses the real route and prevents subsequent AI replies', async () => harness(async h => {
  await h.webhook('Hello'); const id=h.sql.prepare('SELECT id FROM chats LIMIT 1').get().id;
  const response=await h.api(`/api/chats/${id}/send`,'POST',{content:'Our team is here.'}); assert.equal(response.status,200); assert.equal(h.session().status,'human');
  const n=h.sends.length; await h.webhook('YES'); assert.equal(h.sends.length,n);
}));
test('an in-flight AI provider request blocks simultaneous staff provider submission', async () => harness(async h => {
  h.beforeSend=async()=>{ await assert.rejects(()=>takeOverIntake(h.env,h.friendId()),/送信処理中/); };
  await h.webhook('Hello'); assert.equal(h.session().status,'human'); assert.equal(h.sends.length,1);
}));
test('unknown provider outcome stops automation and never retries', async () => harness(async h => {
  h.outcome='unknown'; await h.webhook('Hello',{id:'unknown'}); assert.equal(h.session().status,'human'); assert.equal(h.sends.length,1);
  await h.webhook('Hello',{id:'unknown'}); await h.webhook('YES'); assert.equal(h.sends.length,1);
  assert.equal(h.sql.prepare('SELECT status FROM whatsapp_intake_turns LIMIT 1').get().status,'unknown');
}));
test('accepted-send history recovery is local and does not call provider again', async () => harness(async h => {
  h.failHistory=true; await h.webhook('Hello'); assert.equal(h.sends.length,1); assert.equal(h.sql.prepare('SELECT status FROM whatsapp_intake_turns LIMIT 1').get().status,'accepted');
  await h.api(`/api/whatsapp/intake/${h.friendId()}`); assert.equal(h.sends.length,1); assert.equal(h.sql.prepare("SELECT count(*) n FROM messages_log WHERE id LIKE 'wa-intake-%'").get().n,1);
}));
test('model failure is one attempt followed by human handoff', async () => harness(async h => {
  h.modelOutcome='http'; await h.webhook(FULL); assert.equal(h.models.length,1); assert.equal(h.session().status,'human'); await h.webhook(FULL); assert.equal(h.models.length,1);
}));
test('a queued answer suppresses an obsolete question and is drained by the same event', async () => harness(async h => {
  await h.webhook('Hello'); await h.webhook('YES');
  h.modelOutput=(body:any)=>JSON.parse(body.input).message==='November 2027' ? answer({timing:{value:'November 2027',evidence:'November 2027'}}) : answer({preference:{value:'package',evidence:'whole trip'}});
  h.beforeModel=()=>h.webhook('Please help with the whole trip',{flush:false}); const n=h.sends.length;
  await h.webhook('November 2027'); assert.equal(h.models.length,2); assert.equal(h.sends.length,n+1); assert.match(h.sends.at(-1).text.body,/What travel support/);
}));
test('orphaned event locks hand off without replaying a send', async () => harness(async h => {
  await h.webhook('Hello'); const n=h.sends.length;
  h.sql.prepare("UPDATE whatsapp_intake_sessions SET lock_token='orphan',lock_started_at=?").run(Date.now()-120000);
  await h.webhook('YES'); assert.equal(h.session().status,'human'); assert.equal(h.sends.length,n); assert.equal(h.models.length,0); assert.equal(h.session().handoff_notification,'accepted');
}));
test('terminal handoff closes already queued turns instead of replaying them after a reset', async () => harness(async h => {
  await h.webhook('Hello'); await h.webhook('YES'); h.modelOutput=answer({timing:{value:'November 2027',evidence:'November 2027'}});
  h.beforeModel=async()=>{ await h.webhook('HUMAN',{flush:false}); await h.webhook('A later queued answer',{flush:false}); };
  await h.webhook('November 2027'); assert.equal(h.session().status,'human'); assert.equal(h.sql.prepare("SELECT count(*) n FROM whatsapp_intake_turns WHERE status IN ('pending','processing')").get().n,0);
}));
test('hotel-only discovery uses published hotel identity and the actual public hotel route', async () => harness(async h => {
  const text=FULL.replace('Tokyo and Kyoto','Tokyo').replace('a package tour','hotels only');
  h.modelOutput=answer({...fullFacts(),cities:{value:['Tokyo'],evidence:'Tokyo'},preference:{value:'hotel',evidence:'hotels only'}});
  h.detail={...catalogue(),source:'Sanity published runtime Journey data',tours:[{stays:[['stay','Tokyo',0,2,'tokyo',[{candidateScope:'journey',source:'sanity-linked',hotelId:'H',name:'Public hotel',path:'/en/accessible-hotels/public-hotel'}]]]}]};
  await h.webhook(text); await h.webhook('YES'); await h.webhook('YES'); assert.equal(h.session().status,'recommended'); assert.match(h.sends.at(-1).text.body,/Published hotel title/); assert.match(h.sends.at(-1).text.body,/accessible-hotels\/public-hotel/);
}));
for (const [text,locale] of [['從海外到日本','tc'],['从海外到日本','sc'],['해외에서 일본으로 갑니다','kr']]) test(`script-based locale controls ignore a wrong model language: ${locale}`, async () => harness(async h => {
  await h.webhook('Hello'); await h.webhook('YES'); h.modelOutput=answer({},{locale:'en',intent:'other'}); await h.webhook(text);
  const result=await (await h.api(`/api/whatsapp/intake/${h.friendId()}`)).json(); assert.equal(result.session.state.locale,locale);
}));
test('stale/out-of-order data and opted-out friends cannot invoke the model', async () => harness(async h => {
  await h.webhook('Hello'); await h.webhook('YES'); const sends=h.sends.length;
  await h.webhook('old answer',{timestamp:Math.floor(Date.now()/1000)-10}); assert.equal(h.sends.length,sends);
  h.sql.prepare('UPDATE friends SET is_following=0 WHERE id=?').run(h.friendId()); await h.webhook(FULL); assert.equal(h.models.length,0); assert.equal(h.sends.length,sends);
}));
test('model budget is atomic and bounded per conversation', async () => harness(async h => {
  await h.webhook('Hello'); await h.webhook('YES'); h.sql.prepare('UPDATE whatsapp_intake_sessions SET model_calls=20').run(); await h.webhook(FULL); assert.equal(h.models.length,0); assert.equal(h.session().status,'human');
}));
test('catalogue failures cannot produce fictional alternatives', async () => harness(async h => {
  h.catalogue={...catalogue(),dataset:'preview'}; await h.webhook(FULL); assert.equal(h.session().status,'human'); assert.ok(!h.sends.at(-1).text.body.includes('/journeys/'));
}));
test('test-start is protected, idempotent and cannot open an expired service window', async () => harness(async h => {
  h.env.WHATSAPP_INTAKE_MODE='off'; await h.webhook('Existing test'); h.env.WHATSAPP_INTAKE_MODE='test'; const id=h.friendId();
  assert.equal((await h.api(`/api/whatsapp/intake/${id}`,'GET',undefined,false)).status,401);
  h.sql.prepare("UPDATE messages_log SET created_at='2026-01-01T00:00:00Z' WHERE direction='incoming'").run();
  assert.equal((await h.api(`/api/whatsapp/intake/${id}/test-start`,'POST',{confirmed:true,requestId:'12345678-1234-4123-8123-123456789abc'})).status,409);
  assert.equal(h.session(),undefined);
}));
test('isolated state and outbox encryption rejects swapped scope and tampering', async () => {
  const secret='synthetic-encryption-secret-32-bytes'; const c=await encryptIntake({support:['manual_wheelchair']},secret,'one'); assert.ok(!c.includes('manual'));
  assert.deepEqual(await decryptIntake(c,secret,'one'),{support:['manual_wheelchair']}); await assert.rejects(()=>decryptIntake(c,secret,'two'));
  await assert.rejects(()=>decryptIntake(c.slice(0,-3)+'xyz',secret,'one'));
});
test('source grounding preserves real dates while refusing guessed amounts and currency', () => {
  assert.ok(redactIntakeText('2027-11-03 to 2027-11-10; test@example.invalid +818012345678').startsWith('2027-11-03 to 2027-11-10'));
  assert.ok(!redactIntakeText('My name is Synthetic Test Person, email test@example.invalid and phone +818012345678',['Synthetic Test Person']).includes('test@example'));
  assert.ok(!groundedIntakeFact('budget',{amount:500000,currency:'JPY',basis:null,scope:null},'JPY 600,000'));
  assert.ok(!groundedIntakeFact('budget',{amount:6000,currency:'USD',basis:null,scope:null},'$6,000'));
  assert.ok(sensitiveIntakeText('passport details'));
});
test('budget currency is clarified without blocking discovery on unstated price units', () => {
  let s=newIntake('en',true);
  for(const [slot,value] of Object.entries({preference:'package',support:['none'],timing:'November 2027',duration:{value:7,unit:'days'},cities:['Tokyo'],party:{adults:2,children:0}})) s=advanceIntake(s,{type:'selection',slot:slot as any,value});
  s=advanceIntake(s,{type:'selection',slot:'budget',value:{amount:600000,currency:null,basis:null,scope:null}}); assert.equal(planIntake(s).question,'budget');
  s=advanceIntake(s,{type:'selection',slot:'budget',value:{amount:null,currency:'JPY',basis:null,scope:null}}); assert.equal(s.slots.budget?.amount,600000); assert.equal(s.phase,'recommended');
  assert.equal(s.slots.budget?.basis,null); assert.equal(s.slots.budget?.scope,null);
});
test('public discovery never establishes personal fit', () => {
  const p=projectJourneys(catalogue(),'en'); assert.equal(p[0].cities.length,2); assert.equal(p[0].discoveryOnly,true); assert.equal(p[0].referencePrice,undefined);
  const hotels=projectHotels({fetchedAt:new Date().toISOString(),tours:[{stays:[['stay','Tokyo',0,2,'tokyo',[{candidateScope:'journey',source:'sanity-linked',hotelId:'H',name:'Public hotel',path:'/en/accessible-hotels/public-hotel'},{candidateScope:'specialist',source:'sanity-linked',hotelId:'SECRET',name:'Hidden',path:'/en/accessible-hotels/hidden'}]]]}]},'Tokyo','en');
  assert.deepEqual(hotels.map(h=>h.id),['H']);
});


test('choice v2 signed native journey is deterministic, vision precedes progression and UTM separates steps', async () => harness(async h => {
  h.env.WHATSAPP_INTAKE_SCENARIO='choice_v2';
  await h.webhook('Hello');
  const choose = async (i:number) => { const sent=h.sends.at(-1).interactive; const options=sent.action.buttons?.map((b:any)=>b.reply)||sent.action.sections[0].rows; assert.ok(options[i]); await h.webhook('untrusted title', {choice:options[i].id}); };
  assert.match(h.sends[0].interactive.body.text,/most like to enjoy/);
  for(const index of [0,1,0,1,1,1,1,1,0]) await choose(index);
  assert.equal(h.models.length,0); assert.equal(h.session().status,'review');
  assert.match(h.sends.at(-1).interactive.body.text,/utm_content=travel_vision/);
  const old=h.sends[0].interactive.action.sections[0].rows[0].id;
  await h.webhook('wrong title',{choice:old});
  assert.equal(h.models.length,0); assert.equal(h.session().status,'review');
  await choose(1);
  assert.equal(h.models.length,0); assert.equal(h.session().status,'recommended');
  assert.match(h.sends.at(-1).text.body,/utm_content=whole_trip/);
  assert.equal(h.notifications.filter((n:any)=>n.text.startsWith('WA AI相談')).length,0);
}));
test('choice v2 detailed initial enquiry skips answered questions but still shows vision', async () => harness(async h => {
  h.env.WHATSAPP_INTAKE_SCENARIO='choice_v2';await h.webhook(FULL);
  assert.equal(h.models.length,1);assert.equal(h.session().status,'review');
  assert.match(h.sends.at(-1).interactive.body.text,/utm_content=travel_vision/);
}));
test('choice v2 unknown send is never retried and does not acknowledge vision', async () => harness(async h => {
  h.env.WHATSAPP_INTAKE_SCENARIO='choice_v2';h.outcome='unknown';await h.webhook(FULL);
  assert.equal(h.session().status,'human');assert.equal(h.sends.length,1);
  const state=await decryptIntake<any>(h.session().state_ciphertext,h.env.WHATSAPP_INTAKE_ENCRYPTION_KEY,h.session().id);
  assert.equal(state.travel.visionShownFor,null);await h.webhook('Hello');assert.equal(h.sends.length,1);
}));

test('choice v2 hotel-first keeps requirements and can expand to whole trip', async()=>harness(async h=>{
 h.env.WHATSAPP_INTAKE_SCENARIO='choice_v2';await h.webhook(FULL);
 const choose=async(i:number)=>{const p=h.sends.at(-1).interactive;const rows=p.action.buttons?.map((x:any)=>x.reply)||p.action.sections[0].rows;await h.webhook('ignored',{choice:rows[i].id});};
 await choose(0);await choose(0);await choose(1);await choose(0);await choose(1);
 assert.match(h.sends.at(-1).interactive.body.text,/utm_content=hotel_first/);
 assert.match(h.sends.at(-1).interactive.body.text,/shower=showerBoothOnly/);
 assert.equal(h.models.length,1);await choose(0);
 assert.match(h.sends.at(-1).text.body,/utm_content=whole_trip/);assert.equal(h.models.length,1);
}));
test('choice v2 native replies from another flow cannot change the current prompt',async()=>harness(async h=>{
 h.env.WHATSAPP_INTAKE_SCENARIO='choice_v2';await h.webhook('Hello');
 await h.webhook('Manual wheelchair',{choice:'wi:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:2'});
 assert.equal(h.models.length,0);assert.match(h.sends.at(-1).interactive.body.text,/most like to enjoy/);
}));
test('choice v2 queued replacement suppresses unsent vision and cannot choose a path before it',async()=>harness(async h=>{
 h.env.WHATSAPP_INTAKE_SCENARIO='choice_v2';h.beforeModel=()=>h.webhook('2',{flush:false});await h.webhook(FULL);
 assert.equal(h.sends.length,1);assert.match(h.sends[0].interactive.body.text,/utm_content=travel_vision/);
 assert.equal(h.session().status,'review');
}));

test('choice v2 optional wish comments are retained without a model or losing the next closed question',async()=>harness(async h=>{
 h.env.WHATSAPP_INTAKE_SCENARIO='choice_v2';await h.webhook('Hello');await h.webhook('Food and quiet gardens');
 assert.equal(h.models.length,0);assert.match(h.sends.at(-1).interactive.body.text,/Where would you like/);
 const state=await decryptIntake<any>(h.session().state_ciphertext,h.env.WHATSAPP_INTAKE_ENCRYPTION_KEY,h.session().id);assert.equal(state.travel.answers.wish,'Food and quiet gardens');
}));
