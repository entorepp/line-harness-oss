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

const SOURCE_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfmz1l1sfzyVdCiKAzTPMKl3hCVjgOMyOgZfafEujfB_k8BpA/viewform?usp=header';
const FORM_NAME = 'ホテル事業者様用：ヒアリングシート';
const TRANSLATION_GROUP_ID = stableUuid('flatcare-hotel-accessibility-hearing-form');
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

function optionalText(name, label, extras = {}) {
  return field(name, label, 'text', {
    required: false,
    ...extras,
  });
}

function fileUpload(name, label, extras = {}) {
  return field(name, label, 'file', {
    required: false,
    multiple: true,
    ...extras,
  });
}

function notesField(name, label = '上記について補足・備考があればご記入ください') {
  return field(name, label, 'textarea', {
    required: false,
    placeholder: '補足・備考があればご記入ください',
  });
}

function withNotes(baseField, notesName, notesLabel) {
  return [
    baseField,
    notesField(notesName, notesLabel),
  ];
}

const formPayload = {
  id: FORM_ID,
  name: FORM_NAME,
  description: [
    'ホテル事業者様向けヒアリングシートです。',
    'バリアフリー対応客室、設備、貸出備品、お食事、特別リクエスト対応についてご回答ください。',
  ].join('\n'),
  fields: [
    field('property_name', '宿泊施設のお名前を教えてください', 'text'),
    optionalText('accessible_room_name', 'バリアフリー対応の客室の名前を教えてください'),
    field(
      'same_rate_room_type',
      'バリアフリー客室は一般客室のどのお部屋と同じご料金で管理されているか教えてください',
      'text',
    ),
    field(
      'room_type_inventory',
      '自社作成済みの客室タイプごとに教えてください（ツイン・1室など）',
      'text',
    ),
    optionalText('room_capacity', '客室ごとの定員を教えてください'),
    field('room_floor', '客室のフロアを教えてください', 'text'),
    field('room_facilities', '部屋の設備についてご回答ください', 'textarea'),
    fileUpload('accessible_room_floor_plan', 'バリアフリールームの平面図があれば添付してください', {
      accept: 'image/*,application/pdf',
    }),
    field('available_equipment_inventory', '提供可能な福祉用具の種類と在庫数をご教示ください', 'textarea'),
    fileUpload('rental_equipment_photos', '貸出用品の写真があれば添付してください', {
      accept: 'image/*',
    }),
    ...withNotes(
      field(
        'equipment_rental_timing',
        '福祉用具のレンタル方法は当日受付と事前手配のどちらに対応していますでしょうか。',
        'checkbox',
        {
          options: ['事前手配', '当日受付'],
          allowOtherOption: true,
          otherOptionLabel: 'その他',
        },
      ),
      'equipment_rental_timing_notes',
      '福祉用具レンタル方法について補足・備考があればご記入ください',
    ),
    ...withNotes(
      field(
        'hollywood_twin_available',
        'バリアフリールームのツインタイプのお部屋や洗い場がある場合、ハリウッドツインの対応は可能でしょうか。',
        'radio',
        {
          options: ['可', '不可'],
        },
      ),
      'hollywood_twin_available_notes',
      'ハリウッドツイン対応について補足・備考があればご記入ください',
    ),
    ...withNotes(
      field('meal_plan_types', 'ご提供可能な食事タイプをご教示ください', 'checkbox', {
        options: ['素泊まり', '朝食付き', '夕・朝食付き'],
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      }),
      'meal_plan_types_notes',
      '食事タイプについて補足・備考があればご記入ください',
    ),
    ...withNotes(
      field(
        'extra_bed_types',
        'バリアフリールームにエキストラベッドの対応が可能な場合、ベッドタイプをご教示ください',
        'checkbox',
        {
          options: ['ベッド', '布団'],
          allowOtherOption: true,
          otherOptionLabel: 'その他',
        },
      ),
      'extra_bed_types_notes',
      'エキストラベッド対応について補足・備考があればご記入ください',
    ),
    ...withNotes(
      field('special_request_support', '特別リクエストの対応についてご教示ください', 'checkbox', {
        options: [
          '福祉用具の搬入（現地にて外部業者を手配する場合）',
          '車椅子の事前預かり',
          '駐車場の手配（障害者用）',
          '補助犬の受け入れ',
        ],
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      }),
      'special_request_notes',
      '上記の特別リクエストに関して、補足・備考があればご記入ください',
    ),
    ...withNotes(
      field(
        'guest_room_lift_space',
        '客室内のリフト保管場所の有無（客室内でリフトの移動が可能なスペースがあるか）',
        'radio',
        {
          options: ['有', '無'],
        },
      ),
      'guest_room_lift_space_notes',
      'リフト保管場所や移動スペースについて補足・備考があればご記入ください',
    ),
    optionalText(
      'delivery_entrance_route',
      '搬入口・搬入経路について一般のお客様の入口以外で対応可能でしたらご教示ください',
    ),
    field(
      'delivery_time_restrictions',
      '搬入搬出日時について制約から何時の対応が適切か、追加料金の情報など',
      'textarea',
    ),
    ...withNotes(
      field('meal_special_request_support', 'お食事の特別リクエストの対応についてご教示ください。', 'checkbox', {
        options: [
          '刻み食対応',
          '食事のとろみ付け',
          'アレルギー対応',
          '腎臓病・ローカリウム対応',
          '低塩食対応',
        ],
        allowOtherOption: true,
        otherOptionLabel: 'その他',
      }),
      'meal_special_request_notes',
      '上記のお食事に関する特別リクエストについて、補足・備考があればご記入ください',
    ),
    field(
      'past_accessibility_cases',
      '今までの配慮が必要なお受け入れ情報について、可能な範囲で人数や具体のお客様事例などをご教示ください。また、過去お客様からご意見を頂戴したことのある改善点があれば教えてください',
      'textarea',
    ),
    field(
      'accessible_private_bath',
      '車いす利用可能な貸切風呂や大浴場をお持ちの場合、その料金と商品名についてご教示ください',
      'textarea',
    ),
    field(
      'accessible_parking',
      '駐車場をお持ちの場合、身障者用駐車場の数とそのご料金をご教示ください',
      'textarea',
    ),
    field(
      'other_accessibility_services',
      '上記以外に貴社が独自に提供している配慮が必要な方向けたサービスや特機能がございましたらご教示くださいませ。',
      'textarea',
    ),
    ...withNotes(
      field(
        'free_media_feature_permission',
        '弊社ホームページ・SNS投稿・パンフレット等で、身体や年齢等の配慮が必要なお客様に向けて、貴施設の客室・お食事・サービス情報を無料でご紹介させていただく場合がございます。掲載前には必ず事前確認をいたしますので、紹介可否についてご回答ください',
        'radio',
        {
          options: ['事前確認のうえで紹介してよい', '紹介は希望しない'],
        },
      ),
      'free_media_feature_permission_notes',
      '掲載・紹介にあたってのご希望や注意事項があればご記入ください',
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
    sourceFormUrl: SOURCE_FORM_URL,
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
