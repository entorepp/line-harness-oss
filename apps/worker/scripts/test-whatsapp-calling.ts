import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { authMiddleware } from '../src/middleware/auth.js';
import { waWebhook } from '../src/routes/wa-webhook.js';
import { whatsappCalling } from '../src/routes/whatsapp-calling.js';
import { permissionAllows, expireCallingSdp } from '../src/services/whatsapp-calling.js';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync('../../packages/db/schema.sql','utf8'));
sqlite.exec(readFileSync('../../packages/db/migrations/027_whatsapp_calls.sql','utf8'));
sqlite.exec(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, channel_type) VALUES ('wa','phone','WA','test-token','test-secret','whatsapp');
INSERT INTO friends (id,line_user_id,display_name,line_account_id) VALUES ('f','15555550100','Internal Test','wa');
INSERT INTO friends (id,line_user_id,display_name,line_account_id) VALUES ('other','15555550101','Other','wa');
INSERT INTO messages_log (id,friend_id,direction,message_type,content,created_at) VALUES ('incoming','f','incoming','text','{}','${new Date().toISOString()}');`);
const db = {prepare(sql:string) { const stmt=sqlite.prepare(sql); let b:any[]=[]; return {
 bind(...args:any[]){b=args;return this}, async first<T>(){return (stmt.get(...b)||null) as T|null},
 async all<T>(){return {results:stmt.all(...b) as T[],success:true}}, async run(){const r=stmt.run(...b);return {success:true,meta:{changes:Number(r.changes)}}}
}}};
const env:any={DB:db,API_KEY:'internal',WHATSAPP_CALLING_MODE:'live',WHATSAPP_CALLING_ACCOUNTS:'wa:phone'};
const app=new Hono();app.use('*',authMiddleware as any);app.route('/',whatsappCalling);app.route('/',waWebhook);
const offer='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=ice-ufrag:test\r\na=ice-pwd:test-password\r\na=fingerprint:sha-256 AB:CD\r\n';
let permission:any={permission:{status:'permanent'},actions:[{action_name:'start_call',can_perform_action:true},{action_name:'send_call_permission_request',can_perform_action:true}]};
const actions:any[]=[];let fail='';let counter=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=(async(url:any,init:any={})=>{
 assert.ok(String(url).startsWith('https://graph.facebook.com/v25.0/phone/'));
 if(String(url).includes('settings'))return Response.json({calling:{status:'ENABLED'}});
 if(String(url).includes('call_permissions'))return Response.json(permission);
 const body=JSON.parse(init.body);actions.push(body);
 if(fail==='transport'){throw new TypeError('network stopped')}
 if(fail==='reject')return Response.json({error:{code:138006}},{status:400});
 if(body.action==='connect')return Response.json({calls:[{id:'wacid.out-'+(++counter)}]});
 if(body.type==='interactive')return Response.json({messages:[{id:'wamid.permission-'+(++counter)}]});
 return Response.json({success:true});
}) as typeof fetch;
const root='/api/whatsapp/friends/f/calling';
async function request(path:string,body?:any,auth=true){const response=await app.fetch(new Request('https://test.invalid'+path,{method:body?'POST':'GET',headers:{...(auth?{Authorization:'Bearer internal'}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env);return {status:response.status,body:await response.json() as any}}
async function webhook(events:any[],statuses:any[]=[],valid=true,phone='phone'){
 const body=JSON.stringify({object:'whatsapp_business_account',entry:[{id:'waba',changes:[{field:'calls',value:{metadata:{phone_number_id:phone},calls:events,statuses}}]}]});
 const response=await app.fetch(new Request('https://test.invalid/webhook/whatsapp',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':'sha256='+(valid?createHmac('sha256','test-secret').update(body).digest('hex'):'bad')},body}),env);return response.status;
}
const stamp=()=>Math.floor(Date.now()/1000);
const inbound=(id:string,event='connect')=>({id,from:'15555550100',to:'817000000000',direction:'USER_INITIATED',event,timestamp:String(stamp()),session:{sdp_type:'offer',sdp:offer}});
function row(id:string):any{return sqlite.prepare('SELECT * FROM whatsapp_calls WHERE id = ?').get(id)}
try {
 assert.equal((await request(root+'/status',undefined,false)).status,401);
 assert.equal((await request(root+'/status')).body.data.canCall,true);
 env.WHATSAPP_CALLING_MODE='test';assert.equal((await request(root+'/status')).body.data.canCall,false,'test mode denies unlisted recipient');
 env.WHATSAPP_CALLING_MODE='off';assert.equal((await request(root+'/status')).body.data.canCall,false);
 assert.equal((await request(root+'/calls',{requestId:crypto.randomUUID(),sdp:offer,confirmed:true})).status,403);env.WHATSAPP_CALLING_MODE='live';
 assert.equal(permissionAllows({permission:{status:'temporary',expiration_time:1},actions:[{action_name:'start_call',can_perform_action:true}]},'start_call'),false);
 permission.actions[0].can_perform_action=false;
 assert.equal((await request(root+'/calls',{requestId:crypto.randomUUID(),sdp:offer,confirmed:true})).status,403);permission.actions[0].can_perform_action=true;
 assert.equal(actions.length,0,'guard failures never call provider');
 const id=crypto.randomUUID();
 const first=await request(root+'/calls',{requestId:id,sdp:offer,confirmed:true});assert.equal(first.body.data.state,'connecting');
 await request(root+'/calls',{requestId:id,sdp:offer,confirmed:true});assert.equal(actions.filter(a=>a.action==='connect').length,1,'same id never redials');
 assert.equal((await request('/api/whatsapp/friends/other/calling/calls',{requestId:id,sdp:offer,confirmed:true})).status,409);
 assert.equal((await request(root+'/calls',{requestId:crypto.randomUUID(),sdp:offer,confirmed:true})).status,403,'active call prevents concurrent dial');
 const outbound={id:row(id).provider_call_id,to:'15555550100',from:'817000000000',direction:'BUSINESS_INITIATED',timestamp:String(stamp()),biz_opaque_callback_data:id};
 assert.equal(await webhook([{...outbound,event:'connect',session:{sdp_type:'answer',sdp:offer}}],[],false),401);assert.equal(row(id).answer_sdp,null);
 await webhook([],[{...outbound,status:'ACCEPTED'}]);
 await webhook([{...outbound,event:'connect',session:{sdp_type:'answer',sdp:offer}}]);assert.equal(row(id).state,'accepted');assert.equal(row(id).answer_sdp,offer,'late SDP retained');
 await webhook([{...outbound,event:'terminate',status:'COMPLETED',duration:4}]);
 await webhook([{...outbound,event:'connect',session:{sdp_type:'answer',sdp:offer}}]);assert.equal(row(id).state,'ended');assert.equal(row(id).answer_sdp,null);
 const unknownId=crypto.randomUUID();fail='transport';await request(root+'/calls',{requestId:unknownId,sdp:offer,confirmed:true});assert.equal(row(unknownId).state,'unknown');
 const count=actions.length;await request(root+'/calls',{requestId:unknownId,sdp:offer,confirmed:true});assert.equal(actions.length,count,'unknown outcome not retried');fail='';
 await webhook([{...outbound,id:'wacid.late',biz_opaque_callback_data:unknownId,event:'connect',session:{sdp_type:'answer',sdp:offer}}]);assert.equal(row(unknownId).provider_call_id,'wacid.late');
 env.WHATSAPP_CALLING_MODE='off';assert.equal((await request('/api/whatsapp/calling/calls/'+unknownId+'/end',{})).body.data.state,'ended');env.WHATSAPP_CALLING_MODE='live';
 const incoming=inbound('wacid.in');await webhook([incoming]);await webhook([incoming]);
 const list=(await request('/api/whatsapp/calling/incoming')).body.data.calls;assert.equal(list.length,1,'duplicate incoming webhook yields one alert');assert.equal(list[0].offerSdp,null,'list does not expose SDP');
 const iid=list[0].id;assert.equal((await request('/api/whatsapp/calling/calls/'+iid)).body.data.offerSdp,offer);
 const a=crypto.randomUUID(),b=crypto.randomUUID();const answers=await Promise.all([request('/api/whatsapp/calling/calls/'+iid+'/answer',{ownerId:a,sdp:offer}),request('/api/whatsapp/calling/calls/'+iid+'/answer',{ownerId:b,sdp:offer})]);
 assert.deepEqual(answers.map(r=>r.status).sort(),[200,409]);assert.equal(actions.filter(a=>a.action==='accept').length,1,'only one operator answers');
 assert.equal(row(iid).state,'accepted');await webhook([inbound('wacid.in','terminate')]);assert.equal(row(iid).state,'ended');
 await webhook([inbound('wacid.reverse','terminate')]);await webhook([inbound('wacid.reverse')]);assert.equal((await request('/api/whatsapp/calling/incoming')).body.data.calls.length,0,'terminate before connect stays ended');
 await webhook([{...inbound('wacid.new'),from:'15555550999'}]);const unknownCaller=(await request('/api/whatsapp/calling/incoming')).body.data.calls[0];assert.equal(unknownCaller.friendId,null,'unknown caller requires no customer-history write');await request('/api/whatsapp/calling/calls/'+unknownCaller.id+'/end',{});
 const permissionId=crypto.randomUUID();assert.equal((await request(root+'/permission',{requestId:permissionId,confirmed:true})).body.data.status,'accepted');await request(root+'/permission',{requestId:permissionId,confirmed:true});assert.equal(actions.filter(a=>a.type==='interactive').length,1);
 sqlite.prepare("UPDATE messages_log SET created_at='2020-01-01T00:00:00Z' WHERE direction='incoming'").run();assert.equal((await request(root+'/permission',{requestId:crypto.randomUUID(),confirmed:true})).status,403,'permission request respects reply window');
 sqlite.prepare('UPDATE whatsapp_calls SET answer_sdp = ?, created_at = ? WHERE id = ?').run(offer,Date.now()-180000,id);await expireCallingSdp(db as any);assert.equal(row(id).answer_sdp,null,'minute cleanup expires SDP');
 assert.equal(sqlite.prepare('SELECT count(*) n FROM friends').get()?.n,2,'no customer mutation');
 console.log('PASS WhatsApp calling: auth, mode/permission/window guards, idempotency, unknown outcomes, signed/reordered webhooks, inbound alerts, simultaneous answer, termination and history preservation');
} finally {globalThis.fetch=originalFetch;sqlite.close()}
