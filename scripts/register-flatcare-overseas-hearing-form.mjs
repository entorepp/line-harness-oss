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

const OVERSEAS_FORM_NAME = 'flatcare 海外旅行 事前ヒアリング v1';
const LEGACY_OVERSEAS_FORM_NAME = 'flatcare 事前ヒアリング v1';

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

  const forms = await fetchApi('/api/forms');
  const source = forms.find((form) => form.name === LEGACY_OVERSEAS_FORM_NAME)
    || forms.find((form) => form.name === OVERSEAS_FORM_NAME);

  if (!source) {
    throw new Error(
      `Source overseas form not found. Expected "${LEGACY_OVERSEAS_FORM_NAME}" or "${OVERSEAS_FORM_NAME}".`,
    );
  }

  const payload = {
    name: OVERSEAS_FORM_NAME,
    description: '海外旅行を前提にした事前ヒアリングフォームです。パスポート、海外旅行保険、渡航時の医療・移動・介助に必要な情報を確認します。',
    locale: source.locale || 'ja',
    submitButtonLabel: source.submitButtonLabel || '送信して担当者へ共有',
    successTitle: source.successTitle || '送信ありがとうございました',
    successDescription: source.successDescription || '内容は担当者へ共有され、海外旅行の手配相談に利用されます。',
    saveToMetadata: source.saveToMetadata ?? true,
    fields: source.fields,
  };

  const result = await upsertForm(payload);
  console.log(`${result.action.toUpperCase()}: ${result.form.name}`);
  console.log(`  id: ${result.form.id}`);
  console.log(`  source: ${source.name} (${source.id})`);
  console.log(`  public: ${PUBLIC_BASE_URL}/public-form?id=${result.form.id}`);
  console.log(`  fields: ${payload.fields.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
