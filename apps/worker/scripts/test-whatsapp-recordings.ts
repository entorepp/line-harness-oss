import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { authMiddleware } from '../src/middleware/auth.js';
import { whatsappRecordings } from '../src/routes/whatsapp-recordings.js';
import { processWhatsappRecordings } from '../src/services/whatsapp-recording-jobs.js';
import { audioKey, loadRecordingBytes, recordingHash, storeRecordingBytes } from '../src/services/whatsapp-recording-storage.js';

const db=new DatabaseSync(':memory:');
db.exec(readFileSync('../../packages/db/schema.sql','utf8'));
for(const file of ['027_whatsapp_calls.sql','031_whatsapp_call_recordings.sql','031_whatsapp_call_recordings.sql'])db.exec(readFileSync('../../packages/db/migrations/'+file,'utf8'));
db.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,channel_type) VALUES ('wa','phone','WA','token','secret','whatsapp'); INSERT INTO friends(id,line_user_id,display_name,line_account_id,slack_channel_id) VALUES ('f','15555550100','Owner Test','wa','C1234567890')");
const owner=crypto.randomUUID(),callId=crypto.randomUUID();
db.prepare("INSERT INTO whatsapp_calls(id,friend_id,line_account_id,recipient,state,direction,owner_id,created_at,updated_at) VALUES (?,'f','wa','15555550100','accepted','inbound',?,?,?)").run(callId,owner,Date.now(),Date.now());
const d1={prepare(sql:string){const stmt=db.prepare(sql);let args:any[]=[];return {bind(...a:any[]){args=a;return this},async first(){return stmt.get(...args)||null},async all(){return {results:stmt.all(...args)}},async run(){const r=stmt.run(...args);return {meta:{changes:Number(r.changes)}}}}}};
const kv=new Map<string,ArrayBuffer>();const expirations:number[]=[];
const env:any={DB:d1,API_KEY:'staff',WHATSAPP_CALLING_MODE:'live',WHATSAPP_CALLING_ACCOUNTS:'wa:phone',WHATSAPP_CALL_RECORDING_MODE:'test',WHATSAPP_CALL_RECORDING_TEST_PHONE_HASHES:await recordingHash(new TextEncoder().encode('15555550100').buffer as ArrayBuffer),WHATSAPP_CALL_RECORDING_OPENAI_KEY:'private-test-key',FORM_RESPONSE_EMAIL_ENCRYPTION_KEY:'01234567890123456789012345678901',SLACK_BOT_TOKEN:'private-slack',UPLOADS:{async put(k:string,v:Uint8Array,opts:any){kv.set(k,v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength) as ArrayBuffer);expirations.push(opts.expiration)},async get(k:string){return kv.get(k)||null}}};
const app=new Hono();app.use('*',authMiddleware as any);app.route('/',whatsappRecordings);
const root=`/api/whatsapp/calling/calls/${callId}/recording`;
async function request(path:string,body?:any,method=body?'POST':'GET',headers:any={}){
 const response=await app.request('https://harness.test'+path,{method,headers:{Authorization:'Bearer staff','Content-Type':'application/json',...headers},...(body?{body:body instanceof Uint8Array?body:JSON.stringify(body)}:{})},env);return {status:response.status,body:await response.json() as any};
}
const consent={ownerId:owner,consentConfirmed:true,noticeVersion:'wa-recording-v1',consentMethod:'staff_confirmed'};
assert.equal((await app.request('https://harness.test'+root+'/status',{},env)).status,401);
env.WHATSAPP_CALL_RECORDING_MODE='off';assert.equal((await request(root+'/status')).body.data.enabled,false);
assert.equal((await request(root+'/start',consent)).status,403);env.WHATSAPP_CALL_RECORDING_MODE='test';
assert.equal((await request(root+'/start',{...consent,consentConfirmed:false})).status,400);
assert.equal((await request(root+'/start',{...consent,ownerId:crypto.randomUUID()})).status,403);
assert.equal((await request(root+'/start',consent)).status,200);
assert.equal((await request(root+'/start',consent)).status,200,'idempotent start');
const bytes=new Uint8Array([0x1a,0x45,0xdf,0xa3,0,1,2,3]);
assert.equal((await request(root+'/parts/0',bytes,'PUT',{'Content-Type':'audio/webm','X-Recording-Owner':'other'})).status,403);
assert.equal((await request(root+'/parts/0',bytes,'PUT',{'Content-Type':'audio/webm','X-Recording-Owner':owner})).status,200);
assert.equal((await request(root+'/parts/0',bytes,'PUT',{'Content-Type':'audio/webm','X-Recording-Owner':owner})).status,200);
assert.equal((await request(root+'/parts/0',new Uint8Array([9]),'PUT',{'Content-Type':'audio/webm','X-Recording-Owner':owner})).status,409);
const encrypted=kv.get(audioKey(callId,0))!;assert.notDeepEqual(new Uint8Array(encrypted),bytes);
assert.deepEqual(new Uint8Array(await loadRecordingBytes(env,audioKey(callId,0))),bytes);
kv.set('wrong-context',encrypted);await assert.rejects(loadRecordingBytes(env,'wrong-context'),'ciphertext cannot be moved between calls/keys');
assert.equal((await request(root+'/complete',{ownerId:owner,partCount:2})).status,409);
assert.equal((await request(root+'/complete',{ownerId:owner,partCount:1})).status,200);
let calls:string[]=[];const originalFetch=globalThis.fetch;
globalThis.fetch=(async(url:any,init:any)=>{
 const path=String(url);calls.push(path);
 if(path.endsWith('audio/transcriptions'))return Response.json({text:'Customer requested a hotel quote. Dates unconfirmed.'});
 if(path.endsWith('/responses')){assert.equal(JSON.parse(init.body).store,false);return Response.json({output:[{content:[{type:'output_text',text:'相談：ホテル見積。日程は未確認。AI要約・音声で要確認。'}]}]})}
 if(path.endsWith('chat.postMessage')){const body=JSON.parse(init.body);assert.equal(body.channel,'C1234567890');return Response.json({ok:true,ts:'123.4'})}
 if(path.endsWith('files.getUploadURLExternal'))return Response.json({ok:true,file_id:'F1',upload_url:'https://files.slack.com/upload/test'});
 if(path==='https://files.slack.com/upload/test')return new Response('ok');
 if(path.endsWith('files.completeUploadExternal')){const body=JSON.parse(init.body);assert.equal(body.channel_id,'C1234567890');assert.equal(body.thread_ts,'123.4');return Response.json({ok:true})}
 throw Error('unexpected provider');
}) as any;
try {
 await processWhatsappRecordings(env);
 assert.equal(db.prepare('SELECT state FROM whatsapp_call_recordings WHERE call_id=?').get(callId)?.state,'published');
 const count=calls.length;await processWhatsappRecordings(env);assert.equal(calls.length,count,'cron replay cannot duplicate posts or AI calls');
 assert.ok(expirations.every(t=>t>Math.floor(Date.now()/1000)+29*86400 && t<=Math.floor(Date.now()/1000)+30*86400));
 assert.equal((await request(root+'/complete',{ownerId:owner,partCount:1})).status,200,'completed request retry does not republish');
 // A long recording is processed across ticks with one summary thread.
 db.prepare("UPDATE whatsapp_calls SET state='ended' WHERE id=?").run(callId);
 const longId=crypto.randomUUID(),longRoot=`/api/whatsapp/calling/calls/${longId}/recording`;
 db.prepare("INSERT INTO whatsapp_calls(id,friend_id,line_account_id,recipient,state,direction,owner_id,created_at,updated_at) VALUES (?,'f','wa','15555550100','accepted','inbound',?,?,?)").run(longId,owner,Date.now(),Date.now());
 await request(longRoot+'/start',consent);
 for(let i=0;i<3;i++)assert.equal((await request(longRoot+'/parts/'+i,bytes,'PUT',{'Content-Type':'audio/webm','X-Recording-Owner':owner})).status,200);
 await request(longRoot+'/complete',{ownerId:owner,partCount:3});
 const postsBefore=calls.filter(p=>p.endsWith('chat.postMessage')).length;
 await processWhatsappRecordings(env);assert.equal(db.prepare('SELECT state FROM whatsapp_call_recordings WHERE call_id=?').get(longId)?.state,'queued');
 await processWhatsappRecordings(env);assert.equal(db.prepare('SELECT state FROM whatsapp_call_recordings WHERE call_id=?').get(longId)?.state,'queued');
 await processWhatsappRecordings(env);assert.equal(db.prepare('SELECT state FROM whatsapp_call_recordings WHERE call_id=?').get(longId)?.state,'published');
 assert.equal(calls.filter(p=>p.endsWith('chat.postMessage')).length,postsBefore+1,'continuing file publication reuses the existing Slack thread');
 // Unknown provider results are retained, never retried automatically.
 db.prepare("UPDATE whatsapp_call_recordings SET state='queued',slack_ts=NULL WHERE call_id=?").run(callId);
 db.prepare("UPDATE whatsapp_call_recording_parts SET state='stored' WHERE call_id=?").run(callId);
 globalThis.fetch=(async()=>{throw Error('transport')}) as any;
 await processWhatsappRecordings(env);assert.equal(db.prepare('SELECT state FROM whatsapp_call_recordings WHERE call_id=?').get(callId)?.state,'attention');
 const states=db.prepare('SELECT state FROM whatsapp_call_recording_parts WHERE call_id=?').get(callId);assert.equal(states?.state,'transcribing');
 await processWhatsappRecordings(env);assert.equal(db.prepare('SELECT state FROM whatsapp_call_recordings WHERE call_id=?').get(callId)?.state,'attention');
 db.prepare('UPDATE whatsapp_call_recordings SET expires_at=? WHERE call_id=?').run(Date.now()-1,callId);
 assert.equal((await request(root+'/parts/0')).status,404,'expired audio denied even before KV eviction');
 console.log('PASS recording auth, mode/test allowlist, consent, owner, idempotency, encryption/context binding, missing parts, expiry, AI/Slack routing, one-time publication and uncertain-result circuit breaker');
}finally{globalThis.fetch=originalFetch;db.close()}
