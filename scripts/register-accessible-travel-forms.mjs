import crypto from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';

dns.setDefaultResultOrder('ipv4first');

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

const shouldEmitSql = process.argv.includes('--sql');
const shouldEmitJson = process.argv.includes('--json');

if (!API_KEY && !shouldEmitSql && !shouldEmitJson) {
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

function visibleWhen(fieldName, operator, value) {
  return {
    visibleWhen: {
      field: fieldName,
      operator,
      value,
    },
  };
}

const supportVisible = visibleWhen('support_people_count', 'greater_than', 0);
function wheelchairVisible(noWheelchairValue) {
  return visibleWhen('wheelchair_usage', 'not_equals', noWheelchairValue);
}

const wheelchairRequiredWhenVisibleFieldNames = new Set([
  'vehicle_boarding_preference',
  'wheelchair_manufacturer',
  'wheelchair_model',
  'wheelchair_width_cm',
  'wheelchair_depth_cm',
  'wheelchair_height_cm',
  'wheelchair_weight_kg',
  'wheelchair_foldable',
]);

function isRequiredWhenVisible(fieldName) {
  return wheelchairRequiredWhenVisibleFieldNames.has(fieldName);
}

const ACCESSIBLE_TRAVEL_TRANSLATION_GROUP_ID = '5a9ad125-9f3c-4a7d-b3fe-22f6cb430daa';
const ACCESSIBLE_TRAVEL_FORM_IDS = {
  ja: ACCESSIBLE_TRAVEL_TRANSLATION_GROUP_ID,
  en: 'fdbc9106-9b21-43ac-b840-52d741242a56',
  nl: 'bb8dfeb9-efbd-4c89-8ab4-74d7d26c32ca',
  ko: 'cf538373-a378-42a3-9620-35d5b3985214',
  'zh-TW': '7d7c9b75-5a6b-4bc7-9811-90b78377eaeb',
};

const flexibleTravelDateText = {
  ja: {
    startLabel: '旅行開始日または時期',
    endLabel: '旅行終了日または時期',
    helperText: '日付が未定の場合は「2月頃」「2026年春」「2月中旬〜下旬」などでも構いません。',
    startPlaceholder: '例：2026/2/10、2月頃、2026年春',
    endPlaceholder: '例：2026/2/17、2月下旬、未定',
  },
  en: {
    startLabel: 'Travel start date or approximate timing',
    endLabel: 'Travel end date or approximate timing',
    helperText: 'If exact dates are not decided yet, approximate timing such as "around February", "spring 2026", or "mid to late February" is fine.',
    startPlaceholder: 'e.g. Feb 10, 2026 / around February / spring 2026',
    endPlaceholder: 'e.g. Feb 17, 2026 / late February / undecided',
  },
  nl: {
    startLabel: 'Startdatum of geschatte reisperiode',
    endLabel: 'Einddatum of geschatte reisperiode',
    helperText: 'Als de exacte datum nog niet vaststaat, mag u ook iets invullen zoals "rond februari", "voorjaar 2026" of "midden tot eind februari".',
    startPlaceholder: 'bijv. 10 februari 2026 / rond februari / voorjaar 2026',
    endPlaceholder: 'bijv. 17 februari 2026 / eind februari / nog niet bekend',
  },
  ko: {
    startLabel: '여행 시작일 또는 대략적인 시기',
    endLabel: '여행 종료일 또는 대략적인 시기',
    helperText: '정확한 날짜가 아직 정해지지 않았다면 “2월경”, “2026년 봄”, “2월 중순~하순”처럼 적어 주셔도 됩니다.',
    startPlaceholder: '예: 2026/2/10, 2월경, 2026년 봄',
    endPlaceholder: '예: 2026/2/17, 2월 하순, 미정',
  },
  'zh-TW': {
    startLabel: '旅行開始日期或大約時期',
    endLabel: '旅行結束日期或大約時期',
    helperText: '若確切日期尚未決定，也可以填寫「2月左右」、「2026年春季」、「2月中下旬」等大約時期。',
    startPlaceholder: '例：2026/2/10、2月左右、2026年春季',
    endPlaceholder: '例：2026/2/17、2月下旬、尚未決定',
  },
};

function travelDateField(locale, name) {
  const copy = flexibleTravelDateText[locale] || flexibleTravelDateText.en;
  const isEnd = name === 'travel_end_date';
  return field(name, isEnd ? copy.endLabel : copy.startLabel, 'text', {
    helperText: copy.helperText,
    placeholder: isEnd ? copy.endPlaceholder : copy.startPlaceholder,
  });
}

function normalizePublicFields(fields) {
  return fields.map((rawField) => {
    const { visibleWhen, ...field } = rawField;
    if (visibleWhen) {
      field.required = isRequiredWhenVisible(field.name);
    }
    return visibleWhen ? { ...field, visibleWhen } : field;
  });
}

const localizedForms = [
  {
    locale: 'ja',
    name: 'バリアフリー・介助旅行ヒアリングフォーム',
    description: '最適な旅行プランをご提案するため、ご相談内容の詳細を確認させていただきます。医療的ケアや介助が必要な場合は詳しくご記入ください。',
    fields: [
      field('representative_name', '代表者氏名', 'text'),
      field('email', 'メールアドレス', 'email'),
      field('phone_number', '電話番号', 'tel'),
      field('preferred_language', '希望言語', 'radio', {
        options: ['日本語', 'English', 'Nederlands', '繁體中文', '한국어'],
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      }),
      travelDateField('ja', 'travel_start_date'),
      travelDateField('ja', 'travel_end_date'),
      field('destination', '滞在予定場所（国/地域、または具体的な場所）', 'textarea'),
      field('home_country_region', 'ご出身/お住まいの国・地域', 'text'),
      field('total_travelers', '旅行に参加する合計人数（代表者含む）', 'number'),
      field('max_budget', 'MAXご予算（航空券を除く、旅行全体で）', 'radio', {
        required: false,
        options: ['10万円未満', '10〜30万円', '30〜50万円', '50〜70万円', '70〜100万円', '100〜150万円', '150〜200万円', '200万円以上'],
      }),
      field('party_breakdown', '参加者構成（ご年齢／関係性）', 'textarea', {
        required: false,
        helperText: '例：本人(50代)、配偶者(50代)',
      }),
      field('support_people_count', 'サポートが必要な方は何名ですか？', 'number'),
      field('supported_traveler_gender', 'サポートが必要な方の性別', 'radio', {
        required: false,
        options: ['男性', '女性'],
        allowOtherOption: true,
        otherOptionLabel: 'その他',
        ...supportVisible,
      }),
      field('supported_traveler_height_cm', 'サポートが必要な方の身長（cm）', 'number', {
        required: false,
        ...supportVisible,
      }),
      field('supported_traveler_weight_kg', 'サポートが必要な方の体重（kg）', 'number', {
        required: false,
        ...supportVisible,
      }),
      field('meal_preferences', '朝食・夕食についてのご希望', 'checkbox', {
        required: false,
        options: ['朝食付きを希望', '2食付きを希望', '食事はすべて手配不要', '食事内容（アレルギー、特別食など）に配慮が必要'],
      }),
      field('room_requests', 'お部屋に対するご要望（複数選択可）', 'checkbox', {
        required: false,
        options: ['バリアフリールーム', 'ウォークインシャワー/シャワーブース', 'ツインベッド', 'キングサイズベッド', 'コネクティングルーム', '同フロアを希望', 'ベッド低めを希望', '介護用/電動ベッド', '貸切風呂', '個別食/個室食', '手すり付きのシャワー、トイレ'],
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      }),
      field('hotel_transfer_required', 'ホテル⇔空港やホテル⇄駅の送迎は必要ですか？', 'radio', {
        required: false,
        options: ['必要', '不要'],
      }),
      field('sightseeing_taxi_required', '観光タクシー（チャーター車両）は必要ですか？', 'radio', {
        required: false,
        options: ['必要', '不要'],
      }),
      field('guide_required', '観光ガイドは必要ですか？（介助者とは異なります）', 'radio', {
        required: false,
        options: ['必要', '不要'],
      }),
      field('caregiver_or_nurse_required', '国家資格保有の旅行専門介護士や看護師のご用意は必要ですか？', 'radio', {
        required: false,
        options: ['必要', '不要'],
        ...supportVisible,
      }),
      field('transportation_modes', '滞在中に主に利用予定の交通手段（複数選択可）', 'checkbox', {
        required: false,
        options: ['新幹線・長距離列車', '電車・地下鉄', 'タクシー', 'レンタカー（自力運転）'],
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      }),
      field('wheelchair_usage', '観光中に車椅子を使用しますか？', 'radio', {
        options: ['手動車椅子を使用', '電動車椅子を使用', 'シニアカー/モビリティスクーターを使用', '現地レンタル希望', '使用しない'],
      }),
      field('vehicle_boarding_preference', '車両利用時のご希望（タクシー、送迎車など）', 'radio', {
        required: false,
        options: ['車椅子のまま乗車（リフト付き車両など）', '車椅子を折りたたんで乗車（一般車両）', '車両利用/車椅子利用の予定なし'],
        ...wheelchairVisible('使用しない'),
      }),
      field('suitcase_count', '予想されるスーツケースの個数', 'number', {
        required: false,
      }),
      field('wheelchair_manufacturer', '車椅子メーカー', 'text', {
        placeholder: '例: WHILL / Permobil / Quickie',
        ...wheelchairVisible('使用しない'),
      }),
      field('wheelchair_model', '車椅子モデル・型番', 'text', {
        placeholder: '例: Model C2',
        ...wheelchairVisible('使用しない'),
      }),
      field('wheelchair_width_cm', '（車椅子を使用する場合）車椅子の横幅（最大値 cm）', 'number', {
        ...wheelchairVisible('使用しない'),
      }),
      field('wheelchair_depth_cm', '（車椅子を使用する場合）車椅子の奥行き（最大値 cm）', 'number', {
        ...wheelchairVisible('使用しない'),
      }),
      field('wheelchair_height_cm', '（車椅子を使用する場合）車椅子の高さ（最大値 cm）', 'number', {
        ...wheelchairVisible('使用しない'),
      }),
      field('wheelchair_weight_kg', '（車椅子を使用する場合）車椅子の重さ（kg）', 'number', {
        ...wheelchairVisible('使用しない'),
      }),
      field('wheelchair_foldable', '車椅子は折りたたみ可能ですか？', 'radio', {
        options: ['はい', 'いいえ', '不明'],
        ...wheelchairVisible('使用しない'),
      }),
      field('wheelchair_battery_type', '電動車椅子/シニアカーの場合: バッテリー種別', 'radio', {
        required: false,
        options: ['リチウムイオン', '乾電池', '湿式', '不明', '該当なし'],
        ...wheelchairVisible('使用しない'),
      }),
      field('wheelchair_battery_capacity', '電動車椅子/シニアカーの場合: バッテリー容量（Wh / Ah / V）', 'text', {
        required: false,
        placeholder: '例: 280Wh / 24V 12Ah',
        ...wheelchairVisible('使用しない'),
      }),
      field('wheelchair_battery_removable', '電動車椅子/シニアカーの場合: バッテリーは取り外せますか？', 'radio', {
        required: false,
        options: ['はい', 'いいえ', '不明', '該当なし'],
        ...wheelchairVisible('使用しない'),
      }),
      field('equipment_rental_needs', '滞在中に福祉用具レンタルのご希望はありますか？（複数選択可）', 'checkbox', {
        required: false,
        options: ['手動車椅子', '電動車椅子', 'リフト', 'シャワーチェア・バスボード', '介護用ベッド（特殊寝台）', '特になし'],
        allowOtherOption: true,
        otherOptionLabel: 'その他',
        ...supportVisible,
      }),
      field('assistance_needs', '必要な介助内容（複数選択可）', 'checkbox', {
        required: false,
        options: ['移動介助（移乗含む）', '食事介助', '入浴介助', '排泄介助（トイレ、おむつ交換など）', '見守り・声かけ', '特になし'],
        allowOtherOption: true,
        otherOptionLabel: 'その他',
        ...supportVisible,
      }),
      field('support_details', '配慮や介護が必要なこと、必要なサポート内容の詳細', 'textarea', {
        ...supportVisible,
      }),
      field('medical_care_needed', '医学的管理（看護師など医療資格者の介在）の必要性', 'radio', {
        options: ['有（必要）', '無（不要）'],
        allowOtherOption: true,
        otherOptionLabel: 'その他',
        ...supportVisible,
      }),
      field('medical_care_details', '医学的管理の具体的な内容（複数選択可）', 'checkbox', {
        required: false,
        options: ['吸引', '酸素', '服薬管理', '褥瘡ケア', '導尿/カテーテル管理', '経管栄養', '特になし'],
        allowOtherOption: true,
        otherOptionLabel: 'その他',
        visibleWhen: {
          field: 'medical_care_needed',
          operator: 'equals',
          value: '有（必要）',
        },
      }),
      field('flight_status', '航空券について', 'radio', {
        options: ['確定＆購入済', '検討中', 'これから検討', '特に手配の必要なし'],
      }),
      field('outbound_departure_point', '行きの出発地点(最寄駅/最寄り空港)', 'text', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: '特に手配の必要なし',
        },
      }),
      field('outbound_arrival_point', '行きの到着場所（駅名/空港名）', 'text', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: '特に手配の必要なし',
        },
      }),
      field('outbound_arrival_time', '行きの到着時刻', 'time', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: '特に手配の必要なし',
        },
      }),
      field('return_departure_point', '帰りの出発場所（駅名/空港名）', 'text', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: '特に手配の必要なし',
        },
      }),
      field('return_departure_time', '帰りの出発時刻', 'time', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: '特に手配の必要なし',
        },
      }),
      field('trip_wishes', 'やりたいこと / 行きたいところなど、具体的な希望内容', 'textarea'),
      field('additional_notes', 'その他、旅行に関して共有しておきたい事項', 'textarea', {
        required: false,
      }),
      field('contact_consent', '上記内容をもとに、旅行提案・手配のために当社から連絡を受けることに同意します。', 'radio', {
        options: ['同意する', '同意しない'],
      }),
    ],
  },
  {
    locale: 'en',
    name: 'Accessible & Assisted Travel Consultation Form',
    description: 'To propose the most suitable travel plan, we would like to understand your request in detail. If medical care or caregiving support is needed, please provide as much information as possible.',
    fields: [
      field('representative_name', 'Representative name', 'text'),
      field('email', 'Email address', 'email'),
      field('phone_number', 'Phone number', 'tel'),
      field('preferred_language', 'Preferred language', 'radio', {
        options: ['Japanese', 'English', 'Dutch', 'Traditional Chinese', 'Korean'],
        allowOtherOption: true,
        otherOptionLabel: 'Other',
      }),
      travelDateField('en', 'travel_start_date'),
      travelDateField('en', 'travel_end_date'),
      field('destination', 'Destination(s) planned for your stay (country/region or specific places)', 'textarea'),
      field('home_country_region', 'Country / region of residence or origin', 'text'),
      field('total_travelers', 'Total number of travelers (including the representative)', 'number'),
      field('max_budget', 'Maximum budget (excluding airfare, total for the whole trip)', 'radio', {
        required: false,
        options: ['Under JPY 100,000', 'JPY 100,000 - 300,000', 'JPY 300,000 - 500,000', 'JPY 500,000 - 700,000', 'JPY 700,000 - 1,000,000', 'JPY 1,000,000 - 1,500,000', 'JPY 1,500,000 - 2,000,000', 'Over JPY 2,000,000'],
      }),
      field('party_breakdown', 'Travel party breakdown (age / relationship)', 'textarea', {
        required: false,
        helperText: 'Example: self (50s), spouse (50s)',
      }),
      field('support_people_count', 'How many travelers require support?', 'number'),
      field('supported_traveler_gender', 'Gender of the traveler who requires support', 'radio', {
        required: false,
        options: ['Male', 'Female'],
        allowOtherOption: true,
        otherOptionLabel: 'Other',
        ...supportVisible,
      }),
      field('supported_traveler_height_cm', 'Height of the traveler who requires support (cm)', 'number', {
        required: false,
        ...supportVisible,
      }),
      field('supported_traveler_weight_kg', 'Weight of the traveler who requires support (kg)', 'number', {
        required: false,
        ...supportVisible,
      }),
      field('meal_preferences', 'Meal preferences (breakfast / dinner)', 'checkbox', {
        required: false,
        options: ['Breakfast included', 'Breakfast and dinner included', 'No meal arrangements needed', 'Dietary accommodations required (allergies, special meals, etc.)'],
      }),
      field('room_requests', 'Room requests (multiple answers allowed)', 'checkbox', {
        required: false,
        options: ['Accessible room', 'Walk-in shower / shower booth', 'Twin beds', 'King-size bed', 'Connecting rooms', 'Same floor requested', 'Lower bed height requested', 'Care / electric bed', 'Private bath', 'Private or separate dining', 'Grab bars in shower / toilet'],
        allowOtherOption: true,
        otherOptionLabel: 'Other',
      }),
      field('hotel_transfer_required', 'Do you need transfers between the hotel and the airport / station?', 'radio', {
        required: false,
        options: ['Yes', 'No'],
      }),
      field('sightseeing_taxi_required', 'Do you need a sightseeing taxi / charter vehicle?', 'radio', {
        required: false,
        options: ['Yes', 'No'],
      }),
      field('guide_required', 'Do you need a sightseeing guide? (Different from a caregiver)', 'radio', {
        required: false,
        options: ['Yes', 'No'],
      }),
      field('caregiver_or_nurse_required', 'Do you need a travel-specialist caregiver or nurse with a national qualification?', 'radio', {
        required: false,
        options: ['Yes', 'No'],
        ...supportVisible,
      }),
      field('transportation_modes', 'Main transportation modes you expect to use during the stay (multiple answers allowed)', 'checkbox', {
        required: false,
        options: ['Shinkansen / long-distance rail', 'Train / subway', 'Taxi', 'Rental car (self-driving)'],
        allowOtherOption: true,
        otherOptionLabel: 'Other',
      }),
      field('wheelchair_usage', 'Will a wheelchair be used during sightseeing?', 'radio', {
        options: ['Manual wheelchair', 'Power wheelchair', 'Mobility scooter', 'Local rental requested', 'No wheelchair'],
      }),
      field('vehicle_boarding_preference', 'Vehicle boarding preference (taxi, transfer vehicle, etc.)', 'radio', {
        required: false,
        options: ['Ride while staying in the wheelchair (lift-equipped vehicle, etc.)', 'Fold the wheelchair and ride in a standard vehicle', 'No vehicle / wheelchair transport planned'],
        ...wheelchairVisible('No wheelchair'),
      }),
      field('suitcase_count', 'Estimated number of suitcases', 'number', {
        required: false,
      }),
      field('wheelchair_manufacturer', 'Wheelchair manufacturer', 'text', {
        placeholder: 'e.g. WHILL / Permobil / Quickie',
        ...wheelchairVisible('No wheelchair'),
      }),
      field('wheelchair_model', 'Wheelchair model', 'text', {
        placeholder: 'e.g. Model C2',
        ...wheelchairVisible('No wheelchair'),
      }),
      field('wheelchair_width_cm', 'If using a wheelchair: width (maximum, cm)', 'number', {
        ...wheelchairVisible('No wheelchair'),
      }),
      field('wheelchair_depth_cm', 'If using a wheelchair: depth / length (maximum, cm)', 'number', {
        ...wheelchairVisible('No wheelchair'),
      }),
      field('wheelchair_height_cm', 'If using a wheelchair: height (maximum, cm)', 'number', {
        ...wheelchairVisible('No wheelchair'),
      }),
      field('wheelchair_weight_kg', 'If using a wheelchair: weight (kg)', 'number', {
        ...wheelchairVisible('No wheelchair'),
      }),
      field('wheelchair_foldable', 'Can the wheelchair be folded?', 'radio', {
        options: ['Yes', 'No', 'Unknown'],
        ...wheelchairVisible('No wheelchair'),
      }),
      field('wheelchair_battery_type', 'For power wheelchairs / scooters: battery type', 'radio', {
        required: false,
        options: ['Lithium-ion', 'Dry cell', 'Wet cell', 'Unknown', 'Not applicable'],
        ...wheelchairVisible('No wheelchair'),
      }),
      field('wheelchair_battery_capacity', 'For power wheelchairs / scooters: battery capacity (Wh / Ah / V)', 'text', {
        required: false,
        placeholder: 'e.g. 280Wh / 24V 12Ah',
        ...wheelchairVisible('No wheelchair'),
      }),
      field('wheelchair_battery_removable', 'For power wheelchairs / scooters: is the battery removable?', 'radio', {
        required: false,
        options: ['Yes', 'No', 'Unknown', 'Not applicable'],
        ...wheelchairVisible('No wheelchair'),
      }),
      field('equipment_rental_needs', 'Would you like to rent welfare / accessibility equipment during your stay? (multiple answers allowed)', 'checkbox', {
        required: false,
        options: ['Manual wheelchair', 'Power wheelchair', 'Lift', 'Shower chair / bath board', 'Nursing bed / adjustable care bed', 'None'],
        allowOtherOption: true,
        otherOptionLabel: 'Other',
        ...supportVisible,
      }),
      field('assistance_needs', 'Care / assistance needed (multiple answers allowed)', 'checkbox', {
        required: false,
        options: ['Mobility assistance (including transfers)', 'Meal assistance', 'Bathing assistance', 'Toileting assistance (toilet use, diaper change, etc.)', 'Supervision / verbal prompting', 'None'],
        allowOtherOption: true,
        otherOptionLabel: 'Other',
        ...supportVisible,
      }),
      field('support_details', 'Details of the care considerations or support required', 'textarea', {
        ...supportVisible,
      }),
      field('medical_care_needed', 'Is medical management by a licensed professional (such as a nurse) required?', 'radio', {
        options: ['Yes', 'No'],
        allowOtherOption: true,
        otherOptionLabel: 'Other',
        ...supportVisible,
      }),
      field('medical_care_details', 'Specific medical care required (multiple answers allowed)', 'checkbox', {
        required: false,
        options: ['Suctioning', 'Oxygen', 'Medication management', 'Pressure sore care', 'Catheter / urinary management', 'Tube feeding', 'None'],
        allowOtherOption: true,
        otherOptionLabel: 'Other',
        visibleWhen: {
          field: 'medical_care_needed',
          operator: 'equals',
          value: 'Yes',
        },
      }),
      field('flight_status', 'Air ticket status', 'radio', {
        options: ['Already confirmed and purchased', 'Considering options', 'Will consider from now', 'No flight arrangements needed'],
      }),
      field('outbound_departure_point', 'Outbound departure point (nearest station / airport)', 'text', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: 'No flight arrangements needed',
        },
      }),
      field('outbound_arrival_point', 'Outbound arrival point (station / airport)', 'text', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: 'No flight arrangements needed',
        },
      }),
      field('outbound_arrival_time', 'Outbound arrival time', 'time', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: 'No flight arrangements needed',
        },
      }),
      field('return_departure_point', 'Return departure point (station / airport)', 'text', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: 'No flight arrangements needed',
        },
      }),
      field('return_departure_time', 'Return departure time', 'time', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: 'No flight arrangements needed',
        },
      }),
      field('trip_wishes', 'What would you like to do or where would you like to go? Please share concrete wishes.', 'textarea'),
      field('additional_notes', 'Anything else we should know about the trip', 'textarea', {
        required: false,
      }),
      field('contact_consent', 'Based on the information above, do you agree to be contacted by us for travel planning and arrangements?', 'radio', {
        options: ['I agree', 'I do not agree'],
      }),
    ],
  },
  {
    locale: 'nl',
    name: 'Intakeformulier voor toegankelijke en begeleide reizen',
    description: 'Om het best passende reisplan voor te stellen, willen we uw aanvraag goed begrijpen. Als medische zorg of begeleidingsondersteuning nodig is, vul dan zo veel mogelijk details in.',
    fields: [
      field('representative_name', 'Naam contactpersoon', 'text'),
      field('email', 'E-mailadres', 'email'),
      field('phone_number', 'Telefoonnummer', 'tel'),
      field('preferred_language', 'Voorkeurstaal', 'radio', {
        options: ['Japans', 'Engels', 'Nederlands', 'Traditioneel Chinees', 'Koreaans'],
        allowOtherOption: true,
        otherOptionLabel: 'Anders',
      }),
      travelDateField('nl', 'travel_start_date'),
      travelDateField('nl', 'travel_end_date'),
      field('destination', 'Geplande bestemming(en) tijdens uw verblijf (land/regio of specifieke plaatsen)', 'textarea'),
      field('home_country_region', 'Land/regio van woonplaats of herkomst', 'text'),
      field('total_travelers', 'Totaal aantal reizigers (inclusief de contactpersoon)', 'number'),
      field('max_budget', 'Maximaal budget (exclusief vliegtickets, voor de hele reis)', 'radio', {
        required: false,
        options: ['Minder dan JPY 100.000', 'JPY 100.000 - 300.000', 'JPY 300.000 - 500.000', 'JPY 500.000 - 700.000', 'JPY 700.000 - 1.000.000', 'JPY 1.000.000 - 1.500.000', 'JPY 1.500.000 - 2.000.000', 'Meer dan JPY 2.000.000'],
      }),
      field('party_breakdown', 'Samenstelling van het reisgezelschap (leeftijd / relatie)', 'textarea', {
        required: false,
        helperText: 'Voorbeeld: ikzelf (50), partner (50)',
      }),
      field('support_people_count', 'Hoeveel reizigers hebben ondersteuning nodig?', 'number'),
      field('supported_traveler_gender', 'Geslacht van de reiziger die ondersteuning nodig heeft', 'radio', {
        required: false,
        options: ['Man', 'Vrouw'],
        allowOtherOption: true,
        otherOptionLabel: 'Anders',
        ...supportVisible,
      }),
      field('supported_traveler_height_cm', 'Lengte van de reiziger die ondersteuning nodig heeft (cm)', 'number', {
        required: false,
        ...supportVisible,
      }),
      field('supported_traveler_weight_kg', 'Gewicht van de reiziger die ondersteuning nodig heeft (kg)', 'number', {
        required: false,
        ...supportVisible,
      }),
      field('meal_preferences', 'Maaltijdwensen (ontbijt / diner)', 'checkbox', {
        required: false,
        options: ['Ontbijt inbegrepen gewenst', 'Ontbijt en diner inbegrepen gewenst', 'Geen maaltijdregelingen nodig', 'Dieetaanpassingen nodig (allergieën, speciale maaltijden, enz.)'],
      }),
      field('room_requests', 'Kamerwensen (meerdere antwoorden mogelijk)', 'checkbox', {
        required: false,
        options: ['Toegankelijke kamer', 'Inloopdouche / douchecabine', 'Twee aparte bedden', 'Kingsize bed', 'Verbindingskamers', 'Zelfde verdieping gewenst', 'Lager bed gewenst', 'Zorgbed / elektrisch bed', 'Privébad', 'Privé of aparte eetruimte', 'Steunbeugels in douche / toilet'],
        allowOtherOption: true,
        otherOptionLabel: 'Anders',
      }),
      field('hotel_transfer_required', 'Heeft u transfers nodig tussen hotel en luchthaven/station?', 'radio', {
        required: false,
        options: ['Ja', 'Nee'],
      }),
      field('sightseeing_taxi_required', 'Heeft u een sightseeing taxi / gecharterd voertuig nodig?', 'radio', {
        required: false,
        options: ['Ja', 'Nee'],
      }),
      field('guide_required', 'Heeft u een sightseeing gids nodig? (anders dan een zorgbegeleider)', 'radio', {
        required: false,
        options: ['Ja', 'Nee'],
      }),
      field('caregiver_or_nurse_required', 'Heeft u een reisgespecialiseerde zorgbegeleider of verpleegkundige met nationale kwalificatie nodig?', 'radio', {
        required: false,
        options: ['Ja', 'Nee'],
        ...supportVisible,
      }),
      field('transportation_modes', 'Vervoermiddelen die u vooral verwacht te gebruiken tijdens het verblijf (meerdere antwoorden mogelijk)', 'checkbox', {
        required: false,
        options: ['Shinkansen / langeafstandstrein', 'Trein / metro', 'Taxi', 'Huurauto (zelf rijden)'],
        allowOtherOption: true,
        otherOptionLabel: 'Anders',
      }),
      field('wheelchair_usage', 'Wordt er tijdens sightseeing een rolstoel gebruikt?', 'radio', {
        options: ['Handbewogen rolstoel', 'Elektrische rolstoel', 'Scootmobiel', 'Lokale huur gewenst', 'Geen rolstoel'],
      }),
      field('vehicle_boarding_preference', 'Voorkeur bij instappen in voertuigen (taxi, transferauto, enz.)', 'radio', {
        required: false,
        options: ['In de rolstoel blijven zitten (bijv. voertuig met lift)', 'Rolstoel opvouwen en in een standaard voertuig rijden', 'Geen voertuig-/rolstoelvervoer gepland'],
        ...wheelchairVisible('Geen rolstoel'),
      }),
      field('suitcase_count', 'Geschat aantal koffers', 'number', {
        required: false,
      }),
      field('wheelchair_manufacturer', 'Fabrikant van de rolstoel', 'text', {
        required: false,
        placeholder: 'bijv. WHILL / Permobil / Quickie',
        ...wheelchairVisible('Geen rolstoel'),
      }),
      field('wheelchair_model', 'Model van de rolstoel', 'text', {
        required: false,
        placeholder: 'bijv. Model C2',
        ...wheelchairVisible('Geen rolstoel'),
      }),
      field('wheelchair_width_cm', 'Bij rolstoelgebruik: breedte (maximum, cm)', 'number', {
        ...wheelchairVisible('Geen rolstoel'),
      }),
      field('wheelchair_depth_cm', 'Bij rolstoelgebruik: diepte / lengte (maximum, cm)', 'number', {
        ...wheelchairVisible('Geen rolstoel'),
      }),
      field('wheelchair_height_cm', 'Bij rolstoelgebruik: hoogte (maximum, cm)', 'number', {
        ...wheelchairVisible('Geen rolstoel'),
      }),
      field('wheelchair_weight_kg', 'Bij rolstoelgebruik: gewicht (kg)', 'number', {
        ...wheelchairVisible('Geen rolstoel'),
      }),
      field('wheelchair_foldable', 'Kan de rolstoel worden opgevouwen?', 'radio', {
        options: ['Ja', 'Nee', 'Onbekend'],
        ...wheelchairVisible('Geen rolstoel'),
      }),
      field('wheelchair_battery_type', 'Voor elektrische rolstoel / scootmobiel: batterijtype', 'radio', {
        required: false,
        options: ['Lithium-ion', 'Droge cel', 'Natte cel', 'Onbekend', 'Niet van toepassing'],
        ...wheelchairVisible('Geen rolstoel'),
      }),
      field('wheelchair_battery_capacity', 'Voor elektrische rolstoel / scootmobiel: batterijcapaciteit (Wh / Ah / V)', 'text', {
        required: false,
        placeholder: 'bijv. 280Wh / 24V 12Ah',
        ...wheelchairVisible('Geen rolstoel'),
      }),
      field('wheelchair_battery_removable', 'Voor elektrische rolstoel / scootmobiel: is de batterij uitneembaar?', 'radio', {
        required: false,
        options: ['Ja', 'Nee', 'Onbekend', 'Niet van toepassing'],
        ...wheelchairVisible('Geen rolstoel'),
      }),
      field('equipment_rental_needs', 'Wilt u tijdens uw verblijf welzijns-/toegankelijkheidshulpmiddelen huren? (meerdere antwoorden mogelijk)', 'checkbox', {
        required: false,
        options: ['Handbewogen rolstoel', 'Elektrische rolstoel', 'Lift', 'Douchestoel / badplank', 'Zorgbed / verstelbaar zorgbed', 'Geen'],
        allowOtherOption: true,
        otherOptionLabel: 'Anders',
        ...supportVisible,
      }),
      field('assistance_needs', 'Benodigde zorg / assistentie (meerdere antwoorden mogelijk)', 'checkbox', {
        required: false,
        options: ['Mobiliteitsassistentie (inclusief transfers)', 'Hulp bij maaltijden', 'Hulp bij baden/douchen', 'Toilethulp (toiletgebruik, verschonen, enz.)', 'Toezicht / verbale begeleiding', 'Geen'],
        allowOtherOption: true,
        otherOptionLabel: 'Anders',
        ...supportVisible,
      }),
      field('support_details', 'Details van aandachtspunten of benodigde ondersteuning', 'textarea', {
        ...supportVisible,
      }),
      field('medical_care_needed', 'Is medische begeleiding door een bevoegd professional (zoals een verpleegkundige) nodig?', 'radio', {
        options: ['Ja', 'Nee'],
        allowOtherOption: true,
        otherOptionLabel: 'Anders',
        ...supportVisible,
      }),
      field('medical_care_details', 'Specifieke medische zorg die nodig is (meerdere antwoorden mogelijk)', 'checkbox', {
        required: false,
        options: ['Uitzuigen', 'Zuurstof', 'Medicatiebeheer', 'Decubituszorg', 'Katheter-/urinebeheer', 'Sondevoeding', 'Geen'],
        allowOtherOption: true,
        otherOptionLabel: 'Anders',
        visibleWhen: {
          field: 'medical_care_needed',
          operator: 'equals',
          value: 'Ja',
        },
      }),
      field('flight_status', 'Status van vliegtickets', 'radio', {
        options: ['Al bevestigd en gekocht', 'Opties worden overwogen', 'Nog te overwegen', 'Geen vluchtregelingen nodig'],
      }),
      field('outbound_departure_point', 'Vertrekpunt heenreis (dichtstbijzijnde station / luchthaven)', 'text', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: 'Geen vluchtregelingen nodig',
        },
      }),
      field('outbound_arrival_point', 'Aankomstpunt heenreis (station / luchthaven)', 'text', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: 'Geen vluchtregelingen nodig',
        },
      }),
      field('outbound_arrival_time', 'Aankomsttijd heenreis', 'time', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: 'Geen vluchtregelingen nodig',
        },
      }),
      field('return_departure_point', 'Vertrekpunt terugreis (station / luchthaven)', 'text', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: 'Geen vluchtregelingen nodig',
        },
      }),
      field('return_departure_time', 'Vertrektijd terugreis', 'time', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: 'Geen vluchtregelingen nodig',
        },
      }),
      field('trip_wishes', 'Wat wilt u doen of waar wilt u naartoe? Deel concrete wensen.', 'textarea'),
      field('additional_notes', 'Overige informatie die we over de reis moeten weten', 'textarea', {
        required: false,
      }),
      field('contact_consent', 'Gaat u ermee akkoord dat wij op basis van bovenstaande informatie contact met u opnemen voor reisplanning en arrangementen?', 'radio', {
        options: ['Ik ga akkoord', 'Ik ga niet akkoord'],
      }),
    ],
  },
  {
    locale: 'ko',
    name: '무장애·돌봄 여행 상담 폼',
    description: '가장 적합한 여행 플랜을 제안드리기 위해 상담 내용을 자세히 확인하고자 합니다. 의료적 케어나 돌봄 지원이 필요한 경우 가능한 한 자세히 작성해 주세요.',
    fields: [
      field('representative_name', '대표자 성함', 'text'),
      field('email', '이메일 주소', 'email'),
      field('phone_number', '전화번호', 'tel'),
      field('preferred_language', '희망 언어', 'radio', {
        options: ['일본어', '영어', '네덜란드어', '번체 중국어', '한국어'],
        allowOtherOption: true,
        otherOptionLabel: '기타',
      }),
      travelDateField('ko', 'travel_start_date'),
      travelDateField('ko', 'travel_end_date'),
      field('destination', '체류 예정 지역(국가/지역 또는 구체적인 장소)', 'textarea'),
      field('home_country_region', '거주지 / 출신 국가·지역', 'text'),
      field('total_travelers', '여행 참가 총인원(대표자 포함)', 'number'),
      field('max_budget', '최대 예산(항공권 제외, 여행 전체 기준)', 'radio', {
        required: false,
        options: ['10만 엔 미만', '10만~30만 엔', '30만~50만 엔', '50만~70만 엔', '70만~100만 엔', '100만~150만 엔', '150만~200만 엔', '200만 엔 이상'],
      }),
      field('party_breakdown', '참가자 구성(연령 / 관계)', 'textarea', {
        required: false,
        helperText: '예: 본인(50대), 배우자(50대)',
      }),
      field('support_people_count', '지원이 필요한 분은 몇 명인가요?', 'number'),
      field('supported_traveler_gender', '지원이 필요한 분의 성별', 'radio', {
        required: false,
        options: ['남성', '여성'],
        allowOtherOption: true,
        otherOptionLabel: '기타',
        ...supportVisible,
      }),
      field('supported_traveler_height_cm', '지원이 필요한 분의 키(cm)', 'number', {
        required: false,
        ...supportVisible,
      }),
      field('supported_traveler_weight_kg', '지원이 필요한 분의 체중(kg)', 'number', {
        required: false,
        ...supportVisible,
      }),
      field('meal_preferences', '조식·석식 관련 희망 사항', 'checkbox', {
        required: false,
        options: ['조식 포함 희망', '조식+석식 포함 희망', '식사 수배 불필요', '알레르기·특별식 등 식사 배려 필요'],
      }),
      field('room_requests', '객실 관련 요청 사항(복수 선택 가능)', 'checkbox', {
        required: false,
        options: ['배리어프리 객실', '워크인 샤워 / 샤워부스', '트윈 베드', '킹사이즈 베드', '커넥팅 룸', '같은 층 희망', '낮은 침대 희망', '전동 / 케어 침대', '전세 욕실', '개별식 / 개별 식사 공간', '샤워실·화장실 손잡이'],
        allowOtherOption: true,
        otherOptionLabel: '기타',
      }),
      field('hotel_transfer_required', '호텔⇔공항 / 호텔⇄역 송영이 필요하신가요?', 'radio', {
        required: false,
        options: ['필요', '불필요'],
      }),
      field('sightseeing_taxi_required', '관광 택시(전세 차량)가 필요하신가요?', 'radio', {
        required: false,
        options: ['필요', '불필요'],
      }),
      field('guide_required', '관광 가이드가 필요하신가요? (돌봄 인력과는 별도)', 'radio', {
        required: false,
        options: ['필요', '불필요'],
      }),
      field('caregiver_or_nurse_required', '국가 자격을 가진 여행 전문 요양보호사 / 간호사가 필요하신가요?', 'radio', {
        required: false,
        options: ['필요', '불필요'],
        ...supportVisible,
      }),
      field('transportation_modes', '체류 중 주로 이용 예정인 교통수단(복수 선택 가능)', 'checkbox', {
        required: false,
        options: ['신칸센·장거리 열차', '전철·지하철', '택시', '렌터카(직접 운전)'],
        allowOtherOption: true,
        otherOptionLabel: '기타',
      }),
      field('wheelchair_usage', '관광 중 휠체어를 사용하시나요?', 'radio', {
        options: ['수동 휠체어 사용', '전동 휠체어 사용', '전동 스쿠터 사용', '현지 대여 희망', '사용하지 않음'],
      }),
      field('vehicle_boarding_preference', '차량 이용 시 희망 사항(택시, 송영차 등)', 'radio', {
        required: false,
        options: ['휠체어에 탄 채로 승차(리프트 차량 등)', '휠체어를 접어서 일반 차량에 승차', '차량 / 휠체어 이용 예정 없음'],
        ...wheelchairVisible('사용하지 않음'),
      }),
      field('suitcase_count', '예상되는 캐리어 개수', 'number', {
        required: false,
      }),
      field('wheelchair_manufacturer', '휠체어 제조사', 'text', {
        required: false,
        placeholder: '예: WHILL / Permobil / Quickie',
        ...wheelchairVisible('사용하지 않음'),
      }),
      field('wheelchair_model', '휠체어 모델명 / 형번', 'text', {
        required: false,
        placeholder: '예: Model C2',
        ...wheelchairVisible('사용하지 않음'),
      }),
      field('wheelchair_width_cm', '휠체어 사용 시 가로 폭(최대 cm)', 'number', {
        ...wheelchairVisible('사용하지 않음'),
      }),
      field('wheelchair_depth_cm', '휠체어 사용 시 깊이 / 길이(최대 cm)', 'number', {
        ...wheelchairVisible('사용하지 않음'),
      }),
      field('wheelchair_height_cm', '휠체어 사용 시 높이(최대 cm)', 'number', {
        ...wheelchairVisible('사용하지 않음'),
      }),
      field('wheelchair_weight_kg', '휠체어 사용 시 무게(kg)', 'number', {
        ...wheelchairVisible('사용하지 않음'),
      }),
      field('wheelchair_foldable', '휠체어를 접을 수 있나요?', 'radio', {
        options: ['예', '아니오', '모름'],
        ...wheelchairVisible('사용하지 않음'),
      }),
      field('wheelchair_battery_type', '전동 휠체어/전동 스쿠터의 경우: 배터리 종류', 'radio', {
        required: false,
        options: ['리튬 이온', '건식', '습식', '모름', '해당 없음'],
        ...wheelchairVisible('사용하지 않음'),
      }),
      field('wheelchair_battery_capacity', '전동 휠체어/전동 스쿠터의 경우: 배터리 용량(Wh / Ah / V)', 'text', {
        required: false,
        placeholder: '예: 280Wh / 24V 12Ah',
        ...wheelchairVisible('사용하지 않음'),
      }),
      field('wheelchair_battery_removable', '전동 휠체어/전동 스쿠터의 경우: 배터리를 분리할 수 있나요?', 'radio', {
        required: false,
        options: ['예', '아니오', '모름', '해당 없음'],
        ...wheelchairVisible('사용하지 않음'),
      }),
      field('equipment_rental_needs', '체류 중 복지용구 렌탈이 필요하신가요? (복수 선택 가능)', 'checkbox', {
        required: false,
        options: ['수동 휠체어', '전동 휠체어', '리프트', '샤워 의자 / 욕조 보드', '간호용 침대(특수 침대)', '없음'],
        allowOtherOption: true,
        otherOptionLabel: '기타',
        ...supportVisible,
      }),
      field('assistance_needs', '필요한 돌봄 내용(복수 선택 가능)', 'checkbox', {
        required: false,
        options: ['이동 보조(이승 포함)', '식사 보조', '목욕 보조', '배설 보조(화장실, 기저귀 교체 등)', '지켜보기 / 말 걸기', '없음'],
        allowOtherOption: true,
        otherOptionLabel: '기타',
        ...supportVisible,
      }),
      field('support_details', '배려가 필요한 사항, 필요한 지원 내용의 상세', 'textarea', {
        ...supportVisible,
      }),
      field('medical_care_needed', '간호사 등 의료 자격자의 개입이 필요한 의료적 관리가 있나요?', 'radio', {
        options: ['있음(필요)', '없음(불필요)'],
        allowOtherOption: true,
        otherOptionLabel: '기타',
        ...supportVisible,
      }),
      field('medical_care_details', '구체적으로 필요한 의료적 관리 내용(복수 선택 가능)', 'checkbox', {
        required: false,
        options: ['흡인', '산소', '복약 관리', '욕창 케어', '도뇨 / 카테터 관리', '경관영양', '없음'],
        allowOtherOption: true,
        otherOptionLabel: '기타',
        visibleWhen: {
          field: 'medical_care_needed',
          operator: 'equals',
          value: '있음(필요)',
        },
      }),
      field('flight_status', '항공권 상황', 'radio', {
        options: ['이미 확정 및 구매 완료', '검토 중', '지금부터 검토 예정', '항공권 수배 불필요'],
      }),
      field('outbound_departure_point', '가는 편 출발지(가까운 역 / 공항)', 'text', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: '항공권 수배 불필요',
        },
      }),
      field('outbound_arrival_point', '가는 편 도착지(역 / 공항)', 'text', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: '항공권 수배 불필요',
        },
      }),
      field('outbound_arrival_time', '가는 편 도착 시각', 'time', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: '항공권 수배 불필요',
        },
      }),
      field('return_departure_point', '오는 편 출발지(역 / 공항)', 'text', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: '항공권 수배 불필요',
        },
      }),
      field('return_departure_time', '오는 편 출발 시각', 'time', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: '항공권 수배 불필요',
        },
      }),
      field('trip_wishes', '하고 싶은 일 / 가고 싶은 장소 등 구체적인 희망 사항', 'textarea'),
      field('additional_notes', '그 밖에 여행 관련하여 공유해 두고 싶은 사항', 'textarea', {
        required: false,
      }),
      field('contact_consent', '위 내용을 바탕으로 여행 제안 및 수배를 위해 당사로부터 연락을 받는 것에 동의합니다.', 'radio', {
        options: ['동의합니다', '동의하지 않습니다'],
      }),
    ],
  },
  {
    locale: 'zh-TW',
    name: '無障礙／照護旅遊諮詢表',
    description: '為了向您提出最適合的旅遊方案，我們想先更詳細了解您的需求內容。若需要醫療照護或照顧支援，請盡可能詳盡填寫。',
    fields: [
      field('representative_name', '代表者姓名', 'text'),
      field('email', '電子郵件地址', 'email'),
      field('phone_number', '電話號碼', 'tel'),
      field('preferred_language', '希望使用的語言', 'radio', {
        options: ['日文', '英文', '荷蘭語', '繁體中文', '韓文'],
        allowOtherOption: true,
        otherOptionLabel: '其他',
      }),
      travelDateField('zh-TW', 'travel_start_date'),
      travelDateField('zh-TW', 'travel_end_date'),
      field('destination', '預計停留地（國家／地區或具體地點）', 'textarea'),
      field('home_country_region', '您的國家／地區（出生地或居住地）', 'text'),
      field('total_travelers', '參加旅行的總人數（含代表者）', 'number'),
      field('max_budget', '最高預算（不含機票，整趟旅程）', 'radio', {
        required: false,
        options: ['10萬日圓以下', '10萬～30萬日圓', '30萬～50萬日圓', '50萬～70萬日圓', '70萬～100萬日圓', '100萬～150萬日圓', '150萬～200萬日圓', '200萬日圓以上'],
      }),
      field('party_breakdown', '同行者組成（年齡／關係）', 'textarea', {
        required: false,
        helperText: '例：本人（50多歲）、配偶（50多歲）',
      }),
      field('support_people_count', '需要支援的人數有幾位？', 'number'),
      field('supported_traveler_gender', '需要支援者的性別', 'radio', {
        required: false,
        options: ['男性', '女性'],
        allowOtherOption: true,
        otherOptionLabel: '其他',
        ...supportVisible,
      }),
      field('supported_traveler_height_cm', '需要支援者的身高（cm）', 'number', {
        required: false,
        ...supportVisible,
      }),
      field('supported_traveler_weight_kg', '需要支援者的體重（kg）', 'number', {
        required: false,
        ...supportVisible,
      }),
      field('meal_preferences', '早餐／晚餐的需求', 'checkbox', {
        required: false,
        options: ['希望附早餐', '希望附早晚餐', '不需要安排餐食', '需要餐食上的配合（過敏、特殊餐等）'],
      }),
      field('room_requests', '房型需求（可複選）', 'checkbox', {
        required: false,
        options: ['無障礙客房', '步入式淋浴間／淋浴間', '雙床房', '特大床', '連通房', '希望安排同樓層', '希望較低床高', '照護床／電動床', '包場浴池', '個別餐／包廂用餐', '附扶手的淋浴／廁所'],
        allowOtherOption: true,
        otherOptionLabel: '其他',
      }),
      field('hotel_transfer_required', '是否需要飯店⇔機場或飯店⇄車站接送？', 'radio', {
        required: false,
        options: ['需要', '不需要'],
      }),
      field('sightseeing_taxi_required', '是否需要觀光計程車（包車）？', 'radio', {
        required: false,
        options: ['需要', '不需要'],
      }),
      field('guide_required', '是否需要觀光導遊？（與照護人員不同）', 'radio', {
        required: false,
        options: ['需要', '不需要'],
      }),
      field('caregiver_or_nurse_required', '是否需要具國家資格的旅遊專業照護員或護理師？', 'radio', {
        required: false,
        options: ['需要', '不需要'],
        ...supportVisible,
      }),
      field('transportation_modes', '停留期間預計主要使用的交通工具（可複選）', 'checkbox', {
        required: false,
        options: ['新幹線／長途列車', '電車／地鐵', '計程車', '租車（自行駕駛）'],
        allowOtherOption: true,
        otherOptionLabel: '其他',
      }),
      field('wheelchair_usage', '觀光途中是否會使用輪椅？', 'radio', {
        options: ['使用手動輪椅', '使用電動輪椅', '使用代步車/電動輔助車', '希望在當地租借', '不使用'],
      }),
      field('vehicle_boarding_preference', '搭乘車輛時的需求（計程車、接送車等）', 'radio', {
        required: false,
        options: ['維持坐在輪椅上搭乘（如升降設備車輛）', '將輪椅收折後搭乘一般車輛', '沒有搭車／使用輪椅的計畫'],
        ...wheelchairVisible('不使用'),
      }),
      field('suitcase_count', '預計行李箱數量', 'number', {
        required: false,
      }),
      field('wheelchair_manufacturer', '輪椅製造商', 'text', {
        required: false,
        placeholder: '例：WHILL / Permobil / Quickie',
        ...wheelchairVisible('不使用'),
      }),
      field('wheelchair_model', '輪椅型號', 'text', {
        required: false,
        placeholder: '例：Model C2',
        ...wheelchairVisible('不使用'),
      }),
      field('wheelchair_width_cm', '若使用輪椅：輪椅寬度（最大值 cm）', 'number', {
        ...wheelchairVisible('不使用'),
      }),
      field('wheelchair_depth_cm', '若使用輪椅：輪椅深度／長度（最大值 cm）', 'number', {
        ...wheelchairVisible('不使用'),
      }),
      field('wheelchair_height_cm', '若使用輪椅：輪椅高度（最大值 cm）', 'number', {
        ...wheelchairVisible('不使用'),
      }),
      field('wheelchair_weight_kg', '若使用輪椅：輪椅重量（kg）', 'number', {
        ...wheelchairVisible('不使用'),
      }),
      field('wheelchair_foldable', '輪椅是否可以折疊？', 'radio', {
        options: ['可以', '不可以', '不確定'],
        ...wheelchairVisible('不使用'),
      }),
      field('wheelchair_battery_type', '若使用電動輪椅/代步車：電池種類', 'radio', {
        required: false,
        options: ['鋰電池', '乾電池', '濕式電池', '不確定', '不適用'],
        ...wheelchairVisible('不使用'),
      }),
      field('wheelchair_battery_capacity', '若使用電動輪椅/代步車：電池容量（Wh / Ah / V）', 'text', {
        required: false,
        placeholder: '例：280Wh / 24V 12Ah',
        ...wheelchairVisible('不使用'),
      }),
      field('wheelchair_battery_removable', '若使用電動輪椅/代步車：電池是否可以拆卸？', 'radio', {
        required: false,
        options: ['可以', '不可以', '不確定', '不適用'],
        ...wheelchairVisible('不使用'),
      }),
      field('equipment_rental_needs', '停留期間是否需要租借福祉輔具？（可複選）', 'checkbox', {
        required: false,
        options: ['手動輪椅', '電動輪椅', '升降設備', '淋浴椅／浴板', '照護床（特殊病床）', '不需要'],
        allowOtherOption: true,
        otherOptionLabel: '其他',
        ...supportVisible,
      }),
      field('assistance_needs', '需要的照護內容（可複選）', 'checkbox', {
        required: false,
        options: ['移動協助（含移位）', '進食協助', '沐浴協助', '如廁協助（廁所、尿布更換等）', '陪伴／提醒', '不需要'],
        allowOtherOption: true,
        otherOptionLabel: '其他',
        ...supportVisible,
      }),
      field('support_details', '需要特別配合或照護的事項，以及所需支援內容的詳細說明', 'textarea', {
        ...supportVisible,
      }),
      field('medical_care_needed', '是否需要由護理師等醫療資格者介入的醫療管理？', 'radio', {
        options: ['有（需要）', '無（不需要）'],
        allowOtherOption: true,
        otherOptionLabel: '其他',
        ...supportVisible,
      }),
      field('medical_care_details', '具體需要的醫療管理內容（可複選）', 'checkbox', {
        required: false,
        options: ['抽痰', '氧氣', '用藥管理', '褥瘡照護', '導尿／導管管理', '管灌營養', '不需要'],
        allowOtherOption: true,
        otherOptionLabel: '其他',
        visibleWhen: {
          field: 'medical_care_needed',
          operator: 'equals',
          value: '有（需要）',
        },
      }),
      field('flight_status', '機票狀態', 'radio', {
        options: ['已確認並購買', '評估中', '之後再考慮', '不需要安排機票'],
      }),
      field('outbound_departure_point', '去程出發地（最近車站／機場）', 'text', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: '不需要安排機票',
        },
      }),
      field('outbound_arrival_point', '去程抵達地（車站／機場）', 'text', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: '不需要安排機票',
        },
      }),
      field('outbound_arrival_time', '去程抵達時間', 'time', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: '不需要安排機票',
        },
      }),
      field('return_departure_point', '回程出發地（車站／機場）', 'text', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: '不需要安排機票',
        },
      }),
      field('return_departure_time', '回程出發時間', 'time', {
        required: false,
        visibleWhen: {
          field: 'flight_status',
          operator: 'not_equals',
          value: '不需要安排機票',
        },
      }),
      field('trip_wishes', '想做的事情／想去的地方等具體需求', 'textarea'),
      field('additional_notes', '其他與此次旅行相關、希望先行告知的事項', 'textarea', {
        required: false,
      }),
      field('contact_consent', '基於上述內容，您是否同意我們就旅遊提案與安排與您聯繫？', 'radio', {
        options: ['同意', '不同意'],
      }),
    ],
  },
];

const agencyFormCopy = {
  ja: {
    name: '代理店向け バリアフリー・介助旅行ヒアリングシート',
    description: '代理店様がエンドのお客様から伺った内容をもとに、当社がバリアフリー要件と旅行ニーズに沿ったプランをご提案するためのシートです。御社情報とお客様情報を分けてご入力ください。',
    fieldLabels: {
      representative_name: '御社担当者名',
      email: '御社連絡先メールアドレス',
      phone_number: '御社連絡先電話番号',
      preferred_language: 'お客様の希望言語 / ご対応希望言語',
      destination: 'お客様の滞在予定場所（国/地域、または具体的な場所）',
      home_country_region: 'お客様の居住国・地域',
      total_travelers: 'お客様の旅行人数（同行者含む）',
      max_budget: 'お客様のご予算感（航空券を除く、旅行全体で）',
      party_breakdown: 'お客様の同行者構成（年齢／関係性）',
      support_people_count: 'サポートが必要なお客様は何名ですか？',
      meal_preferences: 'お客様の朝食・夕食についてのご希望',
      room_requests: 'お客様のお部屋に対するご要望（複数選択可）',
      hotel_transfer_required: 'お客様はホテル⇔空港やホテル⇄駅の送迎が必要ですか？',
      sightseeing_taxi_required: 'お客様は観光タクシー（チャーター車両）が必要ですか？',
      guide_required: 'お客様は観光ガイドが必要ですか？（介助者とは異なります）',
      caregiver_or_nurse_required: 'お客様は国家資格保有の旅行専門介護士や看護師が必要ですか？',
      transportation_modes: 'お客様が滞在中に主に利用予定の交通手段（複数選択可）',
      wheelchair_usage: 'お客様は観光中に車椅子を使用しますか？',
      vehicle_boarding_preference: 'お客様の車両利用時のご希望（タクシー、送迎車など）',
      suitcase_count: 'お客様の予想されるスーツケースの個数',
      trip_wishes: 'お客様がやりたいこと / 行きたいところなど、具体的な希望内容',
      additional_notes: 'その他、代理店様から共有しておきたい事項',
      contact_consent: '代理店様として、上記内容を当社へ共有し旅行提案・手配相談に利用することに同意します。',
    },
    agencyCompanyLabel: '御社名 / 代理店名',
    clientFields: [
      field('client_full_name', 'お客様氏名', 'text'),
      field('client_passport_name', 'パスポート記載のお名前（ローマ字）', 'text', {
        required: false,
        helperText: '予約に進む場合に必要です。未確認の場合は「未確認」とご記入ください。',
      }),
      field('client_nationality', 'お客様の国籍', 'text', {
        required: false,
        helperText: '予約に進む場合に必要です。未確認の場合は「未確認」とご記入ください。',
      }),
      field('client_passport_number', 'パスポート番号', 'text', {
        required: false,
        helperText: '予約に進む場合に必要です。未確認の場合は「未確認」とご記入ください。',
      }),
    ],
    priorityFields: [
      field('client_priority_profile', 'お客様が旅行で重視するポイント（複数選択可）', 'checkbox', {
        required: false,
        options: ['ラグジュアリーな体験を優先し、費用は柔軟', '総額予算を強く意識', 'ホテルは上質にしたい', 'ホテルは抑えて体験・観光に予算を回したい', '交通・移動の快適性を優先', '現地文化体験に予算をかけたい', 'バリアフリー確実性を最優先', '移動距離や体力負担の少なさを重視'],
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      }),
      field('budget_allocation_notes', '予算配分・こだわりの補足', 'textarea', {
        required: false,
        helperText: '例：交通費は抑えたいがホテルはラグジュアリー、文化体験には予算をかけたい、など',
      }),
      field('agency_planning_notes', '代理店様として重視したいこと / 提案時の注意点', 'textarea', {
        required: false,
        helperText: '販売上の優先度、避けたい条件、見積りの出し方などがあればご記入ください。',
      }),
    ],
  },
  en: {
    name: 'Accessible & Assisted Travel Consultation Form for Travel Agencies',
    description: 'This form is for travel agencies to submit information collected from their end client. Please separate your agency contact details from the client and passport information so we can propose a plan that matches the accessibility requirements and travel preferences.',
    fieldLabels: {
      representative_name: 'Agency contact person',
      email: 'Agency contact email',
      phone_number: 'Agency contact phone number',
      preferred_language: "Client's preferred language / response language",
      destination: "Client's planned destination(s) (country/region or specific places)",
      home_country_region: "Client's country / region of residence",
      total_travelers: 'Total number of client travelers',
      max_budget: "Client's budget range (excluding airfare, total for the trip)",
      party_breakdown: "Client party breakdown (age / relationship)",
      support_people_count: 'How many client travelers require support?',
      meal_preferences: "Client's meal preferences",
      room_requests: "Client's room requests (multiple answers allowed)",
      hotel_transfer_required: 'Does the client need hotel-airport or hotel-station transfers?',
      sightseeing_taxi_required: 'Does the client need a sightseeing taxi / charter vehicle?',
      guide_required: 'Does the client need a sightseeing guide? (Different from a caregiver)',
      caregiver_or_nurse_required: 'Does the client need a travel-specialist caregiver or nurse with a national qualification?',
      transportation_modes: 'Main transportation modes the client expects to use during the stay',
      wheelchair_usage: 'Will the client use a wheelchair during sightseeing?',
      vehicle_boarding_preference: "Client's vehicle boarding preference (taxi, transfer vehicle, etc.)",
      suitcase_count: "Client's estimated number of suitcases",
      trip_wishes: "Client's concrete wishes: things to do / places to visit",
      additional_notes: 'Additional notes from the agency',
      contact_consent: 'As the agency, I agree to share the above information with Flat Travel for travel proposal and arrangement consultation.',
    },
    agencyCompanyLabel: 'Agency / company name',
    clientFields: [
      field('client_full_name', 'Client full name', 'text'),
      field('client_passport_name', 'Passport name in Roman letters', 'text', {
        required: false,
        helperText: 'Needed once the booking proceeds. If not confirmed, please write "not confirmed".',
      }),
      field('client_nationality', 'Client nationality', 'text', {
        required: false,
        helperText: 'Needed once the booking proceeds. If not confirmed, please write "not confirmed".',
      }),
      field('client_passport_number', 'Passport number', 'text', {
        required: false,
        helperText: 'Needed once the booking proceeds. If not confirmed, please write "not confirmed".',
      }),
    ],
    priorityFields: [
      field('client_priority_profile', 'What does the client prioritize? (multiple answers allowed)', 'checkbox', {
        required: false,
        options: ['Luxury experience; budget is flexible', 'Strong total-budget awareness', 'High-quality hotel is important', 'Lower hotel budget; spend more on experiences / sightseeing', 'Comfortable transportation is important', 'Willing to spend on local cultural experiences', 'Accessibility certainty is the top priority', 'Low physical burden / shorter travel distances are important'],
        allowOtherOption: true,
        otherOptionLabel: 'Other',
      }),
      field('budget_allocation_notes', 'Budget allocation / preference notes', 'textarea', {
        required: false,
        helperText: 'Example: keep transport cost down but use a luxury hotel; spend more on cultural experiences.',
      }),
      field('agency_planning_notes', 'Agency priorities / proposal notes', 'textarea', {
        required: false,
        helperText: 'Please share sales priorities, conditions to avoid, quotation expectations, or other planning notes.',
      }),
    ],
  },
  nl: {
    name: 'Intakeformulier toegankelijke en begeleide reizen voor reisbureaus',
    description: 'Dit formulier is bedoeld voor reisbureaus die informatie namens hun eindklant aanleveren. Vul de gegevens van uw bureau en de klantgegevens apart in, zodat wij een passend voorstel kunnen maken.',
    fieldLabels: {
      representative_name: 'Contactpersoon bij uw bureau',
      email: 'E-mailadres van uw bureau',
      phone_number: 'Telefoonnummer van uw bureau',
      preferred_language: 'Voorkeurstaal van de klant / communicatietaal',
      destination: 'Geplande bestemming(en) van de klant',
      home_country_region: 'Woonland/-regio van de klant',
      total_travelers: 'Totaal aantal reizigers van de klant',
      max_budget: 'Budgetindicatie van de klant (excl. vliegtickets)',
      party_breakdown: 'Samenstelling van het reisgezelschap van de klant',
      support_people_count: 'Hoeveel reizigers van de klant hebben ondersteuning nodig?',
      trip_wishes: 'Concrete wensen van de klant',
      additional_notes: 'Aanvullende opmerkingen van het reisbureau',
      contact_consent: 'Als reisbureau ga ik ermee akkoord deze informatie met Flat Travel te delen voor een reisvoorstel en arrangementen.',
    },
    agencyCompanyLabel: 'Naam reisbureau / bedrijf',
    clientFields: [
      field('client_full_name', 'Volledige naam van de klant', 'text'),
      field('client_passport_name', 'Naam op paspoort (Romeinse letters)', 'text', { required: false }),
      field('client_nationality', 'Nationaliteit van de klant', 'text', { required: false }),
      field('client_passport_number', 'Paspoortnummer', 'text', { required: false }),
    ],
    priorityFields: [
      field('client_priority_profile', 'Waar hecht de klant waarde aan? (meerdere antwoorden mogelijk)', 'checkbox', {
        required: false,
        options: ['Luxe ervaring; budget is flexibel', 'Sterke budgetbewaking', 'Hotelkwaliteit is belangrijk', 'Lager hotelbudget; meer budget voor ervaringen', 'Comfortabel vervoer is belangrijk', 'Budget voor lokale cultuurervaringen', 'Toegankelijkheid is de hoogste prioriteit', 'Lage fysieke belasting is belangrijk'],
        allowOtherOption: true,
        otherOptionLabel: 'Anders',
      }),
      field('budget_allocation_notes', 'Toelichting op budgetverdeling en voorkeuren', 'textarea', { required: false }),
      field('agency_planning_notes', 'Prioriteiten / aandachtspunten van het reisbureau', 'textarea', { required: false }),
    ],
  },
  ko: {
    name: '여행사용 무장애·돌봄 여행 상담 시트',
    description: '여행사가 최종 고객에게 확인한 정보를 바탕으로 입력하는 양식입니다. 당사가 접근성 요건과 여행 니즈에 맞는 플랜을 제안할 수 있도록 여행사 정보와 고객 정보를 구분해 작성해 주세요.',
    fieldLabels: {
      representative_name: '여행사 담당자명',
      email: '여행사 연락 이메일',
      phone_number: '여행사 연락 전화번호',
      preferred_language: '고객 희망 언어 / 응대 언어',
      destination: '고객의 체류 예정 지역',
      home_country_region: '고객의 거주 국가·지역',
      total_travelers: '고객 여행 인원',
      max_budget: '고객 예산감(항공권 제외)',
      party_breakdown: '고객 일행 구성',
      support_people_count: '지원이 필요한 고객은 몇 명인가요?',
      trip_wishes: '고객의 하고 싶은 일 / 가고 싶은 장소',
      additional_notes: '여행사에서 공유할 추가 사항',
      contact_consent: '여행사로서 위 정보를 Flat Travel에 공유하고 여행 제안 및 수배 상담에 활용하는 것에 동의합니다.',
    },
    agencyCompanyLabel: '여행사 / 회사명',
    clientFields: [
      field('client_full_name', '고객 성명', 'text'),
      field('client_passport_name', '여권상 영문 이름', 'text', { required: false }),
      field('client_nationality', '고객 국적', 'text', { required: false }),
      field('client_passport_number', '여권 번호', 'text', { required: false }),
    ],
    priorityFields: [
      field('client_priority_profile', '고객이 중요하게 생각하는 점(복수 선택 가능)', 'checkbox', {
        required: false,
        options: ['럭셔리 경험 우선, 예산은 유연함', '총예산을 강하게 의식', '호텔 품질 중요', '호텔 예산은 낮추고 체험/관광에 예산 배분', '편안한 이동 우선', '현지 문화 체험에 예산 사용', '접근성 확실성이 최우선', '체력 부담이 적은 일정 우선'],
        allowOtherOption: true,
        otherOptionLabel: '기타',
      }),
      field('budget_allocation_notes', '예산 배분 및 선호 사항 보충', 'textarea', { required: false }),
      field('agency_planning_notes', '여행사 측 우선 사항 / 제안 시 주의점', 'textarea', { required: false }),
    ],
  },
  'zh-TW': {
    name: '旅行社專用 無障礙／照護旅遊諮詢表',
    description: '此表單供旅行社依據向最終客戶確認的內容填寫。請分開填寫貴公司資訊與客戶資訊，以便我們依無障礙需求與旅遊偏好提出方案。',
    fieldLabels: {
      representative_name: '貴公司負責人姓名',
      email: '貴公司聯絡電子郵件',
      phone_number: '貴公司聯絡電話',
      preferred_language: '客戶希望使用的語言／溝通語言',
      destination: '客戶預計停留地',
      home_country_region: '客戶居住國家／地區',
      total_travelers: '客戶旅行人數',
      max_budget: '客戶預算感（不含機票）',
      party_breakdown: '客戶同行者組成',
      support_people_count: '需要支援的客戶有幾位？',
      trip_wishes: '客戶想做的事情／想去的地方',
      additional_notes: '旅行社希望補充的事項',
      contact_consent: '身為旅行社，我同意將上述資訊分享給 Flat Travel，用於旅遊提案與安排諮詢。',
    },
    agencyCompanyLabel: '旅行社／公司名稱',
    clientFields: [
      field('client_full_name', '客戶姓名', 'text'),
      field('client_passport_name', '護照姓名（羅馬字）', 'text', { required: false }),
      field('client_nationality', '客戶國籍', 'text', { required: false }),
      field('client_passport_number', '護照號碼', 'text', { required: false }),
    ],
    priorityFields: [
      field('client_priority_profile', '客戶重視的項目（可複選）', 'checkbox', {
        required: false,
        options: ['重視奢華體驗，預算彈性', '強烈重視總預算', '重視飯店品質', '飯店預算較低，將預算放在體驗／觀光', '重視舒適交通移動', '願意為在地文化體驗花費', '無障礙確實性最優先', '重視體力負擔較低的行程'],
        allowOtherOption: true,
        otherOptionLabel: '其他',
      }),
      field('budget_allocation_notes', '預算分配與偏好補充', 'textarea', { required: false }),
      field('agency_planning_notes', '旅行社方面重視事項／提案注意點', 'textarea', { required: false }),
    ],
  },
};

function insertFieldsBefore(fields, targetName, additions) {
  const existingNames = new Set(fields.map((item) => item.name));
  const nextAdditions = additions.filter((item) => !existingNames.has(item.name));
  if (nextAdditions.length === 0) return fields;

  const targetIndex = fields.findIndex((item) => item.name === targetName);
  if (targetIndex < 0) return [...nextAdditions, ...fields];
  return [
    ...fields.slice(0, targetIndex),
    ...nextAdditions,
    ...fields.slice(targetIndex),
  ];
}

function insertFieldsAfter(fields, targetName, additions) {
  const existingNames = new Set(fields.map((item) => item.name));
  const nextAdditions = additions.filter((item) => !existingNames.has(item.name));
  if (nextAdditions.length === 0) return fields;

  const targetIndex = fields.findIndex((item) => item.name === targetName);
  if (targetIndex < 0) return [...fields, ...nextAdditions];
  return [
    ...fields.slice(0, targetIndex + 1),
    ...nextAdditions,
    ...fields.slice(targetIndex + 1),
  ];
}

function customizeAccessibleTravelFormForAgency(form) {
  const copy = agencyFormCopy[form.locale] || agencyFormCopy.en;
  let fields = form.fields.map((item) => {
    const label = copy.fieldLabels[item.name];
    return label ? { ...item, label } : item;
  });

  fields = insertFieldsBefore(fields, 'representative_name', [
    field('agency_company_name', copy.agencyCompanyLabel, 'text'),
  ]);
  fields = insertFieldsAfter(fields, 'preferred_language', copy.clientFields);
  fields = insertFieldsAfter(fields, 'max_budget', copy.priorityFields);

  return {
    ...form,
    name: copy.name,
    description: copy.description,
    fields,
  };
}

const agencyLocalizedForms = localizedForms.map(customizeAccessibleTravelFormForAgency);

function jstNow() {
  const jst = new Date(Date.now() + 9 * 60 * 60_000);
  return `${jst.toISOString().slice(0, -1)}+09:00`;
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function formExistsWhere(form) {
  const clauses = [
    `(translation_group_id = ${sqlString(ACCESSIBLE_TRAVEL_TRANSLATION_GROUP_ID)} AND locale = ${sqlString(form.locale)})`,
    `name = ${sqlString(form.name)}`,
  ];
  const id = ACCESSIBLE_TRAVEL_FORM_IDS[form.locale];
  if (id) {
    clauses.unshift(`id = ${sqlString(id)}`);
  }
  return `(${clauses.join(' OR ')})`;
}

function buildSql() {
  const now = jstNow();
  const statements = [];

  for (const form of localizedForms) {
    const id = ACCESSIBLE_TRAVEL_FORM_IDS[form.locale] || crypto.randomUUID();
    const fieldsJson = JSON.stringify(normalizePublicFields(form.fields));
    const existsWhere = formExistsWhere(form);

    statements.push(
      `INSERT INTO forms
  (id, name, description, fields, locale, translation_group_id, submit_button_label, success_title, success_description, on_submit_tag_id, on_submit_scenario_id, save_to_metadata, is_active, submit_count, created_at, updated_at)
SELECT
  ${sqlString(id)},
  ${sqlString(form.name)},
  ${sqlString(form.description)},
  ${sqlString(fieldsJson)},
  ${sqlString(form.locale)},
  ${sqlString(ACCESSIBLE_TRAVEL_TRANSLATION_GROUP_ID)},
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  1,
  1,
  0,
  ${sqlString(now)},
  ${sqlString(now)}
WHERE NOT EXISTS (SELECT 1 FROM forms WHERE ${existsWhere});`,
      `UPDATE forms
SET
  name = ${sqlString(form.name)},
  description = ${sqlString(form.description)},
  fields = ${sqlString(fieldsJson)},
  locale = ${sqlString(form.locale)},
  translation_group_id = ${sqlString(ACCESSIBLE_TRAVEL_TRANSLATION_GROUP_ID)},
  save_to_metadata = 1,
  is_active = 1,
  updated_at = ${sqlString(now)}
WHERE ${existsWhere};`,
    );
  }

  return `${statements.join('\n\n')}\n`;
}

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

function buildApiPayloads() {
  return localizedForms.map((form) => ({
    name: form.name,
    description: form.description,
    fields: normalizePublicFields(form.fields),
    locale: form.locale,
    translationGroupId: ACCESSIBLE_TRAVEL_TRANSLATION_GROUP_ID,
    saveToMetadata: true,
    isActive: true,
  }));
}

async function main() {
  console.log(`API URL: ${API_URL}`);

  for (const payload of buildApiPayloads()) {
    const result = await upsertForm(payload);
    const publicUrl = `https://liffform-studio.pages.dev/public-form?id=${result.form.id}`;
    console.log(`${result.action.toUpperCase()}: ${result.form.name}`);
    console.log(`  id: ${result.form.id}`);
    console.log(`  public: ${publicUrl}`);
  }
}

if (shouldEmitSql) {
  process.stdout.write(buildSql());
} else if (shouldEmitJson) {
  process.stdout.write(`${JSON.stringify(buildApiPayloads(), null, 2)}\n`);
} else {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
