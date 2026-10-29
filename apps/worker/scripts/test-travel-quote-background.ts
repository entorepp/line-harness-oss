import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {Hono} from 'hono';
import {travelQuoteIntents} from '../src/routes/travel-quote-intents.js';
import {processTravelQuoteReviews} from '../src/services/travel-quote-review-jobs.js';
import {payload} from './travel-quote-background-fixture.js';

const sqlite=new DatabaseSync(':memory:');
sqlite.exec(readFileSync('../../packages/db/schema.sql','utf8'));
sqlite.exec(readFileSync('../../packages/db/migrations/033_travel_quote_review_jobs.sql','utf8'));
let failQueue=false;
const db={
 prepare(sql:string){let values:any[]=[];return {bind(...v:any[]){values=v;return this;},
   async first(){return sqlite.prepare(sql).get(...values)||null;},
   async all(){return {results:sqlite.prepare(sql).all(...values),success:true};},
   async run(){if(failQueue&&sql.includes('INSERT OR IGNORE INTO travel_quote_review_jobs'))throw Error('synthetic durable storage failure');const r=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(r.changes)}};}};},
 async batch(statements:any[]){sqlite.exec('BEGIN');try{const result=[];for(const statement of statements)result.push(await statement.run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}},
};
const env={DB:db,TRAVEL_QUOTE_DEFER_INTERNAL_REVIEW:'true',FLATWORKER_API_BASE_URL:'https://backend.example',FLATWORKER_TRAVEL_QUOTE_TOKEN:'fixture-only'} as any;
const app=new Hono();app.route('/',travelQuoteIntents);
let reviewCalls=0,reviewResult='complete',release:(()=>void)|undefined;
globalThis.fetch=async(input:any,init?:RequestInit)=>{
 assert.equal(String(input),'https://backend.example/api/integrations/travel-quote-intents');
 const body=JSON.parse(String(init?.body));
 if(body.mode==='notify_saved_quote'){
   reviewCalls++;assert.deepEqual(Object.keys(body).sort(),['caseId','expectedUpdatedAt','mode','quoteReference']);
   if(release===undefined&&reviewCalls===1)await new Promise<void>(resolve=>{release=resolve;});
   return Response.json({status:reviewResult,notificationPosted:reviewResult==='complete'}, {status:reviewResult==='retry'?503:200});
 }
 assert.equal((init?.headers as Record<string,string>)['x-flat-travel-defer-internal-review'],'true');
 return Response.json({status:'created',caseId:'flat-travel-'+body.quoteReference.toLowerCase(),profileStored:true,updatedAt:'2026-10-30T00:00:00Z',internalNotificationPending:true});
};
let requests=0;
async function submit(reference:string){return app.fetch(new Request('https://gateway.example/api/travel/quote-intents',{method:'POST',headers:{Origin:'https://flat-travel-design-preview.flat-travel.workers.dev','Content-Type':'application/json','cf-connecting-ip':'fixture-'+(++requests)},body:JSON.stringify({...payload,quoteReference:reference})}),env);}
const reference='FT-20261030-ACKTEST1';
const receipt=await submit(reference);assert.equal(receipt.status,202);assert.equal((await receipt.json() as any).internalReviewQueued,true);
assert.equal(reviewCalls,0,'The customer receipt never waits for PDF or Slack');
await submit(reference);assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM travel_quote_review_jobs').get()!.count,1);
const queued=JSON.stringify(sqlite.prepare('SELECT * FROM travel_quote_review_jobs').all());
assert.doesNotMatch(queued,/Alex|Traveller|Permobil|Transfer board|[A-Za-z0-9._%+-]+@|supplierCostJpy/,'The background ledger contains no customer/quote payload');

const first=processTravelQuoteReviews(env);
for(let i=0;i<30&&!release;i++)await new Promise(resolve=>setTimeout(resolve,0));
assert(release);assert.equal((await processTravelQuoteReviews(env)).processed,0,'Concurrent Cron cannot claim an active lease');
release();await first;assert.equal(reviewCalls,1);
assert.equal(sqlite.prepare('SELECT status FROM travel_quote_review_jobs').get()!.status,'complete');
assert.equal((await processTravelQuoteReviews(env)).processed,0,'Completed delivery is not repeated');

const retryRef='FT-20261030-ACKTEST2';await submit(retryRef);reviewResult='retry';
for(let attempt=0;attempt<6;attempt++){
 await processTravelQuoteReviews(env);
 if(attempt<5){assert.equal(sqlite.prepare('SELECT status FROM travel_quote_review_jobs WHERE quote_reference=?').get(retryRef)!.status,'retry');assert.equal((await processTravelQuoteReviews(env)).processed,0,'Backoff does not spin');sqlite.prepare("UPDATE travel_quote_review_jobs SET next_attempt_at='2000-01-01T00:00:00Z' WHERE quote_reference=?").run(retryRef);}
}
assert.equal(sqlite.prepare('SELECT status FROM travel_quote_review_jobs WHERE quote_reference=?').get(retryRef)!.status,'failed');
const before=reviewCalls;await processTravelQuoteReviews(env);assert.equal(reviewCalls,before,'Failures have a finite retry budget');
sqlite.prepare("UPDATE travel_quote_review_jobs SET status='processing',lease_until='2000-01-01T00:00:00Z' WHERE quote_reference=?").run(retryRef);
await processTravelQuoteReviews(env);assert.equal(sqlite.prepare('SELECT status FROM travel_quote_review_jobs WHERE quote_reference=?').get(retryRef)!.status,'failed','A crash on the final attempt becomes terminal after lease expiry');

failQueue=true;const failed=await submit('FT-20261030-ACKTEST3');assert.equal(failed.status,500,'No success acknowledgement before durable queue storage');failQueue=false;
assert.equal((await submit('FT-20261030-ACKTEST3')).status,200,'Same-reference retry recovers a failed queue save');
reviewResult='superseded';await processTravelQuoteReviews(env);
assert.equal(sqlite.prepare("SELECT status FROM travel_quote_review_jobs WHERE quote_reference='FT-20261030-ACKTEST3'").get()!.status,'superseded');
const disabledCalls=reviewCalls;await processTravelQuoteReviews({...env,TRAVEL_QUOTE_DEFER_INTERNAL_REVIEW:'false'});assert.equal(reviewCalls,disabledCalls);
console.log('PASS: durable fast receipt, no PDF/Slack wait, duplicate safety, raw-SQL leases, bounded retry/backoff, crash recovery, storage-failure rejection, superseded versions and PII-free jobs');
