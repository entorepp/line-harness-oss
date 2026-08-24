import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
        return [key, value];
      }),
  );
}

const studioEnv = readEnvFile(path.join(rootDir, 'apps/forms-studio/.env.local'));
const webEnv = readEnvFile(path.join(rootDir, 'apps/web/.env.local'));

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
  throw new Error('API key not found. Use --sql for the approved remote D1 registration path.');
}

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

const FORM_ID = stableUuid('accessible-japan-flat-travel-trip-planning-form-v1');
const FORM_NAME = 'Accessible Japan × Flat Travel Trip Planning Form';

const payload = {
  id: FORM_ID,
  name: FORM_NAME,
  description: 'Tell us where and when you want to travel. Flat Travel, Japan’s accessible travel specialists, will help plan a complete trip with suitable hotels, transport and experiences.',
  fields: [
    {
      name: 'first_name',
      label: 'First / given name',
      type: 'text',
      required: true,
      placeholder: 'e.g. Jane',
    },
    {
      name: 'last_name',
      label: 'Last / family name',
      type: 'text',
      required: true,
      placeholder: 'e.g. Smith',
    },
    {
      name: 'email',
      label: 'Email address',
      type: 'email',
      required: true,
      placeholder: 'name@example.com',
    },
    {
      name: 'budget',
      label: 'Approximate total budget',
      type: 'text',
      required: true,
      placeholder: 'e.g. USD 8,000–10,000',
      helperText: 'For everyone travelling, excluding international flights. Please include the currency.',
    },
    {
      name: 'travellers',
      label: 'Number of travellers',
      type: 'number',
      required: true,
      placeholder: 'e.g. 2',
      digitsOnly: true,
    },
    {
      name: 'city_schedule',
      label: 'Cities and dates',
      type: 'city_dates',
      required: true,
      helperText: 'Add every city you would like to visit and select the dates for each stay.',
      cityPlaceholder: 'City, e.g. Tokyo',
      startDateLabel: 'Start date',
      endDateLabel: 'End date',
      addItemLabel: 'Add another city',
      removeItemLabel: 'Remove',
      maxItems: 12,
    },
    {
      name: 'notes',
      label: 'Anything else you would like us to know?',
      type: 'textarea',
      required: false,
      placeholder: 'Tell us anything that may help us plan your trip.',
    },
  ],
  locale: 'en',
  translationGroupId: null,
  submitButtonLabel: 'Send my trip details',
  successTitle: 'Thank you — we received your trip details',
  successDescription: 'Flat Travel will review your route and contact you by email.',
  onSubmitTagId: null,
  onSubmitScenarioId: null,
  saveToMetadata: false,
  isActive: true,
};

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
  const fieldsJson = JSON.stringify(payload.fields);
  const existsWhere = `(id = ${sqlString(payload.id)} OR name = ${sqlString(payload.name)})`;

  return `INSERT INTO forms
  (id, name, description, fields, locale, translation_group_id, submit_button_label, success_title, success_description, on_submit_tag_id, on_submit_scenario_id, save_to_metadata, is_active, submit_count, created_at, updated_at)
SELECT
  ${sqlString(payload.id)},
  ${sqlString(payload.name)},
  ${sqlString(payload.description)},
  ${sqlString(fieldsJson)},
  ${sqlString(payload.locale)},
  NULL,
  ${sqlString(payload.submitButtonLabel)},
  ${sqlString(payload.successTitle)},
  ${sqlString(payload.successDescription)},
  NULL,
  NULL,
  0,
  1,
  0,
  ${sqlString(now)},
  ${sqlString(now)}
WHERE NOT EXISTS (SELECT 1 FROM forms WHERE ${existsWhere});

UPDATE forms
SET
  name = ${sqlString(payload.name)},
  description = ${sqlString(payload.description)},
  fields = ${sqlString(fieldsJson)},
  locale = ${sqlString(payload.locale)},
  translation_group_id = NULL,
  submit_button_label = ${sqlString(payload.submitButtonLabel)},
  success_title = ${sqlString(payload.successTitle)},
  success_description = ${sqlString(payload.successDescription)},
  on_submit_tag_id = NULL,
  on_submit_scenario_id = NULL,
  save_to_metadata = 0,
  is_active = 1,
  updated_at = ${sqlString(now)}
WHERE ${existsWhere};
`;
}

function buildPublicUrl(formId = payload.id) {
  const url = new URL('/public-form', PUBLIC_BASE_URL);
  url.searchParams.set('id', formId);
  return url.toString();
}

function buildLiffUrl(formId = payload.id) {
  if (!LIFF_BASE_URL.trim()) return null;
  const url = new URL(LIFF_BASE_URL);
  url.searchParams.set('page', 'form');
  url.searchParams.set('id', formId);
  return url.toString();
}

function buildOutput(formId = payload.id) {
  return {
    formId,
    publicUrl: buildPublicUrl(formId),
    liffUrl: buildLiffUrl(formId),
    managementUrl: `${PUBLIC_BASE_URL.replace(/\/$/, '')}/?formId=${encodeURIComponent(formId)}`,
    payload,
  };
}

async function fetchApi(pathname, options = {}) {
  const response = await fetch(`${API_URL}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const json = await response.json();
  if (!response.ok || !json.success) {
    throw new Error(`${pathname} failed: ${json.error || response.statusText}`);
  }
  return json.data;
}

async function upsertForm() {
  const forms = await fetchApi('/api/forms');
  const existing = forms.find((form) => form.id === payload.id || form.name === payload.name);
  if (existing) {
    return fetchApi(`/api/forms/${existing.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }
  return fetchApi('/api/forms', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function main() {
  if (shouldEmitSql) {
    process.stdout.write(buildSql());
    return;
  }
  if (shouldEmitJson) {
    process.stdout.write(`${JSON.stringify(buildOutput(), null, 2)}\n`);
    return;
  }

  const form = await upsertForm();
  process.stdout.write(`${JSON.stringify(buildOutput(form.id), null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
