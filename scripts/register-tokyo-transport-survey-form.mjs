import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const artifactPath = path.join(
  repoRoot,
  'apps/forms-studio/public/tokyo-transport-survey/index.html',
)

const FORM_ID = '96ff4bc9-40df-4b10-a3db-486f82374b30'
const FORM_NAME = '移動事業者様アンケート（東京エリア）'
const PUBLIC_URL = 'https://liffform-studio.pages.dev/tokyo-transport-survey/'
const GENERIC_PUBLIC_URL = `https://liffform-studio.pages.dev/public-form?id=${FORM_ID}`

function decodeText(value) {
  return value
    .replace(/<[^>]+>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .trim()
}

function extractQuestionLabels() {
  const html = fs.readFileSync(artifactPath, 'utf8')
  const labels = new Map()
  const matcher = /<span class="qn">Q(\d+)<\/span>(.*?)<\/p>/gs

  for (const match of html.matchAll(matcher)) {
    const number = Number(match[1])
    labels.set(number, `Q${number} ${decodeText(match[2])}`)
  }

  if (labels.size !== 44) {
    throw new Error(`Expected 44 questions, found ${labels.size}`)
  }

  return labels
}

function fieldType(number) {
  if (number === 4) return 'email'
  if (number === 3) return 'tel'
  if ([7, 40, 41].includes(number)) return 'checkbox'
  if ([1, 2, 3, 4, 6].includes(number)) return 'text'
  return 'textarea'
}

function fieldOptions(number) {
  if (number === 7) return ['リフトタイプ', 'スロープタイプ']
  if (number === 40) return ['事前振込', '後払い', '全旅クーポン']
  if (number === 41) {
    return [
      '現金',
      'クレジットカード（タッチ決済）',
      'クレジットカード（端末差込）',
      'その他',
    ]
  }
  return undefined
}

function buildFields() {
  const labels = extractQuestionLabels()
  return Array.from({ length: 44 }, (_, index) => {
    const number = index + 1
    const field = {
      name: `q${number}`,
      label: labels.get(number),
      type: fieldType(number),
      required: false,
    }
    const options = fieldOptions(number)
    if (options) field.options = options
    return field
  })
}

function jstNow() {
  const jst = new Date(Date.now() + 9 * 60 * 60_000)
  return `${jst.toISOString().slice(0, -1)}+09:00`
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL'
  return `'${String(value).replaceAll("'", "''")}'`
}

function buildPayload() {
  return {
    id: FORM_ID,
    name: FORM_NAME,
    description: '今後のお見積もり・ご依頼・配車をスムーズに進めるため、よくご依頼する区間・コースの料金をあらかじめ伺うアンケートです。',
    fields: buildFields(),
    locale: 'ja',
    translationGroupId: null,
    submitButtonLabel: '回答を送信する',
    successTitle: '送信が完了しました',
    successDescription: 'ご協力ありがとうございました。',
    saveToMetadata: false,
    isActive: true,
  }
}

function buildSql(payload) {
  const now = jstNow()
  const fieldsJson = JSON.stringify(payload.fields)
  const idWhere = `id = ${sqlString(payload.id)}`

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
WHERE NOT EXISTS (SELECT 1 FROM forms WHERE ${idWhere});

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
WHERE ${idWhere};
`
}

const payload = buildPayload()

if (process.argv.includes('--apply')) {
  const wranglerScript = path.join(repoRoot, 'scripts/cloudflare-wrangler.sh')
  const result = spawnSync(
    wranglerScript,
    ['d1', 'execute', 'line-crm', '--remote', '--command', buildSql(payload)],
    { cwd: repoRoot, stdio: 'inherit' },
  )
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} else if (process.argv.includes('--sql')) {
  process.stdout.write(buildSql(payload))
} else {
  process.stdout.write(`${JSON.stringify({
    formId: FORM_ID,
    publicUrl: PUBLIC_URL,
    genericPublicUrl: GENERIC_PUBLIC_URL,
    fieldCount: payload.fields.length,
    payload,
  }, null, 2)}\n`)
}
