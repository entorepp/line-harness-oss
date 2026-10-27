import { advanceIntake, INTAKE_SLOTS, intakeQuestions, nextIntakeSlot, planIntake, upgradeIntake, type CatalogueItem, type IntakeState, type Locale, type Plan, type Slot } from './whatsapp-intake.js';

export const affirmative = (v: string) => /^(?:yes|y|confirm|correct|agree|i agree|同意|是|好|はい|確認|확인|동의|네)[.!。\s]*$/iu.test(v.trim());
export const greeting = (v: string) => /^(?:hi|hello|hey|test|ai\s*test|aiテスト|テスト|こんにちは|你好|您好|안녕하세요)[!！.。\s]*$/iu.test(v.trim());
export function localeHint(v: string, previous: Locale = 'en'): Locale {
  if (/\p{Script=Hangul}/u.test(v)) return 'kr';
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(v)) return previous;
  if (/[请这们预帮间订为个发从两儿]/u.test(v)) return 'sc';
  if (/[請這們預幫間訂為個發從兩兒臺體]/u.test(v)) return 'tc';
  if ((v.match(/\p{Script=Han}/gu) || []).length > 2) return previous === 'sc' ? 'sc' : 'tc';
  return (v.match(/[a-z]{2,}/giu) || []).length > 3 ? 'en' : previous;
}
export type LocalResult = { state: IntakeState; handled: boolean; silent?: boolean; selection?: number };
export function humanRequested(text: string): boolean {
  return /^(?:human|agent|talk to (?:an? )?(?:human|agent)|人工|專人|专人|担当者|직원|상담원)[.!。\s]*$/iu.test(text) ||
    /\b(?:speak|talk|connect|transfer)\s+(?:me\s+)?(?:to|with)\s+(?:a |an |your )?(?:human|agent|person|team member|staff)\b/iu.test(text) ||
    /(?:轉|转|找|聯繫|联系).{0,12}(?:人工|專人|专人|客服|真人)|(?:상담원|직원|상담사).{0,16}(?:이야기|연결|상담)|(?:担当者|スタッフ|人間).{0,12}(?:話|つない|繋)/u.test(text);
}
export function localIntakeTurn(s: IntakeState, raw: string): LocalResult {
  s = upgradeIntake(s);
  const text = raw.trim();
  if (/^(?:stop|unsubscribe|opt[ -]?out|停止|配信停止|取消訂閱|取消订阅|수신\s*거부)[.!。\s]*$/iu.test(text) || /^(?:please\s+)?stop\s+(?:messaging|contacting|sending)/iu.test(text)) return { state: advanceIntake(s, { type: 'stop' }), handled: true };
  if (humanRequested(text)) return { state: advanceIntake(s, { type: 'human' }), handled: true };
  if (affirmative(text)) return { state: s, handled: true };
  if (s.phase === 'recommended' && /^[123][.!。\s]*$/u.test(text)) return { state: s, handled: true, selection: Number(text.trim()[0]) };
  if (s.phase === 'recommended' && /^(?:quote|quotation|book|booking|見積|見積もり|報價|报价|預訂|预订|견적|예약)(?:[.!。\s]|$)/iu.test(text)) {
    return { state: { ...s, phase: 'human', reason: 'proposal_selected', revision: s.revision + 1 }, handled: true };
  }
  if (/^(?:thanks|thank you|謝謝|谢谢|ありがとう|감사합니다)[!.。\s]*$/iu.test(text)) return { state: s, handled: true, silent: true };
  if (greeting(text)) return { state: { ...s, locale: localeHint(raw, s.locale) }, handled: true };
  const slot = nextIntakeSlot(s);
  const asked = intakeQuestions(s);
  const pick = (slot: Slot, value: unknown): LocalResult => ({ state: advanceIntake(s, { type: 'selection', slot, value }), handled: true });
  if (asked.includes('preference')) {
    if (/^(?:package|package tour|tour|whole trip|the whole trip|complete trip|套裝行程|套餐行程|パッケージ|패키지)$/iu.test(text)) return pick('preference', 'package');
    if (/^(?:hotel|hotels|hotel only|hotels only|只訂飯店|仅酒店|ホテルのみ|호텔만)$/iu.test(text)) return pick('preference', 'hotel');
    if (/^(?:either|both|help me choose|not sure|兩者皆可|两者均可|どちらでも|둘 다)$/iu.test(text)) return pick('preference', 'either');
  }
  if (asked.includes('support') && /^(?:none|no support|no support needed|沒有|没有|不需要|なし|없음|필요 없음)$/iu.test(text)) return pick('support', ['none']);
  if (asked.includes('duration')) {
    const m = text.match(/^(\d{1,3})\s*(days?|nights?|日|天|晚|泊|일|박)$/iu);
    if (m) return pick('duration', { value: Number(m[1]), unit: /^(?:nights?|晚|泊|박)$/iu.test(m[2]) ? 'nights' : 'days' });
  }
  if (/^(?:not decided|undecided|not sure|尚未決定|尚未决定|未定|미정)$/iu.test(text)) {
    if (slot === 'timing') return pick(slot, text);
    if (slot === 'duration') return pick(slot, { value: null, unit: 'days' });
    if (slot === 'budget') return pick(slot, { amount: null, currency: null, basis: null, scope: null });
  }
  return { state: s, handled: false };
}

const LABELS: Record<Locale, Record<Slot, string>> = {
  en: { timing: 'When', duration: 'Duration', cities: 'Cities', party: 'Travellers', budget: 'Budget', support: 'Support', preference: 'Service' },
  tc: { timing: '時期', duration: '天數／晚數', cities: '城市', party: '同行人數', budget: '預算', support: '支援需求', preference: '服務' },
  sc: { timing: '时间', duration: '天数／晚数', cities: '城市', party: '同行人数', budget: '预算', support: '支持需求', preference: '服务' },
  kr: { timing: '시기', duration: '기간', cities: '도시', party: '여행 인원', budget: '예산', support: '지원 요구', preference: '서비스' },
};
const WORDS: Record<Locale, Record<string, string>> = {
  en: { unknown: 'Not decided', days: 'days', nights: 'nights', adults: 'adults', children: 'children', party_total: 'all travellers', per_person: 'per person', room_night: 'per room/night', trip: 'whole trip', hotels: 'hotels only', package: 'package tour', hotel: 'hotels only', either: 'either', none: 'No support requested', step_free: 'Step-free access', accessible_bathroom: 'Accessible bathroom', manual_wheelchair: 'Manual wheelchair', power_wheelchair: 'Power wheelchair', scooter: 'Mobility scooter', airport_transfer: 'Airport transfers', shower_chair: 'Shower chair', vision_support: 'Vision support', hearing_support: 'Hearing support', hoist: 'Hoist', personal_care: 'Personal assistance' },
  tc: { unknown: '尚未決定', days: '天', nights: '晚', adults: '成人', children: '兒童', party_total: '全體總額', per_person: '每人', room_night: '每房每晚', trip: '整趟旅程', hotels: '只有住宿', package: '套裝行程', hotel: '只訂飯店', either: '兩者皆可', none: '無支援需求', step_free: '無階梯通行', accessible_bathroom: '無障礙浴室', manual_wheelchair: '手動輪椅', power_wheelchair: '電動輪椅', scooter: '代步車', airport_transfer: '機場接送', shower_chair: '沐浴椅', vision_support: '視覺支援', hearing_support: '聽覺支援', hoist: '移位機', personal_care: '個人協助' },
  sc: { unknown: '尚未决定', days: '天', nights: '晚', adults: '成人', children: '儿童', party_total: '全体总额', per_person: '每人', room_night: '每房每晚', trip: '整趟旅行', hotels: '只有住宿', package: '套餐行程', hotel: '仅酒店', either: '两者均可', none: '无支持需求', step_free: '无台阶通行', accessible_bathroom: '无障碍浴室', manual_wheelchair: '手动轮椅', power_wheelchair: '电动轮椅', scooter: '代步车', airport_transfer: '机场接送', shower_chair: '沐浴椅', vision_support: '视觉支持', hearing_support: '听觉支持', hoist: '移位机', personal_care: '个人协助' },
  kr: { unknown: '미정', days: '일', nights: '박', adults: '성인', children: '어린이', party_total: '전체 인원 기준', per_person: '1인 기준', room_night: '객실 1박 기준', trip: '전체 여행', hotels: '숙박만', package: '패키지여행', hotel: '호텔만', either: '둘 다', none: '지원 필요 없음', step_free: '계단 없는 이동', accessible_bathroom: '접근 가능한 욕실', manual_wheelchair: '수동 휠체어', power_wheelchair: '전동 휠체어', scooter: '전동 스쿠터', airport_transfer: '공항 이동', shower_chair: '샤워 의자', vision_support: '시각 지원', hearing_support: '청각 지원', hoist: '리프트', personal_care: '개인 지원' },
};
export function renderIntakeSummary(s: IntakeState, includeSupport = true): string {
  const w = WORDS[s.locale];
  const lines: string[] = [];
  for (let i = 0; i < INTAKE_SLOTS.length; i++) {
    const slot = INTAKE_SLOTS[i]; const v: any = s.slots[slot]; if (v === undefined || (!includeSupport && slot === 'support')) continue;
    let value: string;
    if (slot === 'duration') value = v.value === null ? w.unknown : `${v.value} ${w[v.unit]}`;
    else if (slot === 'party') value = `${v.adults} ${w.adults}, ${v.children} ${w.children}`;
    else if (slot === 'budget') value = [v.amount === null ? w.unknown : `${v.amount} ${v.currency || ''}`.trim(), v.basis ? w[v.basis] : '', v.scope ? w[v.scope] : ''].filter(Boolean).join(' · ');
    else if (slot === 'support') value = v.map((code: string) => w[code]).join(', ');
    else if (Array.isArray(v)) value = v.join(' / ');
    else value = w[v] || v;
    lines.push(`${LABELS[s.locale][slot]}: ${value}`);
  }
  return lines.join('\n');
}
export function renderIntakePlan(s: IntakeState, catalogue: CatalogueItem[] = [], options: { introduction?: boolean; selection?: number } = {}): { plan: Plan; text: string } {
  const plan = planIntake(s, catalogue);
  if (plan.action === 'recommend') {
    const follow: Record<Locale, string> = { en: 'Open a link for details and the enquiry or booking steps. Tell us if you would like to change any travel details.', tc: '請開啟連結查看詳情及查詢或預訂步驟。如需更改旅遊條件，直接告訴我們即可。', sc: '请打开链接查看详情及咨询或预订步骤。如需更改旅行条件，直接告诉我们即可。', kr: '링크에서 상세 내용과 문의 또는 예약 절차를 확인해 주세요. 여행 조건을 바꾸고 싶으시면 알려 주세요.' };
    const candidates = options.selection && plan.candidates[options.selection - 1] ? [plan.candidates[options.selection - 1]] : plan.candidates;
    const text = `${renderIntakeSummary(s)}\n\n${plan.message}\n\n${candidates.map((p, i) => `${i + 1}. ${p.title}\n${p.url}`).join('\n\n')}\n\n${follow[s.locale]}`;
    return { plan, text: options.introduction ? `${INTRO[s.locale]}\n\n${text}` : text };
  }
  return { plan, text: options.introduction && plan.action === 'ask' ? `${INTRO[s.locale]}\n\n${plan.message}` : plan.message };
}
const INTRO: Record<Locale, string> = { en: 'Hi, this is Flat Travel.', tc: '您好，這裡是 Flat Travel。', sc: '您好，这里是 Flat Travel。', kr: '안녕하세요, Flat Travel입니다.' };
