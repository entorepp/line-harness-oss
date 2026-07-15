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

const PUBLIC_BASE_URL = process.env.FORMS_PUBLIC_BASE_URL
  || process.env.NEXT_PUBLIC_FORMS_STUDIO_URL
  || studioEnv.NEXT_PUBLIC_FORMS_STUDIO_URL
  || 'https://liffform-studio.pages.dev';

const LIFF_BASE_URL = process.env.LIFF_FORM_BASE_URL
  || process.env.NEXT_PUBLIC_LIFF_URL
  || studioEnv.NEXT_PUBLIC_LIFF_URL
  || webEnv.NEXT_PUBLIC_LIFF_URL
  || '';

const shouldEmitSql = process.argv.includes('--sql');
const shouldEmitJson = process.argv.includes('--json');

if (!API_KEY && !shouldEmitSql && !shouldEmitJson) {
  throw new Error('API key not found. Set FORMS_API_KEY or define NEXT_PUBLIC_API_KEY in apps/web/.env.local');
}

const SOURCE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1HlZPj69bFhf9W5kWyvXJKKzyx8vCCCUT0ZePHWy7KiI/edit#gid=398033132';
const FORM_NAME = 'タクシー事業者様用：ヒアリングシート';
const TRANSLATION_GROUP_ID = stableUuid('flatcare-taxi-accessibility-hearing-form');
const FORM_ID = stableUuid(`${TRANSLATION_GROUP_ID}:ja`);

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

function field(name, label, type, extras = {}) {
  return {
    name,
    label,
    type,
    required: true,
    ...extras,
  };
}

function optionalField(name, label, type = 'text', extras = {}) {
  return field(name, label, type, {
    required: false,
    ...extras,
  });
}

const formPayload = {
  id: FORM_ID,
  name: FORM_NAME,
  description: [
    'タクシー・介護タクシー・ハイヤー事業者様向けのヒアリングシートです。',
    '車いす対応車両、送迎・観光料金、介助・言語対応、旅行会社との取引条件についてご回答ください。',
    '車種や条件によって回答が異なる場合は、車両ごとに分けてご記入ください。',
  ].join('\n'),
  fields: [
    field('operator_name', '事業者名をご記入ください', 'text'),
    field('business_category', '事業区分を選択してください', 'radio', {
      options: ['タクシー会社', '介護タクシー', 'ハイヤー・貸切車事業者'],
      allowOtherOption: true,
      otherOptionLabel: 'その他',
    }),
    field('service_area', '主な営業・対応エリアをご記入ください', 'text'),
    optionalField('website_url', '公式WebサイトURLをご記入ください', 'text', {
      placeholder: 'https://example.com',
    }),
    optionalField('operator_address', '事業者住所をご記入ください'),
    field('contact_phone', '本件のご連絡先電話番号をご記入ください', 'tel'),
    optionalField('contact_email', '本件のご連絡先メールアドレスをご記入ください', 'email'),
    field(
      'dispatch_origin_area',
      '配車可能な出発エリアと、配車できない地域・条件をご教示ください',
      'textarea',
      {
        helperText: '例：静岡市内発のみ対応、東京都23区内は配車可能、遠方は回送料が必要。',
      },
    ),
    field(
      'wheelchair_accessible_vehicle_models',
      '車いすに乗ったまま乗車できる保有車種をご教示ください',
      'textarea',
      {
        helperText: 'メーカー、車種、仕様、車いす乗車位置を車両ごとにご記入ください。移乗が必要な車両はその旨をご記入ください。',
      },
    ),
    field('boarding_equipment', '車いす乗車時の設備・方法を選択してください', 'checkbox', {
      options: ['リフト車', 'スロープ車', '移乗して一般座席へ乗車', '車いす対応車両なし'],
      allowOtherOption: true,
      otherOptionLabel: 'その他',
    }),
    optionalField(
      'wheelchair_accessible_fleet_count',
      '車いす対応車両の保有台数を車種・仕様ごとにご記入ください',
      'textarea',
    ),
    optionalField(
      'passenger_capacity_with_one_wheelchair',
      '車いす1台を乗せた場合の最大乗車定員を車種ごとにご記入ください',
      'textarea',
    ),
    optionalField(
      'max_wheelchair_weight_kg',
      '乗車可能な車いす・利用者合計の最大耐重量（kg）を車種ごとにご記入ください',
      'text',
    ),
    optionalField('max_wheelchair_width_cm', '乗車可能な車いすの最大横幅（cm）を車種ごとにご記入ください'),
    optionalField('max_wheelchair_depth_cm', '乗車可能な車いすの最大奥行き（cm）を車種ごとにご記入ください'),
    optionalField('max_wheelchair_height_cm', '乗車可能な車いすの最大高さ（cm）を車種ごとにご記入ください'),
    optionalField(
      'luggage_capacity_at_max_occupancy',
      '最大定員かつ車いす1台利用時に積載できるスーツケース数・サイズをご記入ください',
      'textarea',
    ),
    optionalField(
      'airport_transfer_pricing',
      '主要空港からホテルまでの送迎料金例をご教示ください',
      'textarea',
      {
        helperText: '空港・到着口、ホテルまたはエリア、車種、片道料金、税・高速・駐車料金の扱いをご記入ください。',
      },
    ),
    optionalField(
      'airport_meet_and_greet',
      '空港到着口でのボード待機・出迎え可否、待機場所、料金、無料待機時間をご教示ください',
      'textarea',
    ),
    optionalField(
      'station_meet_and_transfer_pricing',
      '主要駅の改札・ホームでの合流可否と、駅からホテルまでの送迎料金例をご教示ください',
      'textarea',
    ),
    optionalField(
      'sightseeing_8h_pricing',
      '8時間の観光貸切料金とモデルルート例をご教示ください',
      'textarea',
      {
        helperText: 'エリア、車種、走行距離・時間制限、外国語ドライバー指定料、適用可能な割引を含めてください。',
      },
    ),
    optionalField(
      'sightseeing_10h_pricing',
      '10時間の観光貸切料金とモデルルート例をご教示ください',
      'textarea',
      {
        helperText: 'エリア、車種、走行距離・時間制限、外国語ドライバー指定料、適用可能な割引を含めてください。',
      },
    ),
    field('driver_languages', '対応可能なドライバー言語を選択してください', 'checkbox', {
      options: ['日本語', '英語', '中国語（普通話）', '中国語（広東語）', '韓国語', 'スペイン語', 'フランス語'],
      allowOtherOption: true,
      otherOptionLabel: 'その他',
    }),
    optionalField(
      'mobility_equipment_loans',
      'スロープ、踏み台、貸出用車いす等の種類・数量・料金・手配期限をご教示ください。写真URLがあれば併記してください',
      'textarea',
    ),
    optionalField(
      'toll_parking_prepayment',
      '駐車場代・高速道路料金を事前払いまたは見積内に含められるか、精算方法とあわせてご教示ください',
      'textarea',
      {
        placeholder: '例：見積内に概算計上可能。差額は運行後に請求書で精算。',
      },
    ),
    optionalField(
      'guide_arrangement_languages',
      '観光ガイドの手配可否、対応言語、料金、手配期限をご教示ください',
      'textarea',
    ),
    optionalField(
      'off_vehicle_guide_capacity',
      'ドライバーまたはガイドが下車して観光案内できるか、言語別の対応人数・稼働可能人数をご教示ください',
      'textarea',
    ),
    optionalField(
      'multi_day_driver_continuity',
      '同じドライバーが連続対応できる最大日数と、宿泊を伴う場合の宿泊手配・費用条件をご教示ください',
      'textarea',
    ),
    optionalField(
      'physical_assistance_qualifications',
      '乗務員が対応可能な身体介助と、保有する介護・福祉関連資格をご教示ください',
      'textarea',
      {
        helperText: '例：乗降介助、階段介助、移乗介助。対応できない介助も明記してください。',
      },
    ),
    optionalField(
      'transfer_wheelchair_assistance',
      '移乗サポート・車いすを押すサポートの対応範囲を選択してください',
      'checkbox',
      {
        options: ['車両乗降時の見守り', '移乗介助', '車いすを押す介助', '車いす・荷物の積み下ろし', '対応不可'],
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      },
    ),
    optionalField(
      'driver_meal_expense',
      '観光中の乗務員・ガイドの食事代がお客様負担か、食事・休憩条件とあわせてご教示ください',
      'textarea',
    ),
    optionalField(
      'route_planning_support',
      '観光ルートの作成・提案可否と、料金、必要な準備期間、提供形式をご教示ください',
      'textarea',
    ),
    optionalField(
      'flight_delay_policy',
      '飛行機・列車が遅延した場合の待機、追加料金、運行可否をご教示ください',
      'textarea',
      {
        helperText: '30分、2時間、5時間遅延した場合を目安にご記入ください。',
      },
    ),
    optionalField(
      'direct_messaging_exchange',
      '運行前にWhatsApp等でお客様と直接連絡先を交換できるか、利用可能な連絡手段・タイミング・条件をご教示ください',
      'textarea',
      {
        placeholder: '例：WhatsApp、LINE、WeChat。運行3日前から交換可能。',
      },
    ),
    optionalField(
      'travel_agency_coupon_commission',
      '全旅クーポン、旅行会社向けコミッション、タリフの有無と計算方法をご教示ください',
      'textarea',
    ),
    optionalField(
      'payment_methods',
      '対応可能な支払い方法と、支払期限、事前金、実費精算、請求書発行方法をご教示ください',
      'textarea',
      {
        placeholder: '例：請求書払い。運行後翌月末振込。高速・駐車場代は運行後に実費精算。',
      },
    ),
    optionalField(
      'recommended_model_courses',
      'おすすめのモデルコースをご記入ください。既存資料やWebページがあればURLもご記入ください',
      'textarea',
    ),
    field('cancellation_policy', 'キャンセルポリシーをご記入ください', 'textarea'),
    optionalField(
      'photo_and_document_urls',
      '車両・設備写真、車両諸元、料金表、モデルコース等のURLをご記入ください',
      'textarea',
      {
        placeholder: 'URLが複数ある場合は、1行に1件ずつご記入ください。',
      },
    ),
  ],
  locale: 'ja',
  translationGroupId: TRANSLATION_GROUP_ID,
  submitButtonLabel: '送信',
  successTitle: '送信が完了しました',
  successDescription: 'ご回答ありがとうございます。内容を確認して担当者よりご連絡いたします。',
  saveToMetadata: true,
  isActive: true,
};

const TAXI_SHEET_COLUMN_COVERAGE = [
  { source: 'タクシー会社', fields: ['operator_name'] },
  { source: 'タクシー会社／介護タクシー', fields: ['business_category'] },
  { source: 'エリア', fields: ['service_area'] },
  { source: '参考URL', fields: ['website_url'] },
  { source: '事業者住所', fields: ['operator_address'] },
  { source: '電話番号', fields: ['contact_phone'] },
  { source: 'メールアドレス', fields: ['contact_email'] },
  { source: '配車可能出発エリア', fields: ['dispatch_origin_area'] },
  { source: '保有車種', fields: ['wheelchair_accessible_vehicle_models'] },
  { source: 'リフト車／スロープ車', fields: ['boarding_equipment'] },
  { source: '保有台数', fields: ['wheelchair_accessible_fleet_count'] },
  { source: '定員（車いす1台利用）', fields: ['passenger_capacity_with_one_wheelchair'] },
  { source: '耐重量', fields: ['max_wheelchair_weight_kg'] },
  { source: '最大横幅', fields: ['max_wheelchair_width_cm'] },
  { source: '最大縦幅', fields: ['max_wheelchair_depth_cm'] },
  { source: '最大高さ', fields: ['max_wheelchair_height_cm'] },
  { source: '最大定員時のスーツケース数', fields: ['luggage_capacity_at_max_occupancy'] },
  { source: '空港送迎料金', fields: ['airport_transfer_pricing'] },
  { source: '到着口待機可否／料金', fields: ['airport_meet_and_greet'] },
  { source: '改札合流・駅送迎料金', fields: ['station_meet_and_transfer_pricing'] },
  { source: '観光8時間', fields: ['sightseeing_8h_pricing'] },
  { source: '観光10時間', fields: ['sightseeing_10h_pricing'] },
  { source: 'ドライバー言語', fields: ['driver_languages'] },
  { source: 'スロープ・踏み台・車いす貸出', fields: ['mobility_equipment_loans'] },
  { source: '駐車場・高速代の前払い', fields: ['toll_parking_prepayment'] },
  { source: 'ガイド手配・言語', fields: ['guide_arrangement_languages'] },
  { source: '下車観光ガイド・言語別キャパ', fields: ['off_vehicle_guide_capacity'] },
  { source: '同一ドライバー連続対応・宿泊', fields: ['multi_day_driver_continuity'] },
  { source: '身体介助・介護資格', fields: ['physical_assistance_qualifications'] },
  { source: '移乗・車いすを押すサポート', fields: ['transfer_wheelchair_assistance'] },
  { source: '乗務員の食事代', fields: ['driver_meal_expense'] },
  { source: '観光ルート作成', fields: ['route_planning_support'] },
  { source: '飛行機遅延時の対応', fields: ['flight_delay_policy'] },
  { source: 'WhatsApp等の連絡先交換', fields: ['direct_messaging_exchange'] },
  { source: '全旅クーポン・コミッション', fields: ['travel_agency_coupon_commission'] },
  { source: '支払い方法', fields: ['payment_methods'] },
  { source: 'おすすめモデルコース', fields: ['recommended_model_courses'] },
  { source: 'キャンセルポリシー', fields: ['cancellation_policy'] },
  { source: '写真等のURL', fields: ['photo_and_document_urls'] },
];

function validateFormDefinition(form, coverage) {
  const fieldNames = form.fields.map((item) => item.name);
  const uniqueFieldNames = new Set(fieldNames);
  if (fieldNames.length !== uniqueFieldNames.size) {
    throw new Error('Duplicate taxi form field names detected');
  }

  const missingMappings = coverage.flatMap((item) => item.fields
    .filter((fieldName) => !uniqueFieldNames.has(fieldName))
    .map((fieldName) => ({ source: item.source, fieldName })));
  if (missingMappings.length > 0) {
    throw new Error(`Taxi sheet coverage references missing fields: ${JSON.stringify(missingMappings)}`);
  }

  if (coverage.length !== 39) {
    throw new Error(`Expected coverage for 39 taxi sheet columns, received ${coverage.length}`);
  }

  const splitMappings = coverage.filter((item) => item.fields.length !== 1);
  const mappedFieldNames = coverage.map((item) => item.fields[0]);
  if (
    splitMappings.length > 0
    || form.fields.length !== coverage.length
    || new Set(mappedFieldNames).size !== mappedFieldNames.length
  ) {
    throw new Error('Taxi form must keep a strict one-sheet-column-to-one-question mapping');
  }
}

validateFormDefinition(formPayload, TAXI_SHEET_COLUMN_COVERAGE);

const payloads = [formPayload];

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
  return payloads.map((form) => {
    const fieldsJson = JSON.stringify(form.fields);
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

function buildPublicUrl(formId) {
  const url = new URL('/public-form', PUBLIC_BASE_URL);
  url.searchParams.set('id', formId);
  return url.toString();
}

function buildLiffUrl(formId) {
  if (!LIFF_BASE_URL.trim()) return '';

  const url = new URL(LIFF_BASE_URL);
  url.searchParams.set('page', 'form');
  url.searchParams.set('id', formId);
  return url.toString();
}

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

async function upsertForm(form) {
  const forms = await fetchApi('/api/forms');
  const existing = forms.find((item) => (
    (
      item.translationGroupId === form.translationGroupId
      && item.locale === form.locale
    )
    || item.name === form.name
  ));

  if (existing) {
    const updated = await fetchApi(`/api/forms/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify(form),
    });
    return { action: 'updated', form: updated };
  }

  const created = await fetchApi('/api/forms', {
    method: 'POST',
    body: JSON.stringify(form),
  });
  return { action: 'created', form: created };
}

function buildOutput(form = formPayload) {
  const publicUrl = buildPublicUrl(form.id);
  const liffUrl = buildLiffUrl(form.id);
  return {
    sourceSheetUrl: SOURCE_SHEET_URL,
    locale: form.locale,
    formId: form.id,
    publicUrl,
    liffUrl: liffUrl || null,
    payload: form,
  };
}

async function main() {
  if (shouldEmitSql) {
    process.stdout.write(buildSql());
    return;
  }

  if (shouldEmitJson) {
    process.stdout.write(`${JSON.stringify(payloads.map(buildOutput), null, 2)}\n`);
    return;
  }

  console.log(`API URL: ${API_URL}`);
  for (const form of payloads) {
    const result = await upsertForm(form);
    const output = buildOutput({ ...form, id: result.form.id });

    console.log(`${result.action.toUpperCase()}: ${result.form.name}`);
    console.log(`  locale: ${result.form.locale}`);
    console.log(`  id: ${result.form.id}`);
    console.log(`  fields: ${form.fields.length}`);
    console.log(`  public: ${output.publicUrl}`);
    if (output.liffUrl) {
      console.log(`  liff: ${output.liffUrl}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
