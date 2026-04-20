import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const env = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex < 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    env[key] = value;
  }

  return env;
}

const webEnv = readEnvFile(path.join(repoRoot, 'apps/web/.env.local'));
const studioEnv = readEnvFile(path.join(repoRoot, 'apps/forms-studio/.env.local'));

const API_URL = process.env.FORMS_API_URL
  || process.env.NEXT_PUBLIC_API_URL
  || studioEnv.NEXT_PUBLIC_API_URL
  || webEnv.NEXT_PUBLIC_API_URL
  || 'https://line-flattravel.flat-travel.workers.dev';

const API_KEY = process.env.FORMS_API_KEY
  || process.env.NEXT_PUBLIC_API_KEY
  || studioEnv.NEXT_PUBLIC_API_KEY
  || webEnv.NEXT_PUBLIC_API_KEY;

if (!API_KEY) {
  throw new Error('API key not found. Set FORMS_API_KEY or define NEXT_PUBLIC_API_KEY in apps/web/.env.local');
}

function field(name, label, type, extras = {}) {
  return {
    name,
    label,
    type,
    required: true,
    ...extras,
  };
}

const localizedForms = [
  {
    name: 'バリアフリー・介助旅行ヒアリングフォーム',
    description: '最適な旅行プランをご提案するため、ご相談内容の詳細を確認させていただきます。医療的ケアや介助が必要な場合は詳しくご記入ください。',
    fields: [
      field('representative_name', '代表者氏名', 'text'),
      field('email', 'メールアドレス', 'email'),
      field('phone_number', '電話番号', 'tel'),
      field('preferred_language', '希望言語', 'radio', {
        options: ['日本語', 'English', '繁體中文', '한국어'],
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      }),
      field('travel_start_date', '旅行開始日', 'date'),
      field('travel_end_date', '旅行終了日', 'date'),
      field('destination', '滞在予定場所（国/地域、または具体的な場所）', 'textarea'),
      field('home_country_region', 'ご出身/お住まいの国・地域', 'text'),
      field('total_travelers', '旅行に参加する合計人数（代表者含む）', 'number'),
      field('max_budget', 'MAXご予算（航空券を除く、旅行全体で）', 'radio', {
        options: ['10万円未満', '10〜30万円', '30〜50万円', '50〜70万円', '70〜100万円', '100〜150万円', '150〜200万円', '200万円以上'],
      }),
      field('party_breakdown', '参加者構成（ご年齢／関係性）', 'textarea', {
        helperText: '例：本人(50代)、配偶者(50代)',
      }),
      field('support_people_count', 'サポートが必要な方は何名ですか？', 'number'),
      field('supported_traveler_gender', 'サポートが必要な方の性別', 'radio', {
        options: ['男性', '女性'],
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      }),
      field('supported_traveler_height_cm', 'サポートが必要な方の身長（cm）', 'number'),
      field('supported_traveler_weight_kg', 'サポートが必要な方の体重（kg）', 'number'),
      field('meal_preferences', '朝食・夕食についてのご希望', 'checkbox', {
        options: ['朝食付きを希望', '2食付きを希望', '食事はすべて手配不要', '食事内容（アレルギー、特別食など）に配慮が必要'],
      }),
      field('room_requests', 'お部屋に対するご要望（複数選択可）', 'checkbox', {
        options: ['バリアフリールーム', 'ウォークインシャワー/シャワーブース', 'ツインベッド', 'キングサイズベッド', 'コネクティングルーム', '同フロアを希望', 'ベッド低めを希望', '介護用/電動ベッド', '貸切風呂', '個別食/個室食', '手すり付きのシャワー、トイレ'],
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      }),
      field('hotel_transfer_required', 'ホテル⇔空港やホテル⇄駅の送迎は必要ですか？', 'radio', {
        options: ['必要', '不要'],
      }),
      field('sightseeing_taxi_required', '観光タクシー（チャーター車両）は必要ですか？', 'radio', {
        options: ['必要', '不要'],
      }),
      field('guide_required', '観光ガイドは必要ですか？（介助者とは異なります）', 'radio', {
        options: ['必要', '不要'],
      }),
      field('caregiver_or_nurse_required', '国家資格保有の旅行専門介護士や看護師のご用意は必要ですか？', 'radio', {
        options: ['必要', '不要'],
      }),
      field('transportation_modes', '滞在中に主に利用予定の交通手段（複数選択可）', 'checkbox', {
        options: ['新幹線・長距離列車', '電車・地下鉄', 'タクシー', 'レンタカー（自力運転）'],
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      }),
      field('vehicle_boarding_preference', '車両利用時のご希望（タクシー、送迎車など）', 'radio', {
        options: ['車椅子のまま乗車（リフト付き車両など）', '車椅子を折りたたんで乗車（一般車両）', '車両利用/車椅子利用の予定なし'],
      }),
      field('suitcase_count', '予想されるスーツケースの個数', 'number'),
      field('wheelchair_usage', '観光中に車椅子を使用しますか？', 'radio', {
        options: ['手動車椅子を使用', '電動車椅子を使用', '使用しない'],
      }),
      field('wheelchair_width_cm', '（車椅子を使用する場合）車椅子の横幅（最大値 cm）', 'number'),
      field('wheelchair_height_cm', '（車椅子を使用する場合）車椅子の高さ（最大値 cm）', 'number'),
      field('wheelchair_weight_kg', '（車椅子を使用する場合）車椅子の重さ（kg）', 'number'),
      field('equipment_rental_needs', '滞在中に福祉用具レンタルのご希望はありますか？（複数選択可）', 'checkbox', {
        options: ['手動車椅子', '電動車椅子', 'リフト', 'シャワーチェア・バスボード', '介護用ベッド（特殊寝台）', '特になし'],
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      }),
      field('assistance_needs', '必要な介助内容（複数選択可）', 'checkbox', {
        options: ['移動介助（移乗含む）', '食事介助', '入浴介助', '排泄介助（トイレ、おむつ交換など）', '見守り・声かけ', '特になし'],
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      }),
      field('support_details', '配慮や介護が必要なこと、必要なサポート内容の詳細', 'textarea'),
      field('medical_care_needed', '医学的管理（看護師など医療資格者の介在）の必要性', 'radio', {
        options: ['有（必要）', '無（不要）'],
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      }),
      field('medical_care_details', '医学的管理の具体的な内容（複数選択可）', 'checkbox', {
        options: ['吸引', '酸素', '服薬管理', '褥瘡ケア', '導尿/カテーテル管理', '経管栄養', '特になし'],
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      }),
      field('flight_status', '航空券について', 'radio', {
        options: ['確定＆購入済', '検討中', 'これから検討', '特に手配の必要なし'],
      }),
      field('outbound_departure_point', '行きの出発地点(最寄駅/最寄り空港)', 'text'),
      field('outbound_arrival_point', '行きの到着場所（駅名/空港名）', 'text'),
      field('outbound_arrival_time', '行きの到着時刻', 'time'),
      field('return_departure_point', '帰りの出発場所（駅名/空港名）', 'text'),
      field('return_departure_time', '帰りの出発時刻', 'time'),
      field('trip_wishes', 'やりたいこと / 行きたいところなど、具体的な希望内容', 'textarea'),
      field('additional_notes', 'その他、旅行に関して共有しておきたい事項', 'textarea'),
      field('contact_consent', '上記内容をもとに、旅行提案・手配のために当社から連絡を受けることに同意します。', 'radio', {
        options: ['同意する', '同意しない'],
      }),
    ],
  },
  {
    name: 'Accessible & Assisted Travel Consultation Form',
    description: 'To propose the most suitable travel plan, we would like to understand your request in detail. If medical care or caregiving support is needed, please provide as much information as possible.',
    fields: [
      field('representative_name', 'Representative name', 'text'),
      field('email', 'Email address', 'email'),
      field('phone_number', 'Phone number', 'tel'),
      field('preferred_language', 'Preferred language', 'radio', {
        options: ['Japanese', 'English', 'Traditional Chinese', 'Korean'],
        allowOtherOption: true,
        otherOptionLabel: 'Other',
      }),
      field('travel_start_date', 'Travel start date', 'date'),
      field('travel_end_date', 'Travel end date', 'date'),
      field('destination', 'Destination(s) planned for your stay (country/region or specific places)', 'textarea'),
      field('home_country_region', 'Country / region of residence or origin', 'text'),
      field('total_travelers', 'Total number of travelers (including the representative)', 'number'),
      field('max_budget', 'Maximum budget (excluding airfare, total for the whole trip)', 'radio', {
        options: ['Under JPY 100,000', 'JPY 100,000 - 300,000', 'JPY 300,000 - 500,000', 'JPY 500,000 - 700,000', 'JPY 700,000 - 1,000,000', 'JPY 1,000,000 - 1,500,000', 'JPY 1,500,000 - 2,000,000', 'Over JPY 2,000,000'],
      }),
      field('party_breakdown', 'Travel party breakdown (age / relationship)', 'textarea', {
        helperText: 'Example: self (50s), spouse (50s)',
      }),
      field('support_people_count', 'How many travelers require support?', 'number'),
      field('supported_traveler_gender', 'Gender of the traveler who requires support', 'radio', {
        options: ['Male', 'Female'],
        allowOtherOption: true,
        otherOptionLabel: 'Other',
      }),
      field('supported_traveler_height_cm', 'Height of the traveler who requires support (cm)', 'number'),
      field('supported_traveler_weight_kg', 'Weight of the traveler who requires support (kg)', 'number'),
      field('meal_preferences', 'Meal preferences (breakfast / dinner)', 'checkbox', {
        options: ['Breakfast included', 'Breakfast and dinner included', 'No meal arrangements needed', 'Dietary accommodations required (allergies, special meals, etc.)'],
      }),
      field('room_requests', 'Room requests (multiple answers allowed)', 'checkbox', {
        options: ['Accessible room', 'Walk-in shower / shower booth', 'Twin beds', 'King-size bed', 'Connecting rooms', 'Same floor requested', 'Lower bed height requested', 'Care / electric bed', 'Private bath', 'Private or separate dining', 'Grab bars in shower / toilet'],
        allowOtherOption: true,
        otherOptionLabel: 'Other',
      }),
      field('hotel_transfer_required', 'Do you need transfers between the hotel and the airport / station?', 'radio', {
        options: ['Yes', 'No'],
      }),
      field('sightseeing_taxi_required', 'Do you need a sightseeing taxi / charter vehicle?', 'radio', {
        options: ['Yes', 'No'],
      }),
      field('guide_required', 'Do you need a sightseeing guide? (Different from a caregiver)', 'radio', {
        options: ['Yes', 'No'],
      }),
      field('caregiver_or_nurse_required', 'Do you need a travel-specialist caregiver or nurse with a national qualification?', 'radio', {
        options: ['Yes', 'No'],
      }),
      field('transportation_modes', 'Main transportation modes you expect to use during the stay (multiple answers allowed)', 'checkbox', {
        options: ['Shinkansen / long-distance rail', 'Train / subway', 'Taxi', 'Rental car (self-driving)'],
        allowOtherOption: true,
        otherOptionLabel: 'Other',
      }),
      field('vehicle_boarding_preference', 'Vehicle boarding preference (taxi, transfer vehicle, etc.)', 'radio', {
        options: ['Ride while staying in the wheelchair (lift-equipped vehicle, etc.)', 'Fold the wheelchair and ride in a standard vehicle', 'No vehicle / wheelchair transport planned'],
      }),
      field('suitcase_count', 'Estimated number of suitcases', 'number'),
      field('wheelchair_usage', 'Will a wheelchair be used during sightseeing?', 'radio', {
        options: ['Manual wheelchair', 'Power wheelchair', 'No wheelchair'],
      }),
      field('wheelchair_width_cm', 'If using a wheelchair: width (maximum, cm)', 'number'),
      field('wheelchair_height_cm', 'If using a wheelchair: height (maximum, cm)', 'number'),
      field('wheelchair_weight_kg', 'If using a wheelchair: weight (kg)', 'number'),
      field('equipment_rental_needs', 'Would you like to rent welfare / accessibility equipment during your stay? (multiple answers allowed)', 'checkbox', {
        options: ['Manual wheelchair', 'Power wheelchair', 'Lift', 'Shower chair / bath board', 'Nursing bed / adjustable care bed', 'None'],
        allowOtherOption: true,
        otherOptionLabel: 'Other',
      }),
      field('assistance_needs', 'Care / assistance needed (multiple answers allowed)', 'checkbox', {
        options: ['Mobility assistance (including transfers)', 'Meal assistance', 'Bathing assistance', 'Toileting assistance (toilet use, diaper change, etc.)', 'Supervision / verbal prompting', 'None'],
        allowOtherOption: true,
        otherOptionLabel: 'Other',
      }),
      field('support_details', 'Details of the care considerations or support required', 'textarea'),
      field('medical_care_needed', 'Is medical management by a licensed professional (such as a nurse) required?', 'radio', {
        options: ['Yes', 'No'],
        allowOtherOption: true,
        otherOptionLabel: 'Other',
      }),
      field('medical_care_details', 'Specific medical care required (multiple answers allowed)', 'checkbox', {
        options: ['Suctioning', 'Oxygen', 'Medication management', 'Pressure sore care', 'Catheter / urinary management', 'Tube feeding', 'None'],
        allowOtherOption: true,
        otherOptionLabel: 'Other',
      }),
      field('flight_status', 'Air ticket status', 'radio', {
        options: ['Already confirmed and purchased', 'Considering options', 'Will consider from now', 'No flight arrangements needed'],
      }),
      field('outbound_departure_point', 'Outbound departure point (nearest station / airport)', 'text'),
      field('outbound_arrival_point', 'Outbound arrival point (station / airport)', 'text'),
      field('outbound_arrival_time', 'Outbound arrival time', 'time'),
      field('return_departure_point', 'Return departure point (station / airport)', 'text'),
      field('return_departure_time', 'Return departure time', 'time'),
      field('trip_wishes', 'What would you like to do or where would you like to go? Please share concrete wishes.', 'textarea'),
      field('additional_notes', 'Anything else we should know about the trip', 'textarea'),
      field('contact_consent', 'Based on the information above, do you agree to be contacted by us for travel planning and arrangements?', 'radio', {
        options: ['I agree', 'I do not agree'],
      }),
    ],
  },
  {
    name: '무장애·돌봄 여행 상담 폼',
    description: '가장 적합한 여행 플랜을 제안드리기 위해 상담 내용을 자세히 확인하고자 합니다. 의료적 케어나 돌봄 지원이 필요한 경우 가능한 한 자세히 작성해 주세요.',
    fields: [
      field('representative_name', '대표자 성함', 'text'),
      field('email', '이메일 주소', 'email'),
      field('phone_number', '전화번호', 'tel'),
      field('preferred_language', '희망 언어', 'radio', {
        options: ['일본어', '영어', '번체 중국어', '한국어'],
        allowOtherOption: true,
        otherOptionLabel: '기타',
      }),
      field('travel_start_date', '여행 시작일', 'date'),
      field('travel_end_date', '여행 종료일', 'date'),
      field('destination', '체류 예정 지역(국가/지역 또는 구체적인 장소)', 'textarea'),
      field('home_country_region', '거주지 / 출신 국가·지역', 'text'),
      field('total_travelers', '여행 참가 총인원(대표자 포함)', 'number'),
      field('max_budget', '최대 예산(항공권 제외, 여행 전체 기준)', 'radio', {
        options: ['10만 엔 미만', '10만~30만 엔', '30만~50만 엔', '50만~70만 엔', '70만~100만 엔', '100만~150만 엔', '150만~200만 엔', '200만 엔 이상'],
      }),
      field('party_breakdown', '참가자 구성(연령 / 관계)', 'textarea', {
        helperText: '예: 본인(50대), 배우자(50대)',
      }),
      field('support_people_count', '지원이 필요한 분은 몇 명인가요?', 'number'),
      field('supported_traveler_gender', '지원이 필요한 분의 성별', 'radio', {
        options: ['남성', '여성'],
        allowOtherOption: true,
        otherOptionLabel: '기타',
      }),
      field('supported_traveler_height_cm', '지원이 필요한 분의 키(cm)', 'number'),
      field('supported_traveler_weight_kg', '지원이 필요한 분의 체중(kg)', 'number'),
      field('meal_preferences', '조식·석식 관련 희망 사항', 'checkbox', {
        options: ['조식 포함 희망', '조식+석식 포함 희망', '식사 수배 불필요', '알레르기·특별식 등 식사 배려 필요'],
      }),
      field('room_requests', '객실 관련 요청 사항(복수 선택 가능)', 'checkbox', {
        options: ['배리어프리 객실', '워크인 샤워 / 샤워부스', '트윈 베드', '킹사이즈 베드', '커넥팅 룸', '같은 층 희망', '낮은 침대 희망', '전동 / 케어 침대', '전세 욕실', '개별식 / 개별 식사 공간', '샤워실·화장실 손잡이'],
        allowOtherOption: true,
        otherOptionLabel: '기타',
      }),
      field('hotel_transfer_required', '호텔⇔공항 / 호텔⇄역 송영이 필요하신가요?', 'radio', {
        options: ['필요', '불필요'],
      }),
      field('sightseeing_taxi_required', '관광 택시(전세 차량)가 필요하신가요?', 'radio', {
        options: ['필요', '불필요'],
      }),
      field('guide_required', '관광 가이드가 필요하신가요? (돌봄 인력과는 별도)', 'radio', {
        options: ['필요', '불필요'],
      }),
      field('caregiver_or_nurse_required', '국가 자격을 가진 여행 전문 요양보호사 / 간호사가 필요하신가요?', 'radio', {
        options: ['필요', '불필요'],
      }),
      field('transportation_modes', '체류 중 주로 이용 예정인 교통수단(복수 선택 가능)', 'checkbox', {
        options: ['신칸센·장거리 열차', '전철·지하철', '택시', '렌터카(직접 운전)'],
        allowOtherOption: true,
        otherOptionLabel: '기타',
      }),
      field('vehicle_boarding_preference', '차량 이용 시 희망 사항(택시, 송영차 등)', 'radio', {
        options: ['휠체어에 탄 채로 승차(리프트 차량 등)', '휠체어를 접어서 일반 차량에 승차', '차량 / 휠체어 이용 예정 없음'],
      }),
      field('suitcase_count', '예상되는 캐리어 개수', 'number'),
      field('wheelchair_usage', '관광 중 휠체어를 사용하시나요?', 'radio', {
        options: ['수동 휠체어 사용', '전동 휠체어 사용', '사용하지 않음'],
      }),
      field('wheelchair_width_cm', '휠체어 사용 시 가로 폭(최대 cm)', 'number'),
      field('wheelchair_height_cm', '휠체어 사용 시 높이(최대 cm)', 'number'),
      field('wheelchair_weight_kg', '휠체어 사용 시 무게(kg)', 'number'),
      field('equipment_rental_needs', '체류 중 복지용구 렌탈이 필요하신가요? (복수 선택 가능)', 'checkbox', {
        options: ['수동 휠체어', '전동 휠체어', '리프트', '샤워 의자 / 욕조 보드', '간호용 침대(특수 침대)', '없음'],
        allowOtherOption: true,
        otherOptionLabel: '기타',
      }),
      field('assistance_needs', '필요한 돌봄 내용(복수 선택 가능)', 'checkbox', {
        options: ['이동 보조(이승 포함)', '식사 보조', '목욕 보조', '배설 보조(화장실, 기저귀 교체 등)', '지켜보기 / 말 걸기', '없음'],
        allowOtherOption: true,
        otherOptionLabel: '기타',
      }),
      field('support_details', '배려가 필요한 사항, 필요한 지원 내용의 상세', 'textarea'),
      field('medical_care_needed', '간호사 등 의료 자격자의 개입이 필요한 의료적 관리가 있나요?', 'radio', {
        options: ['있음(필요)', '없음(불필요)'],
        allowOtherOption: true,
        otherOptionLabel: '기타',
      }),
      field('medical_care_details', '구체적으로 필요한 의료적 관리 내용(복수 선택 가능)', 'checkbox', {
        options: ['흡인', '산소', '복약 관리', '욕창 케어', '도뇨 / 카테터 관리', '경관영양', '없음'],
        allowOtherOption: true,
        otherOptionLabel: '기타',
      }),
      field('flight_status', '항공권 상황', 'radio', {
        options: ['이미 확정 및 구매 완료', '검토 중', '지금부터 검토 예정', '항공권 수배 불필요'],
      }),
      field('outbound_departure_point', '가는 편 출발지(가까운 역 / 공항)', 'text'),
      field('outbound_arrival_point', '가는 편 도착지(역 / 공항)', 'text'),
      field('outbound_arrival_time', '가는 편 도착 시각', 'time'),
      field('return_departure_point', '오는 편 출발지(역 / 공항)', 'text'),
      field('return_departure_time', '오는 편 출발 시각', 'time'),
      field('trip_wishes', '하고 싶은 일 / 가고 싶은 장소 등 구체적인 희망 사항', 'textarea'),
      field('additional_notes', '그 밖에 여행 관련하여 공유해 두고 싶은 사항', 'textarea'),
      field('contact_consent', '위 내용을 바탕으로 여행 제안 및 수배를 위해 당사로부터 연락을 받는 것에 동의합니다.', 'radio', {
        options: ['동의합니다', '동의하지 않습니다'],
      }),
    ],
  },
  {
    name: '無障礙／照護旅遊諮詢表',
    description: '為了向您提出最適合的旅遊方案，我們想先更詳細了解您的需求內容。若需要醫療照護或照顧支援，請盡可能詳盡填寫。',
    fields: [
      field('representative_name', '代表者姓名', 'text'),
      field('email', '電子郵件地址', 'email'),
      field('phone_number', '電話號碼', 'tel'),
      field('preferred_language', '希望使用的語言', 'radio', {
        options: ['日文', '英文', '繁體中文', '韓文'],
        allowOtherOption: true,
        otherOptionLabel: '其他',
      }),
      field('travel_start_date', '旅行開始日期', 'date'),
      field('travel_end_date', '旅行結束日期', 'date'),
      field('destination', '預計停留地（國家／地區或具體地點）', 'textarea'),
      field('home_country_region', '您的國家／地區（出生地或居住地）', 'text'),
      field('total_travelers', '參加旅行的總人數（含代表者）', 'number'),
      field('max_budget', '最高預算（不含機票，整趟旅程）', 'radio', {
        options: ['10萬日圓以下', '10萬～30萬日圓', '30萬～50萬日圓', '50萬～70萬日圓', '70萬～100萬日圓', '100萬～150萬日圓', '150萬～200萬日圓', '200萬日圓以上'],
      }),
      field('party_breakdown', '同行者組成（年齡／關係）', 'textarea', {
        helperText: '例：本人（50多歲）、配偶（50多歲）',
      }),
      field('support_people_count', '需要支援的人數有幾位？', 'number'),
      field('supported_traveler_gender', '需要支援者的性別', 'radio', {
        options: ['男性', '女性'],
        allowOtherOption: true,
        otherOptionLabel: '其他',
      }),
      field('supported_traveler_height_cm', '需要支援者的身高（cm）', 'number'),
      field('supported_traveler_weight_kg', '需要支援者的體重（kg）', 'number'),
      field('meal_preferences', '早餐／晚餐的需求', 'checkbox', {
        options: ['希望附早餐', '希望附早晚餐', '不需要安排餐食', '需要餐食上的配合（過敏、特殊餐等）'],
      }),
      field('room_requests', '房型需求（可複選）', 'checkbox', {
        options: ['無障礙客房', '步入式淋浴間／淋浴間', '雙床房', '特大床', '連通房', '希望安排同樓層', '希望較低床高', '照護床／電動床', '包場浴池', '個別餐／包廂用餐', '附扶手的淋浴／廁所'],
        allowOtherOption: true,
        otherOptionLabel: '其他',
      }),
      field('hotel_transfer_required', '是否需要飯店⇔機場或飯店⇄車站接送？', 'radio', {
        options: ['需要', '不需要'],
      }),
      field('sightseeing_taxi_required', '是否需要觀光計程車（包車）？', 'radio', {
        options: ['需要', '不需要'],
      }),
      field('guide_required', '是否需要觀光導遊？（與照護人員不同）', 'radio', {
        options: ['需要', '不需要'],
      }),
      field('caregiver_or_nurse_required', '是否需要具國家資格的旅遊專業照護員或護理師？', 'radio', {
        options: ['需要', '不需要'],
      }),
      field('transportation_modes', '停留期間預計主要使用的交通工具（可複選）', 'checkbox', {
        options: ['新幹線／長途列車', '電車／地鐵', '計程車', '租車（自行駕駛）'],
        allowOtherOption: true,
        otherOptionLabel: '其他',
      }),
      field('vehicle_boarding_preference', '搭乘車輛時的需求（計程車、接送車等）', 'radio', {
        options: ['維持坐在輪椅上搭乘（如升降設備車輛）', '將輪椅收折後搭乘一般車輛', '沒有搭車／使用輪椅的計畫'],
      }),
      field('suitcase_count', '預計行李箱數量', 'number'),
      field('wheelchair_usage', '觀光途中是否會使用輪椅？', 'radio', {
        options: ['使用手動輪椅', '使用電動輪椅', '不使用'],
      }),
      field('wheelchair_width_cm', '若使用輪椅：輪椅寬度（最大值 cm）', 'number'),
      field('wheelchair_height_cm', '若使用輪椅：輪椅高度（最大值 cm）', 'number'),
      field('wheelchair_weight_kg', '若使用輪椅：輪椅重量（kg）', 'number'),
      field('equipment_rental_needs', '停留期間是否需要租借福祉輔具？（可複選）', 'checkbox', {
        options: ['手動輪椅', '電動輪椅', '升降設備', '淋浴椅／浴板', '照護床（特殊病床）', '不需要'],
        allowOtherOption: true,
        otherOptionLabel: '其他',
      }),
      field('assistance_needs', '需要的照護內容（可複選）', 'checkbox', {
        options: ['移動協助（含移位）', '進食協助', '沐浴協助', '如廁協助（廁所、尿布更換等）', '陪伴／提醒', '不需要'],
        allowOtherOption: true,
        otherOptionLabel: '其他',
      }),
      field('support_details', '需要特別配合或照護的事項，以及所需支援內容的詳細說明', 'textarea'),
      field('medical_care_needed', '是否需要由護理師等醫療資格者介入的醫療管理？', 'radio', {
        options: ['有（需要）', '無（不需要）'],
        allowOtherOption: true,
        otherOptionLabel: '其他',
      }),
      field('medical_care_details', '具體需要的醫療管理內容（可複選）', 'checkbox', {
        options: ['抽痰', '氧氣', '用藥管理', '褥瘡照護', '導尿／導管管理', '管灌營養', '不需要'],
        allowOtherOption: true,
        otherOptionLabel: '其他',
      }),
      field('flight_status', '機票狀態', 'radio', {
        options: ['已確認並購買', '評估中', '之後再考慮', '不需要安排機票'],
      }),
      field('outbound_departure_point', '去程出發地（最近車站／機場）', 'text'),
      field('outbound_arrival_point', '去程抵達地（車站／機場）', 'text'),
      field('outbound_arrival_time', '去程抵達時間', 'time'),
      field('return_departure_point', '回程出發地（車站／機場）', 'text'),
      field('return_departure_time', '回程出發時間', 'time'),
      field('trip_wishes', '想做的事情／想去的地方等具體需求', 'textarea'),
      field('additional_notes', '其他與此次旅行相關、希望先行告知的事項', 'textarea'),
      field('contact_consent', '基於上述內容，您是否同意我們就旅遊提案與安排與您聯繫？', 'radio', {
        options: ['同意', '不同意'],
      }),
    ],
  },
];

async function fetchApi(pathname, options = {}) {
  const headers = {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_URL}${pathname}`, {
    ...options,
    headers,
  });

  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(`${pathname} failed: ${json.error || response.statusText}`);
  }
  return json.data;
}

async function upsertForm(payload) {
  const forms = await fetchApi('/api/forms');
  const existing = forms.find((form) => form.name === payload.name);

  if (existing) {
    const updated = await fetchApi(`/api/forms/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    return { action: 'updated', form: updated };
  }

  const created = await fetchApi('/api/forms', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return { action: 'created', form: created };
}

async function main() {
  console.log(`API URL: ${API_URL}`);

  for (const form of localizedForms) {
    const payload = {
      name: form.name,
      description: form.description,
      fields: form.fields,
      saveToMetadata: true,
    };

    const result = await upsertForm(payload);
    const publicUrl = `https://liffform-studio.pages.dev/public-form?id=${result.form.id}`;
    console.log(`${result.action.toUpperCase()}: ${result.form.name}`);
    console.log(`  id: ${result.form.id}`);
    console.log(`  public: ${publicUrl}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
