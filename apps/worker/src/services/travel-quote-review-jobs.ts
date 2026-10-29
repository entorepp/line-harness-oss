import type {Env} from '../index.js';
import type {FlatworkerDraftSummary,TravelQuoteIntent} from './travel-quote-intent.js';

type ReviewJob={id:string;quote_reference:string;case_id:string;case_version:string;notification_id:string;attempts:number;lease_token?:string};
const MAX_ATTEMPTS=6,LEASE_MS=180_000;
const iso=(offset=0)=>new Date(Date.now()+offset).toISOString();
export const deferredReviewEnabled=(env:Env['Bindings'])=>env.TRAVEL_QUOTE_DEFER_INTERNAL_REVIEW==='true';

export async function enqueueTravelQuoteReview(env:Env['Bindings'],intent:TravelQuoteIntent,draft:FlatworkerDraftSummary,notificationId:string){
  if(!draft.updatedAt||draft.caseId!==`flat-travel-${intent.quoteReference.toLowerCase()}`)throw Error('invalid_saved_quote_receipt');
  await env.DB.prepare(`INSERT OR IGNORE INTO travel_quote_review_jobs
    (id,quote_reference,case_id,case_version,notification_id,status,attempts,next_attempt_at,created_at,updated_at)
    VALUES (?,?,?,?,?,'pending',0,?,?,?)`).bind(`${intent.quoteReference}:${draft.updatedAt}:${intent.channel}`,intent.quoteReference,draft.caseId,draft.updatedAt,notificationId,iso(),iso(),iso()).run();
}

export async function processTravelQuoteReviews(env:Env['Bindings'],limit=3){
  if(!deferredReviewEnabled(env))return {processed:0};
  const base=String(env.FLATWORKER_API_BASE_URL||'').replace(/\/+$/,''),token=env.FLATWORKER_TRAVEL_QUOTE_TOKEN;
  if(!base||!token)return {processed:0};
  const due=iso();
  const rows=await env.DB.prepare(`SELECT * FROM travel_quote_review_jobs
    WHERE ((status IN ('pending','retry') AND next_attempt_at<=?) OR (status='processing' AND lease_until<=?))
      AND (attempts<? OR status='processing') ORDER BY next_attempt_at,created_at LIMIT ?`).bind(due,due,MAX_ATTEMPTS,Math.max(1,Math.min(3,limit))).all<ReviewJob>();
  let processed=0;
  for(const row of rows.results||[]){
    if(row.attempts>=MAX_ATTEMPTS){
      const expired=await env.DB.prepare("UPDATE travel_quote_review_jobs SET status='failed',lease_until=NULL,lease_token=NULL,last_error_code='attempts_exhausted',updated_at=? WHERE id=? AND status='processing' AND lease_until<=?").bind(iso(),row.id,due).run();
      if(expired.meta.changes)await env.DB.prepare("UPDATE notifications SET status='failed' WHERE id=?").bind(row.notification_id).run();
      continue;
    }
    const lease=crypto.randomUUID(),now=iso();
    const claimed=await env.DB.prepare(`UPDATE travel_quote_review_jobs SET status='processing',attempts=attempts+1,lease_until=?,lease_token=?,updated_at=?
      WHERE id=? AND attempts<? AND ((status IN ('pending','retry') AND next_attempt_at<=?) OR (status='processing' AND lease_until<=?))`)
      .bind(iso(LEASE_MS),lease,now,row.id,MAX_ATTEMPTS,now,now).run();
    if(!claimed.meta.changes)continue;
    processed++;
    try{
      const response=await fetch(base+'/api/integrations/travel-quote-intents',{method:'POST',headers:{'Content-Type':'application/json','x-flat-travel-quote-token':token},
        body:JSON.stringify({mode:'notify_saved_quote',quoteReference:row.quote_reference,caseId:row.case_id,expectedUpdatedAt:row.case_version}),signal:AbortSignal.timeout(45_000)});
      const result=await response.json() as {status?:string;notificationPosted?:boolean};
      if(!response.ok||!['complete','skipped','superseded'].includes(result.status||''))throw Error('review_not_completed');
      const completedAt=iso();
      await env.DB.batch([
        env.DB.prepare(`UPDATE travel_quote_review_jobs SET status=?,lease_until=NULL,lease_token=NULL,last_error_code=NULL,updated_at=? WHERE id=? AND lease_token=?`).bind(result.status,completedAt,row.id,lease),
        env.DB.prepare(`UPDATE notifications SET status=? WHERE id=? AND EXISTS(SELECT 1 FROM travel_quote_review_jobs WHERE id=? AND status=? AND updated_at=?)`).bind(result.notificationPosted?'sent':'failed',row.notification_id,row.id,result.status,completedAt),
      ]);
    }catch{
      const attempt=row.attempts+1,failed=attempt>=MAX_ATTEMPTS,delay=Math.min(900_000,30_000*2**(attempt-1));
      await env.DB.prepare(`UPDATE travel_quote_review_jobs SET status=?,next_attempt_at=?,lease_until=NULL,lease_token=NULL,last_error_code='review_not_completed',updated_at=? WHERE id=? AND lease_token=?`)
        .bind(failed?'failed':'retry',iso(delay),iso(),row.id,lease).run();
      if(failed)await env.DB.prepare(`UPDATE notifications SET status='failed' WHERE id=?`).bind(row.notification_id).run();
    }
  }
  return {processed};
}
