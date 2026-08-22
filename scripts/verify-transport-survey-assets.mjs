import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const publicRoot = path.join(repoRoot, 'apps/forms-studio/public')
const referenceOrigin = 'https://flatcare-survey.vercel.app'

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
const compareReference = process.argv.includes('--reference')

function stripIntegrationHook(html) {
  return html.replace(
    /<script src="\/transport-survey\.js" data-form-id="[^"]+" data-question-count="\d+"><\/script>\n/,
    '',
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

  if (compareReference) {
    const response = await fetch(referenceOrigin + '/' + sourceSlug + '/')
    if (!response.ok) {
      throw new Error(sourceSlug + ': reference returned ' + response.status)
    }
    const reference = await response.text()
    if (stripIntegrationHook(artifact) !== reference) {
      throw new Error(sourceSlug + ': local UI/content differs from reference')
    }
  }

  process.stdout.write(sourceSlug + ': ' + expectedCount + ' questions OK\n')
}
