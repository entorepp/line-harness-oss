import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { completeFormWhatsappIdentity, extractIdentityEvidence, linkWhatsappIdentity, reconcileWhatsappIdentity } from '../src/services/whatsapp-identity.js';
import { whatsappIdentity } from '../src/routes/whatsapp-identity.js';
import { waWebhook } from '../src/routes/wa-webhook.js';
import { authMiddleware } from '../src/middleware/auth.js';
import { ACCESSIBLE_JAPAN_FORM_ID } from '@line-crm/shared';
import { enqueueAccessibleJapanQuoteJob, processAccessibleJapanQuoteJobs } from '../src/services/accessible-japan-quote-jobs.js';

assert.deepEqual(extractIdentityEvidence('The email was andrea@example.com, in case you need to access the quotation.'), { type: 'customer_email', value: 'andrea@example.com' });
assert.deepEqual(extractIdentityEvidence('My email address is CUSTOMER@example.com.'), { type: 'customer_email', value: 'customer@example.com' });
assert.deepEqual(extractIdentityEvidence('Reference: FTQ-20260909-ABCD1234'), { type: 'journey_reference', value: 'FTQ-20260909-ABCD1234' });
assert.deepEqual(extractIdentityEvidence('Reference: FTH-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), { type: 'email_handoff', value: 'FTH-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
assert.deepEqual(extractIdentityEvidence('Reference: FTR-12345678-1234-1234-1234-123456789abc'), { type: 'form_submission', value: '12345678-1234-1234-1234-123456789abc' });
for (const text of [
  'I am Andrea from the hotel CTA', 'Hotel email: staff@example.com',
  'I received an email from staff@example.com', 'My email is not other@example.com',
  'My old email was other@example.com', 'My email is customer@example.com and spouse@example.com',
  'Reference: FTQ-20260909-ABCD1234 FTQ-20260909-OTHER123',
  'Reference: FTH-invalid; My email is customer@example.com',
]) assert.equal(extractIdentityEvidence(text), null, text);

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync('../../packages/db/schema.sql', 'utf8'));
sqlite.exec(`INSERT INTO line_accounts (id,channel_id,name,channel_type,channel_access_token,channel_secret) VALUES ('wa-test','wa-phone','Test','whatsapp','test-token','');
INSERT INTO friends (id,line_user_id,display_name,line_account_id) VALUES ('friend-test','15555550100','Test','wa-test');
INSERT INTO messages_log (id,friend_id,direction,message_type,content) VALUES ('incoming-1','friend-test','incoming','text','My email is customer@example.com');
INSERT INTO messages_log (id,friend_id,direction,message_type,content) VALUES ('outgoing-1','friend-test','outgoing','text','My email is staff@example.com');`);
const db = { prepare(sql: string) {
  const statement=sqlite.prepare(sql);let bindings: any[]=[];
  return { bind(...values:any[]) {bindings=values;return this;}, async first(){return statement.get(...bindings) ?? null;}, async all(){return {results:statement.all(...bindings),success:true};}, async run(){return {success:true,meta:{changes:Number(statement.run(...bindings).changes)}};} };
}};
const env = {DB:db,API_KEY:'staff-only',WA_BRIDGE_SECRET:'bridge-only',FLATWORKER_API_BASE_URL:'https://test.invalid',FLATWORKER_TRAVEL_QUOTE_TOKEN:'integration-only'} as any;
const app=new Hono(); app.use('*',authMiddleware as any);app.route('/',whatsappIdentity);app.route('/',waWebhook);
const calls:any[]=[];
let unavailable=false;
let readStatus='linked';
globalThis.fetch=(async(input:any,init?:RequestInit)=>{
  assert.match(String(input), /^https:\/\/test.invalid\/api\/integrations\/whatsapp-identity\/(read|link)$/);
  assert.equal(new Headers(init?.headers).get('X-Flat-Travel-Quote-Token'),'integration-only');
  const body=JSON.parse(String(init?.body));calls.push({url:String(input),body});
  assert.deepEqual(Object.keys(body).filter(key=>['text','content','profile','customerSent','booked'].includes(key)),[]);
  if(unavailable)throw new Error('unavailable');
  if (String(input).endsWith('/read') && readStatus === 'unlinked') return Response.json({status:'unlinked'});
  return Response.json({status:'linked',email:'customer@example.com',whatsappNumber:body.whatsappNumber,cases:[]});
}) as typeof fetch;

assert.equal((await linkWhatsappIdentity(env,'friend-test','provider-1','Hello')).status,'unlinked');
assert.equal(calls.length,0);
assert.equal((await reconcileWhatsappIdentity(env,'friend-test')).status,'linked');
assert.equal(calls[0].body.evidence.value,'customer@example.com');
assert.equal(calls[0].body.whatsappNumber,'+15555550100');
assert.equal(calls[0].body.providerMessageId,'stored:incoming-1');
let response=await app.fetch(new Request('https://harness.invalid/api/friends/friend-test/whatsapp-identity'),env);
assert.equal(response.status,401);
response=await app.fetch(new Request('https://harness.invalid/api/friends/friend-test/whatsapp-identity',{headers:{Authorization:'Bearer staff-only'}}),env);
assert.equal(response.status,200);assert.match(response.headers.get('cache-control') || '',/no-store/);
sqlite.exec(`INSERT INTO messages_log (id,friend_id,direction,message_type,content) VALUES ('incoming-2','friend-test','incoming','text','My email is different@example.com')`);
const before=calls.length;
assert.equal((await reconcileWhatsappIdentity(env,'friend-test')).status,'review_required');assert.equal(calls.length,before);
unavailable=true;
assert.equal((await linkWhatsappIdentity(env,'friend-test','provider-2','My email is customer@example.com')).status,'unavailable');
unavailable=false;
const outboundCount=Number((sqlite.prepare("SELECT COUNT(*) AS n FROM messages_log WHERE direction='outgoing'").get() as any).n);
assert.equal(outboundCount,1);
// Exercise the actual trusted-bridge webhook. Only incoming text may link;
// replaying an identical message and outgoing echoes never call the identity API.
async function webhook(direction: string, id: string) {
 return app.fetch(new Request('https://harness.invalid/webhook/whatsapp',{method:'POST',headers:{Authorization:'Bearer bridge-only','Content-Type':'application/json'},body:JSON.stringify({from:'15555550100',to:'15555550100',direction,senderName:'Test',type:'text',text:'My email is customer@example.com',messageId:id,accountId:'wa-test',timestamp:'1788955200'})}),env);
}
const beforeWebhook=calls.length;
assert.equal((await webhook('incoming','bridge-in')).status,200);
assert.equal(calls.length,beforeWebhook+1);
assert.equal((await webhook('incoming','bridge-in')).status,200);
assert.equal(calls.length,beforeWebhook+1);
assert.equal((await webhook('outgoing','bridge-out')).status,200);
assert.equal(calls.length,beforeWebhook+1);
console.log('WhatsApp identity: extraction, real SQL, staff auth, inbound webhook, idempotency, conflict, failure isolation and no sends passed.');

readStatus='unlinked';
sqlite.exec(`INSERT INTO friends (id,line_user_id,display_name,line_account_id,slack_channel_id) VALUES ('linked-friend','15555550200','Registered','wa-test','C1234567890')`);
const beforeChannel=calls.length;
assert.equal((await reconcileWhatsappIdentity(env,'linked-friend')).status,'linked');
assert.equal(calls.at(-1).body.evidence.type,'staff_case_channel');
assert.equal(calls.at(-1).body.evidence.value,'C1234567890');
assert.equal(calls.length,beforeChannel+2);
sqlite.exec(`INSERT INTO friends (id,line_user_id,display_name,line_account_id,slack_channel_id) VALUES ('shared-friend','15555550300','Shared','wa-test','C1234567890')`);
const beforeShared=calls.length;
assert.equal((await reconcileWhatsappIdentity(env,'linked-friend')).status,'review_required');
assert.equal(calls.length,beforeShared+1);
sqlite.exec(`UPDATE line_accounts SET default_slack_channel='C1234567890' WHERE id='wa-test'`);
assert.equal((await reconcileWhatsappIdentity(env,'linked-friend')).status,'unlinked');
console.log('Registered case reconciliation: unique friend channel, shared channel and default channel guards passed.');

assert.equal((await linkWhatsappIdentity({ ...env, DB: { prepare() { throw new Error('mock D1 unavailable'); } } }, 'friend-test', 'provider-error', 'My email is customer@example.com')).status, 'unavailable');
console.log('Identity database failures remain isolated from incoming messages.');

const formId='12345678-1234-1234-1234-123456789abc';
sqlite.exec(`INSERT INTO messages_log (id,friend_id,direction,message_type,content) VALUES
  ('form-before-case','friend-test','incoming','text','Reference: FTR-${formId}'),
  ('form-outgoing','linked-friend','outgoing','text','Reference: FTR-${formId}')`);
const beforeForm=calls.length;
assert.equal((await completeFormWhatsappIdentity(env,formId)).status,'linked');
assert.equal(calls.length,beforeForm+1);
assert.equal(calls.at(-1).body.providerMessageId,'stored:form-before-case');
assert.equal(calls.at(-1).body.friendId,'friend-test');
assert.equal(calls.at(-1).body.evidence.value,formId);
const beforeUnknown=calls.length;
assert.equal((await completeFormWhatsappIdentity(env,'87654321-4321-4321-4321-cba987654321')).status,'unlinked');
assert.equal(calls.length,beforeUnknown);
sqlite.exec(`INSERT INTO messages_log (id,friend_id,direction,message_type,content) VALUES ('form-forwarded','linked-friend','incoming','text','Reference: FTR-${formId}')`);
assert.equal((await completeFormWhatsappIdentity(env,formId)).status,'review_required');
assert.equal(calls.length,beforeUnknown);
assert.equal((await completeFormWhatsappIdentity({...env, DB:{prepare(){throw new Error('mock D1 failure');}}},formId)).status,'unavailable');
console.log('Form intake ordering: exact received reference, one sender, no outgoing replay and isolated failure passed.');

sqlite.exec(`DELETE FROM messages_log WHERE id='form-forwarded';
INSERT INTO forms (id,name) VALUES ('${ACCESSIBLE_JAPAN_FORM_ID}','Test intake');
INSERT INTO form_submissions (id,form_id,data) VALUES ('${formId}','${ACCESSIBLE_JAPAN_FORM_ID}','{}');`);
env.ACCESSIBLE_JAPAN_QUOTE_INTAKE_URL='https://test.invalid/api/integrations/accessible-japan-quote-intents';
env.ACCESSIBLE_JAPAN_QUOTE_INTAKE_TOKEN='intake-only';
const identityFetch=globalThis.fetch;
globalThis.fetch=(async(input:any,init?:RequestInit)=>{
  if(String(input).endsWith('/accessible-japan-quote-intents'))return Response.json({status:'searching',caseId:'case-from-form'},{status:202});
  return identityFetch(input,init);
}) as typeof fetch;
await enqueueAccessibleJapanQuoteJob(env.DB,formId);
const beforeJob=calls.length;
await processAccessibleJapanQuoteJobs(env,{submissionId:formId,limit:1});
assert.equal(calls.length,beforeJob+1,'first case acknowledgement completes the already received FTR identity');
assert.equal(calls.at(-1).body.providerMessageId,'stored:form-before-case');
assert.equal((sqlite.prepare('SELECT case_id FROM accessible_japan_quote_jobs WHERE submission_id=?').get(formId) as any).case_id,'case-from-form');
sqlite.prepare("UPDATE accessible_japan_quote_jobs SET next_attempt_at='2000-01-01' WHERE submission_id=?").run(formId);
await processAccessibleJapanQuoteJobs(env,{limit:1});
assert.equal(calls.length,beforeJob+1,'search continuation never replays the identity handoff');
console.log('Real SQL form job: first case acknowledgement links a prior received reference exactly once.');
