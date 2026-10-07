import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { waWebhook } from '../src/routes/wa-webhook.js';
import { WELCOME_TEXT, WELCOME_PERMISSION_TEXT, sendInboundWelcome } from '../src/services/whatsapp-inbound-welcome.js';
import { authMiddleware } from '../src/middleware/auth.js';

const sql = new DatabaseSync(':memory:');
sql.exec(readFileSync('../../packages/db/schema.sql','utf8'));
for (const file of ['027_whatsapp_calls.sql','028_whatsapp_call_details.sql','029_whatsapp_inbound_welcomes.sql']) sql.exec(readFileSync('../../packages/db/migrations/'+file,'utf8'));
sql.exec(readFileSync('../../packages/db/migrations/029_whatsapp_inbound_welcomes.sql','utf8'));
sql.exec("INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret,channel_type,whatsapp_business_account_id) VALUES ('wa','12345','Test sender','token','app-secret','whatsapp','1234567890')");
let failHistory = false;
const db:any={prepare(query:string){const stmt=sql.prepare(query);let params:any[]=[];return {bind(...p:any[]){params=p;return this},async first(){return stmt.get(...params)||null},async all(){return {results:stmt.all(...params),success:true}},async run(){
 if(failHistory&&query.includes("'outgoing', 'text'")){failHistory=false;throw Error('Simulated receipt write failure')}
 return {success:true,meta:{changes:Number(stmt.run(...params).changes)}};
}}}};
const env:any={DB:db,API_KEY:'staff-key',WHATSAPP_CALLING_MODE:'live',WHATSAPP_CALLING_ACCOUNTS:'wa:12345',WHATSAPP_INBOUND_WELCOME_ENABLED:'true',WHATSAPP_INBOUND_WELCOME_ACCOUNTS:'wa:12345',WHATSAPP_INBOUND_WELCOME_START_AT:new Date(Date.now()-3600000).toISOString()};
const app=new Hono<any>();app.use('*',authMiddleware);app.route('/',waWebhook);
const jobs:Promise<any>[]=[];
const execution:any={waitUntil(p:Promise<any>){jobs.push(p)},passThroughOnException(){}};
const stamp=()=>Math.floor(Date.now()/1000);
let permitted='no_permission';let canRequest=true;let outcome='accepted';let changeRecipient=false;let providerReadFailure=false;
const sends:any[]=[];const originalFetch=globalThis.fetch;
globalThis.fetch=(async(input:any,init:any={})=>{
 const url=String(input);assert.ok(url.startsWith('https://graph.facebook.com/v25.0/12345/'),url);
 assert.equal(init.headers.Authorization,'Bearer token');
 if(url.includes('settings?'))return Response.json({calling:{status:'ENABLED'}});
 if(url.includes('call_permissions?')){
  if(providerReadFailure)throw Error('Simulated permission read timeout');
  if(changeRecipient){sql.prepare("UPDATE friends SET line_user_id='15555559999' WHERE line_user_id='15555550113'").run();changeRecipient=false}
  return Response.json({permission:{status:permitted,expiration_time:stamp()+86400},actions:[{action_name:'send_call_permission_request',can_perform_action:canRequest}]});
 }
 assert.ok(url.endsWith('/messages'));sends.push(JSON.parse(init.body));
 if(outcome==='unknown')throw Error('Simulated timeout after write');
 if(outcome==='rejected')return Response.json({error:{code:131026}},{status:400});
 return Response.json({messages:[{id:'wamid.sent-'+sends.length}]});
}) as typeof fetch;
function message(phone:string,id='wamid.in-'+phone,time=stamp(),type='text',text='Hello, I would like a quotation') {return {from:phone,id,timestamp:String(time),type,...(type==='text'?{text:{body:text}}:{button:{text:'Continue chat',payload:'reopen'}})}}
function envelope(messages:any[],extra:any={}) {return {object:'whatsapp_business_account',entry:[{id:'1234567890',changes:[{field:'messages',value:{metadata:{phone_number_id:'12345'},messages,...extra}}]}]}}
async function webhook(payload:any,signature=true,flush=true,bridge=false){const body=JSON.stringify(payload);const response=await app.fetch(new Request('https://test.invalid/webhook/whatsapp',{method:'POST',body,headers:{'Content-Type':'application/json',...(bridge?{Authorization:'Bearer bridge-key'}:{}),...(signature?{'X-Hub-Signature-256':'sha256='+createHmac('sha256','app-secret').update(body).digest('hex')}:{})}}),env,execution);if(flush)await Promise.all(jobs.splice(0));return response.status}
const row=(phone:string)=>sql.prepare('SELECT * FROM whatsapp_inbound_welcomes WHERE recipient=?').get(phone) as any;
function friend(phone:string,following=1){const id='friend-'+phone;sql.prepare('INSERT INTO friends (id,line_user_id,display_name,line_account_id,is_following) VALUES (?,?,?,?,?)').run(id,phone,'Example','wa',following);return id}
try{
 assert.equal(await webhook(envelope([message('15555550100')]),false),401);assert.equal(sends.length,0);
 env.WHATSAPP_INBOUND_WELCOME_ENABLED='false';await webhook(envelope([message('15555550100')]));assert.equal(sends.length,0);env.WHATSAPP_INBOUND_WELCOME_ENABLED='true';
 await webhook(envelope([message('15555550100','wamid.later')]));assert.equal(sends.length,0,'existing conversation is never backfilled');
 env.WHATSAPP_INBOUND_WELCOME_ACCOUNTS='different:12345';await webhook(envelope([message('15555550101')]));assert.equal(sends.length,0);env.WHATSAPP_INBOUND_WELCOME_ACCOUNTS='wa:12345';
 await webhook(envelope([message('15555550102','wamid.old',stamp()-7200)]));assert.equal(sends.length,0,'pre-activation messages excluded');
 await webhook(envelope([message('15555550103','wamid.delayed',stamp()-1000)]));assert.equal(sends.length,0,'stale webhook excluded even after activation');
 await webhook(envelope([message('15555550104','wamid.stop',stamp(),'text','STOP')]));assert.equal(sends.length,0,'opt-out never prompts');
 friend('15555550105',0);await webhook(envelope([message('15555550105')]));assert.equal(sends.length,0,'stored opt-out is retained');
 const first=envelope([message('15555550106')]);
 assert.deepEqual(await Promise.all([webhook(first,true,false),webhook(first,true,false)]),[200,200]);await Promise.all(jobs.splice(0));
 assert.equal(sends.length,1,'concurrent first webhooks send once');assert.equal(sends[0].interactive.type,'call_permission_request');assert.equal(sends[0].interactive.body.text,WELCOME_PERMISSION_TEXT);assert.equal(sends[0].to,'15555550106');assert.equal(row('15555550106').status,'accepted');
 const request=sql.prepare('SELECT * FROM whatsapp_call_permission_requests WHERE id=?').get(row('15555550106').id) as any;assert.equal(request.status,'accepted');
 await webhook(first);await webhook(envelope([message('15555550106','wamid.second')]));assert.equal(sends.length,1,'replay and later customer messages never repeat acknowledgement');
 const receipt=sql.prepare('SELECT * FROM whatsapp_delivery_receipts WHERE provider_message_id=?').get('wamid.sent-1') as any;assert.equal(receipt.status,'accepted');
 await webhook(envelope([],{statuses:[{id:'wamid.sent-1',status:'delivered',timestamp:String(stamp())}]}));assert.equal(sql.prepare('SELECT status FROM whatsapp_delivery_receipts WHERE provider_message_id=?').get('wamid.sent-1')!.status,'delivered');
 await webhook(envelope([{from:'15555550107',id:'wamid.permission-reply',timestamp:String(stamp()),type:'interactive',interactive:{type:'call_permission_reply',call_permission_reply:{response:'accept',is_permanent:true}}}]));assert.equal(sends.length,1,'permission reply is not an enquiry');
 permitted='permanent';await webhook(envelope([message('15555550107')]));assert.equal(sends.at(-1).type,'text');assert.equal(sends.at(-1).text.body,WELCOME_TEXT);assert.equal(row('15555550107').permission_requested,0);
 permitted='temporary';await webhook(envelope([message('15555550108')]));assert.equal(sends.at(-1).type,'text');
 permitted='no_permission';canRequest=false;await webhook(envelope([message('15555550109')]));assert.equal(sends.at(-1).type,'text');canRequest=true;
 const manualFriend=friend('15555550110');sql.prepare("INSERT INTO whatsapp_call_permission_requests (id,friend_id,line_account_id,recipient,status,created_at) VALUES ('manual',?,'wa','15555550110','pending',?)").run(manualFriend,Date.now());
 await webhook(envelope([message('15555550110')]));assert.equal(sends.at(-1).type,'text','manual permission claim suppresses extra request');
 outcome='unknown';const uncertain=envelope([message('15555550111')]);await webhook(uncertain);const afterUnknown=sends.length;await webhook(uncertain);assert.equal(sends.length,afterUnknown);assert.equal(row('15555550111').status,'unknown');outcome='accepted';
 failHistory=true;const recover=envelope([message('15555550112')]);await webhook(recover);const afterFailure=sends.length;assert.equal(row('15555550112').status,'accepted');await webhook(recover);assert.equal(sends.length,afterFailure,'local receipt recovery does not send');assert.equal(sql.prepare("SELECT count(*) n FROM messages_log WHERE id=?").get('wa-welcome-'+row('15555550112').id)!.n,1);
 changeRecipient=true;await webhook(envelope([message('15555550113')]));assert.equal(sends.length,afterFailure,'changed recipient blocked before send');
 providerReadFailure=true;await webhook(envelope([message('15555550114')]));assert.equal(sends.length,afterFailure,'permission check failure does not send');providerReadFailure=false;
 outcome='rejected';const rejected=envelope([message('15555550115')]);await webhook(rejected);assert.equal(row('15555550115').status,'failed');const afterRejected=sends.length;await webhook(rejected);assert.equal(sends.length,afterRejected);outcome='accepted';
 env.WA_BRIDGE_SECRET='bridge-key';await webhook(envelope([message('15555550116')]),false,true,true);assert.equal(sends.length,afterRejected,'bridge authority alone cannot trigger welcome');
 const echo={object:'whatsapp_business_account',entry:[{id:'1234567890',changes:[{field:'smb_message_echoes',value:{metadata:{phone_number_id:'12345'},message_echoes:[{...message('12345'),to:'15555550117'}]}}]}]};await webhook(echo);assert.equal(sends.length,afterRejected,'app echo never welcomes');
 const existing=friend('15555550118');sql.prepare("INSERT INTO messages_log (id,friend_id,direction,message_type,content) VALUES ('existing',?,'outgoing','text','Existing contact')").run(existing);await webhook(envelope([message('15555550118')]));assert.equal(sends.length,afterRejected,'outbound-only existing conversation excluded');
 const pending=await (async()=>{const input=envelope([message('15555550119')]);await webhook(input,true,false);await Promise.all(jobs.splice(0));return row('15555550119')})();assert(pending);
 await sendInboundWelcome(env,pending.id);assert.equal(sends.length,afterRejected+1,'direct duplicate task only recovers receipt');
 console.log('PASS: first signed enquiry once, concurrency/replay, fresh exact-account/opt-out/history guards, native permission and already-permitted fallback, shared manual claim, failure/unknown no retry, accepted history recovery, provider delivery and recipient mutation guard');
}finally{globalThis.fetch=originalFetch;sql.close()}
