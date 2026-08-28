import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const publicRoot = path.join(repoRoot, 'apps/forms-studio/public')
const publicOrigin = 'https://liffform-studio.pages.dev'

const formDefinitions = [
  ['tokyo', '96ff4bc9-40df-4b10-a3db-486f82374b30', '移動事業者様アンケート（東京エリア）', 'tokyo-transport-survey', 56],
  ['kyoto', '82119557-3c07-4f17-ab39-193d1fb35df3', '移動事業者様アンケート（京都エリア）', 'kyoto-transport-survey', 47],
  ['osaka', 'f01bcdfc-4b53-44c4-9fbf-9bf5ce2707cb', '移動事業者様アンケート（大阪エリア）', 'osaka-transport-survey', 47],
  ['kanazawa', 'db018579-e461-43cc-84c5-2cdfad0e8d5b', '移動事業者様アンケート（金沢エリア）', 'kanazawa-transport-survey', 30],
  ['hiroshima', '1528b3da-2966-4c7c-945d-38e9ea322204', '移動事業者様アンケート（広島エリア）', 'hiroshima-transport-survey', 36],
  ['fuji-odawara', 'eef7e0b9-c0b0-49d8-8a30-bd34a6cf2c92', '移動事業者様アンケート（富士・箱根エリア／小田原発）', 'fuji-odawara-transport-survey', 40],
  ['fuji-mishima', 'e5a619c2-b729-4d9a-9151-b8e5f7d86382', '移動事業者様アンケート（富士・箱根エリア／三島発）', 'fuji-mishima-transport-survey', 40],
  ['fuji-shizuoka', '96a7fa63-8f10-4e8d-881c-4eef2c32c04b', '移動事業者様アンケート（富士・箱根エリア／静岡発）', 'fuji-shizuoka-transport-survey', 40],
].map(([area, id, name, slug, questionCount]) => ({
  area,
  id,
  name,
  slug,
  questionCount,
}))

function decodeText(value) {
  return value
    .replace(/<[^>]+>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function artifactPath(definition) {
  return path.join(publicRoot, definition.slug, 'index.html')
}

function extractQuestions(definition) {
  const html = fs.readFileSync(artifactPath(definition), 'utf8')
  const questions = new Map()
  const matcher = /<div class="q"([^>]*)><p class="qt"><span class="qn">Q(\d+)<\/span>(.*?)<\/p>/gs

  for (const match of html.matchAll(matcher)) {
    const number = Number(match[2])
    questions.set(number, {
      label: 'Q' + number + ' ' + decodeText(match[3]),
      required: match[1].includes('data-required-question="true"'),
    })
  }

  if (questions.size !== definition.questionCount) {
    throw new Error(
      definition.area + ': expected ' + definition.questionCount +
      ' questions, found ' + questions.size,
    )
  }
  for (let number = 1; number <= definition.questionCount; number += 1) {
    if (!questions.has(number)) {
      throw new Error(definition.area + ': missing Q' + number)
    }
  }
  return questions
}

function fieldType(number) {
  if (number === 3) return 'tel'
  if (number === 4) return 'email'
  if (number === 1 || number === 2) return 'text'
  return 'textarea'
}

function buildPayload(definition) {
  const questions = extractQuestions(definition)
  const fields = Array.from({ length: definition.questionCount }, (_, index) => {
    const number = index + 1
    const question = questions.get(number)
    return {
      name: 'q' + number,
      label: question.label,
      type: fieldType(number),
      required: question.required,
    }
  })

  return {
    id: definition.id,
    name: definition.name,
    description: '今後のお見積もり・ご依頼・配車をスムーズに進めるため、よくご依頼する区間・コースの料金をあらかじめ伺うアンケートです。',
    fields,
    locale: 'ja',
    translationGroupId: null,
    submitButtonLabel: '回答を送信する',
    successTitle: '送信が完了しました',
    successDescription: 'ご協力ありがとうございました。',
    saveToMetadata: false,
    isActive: true,
  }
}

function jstNow() {
  const jst = new Date(Date.now() + 9 * 60 * 60_000)
  return jst.toISOString().slice(0, -1) + '+09:00'
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL'
  return "'" + String(value).replaceAll("'", "''") + "'"
}

function buildSql(payload, now) {
  const fieldsJson = JSON.stringify(payload.fields)
  const idWhere = 'id = ' + sqlString(payload.id)
  return [
    'INSERT INTO forms',
    '  (id, name, description, fields, locale, translation_group_id, submit_button_label, success_title, success_description, on_submit_tag_id, on_submit_scenario_id, save_to_metadata, is_active, submit_count, created_at, updated_at)',
    'SELECT',
    '  ' + sqlString(payload.id) + ',',
    '  ' + sqlString(payload.name) + ',',
    '  ' + sqlString(payload.description) + ',',
    '  ' + sqlString(fieldsJson) + ',',
    '  ' + sqlString(payload.locale) + ',',
    '  NULL,',
    '  ' + sqlString(payload.submitButtonLabel) + ',',
    '  ' + sqlString(payload.successTitle) + ',',
    '  ' + sqlString(payload.successDescription) + ',',
    '  NULL,',
    '  NULL,',
    '  0,',
    '  1,',
    '  0,',
    '  ' + sqlString(now) + ',',
    '  ' + sqlString(now),
    'WHERE NOT EXISTS (SELECT 1 FROM forms WHERE ' + idWhere + ');',
    '',
    'UPDATE forms',
    'SET',
    '  name = ' + sqlString(payload.name) + ',',
    '  description = ' + sqlString(payload.description) + ',',
    '  fields = ' + sqlString(fieldsJson) + ',',
    '  locale = ' + sqlString(payload.locale) + ',',
    '  translation_group_id = NULL,',
    '  submit_button_label = ' + sqlString(payload.submitButtonLabel) + ',',
    '  success_title = ' + sqlString(payload.successTitle) + ',',
    '  success_description = ' + sqlString(payload.successDescription) + ',',
    '  on_submit_tag_id = NULL,',
    '  on_submit_scenario_id = NULL,',
    '  save_to_metadata = 0,',
    '  is_active = 1,',
    '  updated_at = ' + sqlString(now),
    'WHERE ' + idWhere + ';',
    '',
  ].join('\n')
}

const areaArgument = process.argv.find((argument) => argument.startsWith('--area='))
const requestedArea = areaArgument?.slice('--area='.length)
const selectedDefinitions = requestedArea
  ? formDefinitions.filter((definition) => definition.area === requestedArea)
  : formDefinitions

if (!selectedDefinitions.length) {
  throw new Error('Unknown survey area: ' + requestedArea)
}

const payloads = selectedDefinitions.map((definition) => ({
  definition,
  payload: buildPayload(definition),
}))
const now = jstNow()
const sql = payloads.map(({ payload }) => buildSql(payload, now)).join('\n')

if (process.argv.includes('--apply')) {
  const wranglerScript = path.join(repoRoot, 'scripts/cloudflare-wrangler.sh')
  const result = spawnSync(
    wranglerScript,
    ['d1', 'execute', 'line-crm', '--remote', '--command', sql],
    { cwd: repoRoot, stdio: 'inherit' },
  )
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} else if (process.argv.includes('--sql')) {
  process.stdout.write(sql)
} else {
  process.stdout.write(JSON.stringify({
    forms: payloads.map(({ definition, payload }) => ({
      formId: definition.id,
      area: definition.area,
      name: definition.name,
      directUrl: publicOrigin + '/' + definition.slug + '/',
      publicUrl: publicOrigin + '/public-form?id=' + definition.id,
      fieldCount: payload.fields.length,
      payload,
    })),
  }, null, 2) + '\n')
}
