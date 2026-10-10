// Bounded, explicitly invoked migration. No customer submission or notification.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const formId = '72fa9940-164a-4efb-9ad8-e819bfeb8c91'
const databaseId = readFileSync(new URL('../apps/worker/wrangler.toml', import.meta.url), 'utf8').match(/database_id\s*=\s*"([^"]+)"/)[1]
const account = process.env.CLOUDFLARE_ACCOUNT_ID
const token = process.env.CLOUDFLARE_API_TOKEN
assert.ok(account && token, 'Run after sourcing scripts/cloudflare-env.sh')
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
async function query(sql, params = []) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${databaseId}/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }), signal: AbortSignal.timeout(25000),
  })
  const data = await response.json()
  assert.ok(response.ok && data.success && data.result?.[0]?.success, `D1 query failed: HTTP ${response.status}`)
  return data.result[0]
}
async function readForm() {
  const data = await query('SELECT * FROM forms WHERE id = ?', [formId])
  assert.equal(data.results.length, 1)
  return data.results[0]
}
async function submissionDigests() {
  const data = await query('SELECT * FROM form_submissions WHERE form_id = ? ORDER BY id', [formId])
  // Customer answers stay only in process memory; retain/output digests only.
  return new Map(data.results.map(row => [row.id, hash(row)]))
}
const before = await readForm()
assert.equal(before.locale, 'en')
assert.equal(before.is_active, 1)
const oldFields = JSON.parse(before.fields)
const proposed = JSON.parse(execFileSync(process.execPath, ['scripts/register-post-order-survey-form.mjs'], { encoding: 'utf8' })).payload.fields
const desiredSling = proposed.find(field => field.name === 'q32')
const desiredExplanation = proposed.find(field => field.name === 'q54')
assert.ok(desiredSling && desiredExplanation && desiredExplanation.required === false)
assert.equal(oldFields.filter(field => field.name === 'q32').length, 1)
const originalSling = oldFields.find(field => field.name === 'q32')
assert.deepEqual({ ...originalSling, label: desiredSling.label }, desiredSling)
let nextFields = oldFields.map(field => field.name === 'q32' ? { ...field, label: desiredSling.label } : field)
const existing = oldFields.find(field => field.name === 'q54')
if (existing) assert.deepEqual(existing, desiredExplanation)
else nextFields.splice(nextFields.findIndex(field => field.name === 'additional_interests'), 0, desiredExplanation)
assert.equal(nextFields.length, 57)
assert.equal(new Set(nextFields.map(field => field.name)).size, 57)
const changed = JSON.stringify(nextFields) !== before.fields
console.log(JSON.stringify({ mode: process.argv.includes('--apply') ? 'apply' : 'dry-run', formId,
  locale: before.locale, beforeFieldCount: oldFields.length, afterFieldCount: nextFields.length,
  updatedAt: before.updated_at, submitCount: before.submit_count, fieldsBeforeSha256: hash(before.fields),
  fieldsAfterSha256: hash(JSON.stringify(nextFields)), changes: changed ? ['q32 label', 'q54 optional field'] : [] }))
if (process.argv.includes('--apply') && changed) {
  const submissionsBefore = await submissionDigests()
  const now = new Date().toISOString()
  const result = await query('UPDATE forms SET fields = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND fields = ? AND locale = ? AND is_active = 1',
    [JSON.stringify(nextFields), now, formId, before.updated_at, before.fields, 'en'])
  assert.equal(result.meta.changes, 1, 'Version conflict: no retry without a new review')
  const after = await readForm()
  assert.equal(after.fields, JSON.stringify(nextFields))
  for (const key of Object.keys(before)) {
    if (!['fields', 'updated_at', 'submit_count'].includes(key)) assert.deepEqual(after[key], before[key], `${key} changed`)
  }
  assert.ok(after.submit_count >= before.submit_count)
  const submissionsAfter = await submissionDigests()
  for (const [id, digest] of submissionsBefore) assert.equal(submissionsAfter.get(id), digest, 'An existing submission changed')
  console.log(JSON.stringify({ result: 'updated-and-read-back', formId, updatedAt: after.updated_at,
    fieldCount: nextFields.length, locale: after.locale, submissionsBefore: submissionsBefore.size,
    submissionsAfter: submissionsAfter.size, existingSubmissionDigestsUnchanged: true,
    submissionDigest: hash([...submissionsBefore]), submitCountBefore: before.submit_count, submitCountAfter: after.submit_count }))
}
