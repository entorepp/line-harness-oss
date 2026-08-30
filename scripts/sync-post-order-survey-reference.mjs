import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FORM_ID = '72fa9940-164a-4efb-9ad8-e819bfeb8c91'
const REFERENCE_URL = 'https://flatcare-post-order-survey.vercel.app'
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const artifactPath = path.join(
  repoRoot,
  'apps/forms-studio/public/post-order-survey/index.html',
)
const hook = `<script src="/post-order-survey.js" data-form-id="${FORM_ID}"></script>`

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function validateReference(source) {
  const requiredMarkers = [
    '<title>Before You Travel</title>',
    'const S=[',
    'const STORE="flattravel_intake_v2";',
    'I have read and agree to the above.',
    '以上の内容について確認・同意します',
    'send.disabled=!agree.checked',
  ]
  for (const marker of requiredMarkers) {
    if (!source.includes(marker)) {
      throw new Error(`Reference is missing required marker: ${marker}`)
    }
  }
  if ((source.match(/<script>/g) || []).length !== 1) {
    throw new Error('Reference must contain exactly one inline application script')
  }
  if (source.includes(hook)) {
    throw new Error('Reference unexpectedly contains the Forms Studio integration hook')
  }
}

async function fetchReference() {
  const response = await fetch(REFERENCE_URL, {
    headers: { 'User-Agent': 'Flat Travel post-order survey sync' },
  })
  if (!response.ok) {
    throw new Error(`Reference fetch failed (${response.status})`)
  }
  const source = await response.text()
  validateReference(source)
  return source
}

const reference = await fetchReference()
if (process.argv.includes('--check')) {
  const artifact = fs.readFileSync(artifactPath, 'utf8')
  const integration = `\n${hook}`
  if ((artifact.split(hook).length - 1) !== 1) {
    throw new Error('Local integration hook occurrence mismatch')
  }
  if (artifact.replace(integration, '') !== reference) {
    throw new Error('Local survey UI differs from the current reviewed reference')
  }
  console.log(`POST_ORDER_REFERENCE_EXACT sha256=${sha256(reference)}`)
} else {
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true })
  fs.writeFileSync(artifactPath, `${reference}\n${hook}`)
  console.log(
    `POST_ORDER_REFERENCE_SYNCED sha256=${sha256(reference)} bytes=${Buffer.byteLength(reference)}`,
  )
}
