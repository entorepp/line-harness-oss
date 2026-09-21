// Shared source. Generated copies in both runtimes must be byte-identical.
export function createAcquisitionFunnel(options) {
  const prefix = '/__acquisition';
  const uuid = value => /^[a-f0-9-]{36}$/i.test(value || '');
  const token = value => /^[a-z0-9][a-z0-9_.-]{0,95}$/i.test(value || '') && !/\d{7}/.test(value) ? value.toLowerCase() : '';
  const sourceOf = value => {
    const s = token(value);
    return ['accessiblejapan','accessible_japan','accessible-japan','accessible-japan.com','www.accessible-japan.com'].includes(s) ? 'accessible_japan' : s;
  };
  const response = (body, status=200) => Response.json(body, {status, headers:{'Cache-Control':'private, no-store','X-Robots-Tag':'noindex','Referrer-Policy':'no-referrer'}});
  const dbOf = env => env.ACQUISITION_DB || env.FORM_TRAFFIC_DB;
  const cookie = request => (request.headers.get('Cookie') || '').split(';').map(s=>s.trim()).find(s=>s.startsWith('af_visit='))?.slice(9) || '';
  const enabled = (request, env) => env.FUNNEL_V1_ENABLED === 'true' && new URL(request.url).origin === options.origin;
  const safePath = pathname => options.surface === 'form' ? '/public-form' : /^\/(en|tc|kr|sc)(\/[a-z0-9_-]+){0,5}\/?$/i.test(pathname) && !/\d{7}|@|case|receipt|share|partner/i.test(pathname) ? pathname.slice(0,180) : '/other';
  const allowedEvents = new Set(['page_visible','interaction','form_start','field_interaction','submit_attempt','validation_error','submit_error','link_click']);
  const allowedSteps = new Set(['first_name','last_name','email','hotel_interest','hotel_match_preference','hotel_grade','travellers','room_count','bed_type','dates_decided','city_schedule','preferred_cities','approximate_timing','approximate_duration','notes','places','experiences','trip_shape','support','final_note','contact','journey','search','navigation','other','scroll','click','keyboard','touch','form_link','site_link','external_link','internal_link']);
  async function insertEvent(db,page,event,step='') {
    await db.prepare('INSERT OR IGNORE INTO acquisition_events(page_id,event,step) VALUES (?,?,?)').bind(page,event,step).run();
  }
  async function getPage(db,id,request) {
    if (!uuid(id)) return null;
    return db.prepare(`SELECT p.id,p.visit_id FROM acquisition_pages p JOIN acquisition_visits v ON v.id=p.visit_id WHERE p.id=? AND v.surface=? AND p.received_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 hours')`).bind(id,options.surface).first();
  }
  async function api(request,env) {
    const url=new URL(request.url), db=dbOf(env);
    if (url.pathname === prefix+'/events') {
      if(request.method!=='POST')return response({error:'method'},405);
      if(request.headers.get('Origin')!==options.origin)return response({error:'origin'},403);
      if(Number(request.headers.get('Content-Length')||0)>4096)return response({error:'size'},413);
      const raw=await request.text(); if(raw.length>4096)return response({error:'size'},413);
      let b;try{b=JSON.parse(raw)}catch{return response({error:'json'},400)}
      if(!Array.isArray(b.events)||b.events.length>12)return response({error:'events'},400);
      const page=await getPage(db,b.pageId,request);if(!page)return response({error:'page'},404);
      const events=b.events.filter(e=>e&&allowedEvents.has(e.event)).map(e=>({event:e.event,step:allowedSteps.has(e.step)?e.step:'',id:e.id}));
      for(const e of events){
        if(e.event==='link_click') {if(uuid(e.id)&&['form_link','site_link','internal_link','external_link'].includes(e.step))await db.prepare('INSERT OR IGNORE INTO acquisition_clicks(id,page_id,destination) VALUES (?,?,?)').bind(e.id,page.id,e.step).run();}
        else await insertEvent(db,page.id,e.event,e.step);
      }
      return response({ok:true,accepted:events.length});
    }
    if(url.pathname===prefix+'/report') {
      if(request.method!=='GET')return response({error:'method'},405);
      if(!options.authorize || !await options.authorize(request,env))return response({error:'unauthorized'},401);
      const end=new Date(url.searchParams.get('end')||Date.now());
      const start=new Date(url.searchParams.get('start')||end.getTime()-86400000);
      if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start||end-start>31*86400000)return response({error:'range'},400);
      const source=sourceOf(url.searchParams.get('source')||'');
      const base=`WITH cohort AS (SELECT * FROM acquisition_visits WHERE is_test=0 AND created_at>=? AND created_at<? AND (?='' OR source=?))`;
      const bindings=[start.toISOString(),end.toISOString(),source,source];
      const summary=await db.prepare(`${base}, stages AS (SELECT v.id,v.surface,v.source,
       (SELECT count(*) FROM acquisition_pages p WHERE p.visit_id=v.id AND p.kind='tracked_link') tracked_requests,
       (SELECT count(*) FROM acquisition_pages p WHERE p.visit_id=v.id AND p.kind='document') document_requests,
       (SELECT count(*) FROM acquisition_pages p WHERE p.visit_id=v.id AND p.kind='document' AND p.tagged=1) tagged_requests,
       EXISTS(SELECT 1 FROM acquisition_pages p JOIN acquisition_events e ON e.page_id=p.id WHERE p.visit_id=v.id AND e.event='page_visible') visible,
       EXISTS(SELECT 1 FROM acquisition_pages p JOIN acquisition_events e ON e.page_id=p.id WHERE p.visit_id=v.id AND e.event='interaction') interacted,
       EXISTS(SELECT 1 FROM acquisition_pages p JOIN acquisition_events e ON e.page_id=p.id WHERE p.visit_id=v.id AND e.event='form_start') form_started,
       EXISTS(SELECT 1 FROM acquisition_pages p JOIN acquisition_events e ON e.page_id=p.id WHERE p.visit_id=v.id AND e.event='submit_attempt') attempted,
       EXISTS(SELECT 1 FROM acquisition_pages p JOIN acquisition_events e ON e.page_id=p.id WHERE p.visit_id=v.id AND e.event='submit_success') submitted
       FROM cohort v) SELECT surface,source,count(*) visits,sum(tracked_requests) tracked_link_requests,sum(document_requests) document_requests,sum(tagged_requests) utm_request_receipts,sum(visible) visible_visits,sum(interacted) interacted_visits,sum(form_started) form_started_visits,sum(attempted) submit_attempt_visits,sum(submitted) submitted_visits FROM stages GROUP BY surface,source`).bind(...bindings).all();
      const paths=await db.prepare(`${base} SELECT v.surface,p.path,count(*) document_requests,
       sum(EXISTS(SELECT 1 FROM acquisition_events e WHERE e.page_id=p.id AND e.event='page_visible')) visible_pages,
       sum(EXISTS(SELECT 1 FROM acquisition_events e WHERE e.page_id=p.id AND e.event='interaction')) interacted_pages
       FROM cohort v JOIN acquisition_pages p ON p.visit_id=v.id WHERE p.kind='document' GROUP BY v.surface,p.path ORDER BY document_requests DESC LIMIT 100`).bind(...bindings).all();
      const steps=await db.prepare(`${base} SELECT v.surface,e.event,e.step,count(DISTINCT v.id) visits FROM cohort v JOIN acquisition_pages p ON p.visit_id=v.id JOIN acquisition_events e ON e.page_id=p.id GROUP BY v.surface,e.event,e.step ORDER BY visits DESC LIMIT 100`).bind(...bindings).all();
      const links=await db.prepare(`${base} SELECT v.surface,p.path,c.destination,count(*) clicks,count(DISTINCT v.id) visits FROM cohort v JOIN acquisition_pages p ON p.visit_id=v.id JOIN acquisition_clicks c ON c.page_id=p.id GROUP BY v.surface,p.path,c.destination`).bind(...bindings).all();
      return response({links:links.results,schemaVersion:'acquisition-v1',start:start.toISOString(),end:end.toISOString(),source,cohort:'visits first received within range; subsequent stages observed up to query time',summary:summary.results,paths:paths.results,steps:steps.results});
    }
    return response({error:'not_found'},404);
  }
  async function receive(request,env,kind='document') {
    const db=dbOf(env),url=new URL(request.url),explicitTest=url.searchParams.get('af_test')==='1'||url.searchParams.get('aj_test')==='1';
    const incomingSource=sourceOf(url.searchParams.get('utm_source')||'');
    let id=cookie(request), visit=uuid(id) ? await db.prepare("SELECT * FROM acquisition_visits WHERE id=? AND surface=? AND last_seen_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 minutes')").bind(id,options.surface).first() : null;
    const test=explicitTest||Boolean(visit?.is_test);
    if(!visit || (explicitTest&&!visit.is_test) || (incomingSource && (incomingSource!==visit.source||token(url.searchParams.get('utm_campaign'))!==visit.campaign))) {
      id=crypto.randomUUID();
      await db.prepare('INSERT INTO acquisition_visits(id,surface,source,medium,campaign,content,is_test) VALUES (?,?,?,?,?,?,?)').bind(id,options.surface,incomingSource||'unattributed',token(url.searchParams.get('utm_medium')),token(url.searchParams.get('utm_campaign')),token(url.searchParams.get('utm_content')),Number(test)).run();
    } else await db.prepare("UPDATE acquisition_visits SET last_seen_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(id).run();
    const page=crypto.randomUUID();
    await db.prepare('INSERT INTO acquisition_pages(id,visit_id,path,kind,tagged) VALUES (?,?,?,?,?)').bind(page,id,safePath(url.pathname),kind,Number(Boolean(incomingSource))).run();
    return {id,page};
  }
  function client(pageId) {
    // Values are never read: only fixed field/step keys and event types.
    return `(()=>{const __name=(value)=>value;(${browserCollector.toString()})(${JSON.stringify({pageId,endpoint:prefix+'/events',submitPath:options.submitPath,surface:options.surface})});})();`;
  }
  async function run(request,env,context,next) {
    if(!enabled(request,env)) return next(request);
    const url=new URL(request.url),db=dbOf(env);
    if(url.pathname.startsWith(prefix+'/'))return api(request,env);
    if(url.pathname===options.linkPath && request.method==='GET') {
      const target=new URL(options.destination,options.origin);
      for(const key of ['utm_source','utm_medium','utm_campaign','utm_content'])if(url.searchParams.has(key))target.searchParams.set(key,url.searchParams.get(key));
      if(!target.searchParams.has('utm_source'))target.searchParams.set('utm_source','accessible_japan');
      if(url.searchParams.get('af_test')==='1')target.searchParams.set('af_test','1');
      const tracked=new Request(new URL(url.pathname+'?'+target.searchParams,url.origin),request);
      const ids=await receive(tracked,env,'tracked_link');
      return new Response(null,{status:302,headers:{Location:target.href,'Cache-Control':'private, no-store','Set-Cookie':`af_visit=${ids.id}; Max-Age=1800; Path=/; HttpOnly; Secure; SameSite=Lax`,'X-Robots-Tag':'noindex'}});
    }
    if(url.pathname===options.submitPath && request.method==='POST') {
      const res=await next(request);let body;try{body=await res.clone().json()}catch{}
      const id=request.headers.get('X-Acquisition-Page');
      if(id && request.headers.get('Origin')===options.origin) {
        try {const page=await getPage(db,id,request);if(page)await insertEvent(db,page.id,res.ok&&options.saved(body)?'submit_success':'submit_error');}catch{console.error('acquisition_submit_write_failed')}
      }
      return res;
    }
    if(request.method!=='GET'||!options.document(url)||/prefetch/i.test((request.headers.get('Purpose')||'')+(request.headers.get('Sec-Purpose')||'')))return next(request);
    // Receive before rendering: record even when the page fails. Never cache a page ID.
    let ids;try{ids=await receive(request,env)}catch{console.error('acquisition_receive_write_failed')}
    let res;try{res=await next(request)}catch(error){if(ids)await db.prepare('UPDATE acquisition_pages SET response_status=500 WHERE id=?').bind(ids.page).run();throw error}
    if(!ids)return res;
    try{await db.prepare('UPDATE acquisition_pages SET response_status=? WHERE id=?').bind(res.status,ids.page).run()}catch{console.error('acquisition_status_write_failed')}
    const headers=new Headers(res.headers);
    headers.append('Set-Cookie',`af_visit=${ids.id}; Max-Age=1800; Path=/; HttpOnly; Secure; SameSite=Lax`);
    headers.set('Cache-Control','private, no-store');headers.set('X-Acquisition-Recorded','v1');
    if(res.status!==200||!(headers.get('Content-Type')||'').includes('text/html'))return new Response(res.body,{status:res.status,headers});
    let html=await res.text();
    for(const name of ['Content-Length','Content-Encoding','ETag'])headers.delete(name);
    const script='<script data-acquisition-v1>'+client(ids.page)+'</script>';
    html=html.includes('</head>')?html.replace('</head>',script+'</head>'):html+script;
    return new Response(html,{status:res.status,headers});
  }
  function browserCollector(config) {
    if(window.__acquisitionV1)return;window.__acquisitionV1=true;
    const nativeFetch=window.fetch.bind(window),seen=new Set(),queue=[];
    let flushing=false,visible=false,tries=0;
    function emit(event,step=''){if(event==='link_click'){queue.push({event,step,id:crypto.randomUUID()});flush();return}const key=event+':'+step;if(seen.has(key))return;seen.add(key);queue.push({event,step});flush()}
    function flush(){if(flushing||!queue.length)return;flushing=true;const batch=queue.splice(0,12);
      nativeFetch(config.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pageId:config.pageId,events:batch}),keepalive:true}).then(r=>{if(!r.ok)throw Error();tries=0}).catch(()=>{if(tries++<2){queue.unshift(...batch);setTimeout(flush,1000)}}).finally(()=>{flushing=false;if(queue.length&&tries===0)flush()})}
    function step(el){const field=el?.closest?.('[data-traffic-field]');if(field)return field.getAttribute('data-traffic-field');
      if(el?.closest?.('[data-private-profile]'))return 'contact';const section=el?.closest?.('[data-private-step]');
      if(section){const s=section.getAttribute('data-private-step');return ({'0':'places','1':'experiences','2':'trip_shape','3':'support','4':'final_note',places:'places',experiences:'experiences',shape:'trip_shape',timing:'trip_shape',support:'support',note:'final_note',finish:'final_note',review:'final_note'})[s]||'other'}
      if(el?.closest?.('form'))return 'contact';if(el?.closest?.('nav'))return 'navigation';return 'other'}
    function pageVisible(){if(document.visibilityState!=='visible'||visible)return;
      const main=document.querySelector('main')||document.querySelector('form');if(!main||!main.getBoundingClientRect().height)return;
      if(config.surface==='form'&&!document.querySelector('[data-traffic-field]'))return;
      requestAnimationFrame(()=>requestAnimationFrame(()=>{if(document.visibilityState==='visible'&&!visible){visible=true;emit('page_visible')}}))}
    function action(e){if(!e.isTrusted)return;const s=step(e.target);emit('interaction');
      if(['input','change','focusin'].includes(e.type)&&e.target?.matches?.('input:not([type=hidden]),select,textarea')){emit('form_start');emit('field_interaction',s)}
      if(e.type==='click'){emit('interaction',s);const a=e.target?.closest?.('a[href]');if(a){try{const u=new URL(a.href,location.href);if(/^https?:$/.test(u.protocol))emit('link_click',u.hostname==='liffform-studio.pages.dev'?'form_link':u.hostname==='flat-travel.com'&&u.origin!==location.origin?'site_link':u.origin===location.origin?'internal_link':'external_link')}catch{}}}
      if(e.type==='click'&&e.target?.closest?.('[data-private-step]')){emit('form_start');emit('field_interaction',s)}}
    ['click','input','change','focusin','keydown','touchstart'].forEach(t=>document.addEventListener(t,action,{capture:true,passive:true}));
    window.addEventListener('scroll',e=>{if(e.isTrusted)emit('interaction','scroll')},{passive:true});
    document.addEventListener('submit',e=>{if(e.isTrusted)emit('submit_attempt')},true);
    document.addEventListener('invalid',e=>{if(e.isTrusted){emit('submit_attempt');emit('validation_error',step(e.target))}},true);
    document.addEventListener('visibilitychange',pageVisible);
    window.addEventListener('pageshow',pageVisible);document.addEventListener('DOMContentLoaded',pageVisible);
    const observer=new MutationObserver(pageVisible);observer.observe(document.documentElement,{childList:true,subtree:true});
    setTimeout(()=>observer.disconnect(),60000);pageVisible();
    // Correlation only for the existing first-party submit endpoint. No body inspection.
    window.fetch=function(input,init){let u;try{u=new URL(typeof input==='string'?input:input.url,location.href)}catch{return nativeFetch(input,init)}
      const method=(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
      if(u.origin===location.origin&&u.pathname===config.submitPath&&method==='POST'){
        emit('submit_attempt');const headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined));headers.set('X-Acquisition-Page',config.pageId);
        return nativeFetch(input,{...init,headers}).catch(e=>{emit('submit_error');throw e});}
      return nativeFetch(input,init);};
  }
  return {run,client,api};
}
