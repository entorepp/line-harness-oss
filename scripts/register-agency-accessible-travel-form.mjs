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
  throw new Error('API key not found. Set FORMS_API_KEY or define NEXT_PUBLIC_API_KEY in apps/forms-studio/.env.local');
}

const AGENCY_ACCESSIBLE_TRAVEL_TRANSLATION_GROUP_ID = '12e813d6-26d7-4982-b60c-4b20ddd4b3b9';
const AGENCY_ACCESSIBLE_TRAVEL_FORM_ID = '57f80920-5089-4d14-911b-26a425ed189f';
const AGENCY_ACCESSIBLE_TRAVEL_LOCALES = ['ja', 'en', 'zh-TW', 'zh-CN', 'ko'];

function stableUuid(input) {
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `${((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hash.slice(18, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}

const AGENCY_ACCESSIBLE_TRAVEL_FORM_IDS = {
  ja: AGENCY_ACCESSIBLE_TRAVEL_FORM_ID,
  en: stableUuid(`${AGENCY_ACCESSIBLE_TRAVEL_TRANSLATION_GROUP_ID}:en`),
  'zh-TW': stableUuid(`${AGENCY_ACCESSIBLE_TRAVEL_TRANSLATION_GROUP_ID}:zh-TW`),
  'zh-CN': stableUuid(`${AGENCY_ACCESSIBLE_TRAVEL_TRANSLATION_GROUP_ID}:zh-CN`),
  ko: stableUuid(`${AGENCY_ACCESSIBLE_TRAVEL_TRANSLATION_GROUP_ID}:ko`),
};

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

const flightVisible = visibleWhen('flight_status', 'not_equals', '特に手配の必要なし');
const SUPPORT_REQUIRED_YES = 'はい';

function travelerVisible(index) {
  return visibleWhen('total_travelers', 'greater_than', index - 1);
}

function travelerSupportVisible(prefix) {
  return visibleWhen(`${prefix}_special_support_required`, 'equals', SUPPORT_REQUIRED_YES);
}

function travelerWheelchairVisible(prefix) {
  return visibleWhen(`${prefix}_wheelchair_usage`, 'not_equals', '使用しない');
}

function nationalityField(name, label, extras = {}) {
  return field(name, label, 'radio', {
    required: false,
    options: ['未確認'],
    allowOtherOption: true,
    otherOptionLabel: '国籍を入力する',
    defaultValue: '未確認',
    ...extras,
  });
}

function travelerSupportFields(prefix, travelerLabel, baseCondition = {}) {
  const supportVisible = travelerSupportVisible(prefix);
  const wheelchairVisible = travelerWheelchairVisible(prefix);
  const isMainTraveler = prefix === 'client';

  return [
    field(
      `${prefix}_special_support_required`,
      isMainTraveler
        ? 'まず特別な配慮やサポートは必要ですか？'
        : `${travelerLabel}: 特別な配慮やサポートは必要ですか？`,
      'radio',
      {
        options: [SUPPORT_REQUIRED_YES, 'いいえ'],
        ...(isMainTraveler ? { defaultValue: SUPPORT_REQUIRED_YES } : {}),
        ...baseCondition,
      },
    ),
    field(`${prefix}_supported_traveler_gender`, `${travelerLabel}: サポートが必要な方の性別`, 'radio', {
      required: false,
      options: ['男性', '女性'],
      allowOtherOption: true,
      otherOptionLabel: 'その他',
      ...supportVisible,
    }),
    field(`${prefix}_supported_traveler_height_cm`, `${travelerLabel}: サポートが必要な方の身長（cm）`, 'number', {
      required: false,
      ...supportVisible,
    }),
    field(`${prefix}_supported_traveler_weight_kg`, `${travelerLabel}: サポートが必要な方の体重（kg）`, 'number', {
      required: false,
      ...supportVisible,
    }),
    field(`${prefix}_caregiver_or_nurse_required`, `${travelerLabel}: 国家資格保有の旅行専門介護士や看護師のご用意は必要ですか？`, 'radio', {
      required: false,
      options: ['必要', '不要'],
      ...supportVisible,
    }),
    field(`${prefix}_wheelchair_usage`, `${travelerLabel}: 観光中に車椅子を使用しますか？`, 'radio', {
      options: ['手動車椅子を使用', '電動車椅子を使用', 'シニアカー/モビリティスクーターを使用', '現地レンタル希望', '使用しない'],
      ...supportVisible,
    }),
    field(`${prefix}_vehicle_boarding_preference`, `${travelerLabel}: 車両利用時のご希望（タクシー、送迎車など）`, 'radio', {
      required: false,
      options: ['車椅子のまま乗車（リフト付き車両など）', '車椅子を折りたたんで乗車（一般車両）', '車両利用/車椅子利用の予定なし'],
      ...wheelchairVisible,
    }),
    field(`${prefix}_wheelchair_manufacturer`, `${travelerLabel}: 車椅子メーカー`, 'text', {
      required: false,
      placeholder: '例: WHILL / Permobil / Quickie',
      ...supportVisible,
    }),
    field(`${prefix}_wheelchair_model`, `${travelerLabel}: 車椅子モデル・型番`, 'text', {
      required: false,
      placeholder: '例: Model C2',
      ...supportVisible,
    }),
    field(`${prefix}_wheelchair_length_cm`, `${travelerLabel}: （車椅子を使用する場合）車椅子の縦幅・全長（最大値 cm）`, 'number', {
      ...supportVisible,
    }),
    field(`${prefix}_wheelchair_width_cm`, `${travelerLabel}: （車椅子を使用する場合）車椅子の横幅（最大値 cm）`, 'number', {
      ...supportVisible,
    }),
    field(`${prefix}_wheelchair_depth_cm`, `${travelerLabel}: （車椅子を使用する場合）車椅子の奥行き（最大値 cm）`, 'number', {
      ...supportVisible,
    }),
    field(`${prefix}_wheelchair_height_cm`, `${travelerLabel}: （車椅子を使用する場合）車椅子の高さ（最大値 cm）`, 'number', {
      ...supportVisible,
    }),
    field(`${prefix}_wheelchair_weight_kg`, `${travelerLabel}: （車椅子を使用する場合）車椅子の重さ（kg）`, 'number', {
      ...supportVisible,
    }),
    field(`${prefix}_wheelchair_foldable`, `${travelerLabel}: 車椅子は折りたたみ可能ですか？`, 'radio', {
      options: ['はい', 'いいえ', '不明'],
      ...wheelchairVisible,
    }),
    field(`${prefix}_wheelchair_battery_type`, `${travelerLabel}: 電動車椅子/シニアカーの場合: バッテリー種別`, 'radio', {
      required: false,
      options: ['リチウムイオン', '乾電池', '湿式', '不明', '該当なし'],
      ...wheelchairVisible,
    }),
    field(`${prefix}_wheelchair_battery_capacity`, `${travelerLabel}: 電動車椅子/シニアカーの場合: バッテリー容量（Wh / Ah / V）`, 'text', {
      required: false,
      placeholder: '例: 280Wh / 24V 12Ah',
      ...wheelchairVisible,
    }),
    field(`${prefix}_wheelchair_battery_removable`, `${travelerLabel}: 電動車椅子/シニアカーの場合: バッテリーは取り外せますか？`, 'radio', {
      required: false,
      options: ['はい', 'いいえ', '不明', '該当なし'],
      ...wheelchairVisible,
    }),
    field(`${prefix}_equipment_rental_needs`, `${travelerLabel}: 滞在中に福祉用具レンタルのご希望はありますか？（複数選択可）`, 'checkbox', {
      required: false,
      options: ['手動車椅子', '電動車椅子', 'リフト', 'シャワーチェア・バスボード', '介護用ベッド（特殊寝台）', '特になし'],
      allowOtherOption: true,
      otherOptionLabel: 'その他',
      ...supportVisible,
    }),
    field(`${prefix}_assistance_needs`, `${travelerLabel}: 必要な介助内容（複数選択可）`, 'checkbox', {
      required: false,
      options: ['移動介助（移乗含む）', '食事介助', '入浴介助', '排泄介助（トイレ、おむつ交換など）', '見守り・声かけ', '特になし'],
      allowOtherOption: true,
      otherOptionLabel: 'その他',
      ...supportVisible,
    }),
    field(`${prefix}_support_details`, `${travelerLabel}: 配慮や介護が必要なこと、必要なサポート内容の詳細`, 'textarea', {
      ...supportVisible,
    }),
    field(`${prefix}_medical_care_needed`, `${travelerLabel}: 医学的管理（看護師など医療資格者の介在）の必要性`, 'radio', {
      options: ['有（必要）', '無（不要）'],
      allowOtherOption: true,
      otherOptionLabel: 'その他',
      ...supportVisible,
    }),
    field(`${prefix}_medical_care_details`, `${travelerLabel}: 医学的管理の具体的な内容（複数選択可）`, 'checkbox', {
      required: false,
      options: ['吸引', '酸素', '服薬管理', '褥瘡ケア', '導尿/カテーテル管理', '経管栄養', '特になし'],
      allowOtherOption: true,
      otherOptionLabel: 'その他',
      visibleWhen: {
        field: `${prefix}_medical_care_needed`,
        operator: 'equals',
        value: '有（必要）',
      },
    }),
  ];
}

function additionalTravelerFields(index) {
  const condition = travelerVisible(index);
  return [
    field(`traveler_${index}_full_name`, `同行者${index}: お客様氏名`, 'text', {
      helperText: 'メインのお客様以外の旅行者情報です。未確認の場合は「未確認」とご記入ください。',
      ...condition,
    }),
    field(`traveler_${index}_passport_name`, `同行者${index}: パスポート記載のお名前（ローマ字）`, 'text', {
      required: false,
      helperText: '予約に進む場合に必要です。未確認の場合は「未確認」とご記入ください。',
      ...condition,
    }),
    nationalityField(`traveler_${index}_nationality`, `同行者${index}: 国籍`, condition),
    field(`traveler_${index}_passport_number`, `同行者${index}: パスポート番号`, 'text', {
      required: false,
      helperText: '予約に進む場合に必要です。未確認の場合は「未確認」とご記入ください。',
      ...condition,
    }),
    field(`traveler_${index}_relationship_to_main`, `同行者${index}: メインのお客様との続柄`, 'text', {
      placeholder: '例：配偶者、子、親、友人、介助者、添乗員',
      ...condition,
    }),
    ...travelerSupportFields(`traveler_${index}`, `同行者${index}`, condition),
  ];
}

function normalizePublicFields(fields) {
  return fields.map((rawField) => {
    const { visibleWhen, ...field } = rawField;
    if (visibleWhen) {
      field.required = false;
    }
    return visibleWhen ? { ...field, visibleWhen } : field;
  });
}

const agencyAccessibleTravelForm = {
  id: AGENCY_ACCESSIBLE_TRAVEL_FORM_ID,
  locale: 'ja',
  translationGroupId: AGENCY_ACCESSIBLE_TRAVEL_TRANSLATION_GROUP_ID,
  name: '代理店向け バリアフリー・介助旅行ヒアリングシート',
  description: '代理店様がお客様から伺った内容をもとに、当社がバリアフリー要件と必要な手配条件に沿ったプランをご提案するためのシートです。お客様へご確認の際は、このページの「お客様へのヒアリングメールをコピー」ボタンから確認文をコピーいただくと、そのままメールやLINEで送れるヒアリング文面としてご利用いただけます。回収した内容をもとに、御社情報とお客様情報を分けてご入力ください。車椅子利用や介助など、特別配慮が必要な旅行者を選択すると、同じページ内に必要な追加質問が表示されます。',
  submitButtonLabel: '代理店情報を送信',
  successTitle: '送信が完了しました',
  successDescription: '共有ありがとうございます。内容を確認し、バリアフリー要件と必要な手配条件に沿ってご提案します。',
  fields: [
    field('agency_company_name', '御社名 / 代理店名', 'text'),
    field('representative_name', '御社担当者名', 'text'),
    field('email', '御社連絡先メールアドレス', 'email'),
    field('phone_number', '御社連絡先電話番号', 'tel', {
      required: false,
    }),
    field('preferred_language', 'お客様の希望言語 / ご対応希望言語', 'radio', {
      options: ['日本語', 'English', '繁體中文', '简体中文', '한국어'],
      allowOtherOption: true,
      otherOptionLabel: 'その他',
    }),
    field('client_full_name', 'メインのお客様氏名（代表旅行者）', 'text'),
    field('client_passport_name', 'メインのお客様: パスポート記載のお名前（ローマ字）', 'text', {
      required: false,
      helperText: '予約に進む場合に必要です。未確認の場合は「未確認」とご記入ください。',
    }),
    nationalityField('client_nationality', 'メインのお客様: 国籍'),
    field('client_passport_number', 'メインのお客様: パスポート番号', 'text', {
      required: false,
      helperText: '予約に進む場合に必要です。未確認の場合は「未確認」とご記入ください。',
    }),
    field('main_traveler_notes', 'メインのお客様に関する補足', 'textarea', {
      required: false,
      helperText: '代表者、支払者、支援対象者など、代理店様側で把握しておきたい位置づけがあればご記入ください。',
    }),
    ...travelerSupportFields('client', 'メインのお客様'),
    field('travel_start_date', '旅行開始日または時期', 'text', {
      helperText: '日付が未定の場合は「2月頃」「2026年春」「2月中旬〜下旬」などでも構いません。',
      placeholder: '例：2026/2/10、2月頃、2026年春',
    }),
    field('travel_end_date', '旅行終了日または時期', 'text', {
      helperText: '日付が未定の場合は「2月頃」「2026年春」「2月中旬〜下旬」などでも構いません。',
      placeholder: '例：2026/2/17、2月下旬、未定',
    }),
    field('destination', 'お客様の滞在予定場所（国/地域、または具体的な場所）', 'textarea'),
    field('total_travelers', 'お客様の合計人数（メインのお客様を含む）', 'number', {
      helperText: '人数を入力すると、同行者ごとの氏名・パスポート情報・メインのお客様との続柄・特別配慮の入力欄が表示されます。',
      placeholder: '例：2',
    }),
    ...additionalTravelerFields(2),
    ...additionalTravelerFields(3),
    ...additionalTravelerFields(4),
    ...additionalTravelerFields(5),
    ...additionalTravelerFields(6),
    ...additionalTravelerFields(7),
    ...additionalTravelerFields(8),
    field('additional_travelers_overflow', '同行者が8名を超える場合の追加情報', 'textarea', {
      required: false,
      helperText: '9名以上の場合は、氏名、パスポート記載名、国籍、パスポート番号、メインのお客様との続柄を人数分ご記入ください。',
      visibleWhen: {
        field: 'total_travelers',
        operator: 'greater_than',
        value: 8,
      },
    }),
    field('max_budget', 'お客様全体の合計予算感（航空券を除く、旅行全体で）', 'radio', {
      required: false,
      options: ['10万円未満', '10〜30万円', '30〜50万円', '50〜70万円', '70〜100万円', '100〜150万円', '150〜200万円', '200万円以上'],
    }),
    field('budget_basis_notes', '合計予算の前提・人数あたりの考え方', 'textarea', {
      required: false,
      helperText: '例：2名合計で100万円以内、ホテル代は1室あたり、介助費は別枠で検討可能、など',
    }),
    field('agency_planning_notes', '代理店様として重視したいこと / 提案時の注意点', 'textarea', {
      required: false,
      helperText: '販売上の優先度、避けたい条件、見積りの出し方などがあればご記入ください。',
    }),
    field('party_breakdown', 'お客様の同行者構成（年齢／関係性）', 'textarea', {
      required: false,
      helperText: '例：本人(50代)、配偶者(50代)',
    }),
    field('meal_preferences', 'お客様の朝食・夕食についてのご希望', 'checkbox', {
      required: false,
      options: ['朝食付きを希望', '2食付きを希望', '食事はすべて手配不要', '食事内容（アレルギー、特別食など）に配慮が必要'],
    }),
    field('room_requests', 'お客様のお部屋に対するご要望（複数選択可）', 'checkbox', {
      required: false,
      options: ['バリアフリールーム', 'ウォークインシャワー/シャワーブース', 'ツインベッド', 'キングサイズベッド', 'コネクティングルーム', '同フロアを希望', 'ベッド低めを希望', '介護用/電動ベッド', '貸切風呂', '個別食/個室食', '手すり付きのシャワー、トイレ'],
      allowOtherOption: true,
      otherOptionLabel: 'その他',
    }),
    field('hotel_transfer_required', 'お客様はホテル⇔空港やホテル⇄駅の送迎が必要ですか？', 'radio', {
      required: false,
      options: ['必要', '不要'],
    }),
    field('sightseeing_taxi_required', 'お客様は観光タクシー（チャーター車両）が必要ですか？', 'radio', {
      required: false,
      options: ['必要', '不要'],
    }),
    field('guide_required', 'お客様は観光ガイドが必要ですか？（介助者とは異なります）', 'radio', {
      required: false,
      options: ['必要', '不要'],
    }),
    field('transportation_modes', 'お客様が滞在中に主に利用予定の交通手段（複数選択可）', 'checkbox', {
      required: false,
      options: ['新幹線・長距離列車', '電車・地下鉄', 'タクシー', 'レンタカー（自力運転）'],
      allowOtherOption: true,
      otherOptionLabel: 'その他',
    }),
    field('suitcase_count', 'お客様の予想されるスーツケースの個数', 'number', {
      required: false,
    }),
    field('flight_status', '航空券について', 'radio', {
      options: ['確定＆購入済', '検討中', 'これから検討', '特に手配の必要なし'],
    }),
    field('outbound_departure_point', '行きの出発地点(最寄駅/最寄り空港)', 'text', {
      required: false,
      ...flightVisible,
    }),
    field('outbound_arrival_point', '行きの到着場所（駅名/空港名）', 'text', {
      required: false,
      ...flightVisible,
    }),
    field('outbound_arrival_time', '行きの到着時刻', 'time', {
      required: false,
      ...flightVisible,
    }),
    field('return_departure_point', '帰りの出発場所（駅名/空港名）', 'text', {
      required: false,
      ...flightVisible,
    }),
    field('return_departure_time', '帰りの出発時刻', 'time', {
      required: false,
      ...flightVisible,
    }),
    field('trip_wishes', 'お客様がやりたいこと / 行きたいところなど、具体的な希望内容', 'textarea'),
    field('additional_notes', 'その他、代理店様から共有しておきたい事項', 'textarea', {
      required: false,
    }),
    field('contact_consent', '代理店様として、上記内容を当社へ共有し旅行提案・手配相談に利用することに同意します。', 'radio', {
      options: ['同意する', '同意しない'],
    }),
  ],
};

const localeCopy = {
  ja: {
    name: agencyAccessibleTravelForm.name,
    description: agencyAccessibleTravelForm.description,
    submitButtonLabel: agencyAccessibleTravelForm.submitButtonLabel,
    successTitle: agencyAccessibleTravelForm.successTitle,
    successDescription: agencyAccessibleTravelForm.successDescription,
    mainTraveler: 'メインのお客様',
    traveler: (index) => `同行者${index}`,
  },
  en: {
    name: 'Agency Accessible Travel and Care Support Intake Sheet',
    description: 'This sheet is for travel agencies to submit information collected from customers so we can propose a plan aligned with accessibility requirements and necessary travel arrangements. When confirming details with customers, use the “Copy customer hearing email” button on this page to copy a message that can be pasted directly into email or LINE. After collecting the answers, enter agency information and customer information separately. If a traveler needs wheelchair use, care assistance, or other special support, the required follow-up questions will appear on the same page.',
    submitButtonLabel: 'Submit agency information',
    successTitle: 'Submission completed',
    successDescription: 'Thank you. We will review the details and prepare a proposal aligned with the accessibility requirements and necessary arrangements.',
    mainTraveler: 'Main traveler',
    traveler: (index) => `Traveler ${index}`,
  },
  'zh-TW': {
    name: '代理店專用 無障礙・照護旅行需求表',
    description: '本表單供代理店根據向客戶確認到的內容填寫，讓我們能依照無障礙需求與必要安排提出旅行方案。向客戶確認時，可使用本頁的「複製給客戶的詢問郵件」按鈕，複製可直接貼到 Email 或 LINE 傳送的詢問文字。回收內容後，請將貴公司資訊與客戶資訊分開填寫。若旅客需要輪椅、照護協助或其他特別支援，同一頁面會顯示必要的追加問題。',
    submitButtonLabel: '送出代理店資訊',
    successTitle: '送出完成',
    successDescription: '感謝提供資訊。我們會確認內容，並依照無障礙需求與必要安排提出方案。',
    mainTraveler: '主要旅客',
    traveler: (index) => `同行者${index}`,
  },
  'zh-CN': {
    name: '代理店专用 无障碍・照护旅行需求表',
    description: '本表单供代理店根据向客户确认到的内容填写，以便我们根据无障碍需求和必要安排提出旅行方案。向客户确认时，可使用本页的“复制给客户的询问邮件”按钮，复制可直接粘贴到邮件或 LINE 发送的询问文字。回收内容后，请将贵公司信息与客户信息分开填写。若旅行者需要轮椅、照护协助或其他特别支持，同一页面会显示必要的追加问题。',
    submitButtonLabel: '提交代理店信息',
    successTitle: '提交完成',
    successDescription: '感谢提供信息。我们会确认内容，并根据无障碍需求和必要安排提出方案。',
    mainTraveler: '主要旅行者',
    traveler: (index) => `同行者${index}`,
  },
  ko: {
    name: '여행사 전용 배리어프리・돌봄 여행 상담 시트',
    description: '여행사가 고객에게 확인한 내용을 바탕으로, 당사가 배리어프리 요건과 필요한 여행 준비 조건에 맞춘 플랜을 제안하기 위한 시트입니다. 고객에게 확인할 때는 이 페이지의 “고객용 확인 메일 복사” 버튼을 사용하면 이메일이나 LINE에 그대로 붙여 보낼 수 있는 확인 문구가 복사됩니다. 회수한 내용을 바탕으로 귀사 정보와 고객 정보를 나누어 입력해 주세요. 휠체어 이용, 돌봄 지원 등 특별한 배려가 필요한 여행자를 선택하면 같은 페이지 안에 필요한 추가 질문이 표시됩니다.',
    submitButtonLabel: '여행사 정보 제출',
    successTitle: '제출이 완료되었습니다',
    successDescription: '공유해 주셔서 감사합니다. 내용을 확인한 뒤 배리어프리 요건과 필요한 준비 조건에 맞춰 제안드리겠습니다.',
    mainTraveler: '대표 여행자',
    traveler: (index) => `동행자 ${index}`,
  },
};

const fieldLabelMaps = {
  en: {
    agency_company_name: 'Agency / company name',
    representative_name: 'Agency contact person',
    email: 'Agency contact email address',
    phone_number: 'Agency contact phone number',
    preferred_language: "Customer's preferred language / support language",
    client_full_name: 'Main traveler full name',
    client_passport_name: 'Main traveler: Name as shown on passport (Roman letters)',
    client_nationality: 'Main traveler: Nationality',
    client_passport_number: 'Main traveler: Passport number',
    main_traveler_notes: 'Notes about the main traveler',
    travel_start_date: 'Travel start date or approximate timing',
    travel_end_date: 'Travel end date or approximate timing',
    destination: 'Planned destination / stay area',
    total_travelers: 'Total number of customers, including the main traveler',
    additional_travelers_overflow: 'Additional traveler information if there are more than 8 travelers',
    max_budget: 'Total budget range for all customers, excluding flights',
    budget_basis_notes: 'Budget assumptions and per-person / per-room basis',
    agency_planning_notes: 'Agency-side priorities / notes for proposal',
    party_breakdown: 'Traveler composition, age range, and relationship',
    meal_preferences: 'Customer meal preferences for breakfast and dinner',
    room_requests: 'Customer room requests (multiple selections allowed)',
    hotel_transfer_required: 'Does the customer need airport/station to hotel transfers?',
    sightseeing_taxi_required: 'Does the customer need a sightseeing taxi or chartered vehicle?',
    guide_required: 'Does the customer need a sightseeing guide? (Separate from a care assistant)',
    transportation_modes: 'Main transportation modes planned during the stay (multiple selections allowed)',
    suitcase_count: 'Expected number of suitcases',
    flight_status: 'Flight ticket status',
    outbound_departure_point: 'Outbound departure point (nearest station / airport)',
    outbound_arrival_point: 'Outbound arrival place (station / airport)',
    outbound_arrival_time: 'Outbound arrival time',
    return_departure_point: 'Return departure place (station / airport)',
    return_departure_time: 'Return departure time',
    trip_wishes: 'Specific things the customer wants to do / places they want to visit',
    additional_notes: 'Other information the agency would like to share',
    contact_consent: 'As the agency, we agree to share the above information with your company for travel proposal and arrangement consultation.',
  },
  'zh-TW': {
    agency_company_name: '貴公司名稱 / 代理店名稱',
    representative_name: '貴公司負責人姓名',
    email: '貴公司聯絡 Email',
    phone_number: '貴公司聯絡電話',
    preferred_language: '客戶希望使用的語言 / 對應語言',
    client_full_name: '主要旅客姓名',
    client_passport_name: '主要旅客：護照記載姓名（羅馬字）',
    client_nationality: '主要旅客：國籍',
    client_passport_number: '主要旅客：護照號碼',
    main_traveler_notes: '主要旅客補充資訊',
    travel_start_date: '旅行開始日期或大約時期',
    travel_end_date: '旅行結束日期或大約時期',
    destination: '客戶預計停留地點（國家/地區或具體地點）',
    total_travelers: '客戶總人數（含主要旅客）',
    additional_travelers_overflow: '同行者超過8名時的追加資訊',
    max_budget: '客戶整體總預算感（不含機票）',
    budget_basis_notes: '總預算前提與每人/每房計算方式',
    agency_planning_notes: '代理店希望重視的事項 / 提案注意點',
    party_breakdown: '客戶同行者構成（年齡/關係）',
    meal_preferences: '客戶早餐・晚餐需求',
    room_requests: '客戶房間需求（可複選）',
    hotel_transfer_required: '客戶是否需要飯店與機場/車站之間接送？',
    sightseeing_taxi_required: '客戶是否需要觀光計程車（包車）？',
    guide_required: '客戶是否需要觀光導遊？（與照護人員不同）',
    transportation_modes: '客戶停留期間主要預計使用的交通方式（可複選）',
    suitcase_count: '客戶預計行李箱數量',
    flight_status: '機票狀況',
    outbound_departure_point: '去程出發地點（最近車站/機場）',
    outbound_arrival_point: '去程抵達地點（車站/機場）',
    outbound_arrival_time: '去程抵達時間',
    return_departure_point: '回程出發地點（車站/機場）',
    return_departure_time: '回程出發時間',
    trip_wishes: '客戶想做的事 / 想去的地方等具體需求',
    additional_notes: '其他代理店希望共享的事項',
    contact_consent: '代理店同意將上述內容提供給本公司，用於旅行提案與手配諮詢。',
  },
  'zh-CN': {
    agency_company_name: '贵公司名称 / 代理店名称',
    representative_name: '贵公司负责人姓名',
    email: '贵公司联系邮箱',
    phone_number: '贵公司联系电话',
    preferred_language: '客户希望使用的语言 / 对应语言',
    client_full_name: '主要旅行者姓名',
    client_passport_name: '主要旅行者：护照记载姓名（罗马字）',
    client_nationality: '主要旅行者：国籍',
    client_passport_number: '主要旅行者：护照号码',
    main_traveler_notes: '主要旅行者补充信息',
    travel_start_date: '旅行开始日期或大致时间',
    travel_end_date: '旅行结束日期或大致时间',
    destination: '客户预计停留地点（国家/地区或具体地点）',
    total_travelers: '客户总人数（含主要旅行者）',
    additional_travelers_overflow: '同行者超过8名时的追加信息',
    max_budget: '客户整体总预算范围（不含机票）',
    budget_basis_notes: '总预算前提与按人/按房计算方式',
    agency_planning_notes: '代理店希望重视的事项 / 提案注意点',
    party_breakdown: '客户同行者构成（年龄/关系）',
    meal_preferences: '客户早餐・晚餐需求',
    room_requests: '客户房间需求（可多选）',
    hotel_transfer_required: '客户是否需要酒店与机场/车站之间接送？',
    sightseeing_taxi_required: '客户是否需要观光出租车（包车）？',
    guide_required: '客户是否需要观光导游？（不同于照护人员）',
    transportation_modes: '客户停留期间主要预计使用的交通方式（可多选）',
    suitcase_count: '客户预计行李箱数量',
    flight_status: '机票情况',
    outbound_departure_point: '去程出发地点（最近车站/机场）',
    outbound_arrival_point: '去程到达地点（车站/机场）',
    outbound_arrival_time: '去程到达时间',
    return_departure_point: '回程出发地点（车站/机场）',
    return_departure_time: '回程出发时间',
    trip_wishes: '客户想做的事 / 想去的地方等具体需求',
    additional_notes: '其他代理店希望共享的事项',
    contact_consent: '代理店同意将上述内容提供给本公司，用于旅行提案与手配咨询。',
  },
  ko: {
    agency_company_name: '귀사명 / 여행사명',
    representative_name: '귀사 담당자명',
    email: '귀사 연락처 이메일 주소',
    phone_number: '귀사 연락처 전화번호',
    preferred_language: '고객 희망 언어 / 대응 희망 언어',
    client_full_name: '대표 여행자 성명',
    client_passport_name: '대표 여행자: 여권상 영문 이름',
    client_nationality: '대표 여행자: 국적',
    client_passport_number: '대표 여행자: 여권 번호',
    main_traveler_notes: '대표 여행자 관련 보충 사항',
    travel_start_date: '여행 시작일 또는 시기',
    travel_end_date: '여행 종료일 또는 시기',
    destination: '고객의 체류 예정 장소(국가/지역 또는 구체적 장소)',
    total_travelers: '고객 총 인원(대표 여행자 포함)',
    additional_travelers_overflow: '동행자가 8명을 초과하는 경우의 추가 정보',
    max_budget: '고객 전체 총예산 범위(항공권 제외)',
    budget_basis_notes: '총예산의 전제 및 1인/객실 기준',
    agency_planning_notes: '여행사 측에서 중요하게 보는 사항 / 제안 시 주의점',
    party_breakdown: '고객 동행자 구성(나이/관계)',
    meal_preferences: '고객의 조식・석식 희망 사항',
    room_requests: '고객의 객실 요청 사항(복수 선택 가능)',
    hotel_transfer_required: '고객에게 호텔과 공항/역 간 송영이 필요합니까?',
    sightseeing_taxi_required: '고객에게 관광 택시(전세 차량)가 필요합니까?',
    guide_required: '고객에게 관광 가이드가 필요합니까? (돌봄 인력과 별도)',
    transportation_modes: '체류 중 주로 이용 예정인 교통수단(복수 선택 가능)',
    suitcase_count: '예상되는 여행가방 개수',
    flight_status: '항공권 상황',
    outbound_departure_point: '가는 편 출발지(가까운 역/공항)',
    outbound_arrival_point: '가는 편 도착 장소(역/공항)',
    outbound_arrival_time: '가는 편 도착 시간',
    return_departure_point: '오는 편 출발 장소(역/공항)',
    return_departure_time: '오는 편 출발 시간',
    trip_wishes: '고객이 하고 싶은 일 / 가고 싶은 곳 등 구체적인 희망',
    additional_notes: '기타 여행사에서 공유하고 싶은 사항',
    contact_consent: '여행사로서 위 내용을 당사에 공유하여 여행 제안 및 준비 상담에 이용하는 데 동의합니다.',
  },
};

const fieldSuffixLabelMaps = {
  en: {
    full_name: 'Customer full name',
    passport_name: 'Name as shown on passport (Roman letters)',
    nationality: 'Nationality',
    passport_number: 'Passport number',
    relationship_to_main: 'Relationship to the main traveler',
    special_support_required: 'Does this traveler need special accommodations or support?',
    supported_traveler_gender: 'Gender of the traveler who needs support',
    supported_traveler_height_cm: 'Height of the traveler who needs support (cm)',
    supported_traveler_weight_kg: 'Weight of the traveler who needs support (kg)',
    caregiver_or_nurse_required: 'Is a licensed travel care worker or nurse required?',
    wheelchair_usage: 'Will this traveler use a wheelchair during sightseeing?',
    vehicle_boarding_preference: 'Vehicle boarding preference (taxi, transfer vehicle, etc.)',
    wheelchair_manufacturer: 'Wheelchair manufacturer',
    wheelchair_model: 'Wheelchair model / product number',
    wheelchair_length_cm: 'Wheelchair length, maximum value (cm)',
    wheelchair_width_cm: 'Wheelchair width, maximum value (cm)',
    wheelchair_depth_cm: 'Wheelchair depth, maximum value (cm)',
    wheelchair_height_cm: 'Wheelchair height, maximum value (cm)',
    wheelchair_weight_kg: 'Wheelchair weight (kg)',
    wheelchair_foldable: 'Can the wheelchair be folded?',
    wheelchair_battery_type: 'For power wheelchairs / mobility scooters: Battery type',
    wheelchair_battery_capacity: 'For power wheelchairs / mobility scooters: Battery capacity (Wh / Ah / V)',
    wheelchair_battery_removable: 'For power wheelchairs / mobility scooters: Can the battery be removed?',
    equipment_rental_needs: 'Welfare / accessibility equipment rental needs during the stay (multiple selections allowed)',
    assistance_needs: 'Care / assistance needed (multiple selections allowed)',
    support_details: 'Details of accommodations, care needs, and required support',
    medical_care_needed: 'Need for medical management by a licensed professional, such as a nurse',
    medical_care_details: 'Specific medical management required (multiple selections allowed)',
  },
  'zh-TW': {
    full_name: '客戶姓名',
    passport_name: '護照記載姓名（羅馬字）',
    nationality: '國籍',
    passport_number: '護照號碼',
    relationship_to_main: '與主要旅客的關係',
    special_support_required: '這位旅客是否需要特別配慮或支援？',
    supported_traveler_gender: '需要支援者的性別',
    supported_traveler_height_cm: '需要支援者的身高（cm）',
    supported_traveler_weight_kg: '需要支援者的體重（kg）',
    caregiver_or_nurse_required: '是否需要具國家資格的旅行照護人員或護理師？',
    wheelchair_usage: '觀光中是否使用輪椅？',
    vehicle_boarding_preference: '搭乘車輛時的需求（計程車、接送車等）',
    wheelchair_manufacturer: '輪椅廠牌',
    wheelchair_model: '輪椅型號',
    wheelchair_length_cm: '輪椅縱向長度/全長（最大值 cm）',
    wheelchair_width_cm: '輪椅寬度（最大值 cm）',
    wheelchair_depth_cm: '輪椅深度（最大值 cm）',
    wheelchair_height_cm: '輪椅高度（最大值 cm）',
    wheelchair_weight_kg: '輪椅重量（kg）',
    wheelchair_foldable: '輪椅是否可折疊？',
    wheelchair_battery_type: '電動輪椅/代步車：電池種類',
    wheelchair_battery_capacity: '電動輪椅/代步車：電池容量（Wh / Ah / V）',
    wheelchair_battery_removable: '電動輪椅/代步車：電池是否可拆卸？',
    equipment_rental_needs: '停留期間福祉輔具租借需求（可複選）',
    assistance_needs: '需要的照護內容（可複選）',
    support_details: '需要配慮或照護的事項、所需支援內容詳情',
    medical_care_needed: '是否需要護理師等醫療資格者介入的醫療管理',
    medical_care_details: '具體需要的醫療管理內容（可複選）',
  },
  'zh-CN': {
    full_name: '客户姓名',
    passport_name: '护照记载姓名（罗马字）',
    nationality: '国籍',
    passport_number: '护照号码',
    relationship_to_main: '与主要旅行者的关系',
    special_support_required: '这位旅行者是否需要特别照顾或支持？',
    supported_traveler_gender: '需要支持者的性别',
    supported_traveler_height_cm: '需要支持者的身高（cm）',
    supported_traveler_weight_kg: '需要支持者的体重（kg）',
    caregiver_or_nurse_required: '是否需要具备国家资格的旅行照护人员或护士？',
    wheelchair_usage: '观光中是否使用轮椅？',
    vehicle_boarding_preference: '乘坐车辆时的需求（出租车、接送车等）',
    wheelchair_manufacturer: '轮椅品牌',
    wheelchair_model: '轮椅型号',
    wheelchair_length_cm: '轮椅纵向长度/全长（最大值 cm）',
    wheelchair_width_cm: '轮椅宽度（最大值 cm）',
    wheelchair_depth_cm: '轮椅深度（最大值 cm）',
    wheelchair_height_cm: '轮椅高度（最大值 cm）',
    wheelchair_weight_kg: '轮椅重量（kg）',
    wheelchair_foldable: '轮椅是否可折叠？',
    wheelchair_battery_type: '电动轮椅/代步车：电池类型',
    wheelchair_battery_capacity: '电动轮椅/代步车：电池容量（Wh / Ah / V）',
    wheelchair_battery_removable: '电动轮椅/代步车：电池是否可拆卸？',
    equipment_rental_needs: '停留期间福利/无障碍辅具租赁需求（可多选）',
    assistance_needs: '需要的照护内容（可多选）',
    support_details: '需要照顾或照护的事项、所需支持内容详情',
    medical_care_needed: '是否需要护士等医疗资格者介入的医学管理',
    medical_care_details: '具体需要的医学管理内容（可多选）',
  },
  ko: {
    full_name: '고객 성명',
    passport_name: '여권상 영문 이름',
    nationality: '국적',
    passport_number: '여권 번호',
    relationship_to_main: '대표 여행자와의 관계',
    special_support_required: '이 여행자에게 특별한 배려나 지원이 필요합니까?',
    supported_traveler_gender: '지원이 필요한 분의 성별',
    supported_traveler_height_cm: '지원이 필요한 분의 키(cm)',
    supported_traveler_weight_kg: '지원이 필요한 분의 체중(kg)',
    caregiver_or_nurse_required: '국가 자격을 보유한 여행 전문 돌봄 인력이나 간호사가 필요합니까?',
    wheelchair_usage: '관광 중 휠체어를 사용합니까?',
    vehicle_boarding_preference: '차량 이용 시 희망 사항(택시, 송영차 등)',
    wheelchair_manufacturer: '휠체어 제조사',
    wheelchair_model: '휠체어 모델・형번',
    wheelchair_length_cm: '휠체어 세로 길이/전체 길이(최대값 cm)',
    wheelchair_width_cm: '휠체어 폭(최대값 cm)',
    wheelchair_depth_cm: '휠체어 깊이(최대값 cm)',
    wheelchair_height_cm: '휠체어 높이(최대값 cm)',
    wheelchair_weight_kg: '휠체어 무게(kg)',
    wheelchair_foldable: '휠체어는 접을 수 있습니까?',
    wheelchair_battery_type: '전동 휠체어/시니어카의 경우: 배터리 종류',
    wheelchair_battery_capacity: '전동 휠체어/시니어카의 경우: 배터리 용량(Wh / Ah / V)',
    wheelchair_battery_removable: '전동 휠체어/시니어카의 경우: 배터리를 분리할 수 있습니까?',
    equipment_rental_needs: '체류 중 복지용구 렌탈 희망 사항(복수 선택 가능)',
    assistance_needs: '필요한 돌봄 내용(복수 선택 가능)',
    support_details: '배려나 돌봄이 필요한 사항, 필요한 지원 내용 상세',
    medical_care_needed: '간호사 등 의료 자격자의 개입이 필요한 의료적 관리',
    medical_care_details: '구체적으로 필요한 의료적 관리 내용(복수 선택 가능)',
  },
};

const valueMaps = {
  en: {
    日本語: 'Japanese',
    繁體中文: 'Traditional Chinese',
    简体中文: 'Simplified Chinese',
    한국어: 'Korean',
    その他: 'Other',
    国籍を入力する: 'Enter nationality',
    未確認: 'Not confirmed',
    はい: 'Yes',
    いいえ: 'No',
    不明: 'Unknown',
    該当なし: 'Not applicable',
    男性: 'Male',
    女性: 'Female',
    必要: 'Required',
    不要: 'Not required',
    手動車椅子を使用: 'Uses a manual wheelchair',
    電動車椅子を使用: 'Uses a power wheelchair',
    'シニアカー/モビリティスクーターを使用': 'Uses a mobility scooter',
    現地レンタル希望: 'Would like local rental',
    使用しない: 'Will not use',
    '車椅子のまま乗車（リフト付き車両など）': 'Board while seated in wheelchair (lift-equipped vehicle, etc.)',
    '車椅子を折りたたんで乗車（一般車両）': 'Fold wheelchair and board a standard vehicle',
    '車両利用/車椅子利用の予定なし': 'No planned vehicle use / wheelchair use',
    リチウムイオン: 'Lithium-ion',
    乾電池: 'Dry cell battery',
    湿式: 'Wet-cell battery',
    手動車椅子: 'Manual wheelchair',
    電動車椅子: 'Power wheelchair',
    リフト: 'Lift',
    'シャワーチェア・バスボード': 'Shower chair / bath board',
    '介護用ベッド（特殊寝台）': 'Care bed',
    特になし: 'None',
    '移動介助（移乗含む）': 'Mobility assistance, including transfers',
    食事介助: 'Meal assistance',
    入浴介助: 'Bathing assistance',
    '排泄介助（トイレ、おむつ交換など）': 'Toileting assistance, including diaper changes',
    '見守り・声かけ': 'Supervision / verbal prompting',
    '有（必要）': 'Yes, required',
    '無（不要）': 'No, not required',
    吸引: 'Suction',
    酸素: 'Oxygen',
    服薬管理: 'Medication management',
    褥瘡ケア: 'Pressure sore care',
    '導尿/カテーテル管理': 'Urinary catheter management',
    経管栄養: 'Tube feeding',
    '10万円未満': 'Under JPY 100,000',
    '10〜30万円': 'JPY 100,000 to 300,000',
    '30〜50万円': 'JPY 300,000 to 500,000',
    '50〜70万円': 'JPY 500,000 to 700,000',
    '70〜100万円': 'JPY 700,000 to 1,000,000',
    '100〜150万円': 'JPY 1,000,000 to 1,500,000',
    '150〜200万円': 'JPY 1,500,000 to 2,000,000',
    '200万円以上': 'JPY 2,000,000 or more',
    朝食付きを希望: 'Breakfast included',
    '2食付きを希望': 'Breakfast and dinner included',
    食事はすべて手配不要: 'No meal arrangements needed',
    '食事内容（アレルギー、特別食など）に配慮が必要': 'Meal considerations needed, such as allergies or special meals',
    バリアフリールーム: 'Accessible room',
    'ウォークインシャワー/シャワーブース': 'Walk-in shower / shower booth',
    ツインベッド: 'Twin beds',
    キングサイズベッド: 'King-size bed',
    コネクティングルーム: 'Connecting rooms',
    同フロアを希望: 'Same floor preferred',
    ベッド低めを希望: 'Lower bed preferred',
    '介護用/電動ベッド': 'Care / electric bed',
    貸切風呂: 'Private bath',
    '個別食/個室食': 'Individual / private dining',
    '手すり付きのシャワー、トイレ': 'Shower and toilet with grab bars',
    '新幹線・長距離列車': 'Shinkansen / long-distance train',
    '電車・地下鉄': 'Train / subway',
    タクシー: 'Taxi',
    'レンタカー（自力運転）': 'Rental car (self-driving)',
    '確定＆購入済': 'Confirmed and purchased',
    検討中: 'Under consideration',
    これから検討: 'To be considered',
    特に手配の必要なし: 'No arrangements needed',
    同意する: 'I agree',
    同意しない: 'I do not agree',
  },
  'zh-TW': {
    日本語: '日語',
    English: '英語',
    简体中文: '簡體中文',
    한국어: '韓語',
    その他: '其他',
    国籍を入力する: '輸入國籍',
    未確認: '未確認',
    はい: '是',
    いいえ: '否',
    不明: '不明',
    該当なし: '不適用',
    男性: '男性',
    女性: '女性',
    必要: '需要',
    不要: '不需要',
    手動車椅子を使用: '使用手動輪椅',
    電動車椅子を使用: '使用電動輪椅',
    'シニアカー/モビリティスクーターを使用': '使用代步車/電動代步車',
    現地レンタル希望: '希望當地租借',
    使用しない: '不使用',
    '車椅子のまま乗車（リフト付き車両など）': '坐在輪椅上乘車（升降車等）',
    '車椅子を折りたたんで乗車（一般車両）': '折疊輪椅後乘坐一般車輛',
    '車両利用/車椅子利用の予定なし': '無車輛/輪椅使用計畫',
    リチウムイオン: '鋰離子',
    乾電池: '乾電池',
    湿式: '濕式',
    手動車椅子: '手動輪椅',
    電動車椅子: '電動輪椅',
    リフト: '升降設備',
    'シャワーチェア・バスボード': '淋浴椅・浴缸板',
    '介護用ベッド（特殊寝台）': '照護床',
    特になし: '無',
    '移動介助（移乗含む）': '移動協助（含移位）',
    食事介助: '用餐協助',
    入浴介助: '沐浴協助',
    '排泄介助（トイレ、おむつ交換など）': '如廁協助（廁所、尿布更換等）',
    '見守り・声かけ': '看護/提醒',
    '有（必要）': '有（需要）',
    '無（不要）': '無（不需要）',
    吸引: '抽吸',
    酸素: '氧氣',
    服薬管理: '服藥管理',
    褥瘡ケア: '褥瘡照護',
    '導尿/カテーテル管理': '導尿/導管管理',
    経管栄養: '管灌營養',
    '10万円未満': '未滿10萬日圓',
    '10〜30万円': '10萬至30萬日圓',
    '30〜50万円': '30萬至50萬日圓',
    '50〜70万円': '50萬至70萬日圓',
    '70〜100万円': '70萬至100萬日圓',
    '100〜150万円': '100萬至150萬日圓',
    '150〜200万円': '150萬至200萬日圓',
    '200万円以上': '200萬日圓以上',
    朝食付きを希望: '希望含早餐',
    '2食付きを希望': '希望含早晚餐',
    食事はすべて手配不要: '所有餐食皆不需安排',
    '食事内容（アレルギー、特別食など）に配慮が必要': '餐食需配慮（過敏、特殊餐等）',
    バリアフリールーム: '無障礙房',
    'ウォークインシャワー/シャワーブース': '無門檻淋浴/淋浴間',
    ツインベッド: '雙床',
    キングサイズベッド: '特大床',
    コネクティングルーム: '連通房',
    同フロアを希望: '希望同樓層',
    ベッド低めを希望: '希望床較低',
    '介護用/電動ベッド': '照護用/電動床',
    貸切風呂: '包場浴池',
    '個別食/個室食': '個別餐/包廂用餐',
    '手すり付きのシャワー、トイレ': '附扶手的淋浴與廁所',
    '新幹線・長距離列車': '新幹線・長途列車',
    '電車・地下鉄': '電車・地鐵',
    タクシー: '計程車',
    'レンタカー（自力運転）': '租車（自行駕駛）',
    '確定＆購入済': '已確定並購買',
    検討中: '討論中',
    これから検討: '之後再討論',
    特に手配の必要なし: '無需特別安排',
    同意する: '同意',
    同意しない: '不同意',
  },
  'zh-CN': {
    日本語: '日语',
    English: '英语',
    繁體中文: '繁体中文',
    한국어: '韩语',
    その他: '其他',
    国籍を入力する: '输入国籍',
    未確認: '未确认',
    はい: '是',
    いいえ: '否',
    不明: '不明',
    該当なし: '不适用',
    男性: '男性',
    女性: '女性',
    必要: '需要',
    不要: '不需要',
    手動車椅子を使用: '使用手动轮椅',
    電動車椅子を使用: '使用电动轮椅',
    'シニアカー/モビリティスクーターを使用': '使用代步车/电动代步车',
    現地レンタル希望: '希望当地租赁',
    使用しない: '不使用',
    '車椅子のまま乗車（リフト付き車両など）': '坐在轮椅上乘车（升降车等）',
    '車椅子を折りたたんで乗車（一般車両）': '折叠轮椅后乘坐普通车辆',
    '車両利用/車椅子利用の予定なし': '无车辆/轮椅使用计划',
    リチウムイオン: '锂离子',
    乾電池: '干电池',
    湿式: '湿式',
    手動車椅子: '手动轮椅',
    電動車椅子: '电动轮椅',
    リフト: '升降设备',
    'シャワーチェア・バスボード': '淋浴椅・浴缸板',
    '介護用ベッド（特殊寝台）': '照护床',
    特になし: '无',
    '移動介助（移乗含む）': '移动协助（含移位）',
    食事介助: '用餐协助',
    入浴介助: '洗浴协助',
    '排泄介助（トイレ、おむつ交換など）': '如厕协助（厕所、尿布更换等）',
    '見守り・声かけ': '看护/提醒',
    '有（必要）': '有（需要）',
    '無（不要）': '无（不需要）',
    吸引: '吸引',
    酸素: '氧气',
    服薬管理: '服药管理',
    褥瘡ケア: '压疮护理',
    '導尿/カテーテル管理': '导尿/导管管理',
    経管栄養: '管饲营养',
    '10万円未満': '低于10万日元',
    '10〜30万円': '10万至30万日元',
    '30〜50万円': '30万至50万日元',
    '50〜70万円': '50万至70万日元',
    '70〜100万円': '70万至100万日元',
    '100〜150万円': '100万至150万日元',
    '150〜200万円': '150万至200万日元',
    '200万円以上': '200万日元以上',
    朝食付きを希望: '希望含早餐',
    '2食付きを希望': '希望含早晚餐',
    食事はすべて手配不要: '所有餐食均无需安排',
    '食事内容（アレルギー、特別食など）に配慮が必要': '餐食需照顾（过敏、特殊餐等）',
    バリアフリールーム: '无障碍房',
    'ウォークインシャワー/シャワーブース': '无门槛淋浴/淋浴间',
    ツインベッド: '双床',
    キングサイズベッド: '特大床',
    コネクティングルーム: '连通房',
    同フロアを希望: '希望同楼层',
    ベッド低めを希望: '希望床较低',
    '介護用/電動ベッド': '照护用/电动床',
    貸切風呂: '包场浴池',
    '個別食/個室食': '单独餐/包间用餐',
    '手すり付きのシャワー、トイレ': '带扶手的淋浴和厕所',
    '新幹線・長距離列車': '新干线・长途列车',
    '電車・地下鉄': '电车・地铁',
    タクシー: '出租车',
    'レンタカー（自力運転）': '租车（自行驾驶）',
    '確定＆購入済': '已确定并购买',
    検討中: '讨论中',
    これから検討: '之后再讨论',
    特に手配の必要なし: '无需特别安排',
    同意する: '同意',
    同意しない: '不同意',
  },
  ko: {
    日本語: '일본어',
    English: '영어',
    繁體中文: '번체중문',
    简体中文: '간체중문',
    한국어: '한국어',
    その他: '기타',
    国籍を入力する: '국적 입력',
    未確認: '미확인',
    はい: '예',
    いいえ: '아니요',
    不明: '불명',
    該当なし: '해당 없음',
    男性: '남성',
    女性: '여성',
    必要: '필요',
    不要: '불필요',
    手動車椅子を使用: '수동 휠체어 사용',
    電動車椅子を使用: '전동 휠체어 사용',
    'シニアカー/モビリティスクーターを使用': '시니어카/모빌리티 스쿠터 사용',
    現地レンタル希望: '현지 렌탈 희망',
    使用しない: '사용하지 않음',
    '車椅子のまま乗車（リフト付き車両など）': '휠체어에 탄 채 승차(리프트 차량 등)',
    '車椅子を折りたたんで乗車（一般車両）': '휠체어를 접고 일반 차량에 승차',
    '車両利用/車椅子利用の予定なし': '차량/휠체어 이용 예정 없음',
    リチウムイオン: '리튬이온',
    乾電池: '건전지',
    湿式: '습식',
    手動車椅子: '수동 휠체어',
    電動車椅子: '전동 휠체어',
    リフト: '리프트',
    'シャワーチェア・バスボード': '샤워 의자・배스보드',
    '介護用ベッド（特殊寝台）': '돌봄용 침대',
    特になし: '특별히 없음',
    '移動介助（移乗含む）': '이동 보조(이승 포함)',
    食事介助: '식사 보조',
    入浴介助: '목욕 보조',
    '排泄介助（トイレ、おむつ交換など）': '배설 보조(화장실, 기저귀 교체 등)',
    '見守り・声かけ': '지켜보기・말 걸기',
    '有（必要）': '있음(필요)',
    '無（不要）': '없음(불필요)',
    吸引: '흡인',
    酸素: '산소',
    服薬管理: '복약 관리',
    褥瘡ケア: '욕창 케어',
    '導尿/カテーテル管理': '도뇨/카테터 관리',
    経管栄養: '경관 영양',
    '10万円未満': '10만 엔 미만',
    '10〜30万円': '10만~30만 엔',
    '30〜50万円': '30만~50만 엔',
    '50〜70万円': '50만~70만 엔',
    '70〜100万円': '70만~100만 엔',
    '100〜150万円': '100만~150만 엔',
    '150〜200万円': '150만~200만 엔',
    '200万円以上': '200만 엔 이상',
    朝食付きを希望: '조식 포함 희망',
    '2食付きを希望': '조식・석식 포함 희망',
    食事はすべて手配不要: '식사 준비 모두 불필요',
    '食事内容（アレルギー、特別食など）に配慮が必要': '식사 내용 배려 필요(알레르기, 특별식 등)',
    バリアフリールーム: '배리어프리 객실',
    'ウォークインシャワー/シャワーブース': '워크인 샤워/샤워 부스',
    ツインベッド: '트윈베드',
    キングサイズベッド: '킹사이즈 침대',
    コネクティングルーム: '커넥팅룸',
    同フロアを希望: '같은 층 희망',
    ベッド低めを希望: '낮은 침대 희망',
    '介護用/電動ベッド': '돌봄용/전동 침대',
    貸切風呂: '전세탕',
    '個別食/個室食': '개별식/개별실 식사',
    '手すり付きのシャワー、トイレ': '손잡이가 있는 샤워실, 화장실',
    '新幹線・長距離列車': '신칸센・장거리 열차',
    '電車・地下鉄': '전철・지하철',
    タクシー: '택시',
    'レンタカー（自力運転）': '렌터카(직접 운전)',
    '確定＆購入済': '확정 및 구매 완료',
    検討中: '검토 중',
    これから検討: '앞으로 검토',
    特に手配の必要なし: '특별한 준비 필요 없음',
    同意する: '동의함',
    同意しない: '동의하지 않음',
  },
};

const helperTextMaps = {
  en: {
    '予約に進む場合に必要です。未確認の場合は「未確認」とご記入ください。': 'Required when proceeding to booking. If not confirmed, enter “Not confirmed”.',
    '代表者、支払者、支援対象者など、代理店様側で把握しておきたい位置づけがあればご記入ください。': 'Enter any agency-side notes about the traveler’s role, such as representative, payer, or support target.',
    '日付が未定の場合は「2月頃」「2026年春」「2月中旬〜下旬」などでも構いません。': 'If dates are not fixed, approximate timing such as “around February”, “spring 2026”, or “mid to late February” is fine.',
    '人数を入力すると、同行者ごとの氏名・パスポート情報・メインのお客様との続柄・特別配慮の入力欄が表示されます。': 'Entering the number of travelers shows fields for each companion’s name, passport information, relationship to the main traveler, and special support needs.',
    '9名以上の場合は、氏名、パスポート記載名、国籍、パスポート番号、メインのお客様との続柄を人数分ご記入ください。': 'For 9 or more travelers, enter each person’s name, passport name, nationality, passport number, and relationship to the main traveler.',
    '例：2名合計で100万円以内、ホテル代は1室あたり、介助費は別枠で検討可能、など': 'Example: within JPY 1,000,000 total for 2 people, hotel budget per room, care assistance costs can be considered separately.',
    '販売上の優先度、避けたい条件、見積りの出し方などがあればご記入ください。': 'Enter sales priorities, conditions to avoid, quote preferences, or other agency-side notes.',
    '例：本人(50代)、配偶者(50代)': 'Example: traveler in their 50s, spouse in their 50s.',
    'メインのお客様以外の旅行者情報です。未確認の場合は「未確認」とご記入ください。': 'Traveler information other than the main traveler. If not confirmed, enter “Not confirmed”.',
  },
  'zh-TW': {
    '予約に進む場合に必要です。未確認の場合は「未確認」とご記入ください。': '進入預約時需要此資訊。未確認時請填寫「未確認」。',
    '代表者、支払者、支援対象者など、代理店様側で把握しておきたい位置づけがあればご記入ください。': '如代表者、付款者、支援對象等，代理店需要掌握的角色定位請填寫。',
    '日付が未定の場合は「2月頃」「2026年春」「2月中旬〜下旬」などでも構いません。': '若日期未定，可填寫「2月左右」「2026年春季」「2月中旬至下旬」等大約時期。',
    '人数を入力すると、同行者ごとの氏名・パスポート情報・メインのお客様との続柄・特別配慮の入力欄が表示されます。': '輸入人數後，會顯示各同行者的姓名、護照資訊、與主要旅客的關係及特別配慮欄位。',
    '9名以上の場合は、氏名、パスポート記載名、国籍、パスポート番号、メインのお客様との続柄を人数分ご記入ください。': '9名以上時，請填寫每位旅客的姓名、護照記載姓名、國籍、護照號碼及與主要旅客的關係。',
    '例：2名合計で100万円以内、ホテル代は1室あたり、介助費は別枠で検討可能、など': '例：2名合計100萬日圓以內、飯店費用以每房計算、照護費可另行討論等。',
    '販売上の優先度、避けたい条件、見積りの出し方などがあればご記入ください。': '如銷售優先度、希望避免的條件、報價方式等，請填寫。',
    '例：本人(50代)、配偶者(50代)': '例：本人（50多歲）、配偶（50多歲）',
    'メインのお客様以外の旅行者情報です。未確認の場合は「未確認」とご記入ください。': '主要旅客以外的旅行者資訊。未確認時請填寫「未確認」。',
  },
  'zh-CN': {
    '予約に進む場合に必要です。未確認の場合は「未確認」とご記入ください。': '进入预约时需要此信息。未确认时请填写“未确认”。',
    '代表者、支払者、支援対象者など、代理店様側で把握しておきたい位置づけがあればご記入ください。': '如代表者、付款者、支持对象等，代理店需要掌握的角色定位请填写。',
    '日付が未定の場合は「2月頃」「2026年春」「2月中旬〜下旬」などでも構いません。': '若日期未定，可填写“2月左右”“2026年春季”“2月中旬至下旬”等大致时间。',
    '人数を入力すると、同行者ごとの氏名・パスポート情報・メインのお客様との続柄・特別配慮の入力欄が表示されます。': '输入人数后，会显示各同行者的姓名、护照信息、与主要旅行者的关系及特别照顾栏位。',
    '9名以上の場合は、氏名、パスポート記載名、国籍、パスポート番号、メインのお客様との続柄を人数分ご記入ください。': '9名以上时，请填写每位旅行者的姓名、护照记载姓名、国籍、护照号码及与主要旅行者的关系。',
    '例：2名合計で100万円以内、ホテル代は1室あたり、介助費は別枠で検討可能、など': '例：2名合计100万日元以内、酒店费用按每房计算、照护费用可另行讨论等。',
    '販売上の優先度、避けたい条件、見積りの出し方などがあればご記入ください。': '如销售优先级、希望避免的条件、报价方式等，请填写。',
    '例：本人(50代)、配偶者(50代)': '例：本人（50多岁）、配偶（50多岁）',
    'メインのお客様以外の旅行者情報です。未確認の場合は「未確認」とご記入ください。': '主要旅行者以外的旅行者信息。未确认时请填写“未确认”。',
  },
  ko: {
    '予約に進む場合に必要です。未確認の場合は「未確認」とご記入ください。': '예약 진행 시 필요합니다. 미확인인 경우 “미확인”이라고 입력해 주세요.',
    '代表者、支払者、支援対象者など、代理店様側で把握しておきたい位置づけがあればご記入ください。': '대표자, 결제자, 지원 대상자 등 여행사 측에서 파악해야 할 위치가 있으면 입력해 주세요.',
    '日付が未定の場合は「2月頃」「2026年春」「2月中旬〜下旬」などでも構いません。': '날짜가 정해지지 않았다면 “2월경”, “2026년 봄”, “2월 중순~하순”처럼 대략적인 시기로 적어도 괜찮습니다.',
    '人数を入力すると、同行者ごとの氏名・パスポート情報・メインのお客様との続柄・特別配慮の入力欄が表示されます。': '인원을 입력하면 동행자별 성명, 여권 정보, 대표 여행자와의 관계, 특별 배려 입력란이 표시됩니다.',
    '9名以上の場合は、氏名、パスポート記載名、国籍、パスポート番号、メインのお客様との続柄を人数分ご記入ください。': '9명 이상인 경우 각 여행자의 성명, 여권상 이름, 국적, 여권 번호, 대표 여행자와의 관계를 입력해 주세요.',
    '例：2名合計で100万円以内、ホテル代は1室あたり、介助費は別枠で検討可能、など': '예: 2명 합계 100만 엔 이내, 호텔비는 객실당, 돌봄 비용은 별도 검토 가능 등',
    '販売上の優先度、避けたい条件、見積りの出し方などがあればご記入ください。': '판매상 우선순위, 피하고 싶은 조건, 견적 제시 방식 등이 있으면 입력해 주세요.',
    '例：本人(50代)、配偶者(50代)': '예: 본인(50대), 배우자(50대)',
    'メインのお客様以外の旅行者情報です。未確認の場合は「未確認」とご記入ください。': '대표 여행자 외의 여행자 정보입니다. 미확인인 경우 “미확인”이라고 입력해 주세요.',
  },
};

const placeholderMaps = {
  en: {
    '例：2026/2/10、2月頃、2026年春': 'e.g. Feb 10, 2026 / around February / spring 2026',
    '例：2026/2/17、2月下旬、未定': 'e.g. Feb 17, 2026 / late February / undecided',
    '例：2': 'e.g. 2',
    '例：配偶者、子、親、友人、介助者、添乗員': 'e.g. spouse, child, parent, friend, care assistant, tour conductor',
    '例: WHILL / Permobil / Quickie': 'e.g. WHILL / Permobil / Quickie',
    '例: Model C2': 'e.g. Model C2',
    '例: 280Wh / 24V 12Ah': 'e.g. 280Wh / 24V 12Ah',
  },
  'zh-TW': {
    '例：2026/2/10、2月頃、2026年春': '例：2026/2/10、2月左右、2026年春季',
    '例：2026/2/17、2月下旬、未定': '例：2026/2/17、2月下旬、未定',
    '例：2': '例：2',
    '例：配偶者、子、親、友人、介助者、添乗員': '例：配偶、子女、父母、朋友、照護人員、領隊',
    '例: WHILL / Permobil / Quickie': '例：WHILL / Permobil / Quickie',
    '例: Model C2': '例：Model C2',
    '例: 280Wh / 24V 12Ah': '例：280Wh / 24V 12Ah',
  },
  'zh-CN': {
    '例：2026/2/10、2月頃、2026年春': '例：2026/2/10、2月左右、2026年春季',
    '例：2026/2/17、2月下旬、未定': '例：2026/2/17、2月下旬、未定',
    '例：2': '例：2',
    '例：配偶者、子、親、友人、介助者、添乗員': '例：配偶、子女、父母、朋友、照护人员、领队',
    '例: WHILL / Permobil / Quickie': '例：WHILL / Permobil / Quickie',
    '例: Model C2': '例：Model C2',
    '例: 280Wh / 24V 12Ah': '例：280Wh / 24V 12Ah',
  },
  ko: {
    '例：2026/2/10、2月頃、2026年春': '예: 2026/2/10, 2월경, 2026년 봄',
    '例：2026/2/17、2月下旬、未定': '예: 2026/2/17, 2월 하순, 미정',
    '例：2': '예: 2',
    '例：配偶者、子、親、友人、介助者、添乗員': '예: 배우자, 자녀, 부모, 친구, 돌봄 인력, 인솔자',
    '例: WHILL / Permobil / Quickie': '예: WHILL / Permobil / Quickie',
    '例: Model C2': '예: Model C2',
    '例: 280Wh / 24V 12Ah': '예: 280Wh / 24V 12Ah',
  },
};

function translateValue(value, locale) {
  if (locale === 'ja') return value;
  if (Array.isArray(value)) return value.map((item) => translateValue(item, locale));
  if (typeof value !== 'string') return value;
  return valueMaps[locale]?.[value] || value;
}

function fieldSuffix(name) {
  const travelerMatch = name.match(/^traveler_\d+_(.+)$/);
  if (travelerMatch) return travelerMatch[1];
  if (name.startsWith('client_')) return name.slice('client_'.length);
  return null;
}

function localizeFieldLabel(name, locale) {
  if (locale === 'ja') return null;

  const copy = localeCopy[locale];
  const suffix = fieldSuffix(name);
  const travelerMatch = name.match(/^traveler_(\d+)_(.+)$/);

  if (name === 'client_special_support_required') {
    return {
      en: 'First, does anyone need special accommodations or support?',
      'zh-TW': '首先，是否有人需要特別配慮或支援？',
      'zh-CN': '首先，是否有人需要特别照顾或支持？',
      ko: '먼저, 특별한 배려나 지원이 필요합니까?',
    }[locale];
  }

  if (travelerMatch && suffix && fieldSuffixLabelMaps[locale]?.[suffix]) {
    return `${copy.traveler(Number(travelerMatch[1]))}: ${fieldSuffixLabelMaps[locale][suffix]}`;
  }

  if (name.startsWith('client_') && suffix && fieldSuffixLabelMaps[locale]?.[suffix]) {
    return `${copy.mainTraveler}: ${fieldSuffixLabelMaps[locale][suffix]}`;
  }

  return fieldLabelMaps[locale]?.[name] || null;
}

function localizeField(rawField, locale) {
  if (locale === 'ja') return rawField;

  const field = { ...rawField };
  field.label = localizeFieldLabel(field.name, locale) || field.label;

  if (field.options) {
    field.options = field.options.map((option) => translateValue(option, locale));
  }
  if (field.otherOptionLabel) {
    field.otherOptionLabel = translateValue(field.otherOptionLabel, locale);
  }
  if (field.defaultValue !== undefined) {
    field.defaultValue = translateValue(field.defaultValue, locale);
  }
  if (field.helperText) {
    field.helperText = helperTextMaps[locale]?.[field.helperText] || field.helperText;
  }
  if (field.placeholder) {
    field.placeholder = placeholderMaps[locale]?.[field.placeholder] || field.placeholder;
  }
  if (field.visibleWhen) {
    field.visibleWhen = {
      ...field.visibleWhen,
      value: translateValue(field.visibleWhen.value, locale),
    };
  }

  return field;
}

function localizeForm(locale) {
  if (locale === 'ja') return agencyAccessibleTravelForm;

  const copy = localeCopy[locale];
  return {
    ...agencyAccessibleTravelForm,
    id: AGENCY_ACCESSIBLE_TRAVEL_FORM_IDS[locale],
    locale,
    name: copy.name,
    description: copy.description,
    submitButtonLabel: copy.submitButtonLabel,
    successTitle: copy.successTitle,
    successDescription: copy.successDescription,
    fields: agencyAccessibleTravelForm.fields.map((field) => localizeField(field, locale)),
  };
}

const agencyAccessibleTravelForms = AGENCY_ACCESSIBLE_TRAVEL_LOCALES.map(localizeForm);

function jstNow() {
  const jst = new Date(Date.now() + 9 * 60 * 60_000);
  return `${jst.toISOString().slice(0, -1)}+09:00`;
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildSql() {
  const now = jstNow();
  return agencyAccessibleTravelForms.map((form) => {
    const fieldsJson = JSON.stringify(normalizePublicFields(form.fields));
    const existsWhere = `(id = ${sqlString(form.id)} OR (translation_group_id = ${sqlString(form.translationGroupId)} AND locale = ${sqlString(form.locale)}) OR name = ${sqlString(form.name)})`;

    return `INSERT INTO forms
  (id, name, description, fields, locale, translation_group_id, submit_button_label, success_title, success_description, on_submit_tag_id, on_submit_scenario_id, save_to_metadata, is_active, submit_count, created_at, updated_at)
SELECT
  ${sqlString(form.id)},
  ${sqlString(form.name)},
  ${sqlString(form.description)},
  ${sqlString(fieldsJson)},
  ${sqlString(form.locale)},
  ${sqlString(form.translationGroupId)},
  ${sqlString(form.submitButtonLabel)},
  ${sqlString(form.successTitle)},
  ${sqlString(form.successDescription)},
  NULL,
  NULL,
  1,
  1,
  0,
  ${sqlString(now)},
  ${sqlString(now)}
WHERE NOT EXISTS (SELECT 1 FROM forms WHERE ${existsWhere});

UPDATE forms
SET
  name = ${sqlString(form.name)},
  description = ${sqlString(form.description)},
  fields = ${sqlString(fieldsJson)},
  locale = ${sqlString(form.locale)},
  translation_group_id = ${sqlString(form.translationGroupId)},
  submit_button_label = ${sqlString(form.submitButtonLabel)},
  success_title = ${sqlString(form.successTitle)},
  success_description = ${sqlString(form.successDescription)},
  save_to_metadata = 1,
  is_active = 1,
  updated_at = ${sqlString(now)}
WHERE ${existsWhere};
`;
  }).join('\n');
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
  const existing = forms.find((form) => (
    (
      form.translationGroupId === AGENCY_ACCESSIBLE_TRAVEL_TRANSLATION_GROUP_ID
      && form.locale === payload.locale
    )
    || form.name === payload.name
  ));

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

  const payloads = buildPayloads();

  for (const payload of payloads) {
    const result = await upsertForm(payload);
    const publicUrl = `https://liffform-studio.pages.dev/public-form?id=${result.form.id}`;
    console.log(`${result.action.toUpperCase()}: ${result.form.name}`);
    console.log(`  locale: ${result.form.locale}`);
    console.log(`  id: ${result.form.id}`);
    console.log(`  public: ${publicUrl}`);
  }
}

function buildPayload(form) {
  return {
    name: form.name,
    description: form.description,
    fields: normalizePublicFields(form.fields),
    locale: form.locale,
    translationGroupId: form.translationGroupId,
    submitButtonLabel: form.submitButtonLabel,
    successTitle: form.successTitle,
    successDescription: form.successDescription,
    saveToMetadata: true,
    isActive: true,
  };
}

function buildPayloads() {
  return agencyAccessibleTravelForms.map(buildPayload);
}

if (shouldEmitSql) {
  process.stdout.write(buildSql());
} else if (shouldEmitJson) {
  process.stdout.write(JSON.stringify(buildPayloads()));
} else {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
