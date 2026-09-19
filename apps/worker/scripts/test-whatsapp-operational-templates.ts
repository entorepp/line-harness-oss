import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { whatsappTemplates } from '../src/routes/whatsapp-templates.js';
import { uploads } from '../src/routes/uploads.js';
import { waWebhook } from '../src/routes/wa-webhook.js';
import { friends } from '../src/routes/friends.js';
import { authMiddleware } from '../src/middleware/auth.js';
import { OPERATIONAL_TEMPLATES, operationalTemplate, prepareOperationalMessage, operationalPayload } from '../src/services/whatsapp-operational-templates.js';
const sql = new DatabaseSync(':memory:');
sql.exec(readFileSync('../../packages/db/schema.sql','utf8'));
sql.exec(readFileSync('../../packages/db/migrations/026_whatsapp_template_sends.sql','utf8'));
sql.exec(`INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret,channel_type,whatsapp_business_account_id) VALUES ('wa','12345','Test sender','token','app-secret','whatsapp','1234567890');
 INSERT INTO friends (id,line_user_id,display_name,line_account_id) VALUES ('a','15555550100','Alex','wa'),('b','15555550101','Other','wa'),('new','15555550102','New contact','wa');
 INSERT INTO chats (id,friend_id) VALUES ('chat-a','a');
 INSERT INTO messages_log (id,friend_id,direction,message_type,content,created_at) VALUES ('in-a','a','incoming','text','Test enquiry','2020-01-01T00:00:00Z'),('in-b','b','incoming','text','Test','2020-01-01T00:00:00Z');`);
let failHistoryOnce = false;
const db:any={prepare(query:string){
 const stmt=sql.prepare(query);let params:any[]=[];
 return {bind(...p:any[]){params=p;return this},async first(){return stmt.get(...params)||null},async all(){return {results:stmt.all(...params),success:true}},async run(){
  if(failHistoryOnce&&query.startsWith('INSERT OR IGNORE INTO messages_log')){failHistoryOnce=false;throw Error('Simulated history failure')}
  return {success:true,meta:{changes:Number(stmt.run(...params).changes)}};
 }};
}};
const files=new Map<string,{value:ArrayBuffer,metadata:any}>();
const env:any={DB:db,API_KEY:'staff-key',UPLOADS:{async put(k:string,value:ArrayBuffer,opts:any){files.set(k,{value,metadata:opts.metadata});assert.equal(opts.expirationTtl,180*86400)},async getWithMetadata(k:string){return files.get(k)||{value:null,metadata:null}}}};
const app=new Hono<any>();app.use('*',authMiddleware);app.route('/',whatsappTemplates);app.route('/',uploads);app.route('/',waWebhook);app.route('/',friends);
const definition=OPERATIONAL_TEMPLATES[0];
let raw:any={id:'template-1',name:definition.name,language:'en_US',category:'UTILITY',status:'APPROVED',components:[{type:'HEADER',format:'DOCUMENT'},{type:'BODY',text:definition.body}]};
let sendMode='accepted';let messages:any[]=[];let mediaCalls=0;
let onProviderStart:(()=>void)|null=null;let providerRelease:(()=>void)|null=null;
const originalFetch=globalThis.fetch;
globalThis.fetch=(async(input:any,init:any={})=>{
 const url=String(input);
 if(url.includes('/message_templates?'))return Response.json({data:[raw]});
 if(url.endsWith('/media')){mediaCalls++;assert.equal(init.body.get('type'),'application/pdf');assert.equal(init.body.get('file').type,'application/pdf');return Response.json({id:'99999'})}
 assert.equal(url,'https://graph.facebook.com/v25.0/12345/messages');assert.equal(init.headers.Authorization,'Bearer token');
 messages.push(JSON.parse(init.body));
 if(onProviderStart){const notify=onProviderStart;onProviderStart=null;await new Promise<void>(resolve=>{providerRelease=resolve;notify()})}
 if(sendMode==='unknown')throw Error('Network timeout after request');
 if(sendMode==='server-error')return Response.json({error:{code:2}},{status:500});
 if(sendMode==='rejected')return Response.json({error:{code:131047}},{status:400});
 return Response.json({messages:[{id:`wamid.test-${messages.length}`} ]});
}) as typeof fetch;
async function request(route:string,body?:any,method=body?'POST':'GET',authorized=true){return app.fetch(new Request(`https://test.invalid${route}`,{method,headers:{...(authorized?{Authorization:'Bearer staff-key'}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{})}),env)}
const path='/api/whatsapp/friends/a';
async function upload(friend='a',type='application/pdf',data='%PDF-1.4\nTest only'){
 const form=new FormData();form.set('file',new Blob([data],{type}),'test.pdf');return request(`/api/whatsapp/friends/${friend}/documents`,form);
}
let draft:any;
async function preview(overrides={}) {const response=await request(path+'/template-preview',{...draft,...overrides});assert.equal(response.status,200,await response.clone().text());return (await response.json() as any).data}
function body(p:any,key=crypto.randomUUID()){return {...draft,idempotencyKey:key,previewToken:p.previewToken,previewExpiresAt:p.previewExpiresAt,optInConfirmed:true,contentConfirmed:true}}
async function send(b:any){return request(path+'/template-messages',b)}
const count=()=>messages.length;
try{
 assert.equal((await request(path+'/templates',undefined,'GET',false)).status,401);
 assert.equal((await upload('new')).status,400,'no initial-contact bypass');
 assert.equal((await upload('a','text/plain')).status,400);
 assert.equal((await upload('a','application/pdf','not-pdf')).status,400);
 const uploadResult=await upload();assert.equal(uploadResult.status,201);const file=(await uploadResult.json() as any).data;
 const privateRead=await request(path+'/documents/'+file.key);assert.equal(privateRead.status,200);assert.equal(privateRead.headers.get('cache-control'),'private, no-store');
 assert.equal((await request(path+'/documents/'+file.key,undefined,'GET',false)).status,401);
 assert.equal((await request('/api/whatsapp/friends/b/documents/'+file.key)).status,404);
 for(const legacy of ['files','images']) assert.equal((await request('/api/'+legacy+'/'+file.key,undefined,'GET',false)).status,404,'no public document leak');
 draft={templateName:definition.name,templateLanguage:'en_US',values:{'body:1':'Alex $&','body:2':'SAMPLE-001'},buttonValues:{},documentKey:file.key};
 const initial=await preview();assert.match(initial.text,/Alex \$&/,'replacement characters are literal');assert.equal(initial.canSend,false);
 const before=count();assert.equal((await send(body(initial))).status,400);assert.equal(count(),before,'off is fail-closed');assert.equal(mediaCalls,0);
 env.WHATSAPP_OPERATIONAL_TEMPLATES_MODE='test';assert.equal((await send(body(await preview()))).status,400);
 env.WHATSAPP_INITIAL_CONTACT_TEST_PHONE_HASHES=createHash('sha256').update('15555550100').digest('hex');
 assert.equal((await request(path+'/template-preview',{...draft,documentKey:null})).status,400);
 assert.equal((await request('/api/whatsapp/friends/b/template-preview',draft)).status,400,'document bound to recipient');
 assert.equal((await request(path+'/template-preview',{...draft,values:{...draft.values,unexpected:'bad'}})).status,400);
 const p=await preview();assert.equal(p.canSend,true);
 assert.equal((await send({...body(p),optInConfirmed:false})).status,400);
 assert.equal((await send({...body(p),values:{...draft.values,'body:2':'CHANGED'}})).status,400,'preview binds values');
 assert.equal((await send({...body(p),previewExpiresAt:Date.now()-1})).status,400);
 sql.prepare("UPDATE friends SET line_user_id='15555550999' WHERE id='a'").run();assert.equal((await send(body(p))).status,400);sql.prepare("UPDATE friends SET line_user_id='15555550100' WHERE id='a'").run();
 raw.status='PAUSED';assert.equal((await send(body(p))).status,400);raw.status='APPROVED';
 raw.category='MARKETING';assert.equal((await send(body(p))).status,400);raw.category='UTILITY';
 assert.equal(count(),before);
 // Two simultaneous requests compete for one SQL claim, including the upload.
 const prepared=body(await preview());let started!:()=>void;const began=new Promise<void>(resolve=>{started=resolve});onProviderStart=started;
 const first=send(prepared);await began;
 const second=await send(prepared);assert.equal(second.status,200);assert.equal((await second.json() as any).data.status,'pending');assert.equal(count(),before+1);providerRelease!();
 const accepted=await first;assert.equal(accepted.status,201);const acceptedData=(await accepted.json() as any).data;assert.equal(acceptedData.status,'accepted');
 const replay=await send(prepared);assert.equal((await replay.json() as any).data.duplicate,true);assert.equal(count(),before+1);
 assert.equal((await send({...prepared,values:{...draft.values,'body:1':'Other'}})).status,409,'same key cannot replay a different payload');
 assert.equal((await request('/api/whatsapp/friends/b/template-messages/'+prepared.idempotencyKey)).status,404);
 assert.equal(messages[0].to,'15555550100');assert.equal(messages[0].type,'template');assert.deepEqual(messages[0].template.components[0],{type:'header',parameters:[{type:'document',document:{id:'99999',filename:'test.pdf'}}]});
 assert.equal(sql.prepare("SELECT count(*) AS n FROM messages_log WHERE direction='outgoing'").get()!.n,1);
 assert.equal(sql.prepare('SELECT status FROM whatsapp_delivery_receipts WHERE message_log_id=?').get(acceptedData.messageId)!.status,'accepted');
 // Delivery callback arriving later updates that same local template message.
 const webhook=JSON.stringify({object:'whatsapp_business_account',entry:[{id:'1234567890',changes:[{field:'messages',value:{metadata:{phone_number_id:'12345'},statuses:[{id:acceptedData.providerMessageId,status:'delivered',timestamp:String(Math.floor(Date.now()/1000))}]}}]}]});
 assert.equal((await app.fetch(new Request('https://test.invalid/webhook/whatsapp',{method:'POST',body:webhook,headers:{'Content-Type':'application/json','X-Hub-Signature-256':'sha256='+createHmac('sha256','app-secret').update(webhook).digest('hex')}}),env)).status,200);
 assert.equal(sql.prepare('SELECT status FROM whatsapp_delivery_receipts WHERE message_log_id=?').get(acceptedData.messageId)!.status,'delivered');
 const history=(await (await request('/api/friends/a/messages')).json() as any).data;assert(history.some((item:any)=>item.messageType==='whatsapp_template'&&item.deliveryStatus==='delivered'));
 for(const state of ['unknown','server-error','rejected']){
  sendMode=state;const req=body(await preview());await send(req);const amount=count();
  const again=await send(req);assert.equal(again.status,200);const result=(await again.json() as any).data;assert.equal(result.status,state==='rejected'?'failed':'unknown');assert.equal(count(),amount,'no automatic repeat after failure/unknown');
 }
 sendMode='accepted';failHistoryOnce=true;const recovered=body(await preview());assert.equal((await send(recovered)).status,502);const sent=count();
 assert.equal((await (await request(path+'/template-messages/'+recovered.idempotencyKey)).json() as any).data.status,'accepted');assert.equal(count(),sent,'local recovery never sends again');
 const dynamic=operationalTemplate({id:'url',name:'url_notice',language:'en_US',status:'APPROVED',category:'UTILITY',components:[{type:'BODY',text:'Invoice {{1}} is available.'},{type:'BUTTONS',buttons:[{type:'URL',text:'Pay',url:'https://pay.example.com/invoice/{{1}}'}]}]})!;
 const dynamicMessage=prepareOperationalMessage(dynamic,{'body:1':'INV-1'},{'0':'unique-token'});assert.equal(dynamicMessage.links[0].url,'https://pay.example.com/invoice/unique-token');
 assert.deepEqual((operationalPayload('15555550100',dynamic,dynamicMessage) as any).template.components[1],{type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:'unique-token'}]});
 assert.throws(()=>prepareOperationalMessage(dynamic,{'body:1':'INV-1'},{}));
 const payment=OPERATIONAL_TEMPLATES[5];const pay=operationalTemplate({name:payment.name,language:'en_US',status:'APPROVED',category:'UTILITY',components:[{type:'BODY',text:payment.body}]})!;
 assert.throws(()=>prepareOperationalMessage(pay,{'body:1':'Alex','body:2':'Invoice','body:3':'javascript:alert(1)'},{}));
 console.log('PASS: real SQL claims, private recipient-bound PDFs, auth, consent, off/test gates, fresh Meta approval, stale preview/recipient, expired-window template send, body/URL variables, concurrent/replayed/unknown sends, receipt recovery and signed delivery callback');
}finally{globalThis.fetch=originalFetch;sql.close()}
