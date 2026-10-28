import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dispatchOutboundMessage } from '../src/services/outbound-messages.js';
import { fetchMetaCustomerProfile, fetchMetaMessageDetail } from '../src/services/meta-messaging.js';
import { normalizeMetaEvent } from '../src/services/meta-webhook-utils.js';
import { persistMetaMessage } from '../src/routes/meta-webhook.js';
const sql = new DatabaseSync(':memory:');
sql.exec(readFileSync('../../packages/db/schema.sql', 'utf8'));
sql.exec(`CREATE TABLE IF NOT EXISTS meta_message_receipts(line_account_id TEXT, message_id TEXT, created_at TEXT, PRIMARY KEY(line_account_id,message_id));
INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,channel_type) VALUES('ig-test','business','Test','token','secret','instagram');
INSERT INTO friends(id,line_user_id,display_name,line_account_id,metadata) VALUES('friend','instagram:business:customer','Customer','ig-test','{"recipientId":"customer"}');
INSERT INTO chats(id,friend_id) VALUES('chat','friend');`);
let lastInbound = new Date().toISOString();
sql.prepare(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,created_at) VALUES('in','friend','incoming','text','Hello',?)`).run(lastInbound);
const db = { prepare(query: string) {
 const statement = sql.prepare(query); let args: any[] = [];
 return { bind(...values:any[]) { args=values; return this; },
 async first(){ return statement.get(...args) || null; }, async all(){return {results: statement.all(...args)};},
 async run(){const r=statement.run(...args);return {meta:{changes:Number(r.changes)}};} };
}, async batch(statements:any[]){ sql.exec('BEGIN'); try { const r=[]; for(const s of statements)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;} } };
const friend = { id:'friend',line_user_id:'instagram:business:customer',line_account_id:'ig-test',channel_id:'business',channel_type:'instagram',channel_access_token:'token',metadata:'{"recipientId":"customer"}' };
const env = {DB:db, WORKER_URL:'https://worker.test',UPLOADS:{async put(){}}} as any;
const originalFetch=globalThis.fetch;
const calls:any[]=[];
let status=200;
globalThis.fetch=async(input,init)=>{
 const url=String(input);
 if(init?.method==='POST') { calls.push(JSON.parse(String(init.body))); return Response.json(status===200?{message_id:'sent-id'}:{error:{message:'Rejected'}},{status}); }
 if(url.includes('/customer?'))return Response.json({});
 if(url.includes('/detail?'))return Response.json({id:'detail',message:'Recovered body',attachments:{data:[{image_data:{url:'https://cdn.test/photo'}}]}});
 if(url.startsWith('https://cdn.test/'))return new Response('photo',{headers:{'Content-Type':'image/jpeg'}});
 throw new Error('Unexpected network: '+url);
};
try {
 for(const messageType of ['text','image','file','video','audio']){
  const result=await dispatchOutboundMessage({env,friend,input:{messageType,content:messageType==='text'?'Hello':'https://files.test/sample',fileName:'sample.pdf'}});
  assert.equal(result.providerMessageId,'sent-id');
  const call=calls.at(-1);assert.equal(call.recipient.id,'customer');
  if(messageType==='text')assert.equal(call.message.text,'Hello');
  else assert.deepEqual(call.message.attachment,{type:messageType,payload:{url:'https://files.test/sample'}});
 }
 const count=calls.length;
 await assert.rejects(()=>dispatchOutboundMessage({env,friend,input:{messageType:'file',content:'javascript:alert(1)'}}));
 assert.equal(calls.length,count);
 status=400;await assert.rejects(()=>dispatchOutboundMessage({env,friend,input:{content:'test'}}),/Rejected/);status=200;
 assert.equal(calls.length,count+1,'No retry on failure');
 sql.prepare('UPDATE messages_log SET created_at = ?').run('2020-01-01T00:00:00Z');
 await assert.rejects(()=>dispatchOutboundMessage({env,friend,input:{messageType:'image',content:'https://files.test/image'}}),/24時間/);
 assert.equal(calls.length,count+1);
 await assert.rejects(()=>fetchMetaCustomerProfile({channelType:'instagram',customerId:'customer',accessToken:'token'}),/顧客名/);
 const detail=await fetchMetaMessageDetail({channelType:'instagram',messageId:'detail',accessToken:'token'});
 assert.equal(detail?.text,'Recovered body');assert.equal(detail?.attachments.length,1);
 const message=normalizeMetaEvent({sender:{id:'customer'},timestamp:Date.now(),message:{mid:'multi',text:'Photo caption',attachments:[{type:'image',payload:{url:'https://cdn.test/one'}},{type:'image',payload:{url:'https://cdn.test/two'}}]}}, {})!;
 const account={id:'ig-test',channel_id:'business',channel_access_token:'token',channel_secret:'secret',channel_type:'instagram',default_slack_channel:null} as const;
 await persistMetaMessage(env,account,message);
 const rows=sql.prepare("SELECT message_type,content FROM messages_log WHERE id != 'in'").all();
 assert.equal(rows.length,3);assert.equal(rows.filter(r=>r.message_type==='image').length,2);assert.ok(rows.some(r=>r.content==='Photo caption'));
 await persistMetaMessage(env,account,message);assert.equal(sql.prepare('SELECT count(*) n FROM messages_log').get()!.n,4);
 console.log('PASS: Meta media/text dispatch, provider errors, unsafe URLs, reply window, missing profiles, exact-message recovery, caption + multiple media and webhook deduplication');
}finally{globalThis.fetch=originalFetch;sql.close();}
