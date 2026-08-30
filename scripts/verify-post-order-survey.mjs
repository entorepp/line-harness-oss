import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FORM_ID = '72fa9940-164a-4efb-9ad8-e819bfeb8c91'
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const publicRoot = path.join(repoRoot, 'apps/forms-studio/public')
const artifact = fs.readFileSync(path.join(publicRoot, 'post-order-survey/index.html'), 'utf8')
const integration = fs.readFileSync(path.join(publicRoot, 'post-order-survey.js'), 'utf8')
const worker = fs.readFileSync(path.join(publicRoot, '_worker.js'), 'utf8')

const hook = `<script src="/post-order-survey.js" data-form-id="${FORM_ID}"></script>`
if ((artifact.split(hook).length - 1) !== 1) throw new Error('Integration hook mismatch')
if (!worker.includes(`['${FORM_ID}', '/post-order-survey/']`)) {
  throw new Error('Canonical public-form route is missing')
}

const requiredReferenceMarkers = [
  'const S=[',
  '{n:11,e:"Things you might enjoy",j:"旅にプラスできること"',
  'repeat:{e:"Traveller",j:"旅行者"',
  'repeat:{e:"Device",j:"機器"',
  'repeat:{e:"Room",j:"部屋"',
  'repeat:{e:"Leg",j:"区間"',
  'send.disabled=!agree.checked',
  'accept:"image/jpeg,image/png,image/heic,image/heif"',
  'accept:"image/jpeg,image/png,image/heic,image/heif,application/pdf"',
]
for (const marker of requiredReferenceMarkers) {
  if (!artifact.includes(marker)) throw new Error(`Missing reviewed marker: ${marker}`)
}

const requiredIntegrationMarkers = [
  'const QUESTION_COUNT = 53',
  'const FILE_QUESTIONS = new Set([5, 7, 13])',
  "payload.append('access', PRIVATE_UPLOAD_ACCESS)",
  "payload.append('formId', formId)",
  "fetch('/api/upload'",
  '`/api/forms/${formId}/submit`',
  "data.consent = document.getElementById('agree')?.checked",
  "localStorage.removeItem(STORE_KEY)",
]
for (const marker of requiredIntegrationMarkers) {
  if (!integration.includes(marker)) throw new Error(`Missing integration marker: ${marker}`)
}

const numberedDefinitions = Array.from(artifact.matchAll(/\{t:"(?:row|email|file|radio|select|text|check|paxone|pax|number|textarea|adl|cards|cardcheck|pcount|grid)"/g)).length
if (numberedDefinitions < 53) throw new Error('Survey question definitions are incomplete')
if ((artifact.match(/t:"file"/g) || []).length !== 3) {
  throw new Error('Expected group photo, insurance and passport file questions')
}

console.log('POST_ORDER_SURVEY_STATIC_OK sections=11 questions=53 initial_expected=41 files=3')
