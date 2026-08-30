import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const FORM_ID = '72fa9940-164a-4efb-9ad8-e819bfeb8c91'
const FORM_NAME = '受注後・ご出発前アンケート'
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const artifactPath = path.join(
  repoRoot,
  'apps/forms-studio/public/post-order-survey/index.html',
)

function extractSurveyModel(source) {
  const needStart = source.indexOf('const NEED=')
  const needEnd = source.indexOf('\n', needStart)
  const countryStart = source.indexOf('const COUNTRIES=')
  const surveyStart = source.indexOf('const S=[')
  const surveyEnd = source.indexOf('\nconst UP=', surveyStart)
  if ([needStart, needEnd, countryStart, surveyStart, surveyEnd].some((offset) => offset < 0)) {
    throw new Error('Unable to locate the reviewed survey model')
  }

  const context = {}
  vm.createContext(context)
  vm.runInContext([
    source.slice(needStart, needEnd),
    source.slice(countryStart, surveyStart),
    source.slice(surveyStart, surveyEnd),
    'this.surveyModel=S;',
  ].join('\n'), context)
  return context.surveyModel
}

function buildFields(source) {
  const fields = []
  let questionNumber = 0
  for (const section of extractSurveyModel(source)) {
    const definitions = [...section.f, ...(section.sub?.f || [])]
    for (const field of definitions) {
      questionNumber += 1
      fields.push({
        name: `q${questionNumber}`,
        label: `Q${questionNumber} ${field.j} / ${field.e}`,
        type: field.t === 'file' ? 'file' : 'textarea',
        required: false,
        ...(field.t === 'file'
          ? {
            accept: field.accept || 'image/*,application/pdf',
            multiple: Boolean(field.multiple),
            maxFiles: field.multiple ? 3 : 1,
          }
          : {}),
      })
    }
  }
  if (questionNumber !== 53) {
    throw new Error(`Expected 53 numbered questions, found ${questionNumber}`)
  }
  fields.push(
    {
      name: 'additional_interests',
      label: 'ご興味のあるオプション / Additional interests',
      type: 'textarea',
      required: false,
    },
    {
      name: 'response_language',
      label: '回答言語 / Response language',
      type: 'text',
      required: false,
    },
    {
      name: 'consent',
      label: '最終確認・同意 / Final confirmation and consent',
      type: 'text',
      required: true,
    },
  )
  return fields
}

function buildPayload() {
  const source = fs.readFileSync(artifactPath, 'utf8')
  return {
    id: FORM_ID,
    name: FORM_NAME,
    description: '受注後・ご出発前のお客様へ、手配確認書と一緒にお送りするアンケートです。',
    fields: buildFields(source),
    locale: 'en',
    translationGroupId: null,
    submitButtonLabel: 'Send',
    successTitle: 'Your response has been sent',
    successDescription: 'Thank you. We will use your answers to prepare your trip.',
    saveToMetadata: false,
    isActive: true,
  }
}

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL'
  return `'${String(value).replaceAll("'", "''")}'`
}

function jstNow() {
  const jst = new Date(Date.now() + 9 * 60 * 60_000)
  return `${jst.toISOString().slice(0, -1)}+09:00`
}

function buildSql(payload, now) {
  const fieldsJson = JSON.stringify(payload.fields)
  const where = `id = ${sqlString(payload.id)}`
  return [
    'INSERT INTO forms',
    '  (id, name, description, fields, locale, translation_group_id, submit_button_label, success_title, success_description, on_submit_tag_id, on_submit_scenario_id, save_to_metadata, is_active, submit_count, created_at, updated_at)',
    'SELECT',
    `  ${sqlString(payload.id)},`,
    `  ${sqlString(payload.name)},`,
    `  ${sqlString(payload.description)},`,
    `  ${sqlString(fieldsJson)},`,
    `  ${sqlString(payload.locale)},`,
    '  NULL,',
    `  ${sqlString(payload.submitButtonLabel)},`,
    `  ${sqlString(payload.successTitle)},`,
    `  ${sqlString(payload.successDescription)},`,
    '  NULL, NULL, 0, 1, 0,',
    `  ${sqlString(now)},`,
    `  ${sqlString(now)}`,
    `WHERE NOT EXISTS (SELECT 1 FROM forms WHERE ${where});`,
    '',
    'UPDATE forms SET',
    `  name = ${sqlString(payload.name)},`,
    `  description = ${sqlString(payload.description)},`,
    `  fields = ${sqlString(fieldsJson)},`,
    `  locale = ${sqlString(payload.locale)},`,
    '  translation_group_id = NULL,',
    `  submit_button_label = ${sqlString(payload.submitButtonLabel)},`,
    `  success_title = ${sqlString(payload.successTitle)},`,
    `  success_description = ${sqlString(payload.successDescription)},`,
    '  on_submit_tag_id = NULL,',
    '  on_submit_scenario_id = NULL,',
    '  save_to_metadata = 0,',
    '  is_active = 1,',
    `  updated_at = ${sqlString(now)}`,
    `WHERE ${where};`,
    '',
  ].join('\n')
}

const payload = buildPayload()
const sql = buildSql(payload, jstNow())
if (process.argv.includes('--apply')) {
  const result = spawnSync(
    path.join(repoRoot, 'scripts/cloudflare-wrangler.sh'),
    ['d1', 'execute', 'line-crm', '--remote', '--command', sql],
    { cwd: repoRoot, stdio: 'inherit' },
  )
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} else if (process.argv.includes('--sql')) {
  process.stdout.write(sql)
} else {
  process.stdout.write(JSON.stringify({
    formId: FORM_ID,
    name: FORM_NAME,
    directUrl: 'https://liffform-studio.pages.dev/post-order-survey/',
    publicUrl: `https://liffform-studio.pages.dev/public-form?id=${FORM_ID}`,
    fieldCount: payload.fields.length,
    payload,
  }, null, 2) + '\n')
}
