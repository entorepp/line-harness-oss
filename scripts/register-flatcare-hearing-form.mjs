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

const PUBLIC_BASE_URL = process.env.FORMS_PUBLIC_BASE_URL
  || process.env.NEXT_PUBLIC_FORMS_STUDIO_URL
  || studioEnv.NEXT_PUBLIC_FORMS_STUDIO_URL
  || 'https://liffform-studio.pages.dev';

if (!API_KEY) {
  throw new Error(
    'API key not found. Set FORMS_API_KEY or define NEXT_PUBLIC_API_KEY in apps/web/.env.local',
  );
}

const YES_NO = ['はい', 'いいえ'];
const CARE_LEVELS = ['自立', '一部介助', '全介助'];

function field(name, label, type, extras = {}) {
  return {
    name,
    label,
    type,
    required: false,
    ...extras,
  };
}

function text(name, label, extras = {}) {
  return field(name, label, 'text', extras);
}

function tel(name, label, extras = {}) {
  return field(name, label, 'tel', extras);
}

function email(name, label, extras = {}) {
  return field(name, label, 'email', extras);
}

function number(name, label, extras = {}) {
  return field(name, label, 'number', extras);
}

function date(name, label, extras = {}) {
  return field(name, label, 'date', extras);
}

function textarea(name, label, extras = {}) {
  return field(name, label, 'textarea', extras);
}

function select(name, label, options, extras = {}) {
  return field(name, label, 'select', { options, ...extras });
}

function radio(name, label, options, extras = {}) {
  return field(name, label, 'radio', { options, ...extras });
}

function checkbox(name, label, options, extras = {}) {
  return field(name, label, 'checkbox', { options, ...extras });
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

const supportVisible = visibleWhen('support.required', 'equals', 'はい');
const wheelchairVisible = visibleWhen('mobility.wheelchair', 'not_equals', '使用しない');
const domesticFlightVisible = visibleWhen('trip.transportModes', 'includes', '飛行機（国内線）');

const payload = {
  name: 'flatcare 国内旅行 事前ヒアリング v1',
  description: '日本在住のお客様の国内旅行を前提にした事前ヒアリングフォームです。国内の宿泊・移動・介助・医療配慮に必要な情報を整理します。',
  locale: 'ja',
  submitButtonLabel: '送信して担当者へ共有',
  successTitle: '送信ありがとうございました',
  successDescription: '内容は担当者へ共有され、国内旅行の手配相談に利用されます。',
  saveToMetadata: true,
  fields: [
    text('fullNameKanji', '氏名（漢字）', {
      required: true,
      placeholder: '例: 坂本 太郎',
    }),
    text('fullNameKana', '氏名（カナ）', {
      required: true,
      placeholder: '例: サカモト タロウ',
    }),
    date('dob', '生年月日', { required: true }),
    select('gender', '性別', ['男性', '女性', 'その他', '未回答'], {
      required: true,
    }),
    tel('phone', '本人連絡先電話番号', {
      required: true,
      placeholder: '例: +81 90 1234 5678',
    }),
    email('email', '本人メールアドレス', {
      required: true,
      placeholder: 'customer@example.com',
    }),
    checkbox('preferredContactMethod', '連絡しやすい方法', ['電話', 'メール', 'LINE'], {
      allowOtherOption: true,
      otherOptionLabel: 'その他',
    }),

    text('emergencyContacts[0].name', '緊急連絡先 1: 氏名', { required: true }),
    text('emergencyContacts[0].relation', '緊急連絡先 1: 続柄', { required: true }),
    tel('emergencyContacts[0].phone', '緊急連絡先 1: 電話番号', { required: true }),
    radio('emergencyContacts[0].speaksJapanese', '緊急連絡先 1: 日本語で連絡できますか', YES_NO),
    text('emergencyContacts[1].name', '緊急連絡先 2: 氏名'),
    text('emergencyContacts[1].relation', '緊急連絡先 2: 続柄'),
    tel('emergencyContacts[1].phone', '緊急連絡先 2: 電話番号'),

    text('trip.purpose', '旅行目的', {
      required: true,
      placeholder: '例: 観光、帰省、法事、イベント参加、通院同行',
    }),
    text('trip.startDateOrPeriod', '旅行開始日または時期', {
      required: true,
      placeholder: '例: 2026/2/10、2月頃、2026年春',
    }),
    text('trip.endDateOrPeriod', '旅行終了日または時期', {
      required: true,
      placeholder: '例: 2026/2/12、2月中旬、未定',
    }),
    textarea('trip.destinations', '行き先・宿泊予定エリア（国内）', {
      required: true,
      placeholder: '例: 京都市内2泊、嵐山と清水寺周辺を希望',
    }),
    text('trip.departureArea', '出発地（都道府県・市区町村・最寄り駅など）', {
      placeholder: '例: 東京都世田谷区 / 新宿駅周辺',
    }),
    text('trip.returnArea', '帰着地（出発地と異なる場合）'),
    number('trip.totalTravelers', '旅行に参加する合計人数（本人含む）', {
      required: true,
    }),
    textarea('trip.partyBreakdown', '参加者構成（年齢・関係性）', {
      placeholder: '例: 本人（70代）、娘（40代）、孫（10代）',
    }),
    radio('trip.budgetRange', 'ご予算感（国内交通・宿泊・介助費の扱いが未定でも可）', [
      '10万円未満',
      '10〜30万円',
      '30〜50万円',
      '50〜70万円',
      '70〜100万円',
      '100万円以上',
      '未定',
    ]),
    textarea('trip.budgetNotes', '予算の前提・優先したいこと', {
      placeholder: '例: 宿泊は安心優先、移動はできるだけ負担を減らしたい',
    }),
    checkbox('trip.transportModes', '利用予定・検討中の国内移動手段', [
      '新幹線・JR特急',
      '在来線・私鉄・地下鉄',
      '飛行機（国内線）',
      '車いす対応タクシー',
      '貸切福祉車両',
      '自家用車',
      'レンタカー',
    ], {
      allowOtherOption: true,
      otherOptionLabel: 'その他',
    }),
    textarea('trip.transportSchedule', '移動に関する希望・既に決まっている便や時間', {
      placeholder: '例: 往路は午前中希望、帰りは夕方までに自宅着希望',
    }),
    checkbox('trip.transferNeeds', '送迎・移動サポートの希望', [
      '自宅から駅・空港まで',
      '駅・空港から宿泊施設まで',
      '宿泊施設から観光地まで',
      '観光地間の移動',
      '不要',
    ], {
      allowOtherOption: true,
      otherOptionLabel: 'その他',
    }),
    textarea('trip.domesticFlightNotes', '国内線を利用する場合の航空会社・便・サポート希望', {
      placeholder: '例: JAL/ANA希望、空港内サポート、事前改札、車いす預け入れなど',
      ...domesticFlightVisible,
    }),

    text('accommodation.area', '宿泊希望エリア・施設名（未定可）'),
    number('accommodation.nights', '宿泊数'),
    number('accommodation.roomCount', '必要な部屋数'),
    checkbox('accommodation.roomType', '部屋タイプの希望', [
      '洋室',
      '和洋室',
      '和室不可',
      'ベッド希望',
      'ツイン',
      'トリプル',
      'コネクティングルーム',
      '同フロア希望',
    ], {
      allowOtherOption: true,
      otherOptionLabel: 'その他',
    }),
    checkbox(
      'accommodationRequirements',
      '宿泊施設に必要な条件',
      [
        'バリアフリールーム / ユニバーサルルーム',
        '入口・客室内の段差が少ない',
        '客室トイレに手すり',
        '浴室に手すり',
        'シャワーチェア',
        'ベッド周りに移乗スペース',
        'ベッド高低め',
        '貸切風呂・家族風呂',
        'エレベーター近く',
        '大浴場は使わない',
      ],
      {
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      },
    ),
    textarea('accommodation.bathingNotes', '入浴・トイレ・洗面まわりの不安や希望'),
    textarea('accommodation.notes', '宿泊施設についての補足'),

    radio('support.required', '特別な配慮やサポートは必要ですか？', YES_NO, {
      required: true,
      defaultValue: 'はい',
    }),
    checkbox(
      'medical.disabilityCategory',
      '障害区分・配慮が必要な内容',
      ['肢体', '視覚', '聴覚', '内部', '精神', '知的', '高齢による移動不安', '認知面の配慮'],
      {
        allowOtherOption: true,
        otherOptionLabel: 'その他',
        ...supportVisible,
      },
    ),
    text('medical.disabilityGrade', '障害等級・要介護度など', {
      helperText: '割引や手配確認に必要な場合のみご記入ください。',
      ...supportVisible,
    }),
    text('medical.handbookNumber', '障害者手帳番号', {
      helperText: '必要な場合のみご記入ください。',
      ...supportVisible,
    }),

    radio('mobility.transferAssistLevel', '移乗介助レベル', CARE_LEVELS, {
      helperText: 'ベッド・座席・車両への移乗を想定して選択してください',
      ...supportVisible,
    }),
    select('mobility.wheelchair', '車椅子利用', ['使用しない', '手動車椅子', '電動車椅子', 'シニアカー', '現地レンタル希望'], {
      ...supportVisible,
    }),
    text('mobility.wheelchairManufacturer', '車椅子メーカー', {
      placeholder: '例: WHILL / Permobil',
      ...wheelchairVisible,
    }),
    text('mobility.wheelchairModel', '車椅子モデル', {
      placeholder: '例: Model C2',
      ...wheelchairVisible,
    }),
    number('mobility.wheelchairWidthCm', '車椅子の横幅（最大値 cm）', {
      ...wheelchairVisible,
    }),
    number('mobility.wheelchairDepthCm', '車椅子の奥行き（最大値 cm）', {
      ...wheelchairVisible,
    }),
    number('mobility.wheelchairHeightCm', '車椅子の高さ（最大値 cm）', {
      ...wheelchairVisible,
    }),
    number('mobility.wheelchairWeightKg', '車椅子重量（kg）', {
      helperText: '車椅子を利用する場合は入力してください',
      ...wheelchairVisible,
    }),
    radio('mobility.foldable', '折りたたみ可能ですか', YES_NO, {
      ...wheelchairVisible,
    }),
    checkbox('mobility.vehicleBoardingPreference', '車両利用時の希望', [
      '車椅子のまま乗車',
      '車椅子を折りたたんで一般車両に乗車',
      '座席へ移乗して乗車',
      'リフト付き車両希望',
      'スロープ付き車両希望',
    ], {
      allowOtherOption: true,
      otherOptionLabel: 'その他',
      ...wheelchairVisible,
    }),
    select('mobility.batteryChemistry', '電池種類', ['なし', '乾電池', '湿式', 'リチウムイオン', '不明'], {
      helperText: '電動車椅子・シニアカーを利用する場合に入力してください。',
      ...wheelchairVisible,
    }),
    number('mobility.batteryVoltageV', 'バッテリー電圧（V）', {
      ...wheelchairVisible,
    }),
    number('mobility.batteryCapacityAh', 'バッテリー容量（Ah）', {
      ...wheelchairVisible,
    }),
    number('mobility.batteryWattHourWh', 'バッテリー容量（Wh）', {
      helperText: '分かる場合は入力してください。通常は V × Ah です',
      ...wheelchairVisible,
    }),
    radio('mobility.batteryRemovable', 'バッテリーは取り外せますか', YES_NO, {
      ...wheelchairVisible,
    }),
    radio('mobility.assistanceLevel', '移動全体の介助レベル', CARE_LEVELS, {
      ...supportVisible,
    }),
    textarea('mobility.assistanceDetails', '移動時の補足メモ', {
      placeholder: '例: 通路側席希望、乗降は全介助 など',
      ...supportVisible,
    }),
    radio('mobility.canStandWithHelp', '支えがあれば立位保持できますか', YES_NO, supportVisible),
    radio('mobility.canWalkShortDistance', '短距離歩行は可能ですか', YES_NO, supportVisible),
    radio('mobility.canClimbStairs', '階段移動は可能ですか', YES_NO, supportVisible),
    number('mobility.sittingToleranceMin', '連続座位可能時間（分）', supportVisible),
    radio('mobility.toiletAssistNeeded', '排泄介助が必要ですか', YES_NO, supportVisible),
    radio('mobility.pressureSoreRisk', '褥瘡リスクがありますか', YES_NO, supportVisible),
    checkbox(
      'mobility.consumables',
      '必要な消耗品',
      ['おむつ・パッド', 'カテーテル', 'ストーマ装具', '吸引カテーテル', '経管栄養関連'],
      {
        allowOtherOption: true,
        otherOptionLabel: 'その他',
        ...supportVisible,
      },
    ),
    checkbox(
      'mobility.equipmentRentalNeeds',
      '国内旅行中にレンタルしたい福祉用具',
      ['手動車椅子', '電動車椅子', 'リフト', 'シャワーチェア・バスボード', '介護用ベッド', '特になし'],
      {
        allowOtherOption: true,
        otherOptionLabel: 'その他',
        ...supportVisible,
      },
    ),
    textarea('mobility.notes', '車椅子・移動面の補足', supportVisible),

    textarea('medical.conditions', '既往症・疾患名', {
      placeholder: '複数ある場合は改行で入力してください',
      ...supportVisible,
    }),
    checkbox(
      'medical.allergies',
      'アレルギー',
      ['食物', '薬剤', 'ラテックス'],
      {
        allowOtherOption: true,
        otherOptionLabel: 'その他',
        ...supportVisible,
      },
    ),
    checkbox(
      'medical.medicalDevices',
      '使用中の医療機器',
      ['人工呼吸器', '酸素', 'PEG', 'カテーテル', 'ストーマ', 'CPAP', 'その他'],
      supportVisible,
    ),
    textarea('medical.medications', '内服薬・常用薬', {
      helperText: '一般名または商品名を改行区切りで入力してください',
      placeholder: '例: モルヒネ 5mg\n例: アムロジピン 5mg',
      ...supportVisible,
    }),
    text('medical.medicationDetails[0].genericName', '服薬詳細 1: 薬剤名', supportVisible),
    text('medical.medicationDetails[0].dosage', '服薬詳細 1: 用量', supportVisible),
    text('medical.medicationDetails[0].dailyAmount', '服薬詳細 1: 1日量', supportVisible),
    radio('medical.medicationDetails[0].isNarcotic', '服薬詳細 1: 医療用麻薬ですか', YES_NO, supportVisible),
    radio('medical.medicationDetails[0].isPsychotropic', '服薬詳細 1: 向精神薬ですか', YES_NO, supportVisible),
    text('medical.medicationDetails[1].genericName', '服薬詳細 2: 薬剤名', supportVisible),
    text('medical.medicationDetails[1].dosage', '服薬詳細 2: 用量', supportVisible),
    text('medical.medicationDetails[1].dailyAmount', '服薬詳細 2: 1日量', supportVisible),
    radio('medical.medicationDetails[1].isNarcotic', '服薬詳細 2: 医療用麻薬ですか', YES_NO, supportVisible),
    radio('medical.medicationDetails[1].isPsychotropic', '服薬詳細 2: 向精神薬ですか', YES_NO, supportVisible),
    radio('medical.oxygenRequired', '酸素投与が必要ですか', YES_NO, supportVisible),
    radio('medical.nurseRequired', '看護師など医療資格者の同行・確認が必要ですか', YES_NO, supportVisible),
    text('medical.primaryDoctor.name', '主治医氏名', supportVisible),
    text('medical.primaryDoctor.clinic', '主治医の医療機関名', supportVisible),
    tel('medical.primaryDoctor.phone', '主治医の電話番号', supportVisible),
    textarea('medical.documentNotes', '診断書・処方内容・医療情報共有に関する補足', {
      placeholder: '必要な場合のみ、共有できる範囲でご記入ください。',
      ...supportVisible,
    }),
    radio('medical.domesticTravelInsurance', '国内旅行保険・任意保険の加入状況', ['加入済み', '加入予定', '未加入', '未定']),
    textarea('medical.notes', '医療面の補足', supportVisible),

    select('dietary.form', '食事形態', ['常食', '刻み', 'ミキサー', 'とろみ']),
    radio('dietary.swallowingDifficulty', '嚥下難度', ['なし', '軽度', '中等度', '重度']),
    text('dietary.preferences', '食事の希望・避けたいもの'),
    textarea('dietary.notes', '食事面の補足'),

    checkbox(
      'transportRequirements',
      '公共交通・車両に必要な条件',
      ['駅員サポート', '通路側座席', '多目的室・個室利用相談', 'リフト車', 'スロープ車', '乗降時の移乗介助'],
      {
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      },
    ),
    radio('serviceDogAccompanied', '補助犬の同伴がありますか', YES_NO),

    text('companions[0].name', '同伴者 1: 氏名'),
    text('companions[0].relation', '同伴者 1: 続柄'),
    date('companions[0].dateOfBirth', '同伴者 1: 生年月日'),
    radio('companions[0].isCaregiver', '同伴者 1: 介助者ですか', YES_NO),
    checkbox(
      'companions[0].caregiverQualifications',
      '同伴者 1: 介助資格',
      ['介護福祉士', '介護職員初任者研修', '実務者研修', 'ガイドヘルパー', '同行援護従業者', '看護師', 'トラベルヘルパー', '旅行介助士'],
      {
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      },
    ),
    text('companions[0].caregiverCertificateUrls', '同伴者 1: 資格証 URL', {
      placeholder: '必要な場合のみ。複数ある場合はカンマ区切り',
    }),
    textarea('companions[0].notes', '同伴者 1: 補足'),

    text('companions[1].name', '同伴者 2: 氏名'),
    text('companions[1].relation', '同伴者 2: 続柄'),
    radio('companions[1].isCaregiver', '同伴者 2: 介助者ですか', YES_NO),
    checkbox(
      'companions[1].caregiverQualifications',
      '同伴者 2: 介助資格',
      ['介護福祉士', '介護職員初任者研修', '実務者研修', 'ガイドヘルパー', '同行援護従業者', '看護師', 'トラベルヘルパー', '旅行介助士'],
      {
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      },
    ),

    checkbox('specialCareConsent', '特別な配慮を要する旅行者としての申出に同意する', ['同意する'], {
      required: true,
      helperText: '旅行手配に必要な範囲で、介助・医療・緊急連絡先情報を担当者が確認します',
    }),
    textarea('notes', 'その他の共有事項', {
      placeholder: '不安点、NG事項、過去のご旅行経験など',
    }),
  ],
};

async function fetchApi(pathname, options = {}) {
  const headers = {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  let response;
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      response = await fetch(`${API_URL}${pathname}`, {
        ...options,
        headers,
      });
      break;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }

  if (!response) throw lastError;

  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(`${pathname} failed: ${json.error || response.statusText}`);
  }
  return json.data;
}

async function upsertForm(formPayload) {
  const forms = await fetchApi('/api/forms');
  const existing = forms.find((form) => form.name === formPayload.name);

  if (existing) {
    const updated = await fetchApi(`/api/forms/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify(formPayload),
    });
    return { action: 'updated', form: updated };
  }

  const created = await fetchApi('/api/forms', {
    method: 'POST',
    body: JSON.stringify(formPayload),
  });
  return { action: 'created', form: created };
}

async function main() {
  console.log(`API URL: ${API_URL}`);
  const result = await upsertForm(payload);
  console.log(`${result.action.toUpperCase()}: ${result.form.name}`);
  console.log(`  id: ${result.form.id}`);
  console.log(`  public: ${PUBLIC_BASE_URL}/public-form?id=${result.form.id}`);
  console.log(`  fields: ${payload.fields.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
