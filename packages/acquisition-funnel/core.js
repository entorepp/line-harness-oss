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
  // Both client and server apply this projection. No arbitrary text, URLs or answer values.
  function cleanAction(input) {
    if (!input || typeof input !== 'object') return null;
    const events=['search_submit','search_change','search_results','control_click','field_focus','price_display','step_view','page_hidden','page_resume'];
    if(!events.includes(input.event))return null;
    const result={event:input.event};
    const d=input.data||{},data={};
    const enums={
      screen:['home','journey_list','journey_detail','extra_support','traveller_details','tailor_made','other'],
      button_id:['search','areas_open','areas_close','areas_clear','area_select','date_open','date_select','month_select','date_mode','date_previous','date_next','date_clear','party_select','explore_journey','gate_continue','gate_close','gate_previous','gate_next','adjust_search','tailor_no_match','next_extra_support','next_traveller_details','review_request','request_hotel_quote','price_retry','hotel_choose','room_choose','hotel_details','activity_details','quickview_close','tailor_next','tailor_back','tailor_step','contact_whatsapp','contact_email','contact_instagram','contact_messenger','nav_home','nav_journeys','nav_tailor','nav_hotels','nav_destinations','nav_guides','nav_other','menu','consent','other_control'],
      form_id:['journey_search','journey_gate'],
      field_id:['areas','travel_month','travel_date','party','contact','other'],
      date_mode:['exact','flexible','any'],party_size_bucket:['1','2','3','4','5_plus','any'],
      price_state:['from_price','priced','loading','request','date','unavailable'],
      price_basis:['per_person_from','party_total'],
      list_id:['home_featured','catalogue','search_results'],
    };
    for(const [key,values] of Object.entries(enums))if(values.includes(d[key]))data[key]=d[key];
    // Product IDs are public catalogue identities, not user/customer identifiers.
    if(/^c\d{1,3}$/i.test(d.journey_id||''))data.journey_id=d.journey_id.toLowerCase();
    if(/^(20\d{2})-(0[1-9]|1[0-2])$/.test(d.travel_month||''))data.travel_month=d.travel_month;
    const areas=new Set(['tokyo','kyoto','osaka','hakone','fuji','fuji-hakone','hiroshima','nara','kanazawa','takayama','nikko','nagoya','kobe','fukuoka','sapporo','okinawa','kamakura','yokohama','himeji','okayama','naoshima','miyajima','beppu','yufuin','nagasaki','kumamoto','kagoshima','ise','toba','wakayama','koyasan','shirakawa-go','matsumoto','nagano','karuizawa','toyama','fukui','shizuoka','atami','izu','kawaguchiko','shiga','otsu','tsuruga','gifu','sendai','aomori','aichi','ehime','gunma','hokkaido','hyogo','ibaraki','ishikawa','iwate','kagawa','kochi','miyagi','miyazaki','niigata','oita','saga','saitama','shimane','tochigi','tokushima','tottori','yamagata','yamaguchi','yamanashi']);
    if(Array.isArray(d.area_ids))data.area_ids=[...new Set(d.area_ids.filter(v=>areas.has(v)))].sort().slice(0,16);
    for(const [key,max] of Object.entries({result_count:200,item_position:200,price_jpy:100000000,render_revision:500,step_number:5}))if(Number.isInteger(d[key])&&d[key]>=0&&d[key]<=max)data[key]=d[key];
    if(data.price_jpy!==undefined&&!['from_price','priced'].includes(data.price_state))delete data.price_jpy;
    result.data=data;return result;
  }
  function siteDiagnostics(config,send) {
    let seq=0,scheduled=false,lastResults='',lastPrice='',revision=0;
    const started=Date.now(), focusSeen=new Set();
    const screen=()=>{const p=location.pathname||'';return /\/extra-support\/?$/.test(p)?'extra_support':/\/enquiry\/?$/.test(p)?'traveller_details':/\/journeys\/[^/]+/.test(p)?'journey_detail':/\/journeys\/?$/.test(p)?'journey_list':/\/tailor-made\/?$/.test(p)?'tailor_made':/^\/(en|tc|sc|kr)\/?$/.test(p)?'home':'other'};
    const journey=node=>node?.closest?.('[data-tour],[data-view-journey],[data-tour-id]')?.getAttribute('data-tour')||node?.closest?.('[data-view-journey]')?.getAttribute('data-view-journey')||String(node?.closest?.('a[href]')?.getAttribute('href')||location.pathname).match(/\/journeys\/(c\d{1,3})(?:[/?#]|$)/i)?.[1]||'';
    function record(event,data={}) {
      if(seq>=500)return;
      const action=cleanAction({event,data:{screen:screen(),...data}});if(!action)return;
      send({...action,id:crypto.randomUUID(),seq:++seq,elapsed_ms:Math.min(86400000,Math.max(0,Date.now()-started))});
    }
    function searchData(form) {
      form=form||document.querySelector('[data-journey-search],#tour-search-form');
      if(!form)return {};
      const val=name=>form.querySelector('[name="'+name+'"]')?.value||'';
      const exact=val('travelExactDate'),flex=val('travelMonth'),people=val('people');
      return {form_id:'journey_search',area_ids:Array.from(form.querySelectorAll('input[name="area"]:checked')).map(e=>e.value),date_mode:exact?'exact':flex?'flexible':'any',travel_month:(exact||flex).slice(0,7),party_size_bucket:people==='5+'?'5_plus':['1','2','3','4'].includes(people)?people:'any'};
    }
    const searchForm=el=>el?.closest?.('[data-journey-search],#tour-search-form');
    const field=el=>{if(searchForm(el))return ({area:'areas',travelMonth:'travel_month',travelExactDate:'travel_date',people:'party'})[el.name]||'other';return el?.closest?.('#mtf-inline-profile-form,[data-private-profile],[data-ftai-root]')?'contact':'other'};
    const buttons=[
      ['[data-journey-search] button[type="submit"],#tour-search-form button[type="submit"]','search'],
      ['#journey-area-trigger','areas_open'],['.mtf-area-popover-close,[data-close-journey-areas]','areas_close'],['[data-clear-journey-areas]','areas_clear'],['.mtf-area-option','area_select'],
      ['#travel-month-trigger','date_open'],['[data-travel-date],[data-gate-calendar-date]','date_select'],['[data-travel-month]','month_select'],['[data-timing-mode]','date_mode'],['#travel-period-previous','date_previous'],['#travel-period-next','date_next'],['#travel-month-clear','date_clear'],['#people,#gate-people','party_select'],
      ['[data-view-journey],[data-tour],a.fts-journey-card','explore_journey'],['#open-journey-from-gate','gate_continue'],['#close-search-gate,[data-close-search-gate]','gate_close'],['#gate-calendar-previous','gate_previous'],['#gate-calendar-next','gate_next'],['[data-adjust-search]','adjust_search'],['[data-tailor-made-no-match]','tailor_no_match'],
      ['[data-journey-action="extra-support"]','next_extra_support'],['[data-journey-action="traveller-details"]','next_traveller_details'],['[data-journey-action="review-request"]','review_request'],['[data-journey-action="hotel-quote"]','request_hotel_quote'],['[data-retry-price],#retry-price,[data-retry-stay]','price_retry'],['[data-hotel-choice]','hotel_choose'],['[data-hotel-room-choice]','room_choose'],['[data-hotel-detail]','hotel_details'],['[data-one-day-tour]','activity_details'],['[data-close-modal],#close-modal','quickview_close'],
      ['[data-private-next]','tailor_next'],['[data-private-back]','tailor_back'],['[data-private-progress-step]','tailor_step'],['[data-contact-channel="whatsapp"]','contact_whatsapp'],['[data-contact-channel="email"]','contact_email'],['[data-contact-channel="instagram"]','contact_instagram'],['[data-contact-channel="messenger"]','contact_messenger'],['[data-flat-consent-choice],[data-flat-consent-settings]','consent'],['[data-menu-toggle],.fts-menu-toggle','menu']
    ];
    document.addEventListener('click',e=>{if(!e.isTrusted)return;const target=e.target;let id=buttons.find(([selector])=>target?.closest?.(selector))?.[1];
      if(!id){const a=target?.closest?.('a[href]');if(a){try{const p=new URL(a.href,location.href).pathname;id=/\/journeys\/c\d+/i.test(p)?'explore_journey':/\/journeys\/?$/.test(p)?'nav_journeys':/\/tailor-made\/?$/.test(p)?'nav_tailor':/\/accessible-hotels/.test(p)?'nav_hotels':/\/destinations/.test(p)?'nav_destinations':/\/travel-guides/.test(p)?'nav_guides':/^\/(en|tc|sc|kr)\/?$/.test(p)?'nav_home':'nav_other'}catch{}}}
      if(!id&&target?.closest?.('button,a[href],summary,[role="button"]'))id='other_control';
      if(id)record('control_click',{button_id:id,journey_id:journey(target)});
      if(id==='gate_continue'){const month=(document.querySelector('#gate-start-date')?.value||'').slice(0,7),party=document.querySelector('#gate-people')?.value;record('search_submit',{form_id:'journey_gate',date_mode:month?'exact':'any',travel_month:month,party_size_bucket:party==='5+'?'5_plus':party,journey_id:journey(target)})}
      // Run after UI handlers, but capture navigation submissions synchronously below.
      if(searchForm(target))setTimeout(()=>{record('search_change',searchData());schedule()},0);
    },true);
    document.addEventListener('focusin',e=>{if(!e.isTrusted||!e.target?.matches?.('input:not([type=hidden]),select,textarea'))return;const id=field(e.target),key=screen()+':'+id;if(focusSeen.has(key))return;focusSeen.add(key);record('field_focus',{field_id:id})},true);
    document.addEventListener('change',e=>{if(e.isTrusted&&searchForm(e.target))record('search_change',searchData())},true);
    document.addEventListener('submit',e=>{if(e.isTrusted&&searchForm(e.target))record('search_submit',searchData(e.target))},true);
    function shown(el){return el&&!el.closest('[hidden]')&&el.getBoundingClientRect().height>0}
    function inspect(){scheduled=false;if(document.visibilityState!=='visible')return;
      const results=document.querySelector('#tour-available'),catalogue=document.querySelector('#tour-cards'),home=document.querySelector('.fts-home-journey-grid');
      const container=shown(results)?document.querySelector('#available-cards'):shown(catalogue)?catalogue:shown(home)?home:null;
      if(container){const list_id=container.id==='available-cards'?'search_results':container===home?'home_featured':'catalogue';
        const cards=Array.from(container.querySelectorAll('.mtf-available-card,.mtf-card,.fts-journey-card'));
        const products=cards.map((card,i)=>{const n=card.querySelector('[data-currency-jpy]'),amount=Number(n?.getAttribute('data-currency-jpy'));return {journey_id:journey(card.querySelector('[data-view-journey],[data-tour],a[href]')||card),item_position:i+1,price_state:amount>0?'from_price':'unavailable',price_basis:'per_person_from',...(amount>0?{price_jpy:Math.round(amount)}:{})}});
        const conditions=list_id==='search_results'?searchData():{};
        const key=JSON.stringify([list_id,conditions,products]);if(key!==lastResults){lastResults=key;revision++;record('search_results',{...conditions,list_id,result_count:cards.length,render_revision:revision});products.forEach(p=>record('price_display',{...p,list_id,render_revision:revision}))}
      }
      const price=document.querySelector('#price-value');if(shown(price)){const state=price.dataset.mode,amount=Number(price.querySelector('[data-currency-jpy]')?.getAttribute('data-currency-jpy'));
        const info={journey_id:journey(),price_state:state,price_basis:'party_total',...(state==='priced'&&amount>0?{price_jpy:Math.round(amount)}:{})};const key=JSON.stringify(info);if(key!==lastPrice){lastPrice=key;record('price_display',info)}}
    }
    function schedule(){if(!scheduled){scheduled=true;setTimeout(inspect,120)}}
    window.addEventListener('flat-travel:route-change',()=>{record('step_view',{journey_id:journey()});schedule()});
    window.addEventListener('pagehide',()=>record('page_hidden'));
    window.addEventListener('pageshow',e=>{if(e.persisted)record('page_resume');schedule()});
    document.addEventListener('visibilitychange',()=>{record(document.visibilityState==='hidden'?'page_hidden':'page_resume');schedule()});
    document.addEventListener('DOMContentLoaded',()=>{record('step_view',{journey_id:journey()});schedule()});
    const observer=new MutationObserver(schedule);observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','data-mode','data-currency-jpy']});schedule();
  }
  async function insertEvent(db,page,event,step='') {
    await db.prepare('INSERT OR IGNORE INTO acquisition_events(page_id,event,step) VALUES (?,?,?)').bind(page,event,step).run();
  }
  async function getPage(db,id,request) {
    if (!uuid(id)) return null;
    return db.prepare(`SELECT p.id,p.visit_id FROM acquisition_pages p JOIN acquisition_visits v ON v.id=p.visit_id WHERE p.id=? AND v.surface=? AND p.received_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-24 hours')`).bind(id,options.surface).first();
  }
  async function api(request,env) {
    const url=new URL(request.url), db=dbOf(env);
    if (url.pathname === prefix+'/actions' && options.surface==='site') {
      if(request.method!=='POST')return response({error:'method'},405);
      if(request.headers.get('Origin')!==options.origin)return response({error:'origin'},403);
      if(Number(request.headers.get('Content-Length')||0)>16384)return response({error:'size'},413);
      const raw=await request.text();if(raw.length>16384)return response({error:'size'},413);
      let b;try{b=JSON.parse(raw)}catch{return response({error:'json'},400)}
      if(!Array.isArray(b?.actions)||b.actions.length>20)return response({error:'actions'},400);
      const page=await getPage(db,b.pageId,request);if(!page)return response({error:'page'},404);
      if(cookie(request)!==page.visit_id)return response({error:'visit'},403);
      let accepted=0;
      for(const a of b.actions){
        const safe=cleanAction(a);
        if(!safe||!uuid(a.id)||!Number.isInteger(a.seq)||a.seq<1||a.seq>500||!Number.isInteger(a.elapsed_ms)||a.elapsed_ms<0||a.elapsed_ms>86400000)continue;
        await db.prepare('INSERT OR IGNORE INTO acquisition_actions(id,page_id,sequence,elapsed_ms,event,data_json) VALUES (?,?,?,?,?,?)').bind(a.id,page.id,a.seq,a.elapsed_ms,safe.event,JSON.stringify(safe.data)).run();accepted++;
      }
      return response({ok:true,accepted});
    }
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
    // Diagnostic values use the same bounded projection in browser and server.
    return `(()=>{const __name=(value)=>value;const cleanAction=${cleanAction.toString()};const siteDiagnostics=${siteDiagnostics.toString()};(${browserCollector.toString()})(${JSON.stringify({pageId,endpoint:prefix+'/events',submitPath:options.submitPath,surface:options.surface})});})();`;
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
    if(config.surface==='site'){
      const pending=[];let sending=false,retries=0;
      const post=actions=>nativeFetch('/__acquisition/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pageId:config.pageId,actions}),keepalive:true});
      function drain(){if(sending||!pending.length)return;sending=true;const batch=pending.splice(0,20);
        post(batch).then(r=>{if(!r.ok)throw Error();retries=0}).catch(()=>{if(retries++<2){pending.unshift(...batch);setTimeout(drain,1000)}}).finally(()=>{sending=false;if(pending.length&&retries===0)drain()})}
      siteDiagnostics(config,a=>{pending.push(a);drain()});
      const flushActions=()=>{while(pending.length)post(pending.splice(0,20)).catch(()=>{})};
      window.addEventListener('pagehide',flushActions);
      document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushActions()});
    }
    function isInquiry(el){return config.surface==='form'||Boolean(el?.closest?.('#mtf-inline-profile-form,[data-private-profile],[data-private-step],[data-ftai-root]'))}
    function step(el){const field=el?.closest?.('[data-traffic-field]');if(field)return field.getAttribute('data-traffic-field');
      if(el?.closest?.('[data-private-profile]'))return 'contact';const section=el?.closest?.('[data-private-step]');
      if(section){const s=section.getAttribute('data-private-step');return ({'0':'places','1':'experiences','2':'trip_shape','3':'support','4':'final_note',places:'places',experiences:'experiences',shape:'trip_shape',timing:'trip_shape',support:'support',note:'final_note',finish:'final_note',review:'final_note'})[s]||'other'}
      if(el?.closest?.('[data-journey-search],#tour-search-form,#mtf-search-gate-form'))return 'search';if(el?.closest?.('form'))return isInquiry(el)?'contact':'other';if(el?.closest?.('nav'))return 'navigation';return 'other'}
    function pageVisible(){if(document.visibilityState!=='visible'||visible)return;
      const main=document.querySelector('main')||document.querySelector('form');if(!main||!main.getBoundingClientRect().height)return;
      if(config.surface==='form'&&!document.querySelector('[data-traffic-field]'))return;
      requestAnimationFrame(()=>requestAnimationFrame(()=>{if(document.visibilityState==='visible'&&!visible){visible=true;emit('page_visible')}}))}
    function action(e){if(!e.isTrusted)return;const s=step(e.target);emit('interaction');
      if(['input','change','focusin'].includes(e.type)&&e.target?.matches?.('input:not([type=hidden]),select,textarea')){if(isInquiry(e.target))emit('form_start');emit('field_interaction',s)}
      if(e.type==='click'){emit('interaction',s);const a=e.target?.closest?.('a[href]');if(a){try{const u=new URL(a.href,location.href);if(/^https?:$/.test(u.protocol))emit('link_click',u.hostname==='liffform-studio.pages.dev'?'form_link':u.hostname==='flat-travel.com'&&u.origin!==location.origin?'site_link':u.origin===location.origin?'internal_link':'external_link')}catch{}}}
      if(e.type==='click'&&e.target?.closest?.('[data-private-step]')){if(isInquiry(e.target))emit('form_start');emit('field_interaction',s)}}
    ['click','input','change','focusin','keydown','touchstart'].forEach(t=>document.addEventListener(t,action,{capture:true,passive:true}));
    window.addEventListener('pagehide',()=>{while(queue.length){const batch=queue.splice(0,12);nativeFetch(config.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pageId:config.pageId,events:batch}),keepalive:true}).catch(()=>{})}});
    window.addEventListener('scroll',e=>{if(e.isTrusted)emit('interaction','scroll')},{passive:true});
    document.addEventListener('submit',e=>{if(e.isTrusted&&isInquiry(e.target))emit('submit_attempt')},true);
    document.addEventListener('invalid',e=>{if(e.isTrusted&&isInquiry(e.target)){emit('submit_attempt');emit('validation_error',step(e.target))}},true);
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
