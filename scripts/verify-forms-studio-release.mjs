import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const productionBranch = 'production/liffform-studio'
const requiredCommit = 'c345b22'

assert.equal(git('branch', '--show-current'), productionBranch,
  `Forms Studio production must be released from ${productionBranch}`)
assert.equal(git('status', '--porcelain'), '', 'Commit the reviewed release before deployment')
git('merge-base', '--is-ancestor', requiredCommit, 'HEAD')

// Verify the active provider deployment rather than an unrelated main branch.
assert.ok(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID,
  'Cloudflare credentials are required for production source verification')
const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/liffform-studio`,
  { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }, signal: AbortSignal.timeout(25000) },
)
const body = await response.json()
assert.ok(response.ok && body.success, `Cloudflare project readback failed (${response.status})`)
const active = body.result.canonical_deployment
assert.equal(active?.environment, 'production', 'Cannot identify the active production deployment')
const liveCommit = active.deployment_trigger?.metadata?.commit_hash
assert.match(liveCommit || '', /^[a-f0-9]{40}$/, 'The active deployment has no verifiable source commit')
git('merge-base', '--is-ancestor', liveCommit, 'HEAD')

if (process.argv.includes('--built')) {
  for (const name of ['form-traffic.html', 'form-traffic.js', '_worker.js']) {
    assert.equal(
      readFileSync(path.join(root, 'apps/forms-studio/out', name), 'utf8'),
      readFileSync(path.join(root, 'apps/forms-studio/public', name), 'utf8'),
      `Built asset differs from reviewed source: ${name}`,
    )
  }
  const html = readFileSync(path.join(root, 'apps/forms-studio/out/public-form.html'), 'utf8')
  const chunks = [...html.matchAll(/src="([^\"]*\/app\/public-form\/[^\"]+\.js)"/g)].map(match => match[1])
  assert.ok(chunks.length > 0, 'Public form bundle is missing')
  const code = chunks.map(chunk => readFileSync(path.join(root, 'apps/forms-studio/out', chunk), 'utf8')).join('\n')
  assert.ok(code.includes('/form-traffic.html?v=20260919-2')
    && code.includes('liffform.analytics-consent.v1')
    && !code.includes('Allow analytics')
    && !code.includes('Decline analytics')
    && !code.includes('Analytics cookie settings'),
    'The published form must include the cookieless collector without a consent banner')
}

console.log(JSON.stringify({ releaseGuard: 'passed', branch: productionBranch,
  activeDeployment: active.id, activeSource: liveCommit, candidateSource: git('rev-parse', 'HEAD'),
  builtAssetsChecked: process.argv.includes('--built') }))
