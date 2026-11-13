import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { fwWhatsapp } from '../src/routes/fw-whatsapp.js';
import { authMiddleware } from '../src/middleware/auth.js';
import { OPERATIONAL_TEMPLATES } from '../src/services/whatsapp-operational-templates.js';

const sql=new DatabaseSync(':memory:');
sql.exec(readFileSync('../../packages/db/schema.sql','utf8'));
sql.exec(readFileSync('../../packages/db/migrations/034_fw_whatsapp_sends.sql','utf8'));
sql.exec(readFileSync('../../packages/db/migrations/026_whatsapp_template_sends.sql','utf8')); 
const db={prepare(query:string){const stmt=sql.prepare(query);let values:any[]=[];return {bind(...v:any[]){values=v;return this;},async first(){return stmt.get(...values)||null;},async all(){return {results:stmt.all(...values)};},async run(){return {meta:{changes:Number(stmt.run(...values).changes)}};}};}};
sql.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,channel_type,whatsapp_business_account_id)
 VALUES('wa','phone','Flat Travel','token','secret','whatsapp','1234567890');
 INSERT INTO friends(id,line_user_id,display_name,line_account_id,is_following) VALUES('friend','15555550101','Alex','wa',1),('private','US.Private1','Private','wa',1),('legacy','username_only','Legacy','wa',1);
 INSERT INTO chats(id,friend_id) VALUES('chat','friend');`);
const memory=new Map<string,any>();
const env={DB:db,API_KEY:'staff-key',FLATWORKER_TRAVEL_QUOTE_TOKEN:'x'.repeat(40),WHATSAPP_OPERATIONAL_TEMPLATES_MODE:'live',
 UPLOADS:{async put(key:string,value:any,options:any){memory.set(key,{value,metadata:options.metadata});},async getWithMetadata(key:string){return memory.get(key)||{value:null,metadata:null};}}} as any;
const app=new Hono();app.use('*',authMiddleware as any);app.route('/',fwWhatsapp);
const prefix='/api/integrations/fw-whatsapp';
async function call(path:string,body?:any,token=env.FLATWORKER_TRAVEL_QUOTE_TOKEN){return app.fetch(new Request('https://example.test'+prefix+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);}
const realFetch=globalThis.fetch;let sends=0;let unknown=false;let approved=true;let lastPayload:any=null;
const status=()=>approved?'APPROVED':'PAUSED';
const journey=[
 {name:'flat_travel_payment_received_v1',language:'en_US',status:'APPROVED',category:'UTILITY',components:[{type:'BODY',text:'Thank you! We’ve received your payment.'}]},
 {name:'flat_travel_arrangements_confirmed_v1',language:'en_US',status:'APPROVED',category:'UTILITY',components:[{type:'HEADER',format:'DOCUMENT'},{type:'BODY',text:'Good news! All your arrangements are now confirmed.'}]},
 {name:'flat_travel_post_trip_feedback_v1',language:'en_US',status:'APPROVED',category:'UTILITY',components:[{type:'BODY',text:'Welcome home!'},{type:'BUTTONS',buttons:[{type:'URL',text:'Share feedback',url:'https://liffform-studio.pages.dev/public-form?id=8dc19365-8dd7-49e7-92fb-fdd697572771&lang=en&issue={{1}}'}]}]},
 {name:'flat_travel_quote_reminder_1_v1',language:'en_US',status:'APPROVED',category:'MARKETING',components:[{type:'BODY',text:'Just checking in on the quote we sent.'}]},
 {name:'flat_travel_payment_link_v1',language:'en_US',status:'APPROVED',category:'UTILITY',components:[{type:'BODY',text:'Hello {{1}}, pay {{2}} at {{3}}.'}]},
];
globalThis.fetch=(async(url:any,init?:RequestInit)=>{
 const u=String(url);assert.ok(u.startsWith('https://graph.facebook.com/'));
 if(u.includes('/message_templates'))return Response.json({data:[{name:'flat_travel_requested_quote_v2',language:'en_US',status:status(),category:'UTILITY',components:[{type:'HEADER',format:'DOCUMENT'},{type:'BODY',text:'Hello {{1}}, your quotation is attached.'}]},...journey]});
 if(u.endsWith('/media'))return Response.json({id:'123456'});
 assert.ok(u.endsWith('/messages'));sends++;lastPayload=JSON.parse(String(init?.body||'null'));
 if(unknown)throw new Error('network');
 return Response.json({messages:[{id:'wamid.'+sends}]});
}) as typeof fetch;
const inbound=()=>sql.prepare("INSERT INTO messages_log(id,friend_id,direction,message_type,content,created_at) VALUES(?,?,'incoming','text','hello',?)").run(crypto.randomUUID(),'friend',new Date().toISOString());
try {
 assert.equal((await call('/contacts?q=Alex',undefined,'staff-key')).status,401,'general staff key cannot use dedicated boundary');
 assert.equal((await call('/contacts?q=Alex',undefined,'')).status,401);
 const search=await (await call('/contacts?q=Alex')).json() as any;assert.equal(search.contacts.length,1);
 const byPhone=await(await call('/contacts?q='+encodeURIComponent('+1 (555) 555-0101'))).json() as any;assert.equal(byPhone.contacts[0].id,'friend','formatted international number searches the stored exact number');
 const contact=search.contacts[0];assert.equal(contact.window.canSend,false);
 assert.equal((await call('/contacts/legacy')).status,409,'username cannot become send recipient');
 const privateContact=await(await call('/contacts/private')).json() as any;assert.equal(privateContact.address,'US.Private1');
 const body={idempotencyKey:'a'.repeat(64),fingerprint:contact.fingerprint,confirmed:true,text:'Please review',url:'https://go.flat-travel.com/api/integrations/quote-email/view?token=example'};
 assert.equal((await call('/contacts/friend/send',body)).status,409);assert.equal(sends,0,'closed window cannot send free text');
 inbound();
 assert.equal((await call('/contacts/friend/send',{...body,fingerprint:'stale'})).status,409);assert.equal(sends,0);
 assert.equal((await call('/contacts/friend/send',{...body,url:'https://attacker.invalid/quote'})).status,400);assert.equal(sends,0);
 let result=await(await call('/contacts/friend/send',body)).json() as any;assert.equal(result.status,'accepted');assert.equal(sends,1);
 result=await(await call('/contacts/friend/send',body)).json() as any;assert.equal(result.duplicate,true);assert.equal(sends,1);
 assert.equal((await call('/contacts/friend/send',{...body,text:'changed'})).status,409);assert.equal(sends,1);
 const history=await(await call('/contacts/friend/history?fingerprint='+contact.fingerprint)).json() as any;
 assert.ok(history.events.some((e:any)=>e.delivery_status==='accepted'));assert.ok(history.events.every((e:any)=>!('content' in e)));
 unknown=true;const uncertain={...body,idempotencyKey:'b'.repeat(64)};
 assert.equal((await call('/contacts/friend/send',uncertain)).status,502);assert.equal(sends,2);
 result=await(await call('/contacts/friend/send',uncertain)).json() as any;assert.equal(result.status,'unknown');assert.equal(sends,2);
 unknown=false;
 sql.exec("UPDATE messages_log SET created_at='2020-01-01T00:00:00Z' WHERE direction='incoming'");
 const prep=await call('/contacts/friend/prepare-template',{fingerprint:contact.fingerprint,name:'Alex',pdf:btoa('%PDF-example')});
 const prepared=await prep.json() as any;assert.equal(prep.status,200,JSON.stringify(prepared));assert.equal(sends,2,'preview never sends');
 const templateBody={idempotencyKey:'c'.repeat(64),fingerprint:contact.fingerprint,confirmed:true,template:prepared.template,optInConfirmed:true};
 assert.equal((await call('/contacts/friend/send',{...templateBody,optInConfirmed:false})).status,409);assert.equal(sends,2);
 result=await(await call('/contacts/friend/send',templateBody)).json() as any;assert.equal(result.status,'accepted',JSON.stringify(result));assert.equal(sends,3);
 const after=await(await call('/contacts/friend')).json() as any;assert.equal(after.window.canSend,false,'template acceptance must not reopen window');
 const second=await(await call('/contacts/friend/prepare-template',{fingerprint:contact.fingerprint,name:'Alex',pdf:btoa('%PDF-example')})).json() as any;
 approved=false;
 result=await(await call('/contacts/friend/send',{...templateBody,idempotencyKey:'d'.repeat(64),template:second.template})).json() as any;
 assert.notEqual(result.status,'accepted');assert.equal(sends,3,'withdrawn approval never sends');
 approved=true;
 // Customer journey templates: allowlist, per-template inputs, approval and category gates.
 const journeyNames=OPERATIONAL_TEMPLATES.slice(OPERATIONAL_TEMPLATES.findIndex(t=>t.name==='flat_travel_requested_quote_v2')+1).map(t=>t.name);
 assert.equal(journeyNames.length,18);
 const catalogue=await(await call('/contacts/friend/templates?fingerprint='+contact.fingerprint)).json() as any;
 assert.deepEqual(catalogue.templates.map((t:any)=>t.name),['flat_travel_requested_quote_v2',...journeyNames],'picker lists exactly the quotation and the 18 journey templates');
 const pick=(n:string)=>catalogue.templates.find((t:any)=>t.name===n);
 assert.equal(pick('flat_travel_requested_quote_v2').customerNameRequired,true);
 assert.equal(pick('flat_travel_payment_received_v1').available,true);
 assert.equal(pick('flat_travel_arrangements_confirmed_v1').documentRequired,true);
 assert.equal(pick('flat_travel_post_trip_feedback_v1').linkRequired,true);
 assert.equal(pick('flat_travel_enquiry_received_v1').available,false,'not yet registered at Meta');
 assert.equal(pick('flat_travel_quote_reminder_1_v1').available,false,'recategorised as MARKETING is never sendable');
 assert.equal((await call('/contacts/friend/templates?fingerprint=stale')).status,409);
 const prepare=(extra:any)=>call('/contacts/friend/prepare-template',{fingerprint:contact.fingerprint,...extra});
 assert.equal((await prepare({templateName:'flat_travel_payment_link_v1'})).status,400,'templates outside the FW allowlist are refused');
 assert.equal((await prepare({templateName:'flat_travel_payment_received_v1',pdf:btoa('%PDF-x')})).status,400,'no PDF on a text-only template');
 assert.equal((await prepare({templateName:'flat_travel_payment_received_v1',name:'Alex'})).status,400,'no name on a fixed-copy template');
 assert.equal((await prepare({templateName:'flat_travel_arrangements_confirmed_v1'})).status,400,'PDF template needs the PDF');
 assert.equal((await prepare({templateName:'flat_travel_post_trip_feedback_v1'})).status,400,'survey template needs the issue id');
 assert.equal((await prepare({templateName:'flat_travel_post_trip_feedback_v1',link:'../x?y'})).status,400,'issue id cannot change the URL');
 assert.equal((await prepare({templateName:'flat_travel_quote_reminder_1_v1'})).status,409,'MARKETING template cannot be prepared');
 assert.equal((await prepare({templateName:'flat_travel_enquiry_received_v1'})).status,409,'unregistered template cannot be prepared');
 const sendPrepared=async(extra:any,key:string)=>{const r=await prepare(extra);const p=await r.json() as any;assert.equal(r.status,200,JSON.stringify(p));
  return {prepared:p,result:await(await call('/contacts/friend/send',{idempotencyKey:key.repeat(64),fingerprint:contact.fingerprint,confirmed:true,template:p.template,optInConfirmed:true})).json() as any};};
 let before=sends;let sent=await sendPrepared({templateName:'flat_travel_payment_received_v1'},'e');
 assert.equal(sent.result.status,'accepted',JSON.stringify(sent.result));assert.equal(sends,before+1);
 assert.equal(lastPayload.template.name,'flat_travel_payment_received_v1');assert.deepEqual(lastPayload.template.components,[]);
 sent=await sendPrepared({templateName:'flat_travel_arrangements_confirmed_v1',pdf:btoa('%PDF-example')},'f');
 assert.equal(sent.result.status,'accepted');assert.equal(lastPayload.template.components[0].parameters[0].document.filename,'booking-confirmations.pdf');
 sent=await sendPrepared({templateName:'flat_travel_post_trip_feedback_v1',link:'issue-abc_123'},'0');
 assert.equal(sent.result.status,'accepted');assert.ok(sent.prepared.text.includes('&issue=issue-abc_123'));
 assert.deepEqual(lastPayload.template.components,[{type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:'issue-abc_123'}]}]);
 const swapped=await(await prepare({templateName:'flat_travel_payment_received_v1'})).json() as any;before=sends;
 assert.equal((await call('/contacts/friend/send',{idempotencyKey:'1'.repeat(64),fingerprint:contact.fingerprint,confirmed:true,optInConfirmed:true,template:{...swapped.template,templateName:'flat_travel_payment_link_v1'}})).status,409);
 assert.equal(sends,before,'send refuses a template outside the allowlist');
 result=await(await call('/contacts/friend/send',{idempotencyKey:'2'.repeat(64),fingerprint:contact.fingerprint,confirmed:true,optInConfirmed:true,template:{...swapped.template,templateName:'flat_travel_arrival_check_v1'}})).json() as any;
 assert.notEqual(result.status,'accepted');assert.equal(sends,before,'a preview cannot be reused for another template');
 const g3:any=journey[2].components[1];const realUrl=g3.buttons[0].url;g3.buttons[0].url='https://attacker.invalid/form?issue={{1}}';
 const moved=await(await call('/contacts/friend/templates?fingerprint='+contact.fingerprint)).json() as any;
 assert.equal(moved.templates.find((t:any)=>t.name==='flat_travel_post_trip_feedback_v1').unavailableReason,'link_button_changed');
 before=sends;assert.equal((await prepare({templateName:'flat_travel_post_trip_feedback_v1',link:'issue-abc_123'})).status,409,'a survey button moved at Meta is refused');
 g3.buttons[0].url=realUrl;
 (journey[0].components as any[]).push({type:'BUTTONS',buttons:[{type:'URL',text:'Open',url:'https://example.com/'}]});
 assert.equal((await prepare({templateName:'flat_travel_payment_received_v1'})).status,409,'an unexpected URL button is refused');
 (journey[0].components as any[]).pop();assert.equal(sends,before);
 // Scheduled C1-C3 reuse only evidenced original quote receipts and the previous day's approval.
 const sha=async(value:string)=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
 const today=new Date(Date.now()+9*3600_000).toISOString().slice(0,10);
 const dayAgo=(n:number)=>new Date(Date.parse(today+'T00:00:00Z')-n*86400_000).toISOString().slice(0,10);
 journey[3].category='UTILITY';
 journey.push(...['flat_travel_quote_reminder_2_v2','flat_travel_quote_reminder_3_v2'].map(name=>({name,language:'en_US',status:'APPROVED',category:'UTILITY',components:[{type:'BODY',text:'Following up on your requested quotation.'}]})));
 const scheduled=async(stage:number,receipt:string,extra:any={})=>{
  const templateName=['flat_travel_quote_reminder_1_v1','flat_travel_quote_reminder_2_v2','flat_travel_quote_reminder_3_v2'][stage-1];
  const prepared=await(await prepare({templateName})).json() as any;
  return {idempotencyKey:await sha(JSON.stringify(['fw-followup',receipt,stage])),fingerprint:contact.fingerprint,confirmed:true,optInConfirmed:true,template:prepared.template,
    followup:{stage,quoteMessageId:receipt,approvedBy:'U1',approvedAt:dayAgo(1)+'T15:00:00+09:00',sendOn:today,textHash:await sha(prepared.text),...extra}};
 };
 const original=(receipt:string)=>sql.prepare("INSERT INTO fw_whatsapp_sends(id,friend_id,request_hash,status,message_log_id,created_at,updated_at) VALUES(?,?,'quote','accepted',?,?,?)")
  .run(receipt,'friend',receipt,dayAgo(14)+'T09:00:00+09:00',dayAgo(14)+'T09:00:00+09:00');
 // Existing incoming messages predate this synthetic quotation.
 sql.prepare("UPDATE messages_log SET created_at=? WHERE direction='incoming'").run(dayAgo(20)+'T00:00:00+09:00');
 unknown=false;
 for(const stage of [1,2,3]) {
  const receipt='original-'+stage;original(receipt);
  const body=await scheduled(stage,receipt);before=sends;
  assert.equal((await call('/contacts/friend/send',{...body,followup:{...body.followup,approvedAt:dayAgo(2)+'T15:00:00+09:00'}})).status,502);
  assert.equal(sends,before,'stale approval never sends');
  assert.equal((await call('/contacts/friend/send',{...body,followup:{...body.followup,textHash:'0'.repeat(64)}})).status,409);
  assert.equal(sends,before,'reviewed text must match');
  const sent=await(await call('/contacts/friend/send',body)).json() as any;
  assert.equal(sent.status,'accepted',JSON.stringify(sent));assert.equal(sends,before+1);
  await call('/contacts/friend/send',body);assert.equal(sends,before+1,'same quote/stage never sends twice');
 }
 const repliedReceipt='original-replied';original(repliedReceipt);const blocked=await scheduled(1,repliedReceipt);before=sends;
 inbound();
 assert.equal((await call('/contacts/friend/send',blocked)).status,502);assert.equal(sends,before,'incoming reply stops an approved follow-up');
 const state=await(await call('/contacts/friend/followup-state?fingerprint='+contact.fingerprint+'&quoteMessageId='+repliedReceipt)).json() as any;
 assert.equal(state.replied,true);
 assert.equal((await call('/contacts/friend/send',{...blocked,followup:{...blocked.followup,stage:4}})).status,502);
 assert.equal(sends,before,'only C1-C3 may use the scheduled path');
 console.log('FW WhatsApp: auth, recipient, stale review, window, template consent/approval, receipts, idempotency and unknown-outcome tests and journey template tests passed');
} finally {globalThis.fetch=realFetch;sql.close();}
