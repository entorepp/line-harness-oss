import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const publicRoot = path.join(repoRoot, 'apps/forms-studio/public')

const definitions = [
  ['tokyo', 'tokyo-transport-survey', '96ff4bc9-40df-4b10-a3db-486f82374b30', 56],
  ['kyoto', 'kyoto-transport-survey', '82119557-3c07-4f17-ab39-193d1fb35df3', 47],
  ['osaka', 'osaka-transport-survey', 'f01bcdfc-4b53-44c4-9fbf-9bf5ce2707cb', 47],
  ['kanazawa', 'kanazawa-transport-survey', 'db018579-e461-43cc-84c5-2cdfad0e8d5b', 30],
  ['hiroshima', 'hiroshima-transport-survey', '1528b3da-2966-4c7c-945d-38e9ea322204', 36],
  ['fuji-odawara', 'fuji-odawara-transport-survey', 'eef7e0b9-c0b0-49d8-8a30-bd34a6cf2c92', 40],
  ['fuji-mishima', 'fuji-mishima-transport-survey', 'e5a619c2-b729-4d9a-9151-b8e5f7d86382', 40],
  ['fuji-shizuoka', 'fuji-shizuoka-transport-survey', '96a7fa63-8f10-4e8d-881c-4eef2c32c04b', 40],
]

const workerSource = fs.readFileSync(path.join(publicRoot, '_worker.js'), 'utf8')

if (process.argv.includes('--reference')) {
  throw new Error(
    '--reference is no longer valid after the intentional 2026-08-29 survey wording changes; ' +
    'run this verifier without that flag.',
  )
}

for (const [sourceSlug, targetSlug, formId, expectedCount] of definitions) {
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

  const inclusionNote = '送迎料金・観光貸切の車両代金には、' +
    '基本介助料金・乗降料金を含めてご記入ください。'
  if (!artifact.includes(inclusionNote)) {
    throw new Error(sourceSlug + ': assistance/boarding inclusion note missing')
  }

  const courseQuestionCount = Array.from(
    artifact.matchAll(/<div class="q" data-required-question="true"><p class="qt"><span class="qn">Q\d+<\/span>この行程の料金をご記入ください<\/p>/g),
  ).length
  const requiredCostCount = Array.from(
    artifact.matchAll(/data-required-cost="true"/g),
  ).length
  if (!courseQuestionCount || requiredCostCount !== courseQuestionCount * 2) {
    throw new Error(sourceSlug + ': required toll/parking controls mismatch')
  }
  const includedVehicleLabels = Array.from(
    artifact.matchAll(/車両代金（基本介助料金・乗降料金込）/g),
  ).length
  if (includedVehicleLabels !== courseQuestionCount) {
    throw new Error(sourceSlug + ': sightseeing vehicle inclusion labels mismatch')
  }

  const transferInclusionLabels = Array.from(
    artifact.matchAll(/※高速代金・基本介助料金・乗降料金込/g),
  ).length
  const expectedTransferInclusionLabels = sourceSlug === 'kanazawa' ? 2 : 3
  if (transferInclusionLabels !== expectedTransferInclusionLabels) {
    throw new Error(sourceSlug + ': transfer inclusion labels mismatch')
  }

  if (sourceSlug === 'kanazawa') {
    const requiredKanazawaCopy = [
      '金沢市内中心部のホテル → 富士レークホテル',
      '送迎料金（高速代金・基本介助料金・乗降料金込／回送料金・駐車場代金を除く）',
      'お帰りの回送料金（高速代金込）',
      '兼六園・白川郷観光　8時間｜名園と世界遺産・合掌造りコース',
      'ハイアットセントリック金沢 → 兼六園 → 白川郷・合掌造り集落',
    ]
    for (const copy of requiredKanazawaCopy) {
      if (!artifact.includes(copy)) {
        throw new Error('kanazawa: missing required route/cost copy: ' + copy)
      }
    }
    if (Array.from(artifact.matchAll(/data-required-cost-group="kanazawa-fuji-transfer"/g)).length !== 3) {
      throw new Error('kanazawa: Fuji Lake Hotel conditional costs mismatch')
    }
    if (artifact.includes('高速代金（送迎・回送合計／必須）')) {
      throw new Error('kanazawa: transfer toll must not be collected separately')
    }
  }

  process.stdout.write(sourceSlug + ': ' + expectedCount + ' questions OK\n')
}
