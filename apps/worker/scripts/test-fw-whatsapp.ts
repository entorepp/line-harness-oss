import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { fwWhatsapp } from '../src/routes/fw-whatsapp.js';
import { authMiddleware } from '../src/middleware/auth.js';

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
const realFetch=globalThis.fetch;let sends=0;let unknown=false;let approved=true;
globalThis.fetch=(async(url:any,init?:RequestInit)=>{
 const u=String(url);assert.ok(u.startsWith('https://graph.facebook.com/'));
 if(u.includes('/message_templates'))return Response.json({data:[{name:'flat_travel_requested_quote_v2',language:'en_US',status:approved?'APPROVED':'PAUSED',category:'UTILITY',components:[{type:'HEADER',format:'DOCUMENT'},{type:'BODY',text:'Hello {{1}}, your quotation is attached.'}]}]});
 if(u.endsWith('/media'))return Response.json({id:'123456'});
 assert.ok(u.endsWith('/messages'));sends++;
 if(unknown)throw new Error('network');
 return Response.json({messages:[{id:'wamid.'+sends}]});
}) as typeof fetch;
const inbound=()=>sql.prepare("INSERT INTO messages_log(id,friend_id,direction,message_type,content,created_at) VALUES(?,?,'incoming','text','hello',?)").run(crypto.randomUUID(),'friend',new Date().toISOString());
try {
 assert.equal((await call('/contacts?q=Alex',undefined,'staff-key')).status,401,'general staff key cannot use dedicated boundary');
 assert.equal((await call('/contacts?q=Alex',undefined,'')).status,401);
 const search=await (await call('/contacts?q=Alex')).json() as any;assert.equal(search.contacts.length,1);
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
 console.log('FW WhatsApp: auth, recipient, stale review, window, template consent/approval, receipts, idempotency and unknown-outcome tests passed');
} finally {globalThis.fetch=realFetch;sql.close();}
