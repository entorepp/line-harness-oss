import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const publicRoot = path.join(repoRoot, 'apps/forms-studio/public')
const referenceOrigin = 'https://flatcare-survey.vercel.app'
const previewNote = '<p class="submit-note">※ こちらは確認用のイメージです。ボタンを押しても送信はされません。</p>\n'

const definitions = [
  ['tokyo', 'tokyo-transport-survey', '96ff4bc9-40df-4b10-a3db-486f82374b30', 56, 10],
  ['kyoto', 'kyoto-transport-survey', '82119557-3c07-4f17-ab39-193d1fb35df3', 47, 7],
  ['osaka', 'osaka-transport-survey', 'f01bcdfc-4b53-44c4-9fbf-9bf5ce2707cb', 47, 7],
  ['kanazawa', 'kanazawa-transport-survey', 'db018579-e461-43cc-84c5-2cdfad0e8d5b', 30, 2],
  ['hiroshima', 'hiroshima-transport-survey', '1528b3da-2966-4c7c-945d-38e9ea322204', 36, 4],
  ['fuji-odawara', 'fuji-odawara-transport-survey', 'eef7e0b9-c0b0-49d8-8a30-bd34a6cf2c92', 40, 4],
  ['fuji-mishima', 'fuji-mishima-transport-survey', 'e5a619c2-b729-4d9a-9151-b8e5f7d86382', 40, 4],
  ['fuji-shizuoka', 'fuji-shizuoka-transport-survey', '96a7fa63-8f10-4e8d-881c-4eef2c32c04b', 40, 4],
]

const workerSource = fs.readFileSync(path.join(publicRoot, '_worker.js'), 'utf8')
const surveyScript = fs.readFileSync(path.join(publicRoot, 'transport-survey.js'), 'utf8')
const compareReference = process.argv.includes('--reference')

if (!surveyScript.includes("querySelectorAll('.costs')") ||
    !surveyScript.includes("querySelectorAll('input.must-in')") ||
    !surveyScript.includes('hasAnyAmount && !isValidAmount(control)')) {
  throw new Error('transport-survey.js: conditional course-cost validation missing')
}

function withoutHook(artifact, hook) {
  const occurrences = artifact.split(hook).length - 1
  if (occurrences !== 1) throw new Error('integration hook occurrence mismatch')
  return artifact.replace(`\n${hook}\n`, '')
}

async function fetchReference(sourceSlug) {
  const response = await fetch(`${referenceOrigin}/${sourceSlug}/`, {
    headers: { 'User-Agent': 'Flatcare transport survey verifier' },
  })
  if (!response.ok) {
    throw new Error(`${sourceSlug}: reference fetch failed (${response.status})`)
  }
  const html = await response.text()
  const occurrences = html.split(previewNote).length - 1
  if (occurrences !== 1) {
    throw new Error(`${sourceSlug}: reference preview note occurrence mismatch`)
  }
  return html.replace(previewNote, '')
}

for (const [sourceSlug, targetSlug, formId, expectedCount, expectedCourses] of definitions) {
  const artifact = fs.readFileSync(
    path.join(publicRoot, targetSlug, 'index.html'),
    'utf8',
  )
  const numbers = Array.from(
    artifact.matchAll(/class="qn">Q(\d+)/g),
    (match) => Number(match[1]),
  )
  const expectedNumbers = Array.from(
    { length: expectedCount },
    (_, index) => index + 1,
  )

  if (JSON.stringify(numbers) !== JSON.stringify(expectedNumbers)) {
    throw new Error(sourceSlug + ': question sequence mismatch')
  }
  const hook = '<script src="/transport-survey.js" data-form-id="' +
    formId + '" data-question-count="' + expectedCount + '"></script>'
  if (!artifact.includes(hook)) {
    throw new Error(sourceSlug + ': integration hook mismatch')
  }
  if (!workerSource.includes("['" + formId + "', '/" + targetSlug + "/']")) {
    throw new Error(sourceSlug + ': canonical route missing')
  }
  if (artifact.includes('こちらは確認用のイメージです')) {
    throw new Error(sourceSlug + ': non-functional preview note must not be published')
  }

  const courseCount = Array.from(artifact.matchAll(/class="costs"/g)).length
  const vehicleCount = Array.from(artifact.matchAll(/class="cost cost-lead"/g)).length
  const conditionalCostCount = Array.from(artifact.matchAll(/class="amt sm must-in"/g)).length
  if (courseCount !== expectedCourses || vehicleCount !== courseCount ||
      conditionalCostCount !== courseCount * 2) {
    throw new Error(sourceSlug + ': course cost layout/conditional fields mismatch')
  }

  const requiredCopy = [
    '高速代金・介助料・乗降介助料 を含んだ金額をご記入ください',
    '待機料金・駐車料金・介助料・乗降介助料 を含んだ金額をご記入ください',
    'ご対応が難しい行程は、<b>車両代金を含めて空欄のまま</b>で結構です。',
    '車両代金をご記入いただいた行程は、<b>高速代金・駐車場代金もあわせてご記入ください</b>。',
  ]
  for (const copy of requiredCopy) {
    if (!artifact.includes(copy)) {
      throw new Error(sourceSlug + ': missing reference guidance: ' + copy)
    }
  }

  if (sourceSlug === 'kanazawa') {
    const kanazawaCopy = [
      '富士エリア<span class="th-note">回送料金を含む</span>',
      '<th class="hn">富士レークホテル</th>',
      '金沢観光　8時間｜兼六園・城下町満喫コース',
      'ハイアットセントリック金沢 → 兼六園 → 近江町市場（昼食） → 長町武家屋敷跡 → ひがし茶屋街 → ハイアットセントリック金沢',
      '白川郷観光　8時間｜世界遺産・合掌造り満喫コース',
      'ハイアットセントリック金沢 → 金沢城 → 白川郷 → ハイアットセントリック金沢',
    ]
    for (const copy of kanazawaCopy) {
      if (!artifact.includes(copy)) {
        throw new Error('kanazawa: missing reference route/cost copy: ' + copy)
      }
    }
  }

  if (compareReference) {
    const localComparable = withoutHook(artifact, hook)
    const referenceComparable = await fetchReference(sourceSlug)
    if (localComparable !== referenceComparable) {
      throw new Error(sourceSlug + ': local artifact differs from current reference')
    }
  }

  process.stdout.write(
    sourceSlug + ': ' + expectedCount + ' questions / ' +
    expectedCourses + ' courses OK' + (compareReference ? ' (reference exact)' : '') + '\n',
  )
}
