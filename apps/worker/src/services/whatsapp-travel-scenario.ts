/** Choice-first travel planning. No model-authored products, prices or links. */
import type { IntakeState, Locale, CatalogueItem, Candidate, Plan } from './whatsapp-intake.js';
export type TravelScenario = { version: 2; flow: string; answers: Record<string, string>; tripRevision: number; visionShownFor: number | null; free?: string };
export type TravelPrompt = { key: string; text: string; choices: string[]; values: string[] };
export type TravelReply = { text: string; verifyUrls?: string[]; prompt?: TravelPrompt; vision?: number; flow?: string; revision?: number; plan: Plan };
const L = (locale: Locale, en: string, tc: string, sc: string, kr: string) => ({ en, tc, sc, kr })[locale];
const terminal = (s: IntakeState) => ['human', 'stopped', 'outside_scope'].includes(s.phase);
export function enableTravelScenario(s: IntakeState): IntakeState {
  const next = structuredClone(s);
  if (!next.travel && !terminal(next)) next.travel = { version: 2, flow: crypto.randomUUID(), answers: {}, tripRevision: 0, visionShownFor: null };
  return reconcileTravelScenario(next);
}
export function reconcileTravelScenario(s: IntakeState): IntakeState {
  if (!s.travel || terminal(s)) return s;
  s.phase = travelCoreComplete(s) ? (s.travel.visionShownFor === s.travel.tripRevision && progress(s) ? 'recommended' : 'review') : 'collecting';
  return s;
}
function known(s: IntakeState, key: string): boolean {
  const a = s.travel!.answers;
  if (a[key] !== undefined) return true;
  if (key === 'wish') return !!s.slots.cities?.length; // A detailed first enquiry need not repeat its purpose.
  return Object.hasOwn(s.slots, key);
}
export function travelCoreComplete(s: IntakeState) { return !!s.travel && ['wish','cities','timing','duration','party','budget','support'].every(k => known(s, k)); }
function progress(s: IntakeState): string | undefined { return s.travel?.answers.progress || (s.slots.preference === 'hotel' ? 'hotel' : s.slots.preference === 'package' ? 'whole' : undefined); }
function prompt(s: IntakeState, key: string, text: string, entries: [string, string][]): TravelPrompt {
  return { key, text, values: entries.map(x => x[0]), choices: entries.map(x => x[1]) };
}
const cities = ['Tokyo','Kyoto','Osaka','Fuji / Hakone','Hiroshima','Kanazawa'];
const citySlug: Record<string,string> = { Tokyo:'tokyo', Kyoto:'kyoto', Osaka:'osaka', 'Fuji / Hakone':'fuji-hakone', Hiroshima:'hiroshima', Kanazawa:'kanazawa' };
export function nextTravelPrompt(s: IntakeState): TravelPrompt | undefined {
  if (!s.travel || terminal(s)) return;
  const l = s.locale, a = s.travel.answers;
  const unknown = L(l,'Not decided','尚未決定','尚未决定','미정');
  const other = L(l,'Other / type answer','其他／輸入回答','其他／输入回答','기타 / 직접 입력');
  const p = (key: string, text: string, values: [string,string][]) => prompt(s,key,text,values);
  if (s.travel.free) return p(s.travel.free, L(l,'Please type your answer, or choose “Not decided”.','請輸入您的回答，或選擇「尚未決定」。','请输入您的回答，或选择“尚未决定”。','답변을 입력하거나 미정을 선택해 주세요.'), [['unknown',unknown]]);
  if (!known(s,'wish')) return p('wish',L(l,'What would you most like to enjoy in Japan?','您最想在日本體驗甚麼？','您最想在日本体验什么？','일본에서 가장 즐기고 싶은 것은 무엇인가요?'),[
    ['culture',L(l,'Culture & city walks','文化與城市漫步','文化与城市漫步','문화와 도시 산책')],['food',L(l,'Food','美食','美食','음식')],['nature',L(l,'Nature & scenery','自然與風景','自然与风景','자연과 풍경')],['themeparks',L(l,'Theme parks','主題樂園','主题乐园','테마파크')],['relax',L(l,'A relaxed stay','悠閒度假','悠闲度假','여유로운 여행')],['unknown',L(l,'Suggest ideas','請推薦','请推荐','추천해 주세요')],['other',other]]);
  if (!known(s,'cities')) return p('cities',L(l,'Where would you like to go?','您想去哪裡？','您想去哪里？','어디에 가고 싶으신가요?'),[['Tokyo','Tokyo'],['Tokyo|Kyoto','Tokyo & Kyoto'],['Tokyo|Kyoto|Osaka','Tokyo, Kyoto & Osaka'],['other',other],['unknown',unknown]]);
  if (a.wish && !travelCoreComplete(s) && !a.experience) return p('experience',L(l,'Is this your first visit to Japan?','這是您第一次到日本嗎？','这是您第一次到日本吗？','일본 방문은 처음인가요?'),[['first',L(l,'Yes','是','是','네')],['repeat',L(l,'No','不是','不是','아니요')],['unknown',unknown]]);
  if (a.wish && !travelCoreComplete(s) && !a.planning) return p('planning',L(l,'How much planning help would you like this time?','這次希望我們協助多少規劃？','这次希望我们协助多少规划？','이번에는 어느 정도의 여행 계획 도움이 필요하신가요?'),[['independent',L(l,'I can plan most of it','大部分自行規劃','大部分自行规划','대부분 직접 계획')],['some',L(l,'Help with some parts','協助部分安排','协助部分安排','일부 도움 필요')],['delegate',L(l,'Plan it together','一起規劃整趟旅程','一起规划整趟旅行','전체 함께 계획')]]);
  if (!known(s,'timing')) return p('timing',L(l,'When are you thinking of travelling?','您打算何時出發？','您打算何时出发？','언제 여행을 생각하고 계신가요?'),[['within3',L(l,'Within 3 months','3個月內','3个月内','3개월 이내')],['3to6',L(l,'In 3–6 months','3至6個月後','3至6个月后','3~6개월 후')],['6to12',L(l,'In 6–12 months','6至12個月後','6至12个月后','6~12개월 후')],['later',L(l,'More than a year away','1年以後','1年以后','1년 이후')],['unknown',unknown],['other',other]]);
  if (!known(s,'duration')) return p('duration',L(l,'About how many days?','大約多少天？','大约多少天？','약 며칠 동안 여행하시나요?'),[['1-6',L(l,'Up to 6 days','6天以內','6天以内','6일 이내')],['7-9','7–9'],['10-14','10–14'],['15-21','15–21'],['22-180','22+'],['unknown',unknown],['other',other]]);
  if (!known(s,'party')) return p('party',L(l,'How many people will travel?','有多少人同行？','有多少人同行？','몇 명이 함께 여행하시나요?'),[['1','1'],['2','2'],['3','3'],['4','4'],['5+','5+'],['unknown',unknown],['other',other]]);
  if (!known(s,'budget')) return p('budget',L(l,'Approximate budget in JPY for everyone: accommodation, transport and activities in Japan, excluding international flights? These are budget bands, not quoted prices.','全體旅客的日本住宿、交通和活動預算大約是多少日圓？不含國際機票；以下是預算區間，並非報價。','全体旅客的日本住宿、交通和活动预算大约是多少日元？不含国际机票；以下是预算区间，并非报价。','국제 항공편을 제외한 전원 숙박·일본 내 교통·활동 예산은 얼마인가요? 일본 엔 기준이며 견적이 아닌 예산 구간입니다.'),[['under300k','< JPY 300,000'],['300to600k','JPY 300,000–600,000'],['600to1000k','JPY 600,000–1,000,000'],['over1000k','> JPY 1,000,000'],['unknown',L(l,'Show me an example','先看看行程範例','先看看行程范例','예시를 먼저 볼게요')],['other',L(l,'Other currency / amount','其他幣別／金額','其他币种／金额','다른 통화 / 금액')]]);
  if (!known(s,'support')) return p('support',L(l,'Which support should we consider first? You can type additional needs too.','我們先確認哪項支援？其他需求也可以直接輸入。','我们先确认哪项支持？其他需求也可以直接输入。','어떤 지원부터 확인할까요? 추가 요구도 입력하실 수 있습니다.'),[['none',L(l,'No specific support','無特別需求','无特别需求','특별한 지원 없음')],['step_free',L(l,'Step-free access','無階梯通行','无台阶通行','계단 없는 이동')],['manual_wheelchair',L(l,'Manual wheelchair','手動輪椅','手动轮椅','수동 휠체어')],['power_wheelchair',L(l,'Power wheelchair','電動輪椅','电动轮椅','전동 휠체어')],['accessible_bathroom',L(l,'Bathroom / room needs','浴室／客房設備','浴室／客房设备','욕실 / 객실 시설')],['airport_transfer',L(l,'Transfers','接送','接送','차량 이동')],['personal_care',L(l,'Personal assistance','個人照護協助','个人照护协助','개인 돌봄 지원')],['unknown',unknown],['other',other]]);
  if (s.travel.visionShownFor !== s.travel.tripRevision || !a.progress) return p('progress',L(l,'Where would you like to start?','您想從哪裡開始安排？','您想从哪里开始安排？','어디부터 정하고 싶으신가요?'),[['hotel',L(l,'Hotels first','先決定住宿','先决定住宿','숙소부터')],['whole',L(l,'See the whole trip','看看整趟行程','看看整趟行程','전체 여행 보기')],['recommend',L(l,'Recommend a next step','請推薦下一步','请推荐下一步','다음 단계 추천')]]);
  const route = progress(s);
  if (route === 'hotel') {
    if (!a.hotelCity && s.slots.cities?.length !== 1) return p('hotelCity',L(l,'Which city shall we start with?','先選哪個城市的住宿？','先选哪个城市的住宿？','어느 도시 숙소부터 볼까요?'),cities.map(c=>[c,c]));
    if (!a.hotelDates) return p('hotelDates',L(l,'Are your check-in and check-out dates fixed?','入住和退房日期確定了嗎？','入住和退房日期确定了吗？','체크인·체크아웃 날짜가 정해졌나요?'),[['other',L(l,'Yes — enter dates','是，輸入日期','是，输入日期','네, 날짜 입력')],['unknown',L(l,'Not yet — browse first','尚未，先看看飯店','尚未，先看看酒店','아직요, 먼저 둘러보기')]]);
    if (!a.hotelRooms) return p('hotelRooms',L(l,'How many rooms?','需要幾間客房？','需要几间客房？','객실은 몇 개 필요한가요?'),[['1','1'],['2','2'],['unknown',unknown]]);
    if (!a.hotelFeature) return p('hotelFeature',L(l,'Which room feature matters most? Additional requirements can be typed.','哪項客房設備最重要？其他需求可以直接輸入。','哪项客房设备最重要？其他需求可以直接输入。','가장 중요한 객실 시설은 무엇인가요? 추가 요구는 입력해 주세요.'),[['any',L(l,'No preference','沒有偏好','没有偏好','선호 없음')],['showerBoothOnly',L(l,'Shower booth only','獨立淋浴間，無浴缸','独立淋浴间，无浴缸','욕조 없는 샤워 부스')],['separateShowerAndBathtub',L(l,'Separate shower & bath','淋浴間與浴缸分開','淋浴间与浴缸分开','샤워실과 욕조 분리')],['adjustable',L(l,'Adjustable bed','可調式床','可调式床','조절식 침대')],['other',other]]);
  }
  return p('followup',L(l,'You can keep exploring or change where to start.','您可以繼續瀏覽，或改變安排的起點。','您可以继续浏览，或改变安排的起点。','계속 둘러보거나 시작 단계를 바꿀 수 있습니다.'),[[route==='hotel'?'whole':'hotel',route==='hotel'?L(l,'See the whole trip','看看整趟行程','看看整趟行程','전체 여행 보기'):L(l,'Hotels first','先決定住宿','先决定住宿','숙소부터')]]);
}
/** Only called for a validated native choice or an explicit numbered answer to the current prompt. */
export function selectTravelChoice(current: IntakeState, index: number): IntakeState {
  const s = structuredClone(current), q = nextTravelPrompt(s); if (!q || !Number.isInteger(index) || !q.values[index]) return s;
  const a=s.travel!.answers, value=q.values[index];
  if (value === 'other') { s.travel!.free=q.key; s.revision++; return s; }
  delete s.travel!.free;
  // A progress choice is valid only after the travel vision was actually accepted by the provider.
  if (q.key === 'progress' && s.travel!.visionShownFor !== s.travel!.tripRevision) return s;
  a[q.key==='followup'?'progress':q.key]=value;
  if(q.key==='progress' && value==='recommend' && a.planning==='independent' && a.wish==='relax'){a.progress='hotel';a.guidance='independent_relaxed';}
  if (q.key === 'cities' && value !== 'unknown') s.slots.cities=value.split('|');
  if (q.key === 'support' && value !== 'unknown') s.slots.support=[value as any];
  if (!['progress','followup','hotelCity','hotelDates','hotelRooms','hotelFeature'].includes(q.key)) { s.travel!.tripRevision++; s.travel!.visionShownFor=null; }
  if(value==='personal_care') { s.phase='human'; s.reason='specialist_support'; }
  s.unclearCount=0; s.revision++; return reconcileTravelScenario(s);
}
export function travelTextAnswer(s: IntakeState, text: string): IntakeState | null {
  const q=nextTravelPrompt(s); if(!q) return null;
  const range=text.match(/^(\d{1,3})\s*[-–〜]\s*(\d{1,3})\s*(?:days?|天|日|일)$/iu);
  const people=text.match(/^(\d{1,2})\s*(?:people|persons?|travell?ers?|人|名|명)$/iu);
  if((range && Number(range[1])>=1 && Number(range[2])>=Number(range[1]) && Number(range[2])<=180)||(people&&Number(people[1])>=1&&Number(people[1])<=20)) {
    const n=structuredClone(s), key=range?'duration':'party';n.travel!.answers[key]=range?`${Number(range[1])}-${Number(range[2])}`:String(Number(people![1]));delete (n.slots as any)[key];delete n.travel!.free;n.travel!.tripRevision++;n.travel!.visionShownFor=null;n.revision++;return reconcileTravelScenario(n);
  }
  const number=text.match(/^([1-9])(?:[.!。])?$/); if(number) return selectTravelChoice(s,Number(number[1])-1);
  if(['progress','followup'].includes(q.key)&&/^(?:whole trip|hotel(?:s)? first|recommend)$/i.test(text)){const value=/^hotel/i.test(text)?'hotel':/^recommend/i.test(text)?'recommend':'whole';const i=q.values.indexOf(value);if(i>=0)return selectTravelChoice(s,i);}
  const exact=q.choices.findIndex(x=>x.toLocaleLowerCase()===text.toLocaleLowerCase()); if(exact>=0)return selectTravelChoice(s,exact);
  if(['not decided','undecided','尚未決定','尚未决定','미정'].includes(text.toLowerCase())) { const i=q.values.indexOf('unknown'); if(i>=0)return selectTravelChoice(s,i); }
  if((q.key==='wish' && text.length<=200 && (s.travel!.free==='wish' || !/\d|Tokyo|Kyoto|Osaka|Hiroshima|Kanazawa|Japan in|JPY|USD|EUR|days|nights|adults|children|東京|东京|京都|大阪|日間|天|도쿄|교토|오사카/iu.test(text))) || (s.travel!.free && ['hotelFeature','hotelDates'].includes(q.key))) {
    const n=structuredClone(s); n.travel!.answers[q.key]=text.slice(0,200); delete n.travel!.free; if(q.key==='wish'){n.travel!.tripRevision++; n.travel!.visionShownFor=null;} n.revision++; return reconcileTravelScenario(n);
  }
  return null;
}
export function travelFactsChanged(before: IntakeState, after: IntakeState): IntakeState {
  if(!after.travel || terminal(after))return after;
  const keys=Object.keys(after.slots).filter(k=>JSON.stringify((before.slots as any)[k])!==JSON.stringify((after.slots as any)[k]));
  for(const k of keys)delete after.travel.answers[k];
  if(keys.some(k=>k!=='preference')) { after.travel.tripRevision++; after.travel.visionShownFor=null; }
  if(keys.includes('preference')) delete after.travel.answers.progress;
  if(keys.length)delete after.travel.free;
  return reconcileTravelScenario(after);
}
export function trackedTravelUrl(raw: string, step: 'travel_vision'|'whole_trip'|'hotel_first'|'tailor_made'): string {
  const u=new URL(raw); if(u.origin!=='https://flat-travel.com'||u.username||u.password||u.hash||!/^\/(en|tc|sc|kr)\//.test(u.pathname))throw new Error('invalid_travel_url');
  for(const key of u.searchParams.keys())if(!['shower','bed','utm_source','utm_medium','utm_campaign','utm_content'].includes(key))throw new Error('unapproved_travel_query');
  u.searchParams.set('utm_source','whatsapp'); u.searchParams.set('utm_medium','messaging'); u.searchParams.set('utm_campaign','wa_travel_scenario_v2'); u.searchParams.set('utm_content',step); return u.href;
}
function safeCatalogue(s: IntakeState, catalogue: CatalogueItem[]): CatalogueItem[] {
  return catalogue.filter(p=>p.kind==='package'&&p.locale===s.locale&&p.publication.status==='published'&&Date.parse(p.publication.validUntil)>Date.now()&&/^https:\/\/flat-travel\.com\/(en|tc|sc|kr)\/journeys\/[a-z0-9-]+$/.test(p.url));
}
function matching(s: IntakeState, c: CatalogueItem[]): CatalogueItem[] {
  const a=s.travel!.answers, d=s.slots.duration, range=a.duration?.match(/^(\d+)-(\d+)$/), total=s.slots.party ? s.slots.party.adults+s.slots.party.children : /^\d{1,2}$/.test(a.party||'')?Number(a.party):null;
  const days=d?.value==null?null:d.value+(d.unit==='nights'?1:0);
  return safeCatalogue(s,c).filter(p=>s.slots.cities?.length===p.cities.length&&s.slots.cities.every(x=>p.cities.includes(x))&&(days!==null?days>=p.minDays&&days<=p.maxDays:range?p.minDays>=Number(range[1])&&p.maxDays<=Number(range[2]):true)&&(!total||!p.supportedPartySizes||p.supportedPartySizes.includes(total))&&!a.party?.includes('+')&&a.wish!=='relax');
}
function candidate(p: CatalogueItem): Candidate { return {id:p.id,title:p.title,kind:p.kind,url:p.url,budgetComparison:'unverified',availability:'unverified',personalFit:'unverified',booking:'not_booked',supportReviewRequired:true}; }
function summary(s: IntakeState): string {
  const a=s.travel!.answers,l=s.locale;
  const destination=s.slots.cities?.join(' / ').slice(0,120)||L(l,'destinations still open','目的地尚未決定','目的地尚未决定','목적지 미정');
  const duration=s.slots.duration?.value?`${s.slots.duration.value} ${s.slots.duration.unit}`:a.duration&&a.duration!=='unknown'?`${a.duration.replace('-','–')} days`:'';
  const party=s.slots.party?`${s.slots.party.adults} adults + ${s.slots.party.children} children`:a.party&&a.party!=='unknown'?`${a.party} people`:'';
  const timing=s.slots.timing?.slice(0,60)||({within3:L(l,'Within 3 months','3個月內','3个月内','3개월 이내'),'3to6':L(l,'In 3–6 months','3至6個月後','3至6个月后','3~6개월 후'),'6to12':L(l,'In 6–12 months','6至12個月後','6至12个月后','6~12개월 후'),later:L(l,'More than a year away','1年以後','1年以后','1년 이후')} as Record<string,string>)[a.timing];
  return [destination,duration,party,timing].filter(Boolean).join(' · ');
}
export function renderTravelScenario(s: IntakeState, catalogue: CatalogueItem[]): TravelReply {
  const l=s.locale,a=s.travel!.answers,q=nextTravelPrompt(s);
  const base: Plan={requiresHumanBeforeBooking:true,action:'ask',message:'',revision:s.revision,summary:s.slots,missing:[],candidates:[]};
  const footer=L(l,'You can also type an answer or extra details.','也可以直接輸入回答或補充。','也可以直接输入回答或补充。','답변이나 추가 내용을 직접 입력해도 됩니다.');
  const needsVision=travelCoreComplete(s)&&s.travel!.visionShownFor!==s.travel!.tripRevision;
  if(needsVision){
    const valid=safeCatalogue(s,catalogue), exact=matching(s,valid), reference=exact[0]||valid.find(p=>s.slots.cities?.some(c=>p.cities.includes(c)))||valid[0];
    const idea=L(l,'A starting point for your trip:','您的旅行初步構想：','您的旅行初步构想：','여행의 시작점입니다:');
    const theme: Record<string,string> = {culture:L(l,'Culture and city walks','文化與城市漫步','文化与城市漫步','문화와 도시 산책'),food:L(l,'Food','美食','美食','음식'),nature:L(l,'Nature and scenery','自然與風景','自然与风景','자연과 풍경'),themeparks:L(l,'Theme parks','主題樂園','主题乐园','테마파크')};
    const desired=theme[a.wish] || (a.wish && !['relax','unknown'].includes(a.wish) ? a.wish.slice(0,60) : '');
    const pace=(desired ? desired + '. ' : '') + (a.wish==='relax'?L(l,'Allow several nights in each city and avoid packing too many stops into a day.','每個城市多住幾晚，避免每天安排太多景點。','每个城市多住几晚，避免每天安排太多景点。','도시마다 여러 밤 머무르며 하루 일정을 여유롭게 잡아보세요.') : L(l,'Use these destinations as the starting point, then choose accommodation and transport around your dates.','先以這些目的地規劃，再按日期安排住宿和交通。','先以这些目的地规划，再按日期安排住宿和交通。','이 목적지를 중심으로 날짜에 맞춰 숙소와 교통을 정해보세요.'));
    const ref=reference?`\n${L(l,'Published model example (route and pace may differ):','已公開的行程範例（路線和步調可能不同）：','已公开的行程范例（路线和节奏可能不同）：','공개된 모델 예시 (경로와 일정 속도는 다를 수 있습니다):')}\n${trackedTravelUrl(reference.url,'travel_vision')}`:'';
    const price=L(l,'A price is not confirmed; enter dates and party details on the model page to check.','價格尚未確認；請在行程頁輸入日期及人數查詢。','价格尚未确认；请在行程页输入日期及人数查询。','가격은 미확정입니다. 모델 페이지에 날짜와 인원을 입력하여 확인해 주세요.');
    base.candidates=reference?[candidate(reference)]:[];
    return {plan:base,text:`${idea}\n${summary(s)}\n${pace}${ref}\n${price}\n\n${q!.text}`,prompt:q,vision:s.travel!.tripRevision,flow:s.travel!.flow,revision:s.revision};
  }
  if(q && q.key !== 'followup')return {plan:base,text:`${a.guidance==='independent_relaxed'?L(l,'You prefer planning independently and a relaxed stay, so starting with accommodation makes sense.\n','您希望自行規劃並悠閒停留，因此建議從住宿開始。\n','您希望自行规划并悠闲停留，因此建议从住宿开始。\n','직접 계획하며 여유롭게 머무르고 싶으시니 숙소부터 정하는 것을 추천합니다.\n'):''}${q.text}\n\n${footer}`,prompt:q,flow:s.travel!.flow,revision:s.revision};
  if(progress(s)==='hotel') {
    const city=a.hotelCity||s.slots.cities?.[0],slug=citySlug[city||''];
    const url=new URL(slug?`https://flat-travel.com/${l}/accessible-hotels/areas/${slug}`:`https://flat-travel.com/${l}/accessible-hotels`);
    if(slug&&['showerBoothOnly','separateShowerAndBathtub'].includes(a.hotelFeature))url.searchParams.set('shower',a.hotelFeature);
    if(slug&&a.hotelFeature==='adjustable')url.searchParams.set('bed','adjustable');
    const text=L(l,'Start with this hotel list. The room-feature filter is applied where selected; dates, party, rooms and availability are not applied to this research list. We have kept your requirements for the next step. You can expand to transport or the whole trip later.','先從這份飯店清單開始。已選設備會套用篩選；日期、人數、房數及空房未套用至此研究清單。需求已保留，之後也可加入交通或整趟行程。','先从这份酒店清单开始。已选设备会应用筛选；日期、人数、房数及空房未应用至此研究清单。需求已保留，之后也可加入交通或整趟行程。','호텔 목록부터 살펴보세요. 선택한 객실 시설 필터가 적용되며 날짜·인원·객실 수·재고는 이 목록에 적용되지 않습니다. 요구 사항은 보관되며 나중에 교통이나 전체 여행으로 확장할 수 있습니다.');
    base.action='recommend';return {plan:base,text:`${text}\n${trackedTravelUrl(url.href,'hotel_first')}`,verifyUrls:[url.origin+url.pathname],prompt:q,flow:s.travel!.flow,revision:s.revision};
  }
  const matches=(s.slots.cities?.length ? matching(s,catalogue) : safeCatalogue(s,catalogue)).slice(0,3);
  const reason=progress(s)==='recommend'?L(l,'A whole-trip example will make the route and transport easier to compare before choosing individual stays.\n','先看整趟行程範例，較容易比較路線和交通，再決定各段住宿。\n','先看整趟行程范例，较容易比较路线和交通，再决定各段住宿。\n','전체 여행 예시를 보면 경로와 교통을 비교한 뒤 개별 숙소를 정하기 쉽습니다.\n'):'';
  if(matches.length){base.action='recommend';base.candidates=matches.map(candidate);return {plan:base,text:`${reason}${L(l,'Start by comparing these whole-trip models against your plans. Prices, pace, room accessibility and availability still need checking.','先比較這些整趟行程範例。價格、步調、客房無障礙條件和供應仍需確認。','先比较这些整趟行程范例。价格、节奏、客房无障碍条件和供应仍需确认。','전체 여행 모델을 먼저 비교해 보세요. 가격·일정 속도·객실 접근성·재고는 확인이 필요합니다.')}\n\n${matches.map(p=>`${p.title}\n${trackedTravelUrl(p.url,'whole_trip')}`).join('\n\n')}`,flow:s.travel!.flow,revision:s.revision};}
  base.action='handoff';base.reason='tailor_made_route';return {plan:base,verifyUrls:[`https://flat-travel.com/${l}/tailor-made`],text:`${L(l,'The published models do not establish a match for your requested route, length or pace. We have saved your requirements for an individual whole-trip review.','已公開的行程無法確認符合您的路線、天數或步調。我們已保存需求，以便個別規劃整趟旅程。','已公开的行程无法确认符合您的路线、天数或节奏。我们已保存需求，以便单独规划整趟旅行。','공개 모델이 원하시는 경로·기간·속도에 맞는지 확인되지 않습니다. 개별 전체 여행 상담을 위해 요구 사항을 저장했습니다.')}\n${trackedTravelUrl(`https://flat-travel.com/${l}/tailor-made`,'tailor_made')}`};
}
export function nativeTravelInteractive(reply: TravelReply, turnId: string): object | undefined {
  const q=reply.prompt;if(!q)return;
  if(reply.text.length>1024||q.choices.length>10||!q.choices.length||!/^[a-f0-9-]{36}$/.test(turnId))throw new Error('invalid_travel_interactive');
  const rows=q.choices.map((title,i)=>({id:`wi:${turnId}:${i}`,title}));
  if(rows.some(r=>r.title.length>24))throw new Error('travel_choice_label_too_long');
  return rows.length<=3&&rows.every(r=>r.title.length<=20)?{type:'button',body:{text:reply.text},action:{buttons:rows.map(r=>({type:'reply',reply:r}))}}:{type:'list',body:{text:reply.text},action:{button:'Select',sections:[{rows}]}};
}
