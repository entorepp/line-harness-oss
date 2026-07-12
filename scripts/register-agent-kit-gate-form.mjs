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

const AGENT_KIT_URL = 'https://drive.google.com/drive/folders/1SB1K38sai-K0KKg14dlBvdV7aTEbHYEu?usp=drive_link';
const TRANSLATION_GROUP_ID = stableUuid('flatcare-agent-kit-gate-form');
const LOCALES = ['en', 'ja', 'ko', 'zh-TW', 'zh-CN'];
const FORM_IDS = Object.fromEntries(
  LOCALES.map((locale) => [locale, stableUuid(`${TRANSLATION_GROUP_ID}:${locale}`)]),
);
const FORM_ID = FORM_IDS.en;

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

const localeCopy = {
  en: {
    name: 'Flat Care Agent Kit Access Form',
    description: 'Please submit your company contact details to access the Flat Care Agent Kit.',
    submitButtonLabel: 'Access the Agent Kit',
    successTitle: 'Opening the Agent Kit',
    successDescription: 'Thank you. We are opening the Agent Kit now.',
    companyName: 'Company name',
    contactPersonName: 'Contact person name',
    position: 'Position',
    email: 'Email address',
    phone: 'Phone number',
    companyNamePlaceholder: 'Example: ABC Travel Co., Ltd.',
    contactPersonNamePlaceholder: 'Example: Jane Smith',
    positionPlaceholder: 'Example: Product Manager / Travel Consultant',
    emailPlaceholder: 'name@example.com',
    phonePlaceholder: '+1 555 123 4567',
  },
  ja: {
    name: 'Flat Care Agent Kit アクセスフォーム',
    description: 'Flat Care Agent Kitにアクセスするため、会社のご連絡先情報をご入力ください。',
    submitButtonLabel: 'Agent Kitを開く',
    successTitle: 'Agent Kitを開いています',
    successDescription: 'ありがとうございます。Agent Kitを開いています。',
    companyName: '会社名',
    contactPersonName: '担当者名',
    position: 'ポジション',
    email: 'メールアドレス',
    phone: '電話番号',
    companyNamePlaceholder: '例: ABC Travel株式会社',
    contactPersonNamePlaceholder: '例: 山田 太郎',
    positionPlaceholder: '例: 商品企画 / 旅行コンサルタント',
    emailPlaceholder: 'name@example.com',
    phonePlaceholder: '+81 90 1234 5678',
  },
  ko: {
    name: 'Flat Care Agent Kit 액세스 폼',
    description: 'Flat Care Agent Kit에 액세스하기 위해 회사 연락처 정보를 입력해 주세요.',
    submitButtonLabel: 'Agent Kit 열기',
    successTitle: 'Agent Kit을 여는 중입니다',
    successDescription: '감사합니다. Agent Kit을 여는 중입니다.',
    companyName: '회사명',
    contactPersonName: '담당자명',
    position: '포지션',
    email: '이메일 주소',
    phone: '전화번호',
    companyNamePlaceholder: '예: ABC Travel Co., Ltd.',
    contactPersonNamePlaceholder: '예: Kim Minji',
    positionPlaceholder: '예: 상품 기획 / 여행 컨설턴트',
    emailPlaceholder: 'name@example.com',
    phonePlaceholder: '+82 10 1234 5678',
  },
  'zh-TW': {
    name: 'Flat Care Agent Kit 存取表單',
    description: '請填寫貴公司的聯絡資訊，以存取 Flat Care Agent Kit。',
    submitButtonLabel: '開啟 Agent Kit',
    successTitle: '正在開啟 Agent Kit',
    successDescription: '謝謝。正在為您開啟 Agent Kit。',
    companyName: '公司名稱',
    contactPersonName: '聯絡人姓名',
    position: '職位',
    email: '電子郵件地址',
    phone: '電話號碼',
    companyNamePlaceholder: '例: ABC Travel Co., Ltd.',
    contactPersonNamePlaceholder: '例: Wang Mei',
    positionPlaceholder: '例: 產品企劃 / 旅行顧問',
    emailPlaceholder: 'name@example.com',
    phonePlaceholder: '+886 912 345 678',
  },
  'zh-CN': {
    name: 'Flat Care Agent Kit 访问表单',
    description: '请填写贵公司的联系信息，以访问 Flat Care Agent Kit。',
    submitButtonLabel: '打开 Agent Kit',
    successTitle: '正在打开 Agent Kit',
    successDescription: '谢谢。正在为您打开 Agent Kit。',
    companyName: '公司名称',
    contactPersonName: '联系人姓名',
    position: '职位',
    email: '电子邮件地址',
    phone: '电话号码',
    companyNamePlaceholder: '例: ABC Travel Co., Ltd.',
    contactPersonNamePlaceholder: '例: Wang Mei',
    positionPlaceholder: '例: 产品企划 / 旅行顾问',
    emailPlaceholder: 'name@example.com',
    phonePlaceholder: '+86 138 0000 0000',
  },
};

function buildPayload(locale) {
  const copy = localeCopy[locale];
  return {
    id: FORM_IDS[locale],
    name: copy.name,
    description: copy.description,
    fields: [
      field('company_name', copy.companyName, 'text', {
        placeholder: copy.companyNamePlaceholder,
      }),
      field('contact_person_name', copy.contactPersonName, 'text', {
        placeholder: copy.contactPersonNamePlaceholder,
      }),
      field('position', copy.position, 'text', {
        placeholder: copy.positionPlaceholder,
      }),
      field('email', copy.email, 'email', {
        placeholder: copy.emailPlaceholder,
      }),
      field('phone', copy.phone, 'tel', {
        placeholder: copy.phonePlaceholder,
      }),
    ],
    locale,
    translationGroupId: TRANSLATION_GROUP_ID,
    submitButtonLabel: copy.submitButtonLabel,
    successTitle: copy.successTitle,
    successDescription: copy.successDescription,
    saveToMetadata: true,
    isActive: true,
  };
}

const payloads = LOCALES.map(buildPayload);
const payload = payloads[0];

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

function withRedirect(url) {
  const next = new URL(url);
  next.searchParams.set('redirect', AGENT_KIT_URL);
  return next.toString();
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
  const existing = forms.find((form) => (
    (
      form.translationGroupId === TRANSLATION_GROUP_ID
      && form.locale === formPayload.locale
    )
    || form.name === formPayload.name
  ));

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

function buildOutput(form = payload) {
  const publicUrl = buildPublicUrl(form.id);
  const liffUrl = buildLiffUrl(form.id);
  return {
    locale: form.locale,
    formId: form.id,
    publicUrl,
    publicRedirectUrl: withRedirect(publicUrl),
    liffUrl: liffUrl || null,
    liffRedirectUrl: liffUrl ? withRedirect(liffUrl) : null,
    agentKitUrl: AGENT_KIT_URL,
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
  for (const formPayload of payloads) {
    const result = await upsertForm(formPayload);
    const output = buildOutput({ ...formPayload, id: result.form.id });

    console.log(`${result.action.toUpperCase()}: ${result.form.name}`);
    console.log(`  locale: ${result.form.locale}`);
    console.log(`  id: ${result.form.id}`);
    console.log(`  fields: ${formPayload.fields.length}`);
    console.log(`  public: ${output.publicUrl}`);
    console.log(`  public + redirect: ${output.publicRedirectUrl}`);
    if (output.liffUrl) {
      console.log(`  liff: ${output.liffUrl}`);
      console.log(`  liff + redirect: ${output.liffRedirectUrl}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
