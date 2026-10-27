/** Offline proposal prototype. Deliberately not imported by any Worker route or sender. */
export const INTAKE_SLOTS = ['timing', 'duration', 'cities', 'party', 'budget', 'support', 'preference'] as const;
export type Slot = typeof INTAKE_SLOTS[number];
export type Locale = 'en' | 'tc' | 'sc' | 'kr';
export type Support = 'none' | 'step_free' | 'accessible_bathroom' | 'manual_wheelchair' | 'power_wheelchair' | 'scooter' | 'airport_transfer' | 'hoist' | 'personal_care';
type Basis = 'party_total' | 'per_person' | 'room_night';
type Scope = 'trip' | 'hotels';
export type Slots = {
  // Preserve the customer's wording, including month-only and undecided timing.
  timing: string;
  duration: { value: number | null; unit: 'days' | 'nights' };
  cities: string[];
  party: { adults: number; children: number };
  budget: { amount: number | null; currency: string | null; basis: Basis | null; scope: Scope | null };
  support: Support[];
  preference: 'package' | 'hotel' | 'either';
};
export type IntakeState = {
  version: 1; revision: number; locale: Locale;
  phase: 'consent' | 'collecting' | 'review' | 'recommended' | 'human' | 'stopped';
  slots: Partial<Slots>; unclearCount: number; reason?: string;
};
export type Interpretation = {
  intent: 'answer' | 'human' | 'stop' | 'urgent' | 'existing_booking' | 'other';
  confidence: number;
  facts: Partial<Record<Slot, { value: unknown; evidence: string }>>;
};
export type Event =
  | { type: 'consent'; allowed: boolean }
  | { type: 'selection'; slot: Slot; value: unknown }
  | { type: 'interpreted'; text: string; result: unknown }
  | { type: 'confirm'; revision: number }
  | { type: 'human' | 'stop' | 'staff_takeover' };
export type CatalogueItem = {
  id: string; title: string; kind: 'package' | 'hotel'; locale: Locale; url: string;
  publication: { status: 'published' | 'draft'; revision: string; validUntil: string };
  cities: string[]; minDays: number; maxDays: number;
  // Public evidence supports discovery only; it never establishes personal fit.
  supportEvidence: Partial<Record<Support, string>>;
  referencePrice?: { amount: number; currency: string; basis: Basis; scope: Scope; party: Slots['party']; validUntil: string };
};
export type Candidate = {
  id: string; title: string; kind: 'package' | 'hotel'; url: string;
  budgetComparison: 'reference_within_budget' | 'unverified';
  availability: 'unverified'; personalFit: 'unverified'; booking: 'not_booked';
};
export type Plan = {
  previewOnly: true; action: 'consent' | 'ask' | 'review' | 'recommend' | 'handoff' | 'stop';
  message: string; question?: Slot; revision: number; summary: Partial<Slots>; missing: Slot[];
  reason?: string; candidates: Candidate[];
};

const SUPPORT: Support[] = ['none', 'step_free', 'accessible_bathroom', 'manual_wheelchair', 'power_wheelchair', 'scooter', 'airport_transfer', 'hoist', 'personal_care'];
const CURRENCIES = ['JPY', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'HKD', 'TWD', 'KRW', 'SGD'];
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const bounded = (x: unknown, n: number): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= n;
const integer = (x: unknown, min: number, max: number) => Number.isInteger(x) && Number(x) >= min && Number(x) <= max;
const keys = (x: Record<string, unknown>, expected: string[]) => Object.keys(x).length === expected.length && expected.every(k => Object.hasOwn(x, k));
const currency = (x: unknown) => typeof x === 'string' && CURRENCIES.includes(x);
function validSlot(slot: Slot, x: unknown): boolean {
  switch (slot) {
    case 'timing': return bounded(x, 160);
    case 'duration': return record(x) && keys(x, ['value', 'unit']) && (x.value === null || integer(x.value, 1, 180)) && ['days', 'nights'].includes(String(x.unit));
    case 'cities': return Array.isArray(x) && x.length > 0 && x.length <= 10 && x.every(v => bounded(v, 60)) && new Set(x).size === x.length;
    case 'party': return record(x) && keys(x, ['adults', 'children']) && integer(x.adults, 1, 20) && integer(x.children, 0, 20) && Number(x.adults) + Number(x.children) <= 20;
    case 'budget': return record(x) && keys(x, ['amount', 'currency', 'basis', 'scope']) &&
      (x.amount === null || (typeof x.amount === 'number' && Number.isFinite(x.amount) && x.amount > 0 && x.amount <= 100_000_000)) &&
      (x.currency === null || currency(x.currency)) && (x.basis === null || ['party_total', 'per_person', 'room_night'].includes(String(x.basis))) &&
      (x.scope === null || ['trip', 'hotels'].includes(String(x.scope)));
    case 'support': return Array.isArray(x) && x.length > 0 && x.length <= SUPPORT.length && x.every(v => SUPPORT.includes(v)) &&
      new Set(x).size === x.length && (!x.includes('none') || x.length === 1);
    case 'preference': return ['package', 'hotel', 'either'].includes(String(x)) && typeof x === 'string';
  }
}

const COPY: Record<Locale, Record<Slot | 'consent' | 'review' | 'recommend' | 'handoff', string>> = {
  en: {
    consent: 'I am Flat Travel’s AI assistant. May I use the travel and accessibility needs you share to guide this enquiry? You can ask for our team at any time.',
    timing: 'When would you like to visit Japan? A month or “not decided” is fine.',
    duration: 'How long would you like to stay? Please specify days or nights; “not decided” is fine.',
    cities: 'Which cities would you like to visit?',
    party: 'How many adults and children will travel?',
    budget: 'What is your approximate budget and currency? Is it for everyone, per person, or per room/night, and for the whole trip or hotels only? “Not decided” is fine.',
    support: 'What travel support do you need: step-free access, bathroom features, mobility equipment, transfers, or personal assistance? “None” is also fine.',
    preference: 'Would you prefer a package tour, hotels only, or either?',
    review: 'Please check the travel details below. Are they correct? You can change any answer.',
    recommend: 'These are options to explore. Prices are references only. Dates, accessible-room availability and personal suitability need confirmation before booking.',
    handoff: 'I will pass this enquiry to our team with the details you have shared.',
  },
  tc: {
    consent: '我是 Flat Travel 的 AI 助理。可以使用您提供的旅遊及無障礙需求來協助本次諮詢嗎？您可隨時要求專人服務。',
    timing: '您希望何時到日本旅遊？只提供月份或回答「尚未決定」也可以。', duration: '您打算停留多久？請註明天數或晚數；尚未決定也可以。', cities: '您想造訪哪些城市？', party: '有幾位成人及兒童同行？',
    budget: '大約的預算和幣別是甚麼？是全體總額、每人或每房每晚？包含整趟旅程還是只有住宿？尚未決定也可以。', support: '您需要哪些旅遊支援，例如無階梯通行、浴室設施、行動輔具、接送或個人協助？沒有需求也可以。', preference: '您偏好套裝行程、只訂飯店，還是兩者皆可？', review: '請確認下方的旅遊需求。內容正確嗎？您可以更改任何回答。', recommend: '以下是可考慮的選項。價格僅供參考，日期、無障礙客房供應及個人適用性須在預訂前確認。', handoff: '我會將您已提供的需求交給專人協助。',
  },
  sc: {
    consent: '我是 Flat Travel 的 AI 助理。可以使用您提供的旅行及无障碍需求来协助本次咨询吗？您可随时要求人工服务。',
    timing: '您希望何时到日本旅行？只提供月份或回答“尚未决定”也可以。', duration: '您计划停留多久？请注明天数或晚数；尚未决定也可以。', cities: '您想游览哪些城市？', party: '有几位成人和儿童同行？',
    budget: '大约的预算和币种是什么？是全体总额、每人还是每房每晚？包含整趟旅行还是只有住宿？尚未决定也可以。', support: '您需要哪些旅行支持，例如无台阶通行、浴室设施、行动辅具、接送或个人协助？没有需求也可以。', preference: '您更希望预订套餐行程、仅酒店，还是两者均可？', review: '请确认下方的旅行需求。内容正确吗？您可以修改任何回答。', recommend: '以下是可考虑的选项。价格仅供参考，日期、无障碍客房供应及个人适用性须在预订前确认。', handoff: '我会将您已提供的需求转交给人工服务。',
  },
  kr: {
    consent: '저는 Flat Travel의 AI 도우미입니다. 이번 상담을 위해 여행 및 접근성 요구 사항을 사용해도 될까요? 언제든 직원 상담을 요청하실 수 있습니다.',
    timing: '언제 일본을 방문하고 싶으신가요? 월만 알려 주시거나 “미정”이라고 답하셔도 됩니다.', duration: '얼마나 머무를 예정인가요? 일수 또는 숙박 일수를 알려 주세요. 미정이어도 됩니다.', cities: '어떤 도시를 방문하고 싶으신가요?', party: '성인과 어린이는 각각 몇 명인가요?',
    budget: '대략적인 예산과 통화를 알려 주세요. 전체 인원 기준, 1인 기준, 객실 1박 기준 중 무엇인가요? 전체 여행 또는 숙박만의 예산인가요? 미정이어도 됩니다.', support: '계단 없는 이동, 욕실 시설, 이동 보조기기, 차량 이동, 개인 지원 등 어떤 도움이 필요한가요? 필요 없다고 답하셔도 됩니다.', preference: '패키지여행, 호텔만 예약, 또는 둘 다 중 어느 쪽을 원하시나요?', review: '아래 여행 요청 사항이 맞는지 확인해 주세요. 답변을 수정하실 수 있습니다.', recommend: '검토하실 수 있는 선택지입니다. 가격은 참고용이며, 날짜, 접근 가능한 객실의 재고 및 개인 적합성은 예약 전에 확인해야 합니다.', handoff: '지금까지 알려 주신 내용을 담당 직원에게 전달하겠습니다.',
  },
};

export function newIntake(locale: Locale, isNewLead: boolean): IntakeState {
  if (!Object.hasOwn(COPY, locale)) throw new Error('unsupported_locale');
  return { version: 1, revision: 0, locale, phase: isNewLead ? 'consent' : 'human', slots: {}, unclearCount: 0, ...(!isNewLead ? { reason: 'existing_customer' } : {}) };
}
const missing = (state: IntakeState) => INTAKE_SLOTS.filter(slot => state.slots[slot] === undefined);
const handoff = (s: IntakeState, reason: string) => { s.phase = 'human'; s.reason = reason; };
function unclear(s: IntakeState) { if (++s.unclearCount >= 2) handoff(s, 'repeated_uncertainty'); }

/** A model proposes values only. Customer confirmation is required before matching. */
export function advanceIntake(current: IntakeState, event: Event): IntakeState {
  if (event.type === 'interpreted' && bounded(event.text, 2500)) {
    if (/^(?:stop|unsubscribe|opt[ -]?out|停止|配信停止|取消訂閱|取消订阅|수신\s*거부)[.!。\s]*$/i.test(event.text.trim())) return advanceIntake(current, { type: 'stop' });
    if (/^(?:human|agent|talk to (?:an? )?(?:human|agent)|人工|專人|专人|担当者|직원|상담원)[.!。\s]*$/i.test(event.text.trim())) return advanceIntake(current, { type: 'human' });
  }
  const s = structuredClone(current);
  if (['human', 'stopped'].includes(s.phase) && !['stop', 'human', 'staff_takeover'].includes(event.type)) return s;
  if (event.type === 'stop') { s.phase = 'stopped'; s.reason = 'opt_out'; s.revision++; return s; }
  if (s.phase === 'stopped') return s;
  if (event.type === 'human' || event.type === 'staff_takeover') { handoff(s, event.type); s.revision++; return s; }
  if (s.phase === 'consent') {
    if (event.type === 'consent') { if (event.allowed === true) s.phase = 'collecting'; else handoff(s, 'ai_consent_declined'); s.revision++; }
    return s;
  }
  if (event.type === 'confirm') {
    if (s.phase === 'review' && event.revision === s.revision && !missing(s).length) { s.phase = 'recommended'; s.revision++; }
    return s;
  }
  let patch: Partial<Slots> = {};
  if (event.type === 'selection') {
    if (!INTAKE_SLOTS.includes(event.slot) || !validSlot(event.slot, event.value)) { unclear(s); s.revision++; return s; }
    patch = { [event.slot]: event.value };
  } else if (event.type === 'interpreted') {
    const r = event.result;
    if (!bounded(event.text, 2500) || !record(r) || !keys(r, ['intent', 'confidence', 'facts']) ||
      typeof r.confidence !== 'number' || !Number.isFinite(r.confidence) || r.confidence < 0 || r.confidence > 1 || !record(r.facts)) {
      unclear(s); s.revision++; return s;
    }
    // These decisions can only reduce automation, even when confidence is low.
    if (r.intent === 'stop') { s.phase = 'stopped'; s.reason = 'opt_out'; s.revision++; return s; }
    if (['human', 'urgent', 'existing_booking'].includes(String(r.intent))) { handoff(s, String(r.intent)); s.revision++; return s; }
    if (r.intent !== 'answer' || r.confidence < 0.9 || !Object.keys(r.facts).length || Object.keys(r.facts).some(k => !INTAKE_SLOTS.includes(k as Slot))) {
      unclear(s); s.revision++; return s;
    }
    for (const [slot, fact] of Object.entries(r.facts)) {
      if (!record(fact) || !keys(fact, ['value', 'evidence']) || !bounded(fact.evidence, 400) || !event.text.includes(fact.evidence) || !validSlot(slot as Slot, fact.value)) {
        unclear(s); s.revision++; return s;
      }
      Object.assign(patch, { [slot]: fact.value });
    }
  } else return s;
  s.slots = { ...s.slots, ...structuredClone(patch) };
  s.unclearCount = 0;
  s.revision++;
  if (s.slots.support?.some(need => need === 'hoist' || need === 'personal_care')) handoff(s, 'specialist_support');
  else s.phase = missing(s).length ? 'collecting' : 'review';
  return s;
}

function publicUrl(value: string, locale: Locale) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'flat-travel.com' && !u.username && !u.password && !u.port && u.pathname.startsWith(`/${locale}/`) && !u.search && !u.hash; }
  catch { return false; }
}
function candidatesFor(s: IntakeState, catalogue: readonly CatalogueItem[], now: number): Candidate[] {
  const slots = s.slots as Slots;
  const days = slots.duration.value === null ? null : slots.duration.value + (slots.duration.unit === 'nights' ? 1 : 0);
  const result: Candidate[] = [];
  const seen = new Set<string>();
  for (const p of catalogue.slice(0, 100)) {
    if (!record(p) || !bounded(p.id, 120) || seen.has(p.id) || !bounded(p.title, 180) || !['package', 'hotel'].includes(p.kind) ||
      p.locale !== s.locale || !publicUrl(p.url, s.locale) || p.publication?.status !== 'published' || !bounded(p.publication.revision, 120) ||
      !(Date.parse(p.publication.validUntil) > now) || !Array.isArray(p.cities) || !p.cities.length || !p.cities.every(c => bounded(c, 60)) ||
      !integer(p.minDays, 1, 181) || !integer(p.maxDays, p.minDays, 181) || !record(p.supportEvidence)) continue;
    if (slots.preference !== 'either' && p.kind !== slots.preference) continue;
    // A multi-stop hotel itinerary needs per-city stays and a separate review.
    if (p.kind === 'hotel' && (slots.cities.length !== 1 || !p.cities.includes(slots.cities[0]))) continue;
    if (p.kind === 'package' && (days === null || days < p.minDays || days > p.maxDays ||
      slots.cities.length !== p.cities.length || !slots.cities.every(city => p.cities.includes(city)))) continue;
    if (slots.support.some(need => need !== 'none' && !publicUrl(p.supportEvidence[need] || '', s.locale))) continue;
    let comparison: Candidate['budgetComparison'] = 'unverified';
    const price = p.referencePrice;
    // No FX guesses, party multiplication, per-night conversion or mixed scope comparison.
    if (slots.budget.amount !== null && price && typeof price.amount === 'number' && Number.isFinite(price.amount) && price.amount > 0 &&
      Date.parse(price.validUntil) > now && price.currency === slots.budget.currency && price.basis === slots.budget.basis && price.scope === slots.budget.scope &&
      price.party?.adults === slots.party.adults && price.party.children === slots.party.children) {
      if (price.amount > slots.budget.amount) continue;
      comparison = 'reference_within_budget';
    }
    seen.add(p.id);
    result.push({ id: p.id, title: p.title, kind: p.kind, url: p.url, budgetComparison: comparison, availability: 'unverified', personalFit: 'unverified', booking: 'not_booked' });
  }
  if (slots.preference === 'either') {
    const firstPackage = result.find(p => p.kind === 'package');
    const firstHotel = result.find(p => p.kind === 'hotel');
    const first = [firstPackage, firstHotel].filter((p): p is Candidate => !!p);
    return [...first, ...result.filter(p => !first.includes(p))].slice(0, 3);
  }
  return result.slice(0, 3);
}

export function planIntake(s: IntakeState, catalogue: readonly CatalogueItem[] = [], now = Date.now()): Plan {
  const copy = COPY[s.locale];
  const base = { previewOnly: true as const, revision: s.revision, summary: structuredClone(s.slots), missing: missing(s), candidates: [] as Candidate[] };
  if (s.phase === 'stopped') return { ...base, action: 'stop', message: '', reason: s.reason };
  if (s.phase === 'human') return { ...base, action: 'handoff', message: copy.handoff, reason: s.reason };
  if (s.phase === 'consent') return { ...base, action: 'consent', message: copy.consent };
  const next = base.missing[0];
  if (next) return { ...base, action: 'ask', question: next, message: copy[next] };
  if (s.phase !== 'recommended') return { ...base, action: 'review', message: copy.review };
  const candidates = Number.isFinite(now) ? candidatesFor(s, catalogue, now) : [];
  if (!candidates.length) return { ...base, action: 'handoff', message: copy.handoff, reason: 'no_verified_catalogue_match' };
  return { ...base, action: 'recommend', message: copy.recommend, candidates };
}
