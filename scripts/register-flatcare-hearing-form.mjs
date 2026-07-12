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

const payload = {
  name: 'flatcare 事前ヒアリング v1',
  description: 'FlatWorker 案件へ直接取り込むための事前ヒアリングフォームです。車椅子・医療・緊急連絡先・同伴者情報をまとめて確認します。',
  submitButtonLabel: '送信して担当者へ共有',
  successTitle: '送信ありがとうございました',
  successDescription: '内容は担当者へ共有され、案件情報に反映されます。',
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

    text('emergencyContacts[0].name', '緊急連絡先 1: 氏名', { required: true }),
    text('emergencyContacts[0].relation', '緊急連絡先 1: 続柄', { required: true }),
    tel('emergencyContacts[0].phone', '緊急連絡先 1: 電話番号', { required: true }),
    radio('emergencyContacts[0].speaksJapanese', '緊急連絡先 1: 日本語で連絡できますか', YES_NO),

    text('passport.number', 'パスポート番号', {
      required: true,
      placeholder: '例: TR1234567',
    }),
    text('passport.nameRoman', '旅券ローマ字氏名', {
      required: true,
      placeholder: '例: SAKAMOTO/TARO',
    }),
    date('passport.expiresOn', 'パスポート有効期限', { required: true }),
    date('passport.issuedOn', 'パスポート発行日'),

    checkbox(
      'medical.disabilityCategory',
      '障害区分',
      ['肢体', '視覚', '聴覚', '内部', '精神', '知的'],
      { required: true },
    ),
    text('medical.disabilityGrade', '障害等級'),
    text('medical.handbookNumber', '障害者手帳番号'),

    radio('mobility.transferAssistLevel', '移乗介助レベル', CARE_LEVELS, {
      required: true,
      helperText: 'ベッド・座席・車両への移乗を想定して選択してください',
    }),
    select('mobility.wheelchair', '車椅子利用', ['なし', '手動車椅子', '電動車椅子', 'シニアカー', '現地レンタル'], {
      required: true,
    }),
    text('mobility.wheelchairManufacturer', '車椅子メーカー', {
      placeholder: '例: WHILL / Permobil',
    }),
    text('mobility.wheelchairModel', '車椅子モデル', {
      placeholder: '例: Model C2',
    }),
    number('mobility.wheelchairWeightKg', '車椅子重量（kg）', {
      helperText: '車椅子を利用する場合は入力してください',
    }),
    radio('mobility.foldable', '折りたたみ可能ですか', YES_NO),
    number('mobility.foldedDimensionsCm.w', '折りたたみ時 幅（cm）'),
    number('mobility.foldedDimensionsCm.d', '折りたたみ時 奥行き（cm）'),
    number('mobility.foldedDimensionsCm.h', '折りたたみ時 高さ（cm）'),
    select('mobility.batteryChemistry', '電池種類', ['なし', '乾電池', '湿式', 'リチウムイオン', '不明'], {
      helperText: '電動車椅子の場合は必須です',
    }),
    number('mobility.batteryVoltageV', 'バッテリー電圧（V）'),
    number('mobility.batteryCapacityAh', 'バッテリー容量（Ah）'),
    number('mobility.batteryWattHourWh', 'バッテリー容量（Wh）', {
      helperText: '分かる場合は入力してください。通常は V × Ah です',
    }),
    radio('mobility.batteryRemovable', 'バッテリーは取り外せますか', YES_NO),
    number('mobility.spareBatteryCount', 'スペアバッテリー本数'),
    text('mobility.un38_3CertificateUrl', 'UN38.3 証明書 URL'),
    text('mobility.batterySelfDeclarationUrl', 'メーカー自己宣言書 URL'),
    radio('mobility.assistanceLevel', '移動全体の介助レベル', CARE_LEVELS),
    textarea('mobility.assistanceDetails', '移動時の補足メモ', {
      placeholder: '例: 通路側席希望、乗降は全介助 など',
    }),
    radio('mobility.canStandWithHelp', '支えがあれば立位保持できますか', YES_NO),
    radio('mobility.canWalkShortDistance', '短距離歩行は可能ですか', YES_NO),
    radio('mobility.canClimbStairs', '階段移動は可能ですか', YES_NO),
    number('mobility.sittingToleranceMin', '連続座位可能時間（分）'),
    radio('mobility.toiletAssistNeeded', '排泄介助が必要ですか', YES_NO),
    radio('mobility.pressureSoreRisk', '褥瘡リスクがありますか', YES_NO),
    checkbox(
      'mobility.consumables',
      '必要な消耗品',
      ['パッド', 'カテーテル', 'ストーマ装具', '吸引カテーテル', '経管栄養関連'],
      {
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      },
    ),
    textarea('mobility.notes', '車椅子・移動面の補足'),

    textarea('medical.conditions', '既往症・疾患名', {
      placeholder: '複数ある場合は改行で入力してください',
    }),
    checkbox(
      'medical.allergies',
      'アレルギー',
      ['食物', '薬剤', 'ラテックス'],
      {
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      },
    ),
    checkbox(
      'medical.medicalDevices',
      '使用中の医療機器',
      ['人工呼吸器', '酸素', 'PEG', 'カテーテル', 'ストーマ', 'CPAP', 'その他'],
    ),
    textarea('medical.medications', '内服薬・常用薬', {
      required: true,
      helperText: '一般名または商品名を改行区切りで入力してください',
      placeholder: '例: モルヒネ 5mg\n例: アムロジピン 5mg',
    }),
    text('medical.medicationDetails[0].genericName', '服薬詳細 1: 薬剤名'),
    text('medical.medicationDetails[0].dosage', '服薬詳細 1: 用量'),
    text('medical.medicationDetails[0].dailyAmount', '服薬詳細 1: 1日量'),
    radio('medical.medicationDetails[0].isNarcotic', '服薬詳細 1: 医療用麻薬ですか', YES_NO),
    radio('medical.medicationDetails[0].isPsychotropic', '服薬詳細 1: 向精神薬ですか', YES_NO),
    radio('medical.medicationDetails[0].mhlwPermitRequired', '服薬詳細 1: 厚労省携帯許可が必要ですか', YES_NO),
    text('medical.medicationDetails[1].genericName', '服薬詳細 2: 薬剤名'),
    text('medical.medicationDetails[1].dosage', '服薬詳細 2: 用量'),
    text('medical.medicationDetails[1].dailyAmount', '服薬詳細 2: 1日量'),
    radio('medical.medicationDetails[1].isNarcotic', '服薬詳細 2: 医療用麻薬ですか', YES_NO),
    radio('medical.medicationDetails[1].isPsychotropic', '服薬詳細 2: 向精神薬ですか', YES_NO),
    radio('medical.medicationDetails[1].mhlwPermitRequired', '服薬詳細 2: 厚労省携帯許可が必要ですか', YES_NO),
    radio('medical.oxygenRequired', '酸素投与が必要ですか', YES_NO),
    text('medical.insuranceProvider', '海外旅行保険会社名', {
      required: true,
    }),
    text('medical.insurancePolicyNumber', '海外旅行保険証券番号', {
      required: true,
    }),
    tel('medical.insuranceEmergencyPhone', '保険会社 緊急連絡先', {
      required: true,
    }),
    text('medical.primaryDoctor.name', '主治医氏名'),
    text('medical.primaryDoctor.clinic', '主治医の医療機関名'),
    tel('medical.primaryDoctor.phone', '主治医の電話番号'),
    text('medical.englishDiagnosisUrl', '英文診断書 URL'),
    text('medical.englishPrescriptionUrl', '英文処方箋 URL'),
    radio('medical.insurancePreExistingRider', '既往症特約に加入していますか', YES_NO),
    number('medical.insuranceCoverageAmountJPY', '補償額（JPY）'),
    textarea('medical.notes', '医療面の補足'),

    select('dietary.form', '食事形態', ['常食', '刻み', 'ミキサー', 'とろみ']),
    radio('dietary.swallowingDifficulty', '嚥下難度', ['なし', '軽度', '中等度', '重度']),
    text('dietary.religion', '宗教食・食文化'),
    textarea('dietary.notes', '食事面の補足'),

    checkbox(
      'accommodationRequirements',
      '宿泊施設に必要な条件',
      ['段差 5cm 以内', 'シャワーチェア必須', '手すり必須', 'ベッド高低め', 'ドア幅広め'],
      {
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      },
    ),
    checkbox(
      'transportRequirements',
      '移動手段に必要な条件',
      ['リフト車', 'スロープ車', '通路側座席', 'アームレスト可動席'],
      {
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      },
    ),
    radio('serviceDogAccompanied', '補助犬の同伴がありますか', YES_NO),

    text('companions[0].name', '同伴者 1: 氏名'),
    text('companions[0].relation', '同伴者 1: 続柄'),
    date('companions[0].dateOfBirth', '同伴者 1: 生年月日'),
    text('companions[0].nationality', '同伴者 1: 国籍'),
    text('companions[0].passportLast4', '同伴者 1: パスポート下4桁'),
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
      placeholder: '複数ある場合はカンマ区切り',
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
