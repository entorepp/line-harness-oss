import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { FORM_ID, payload, buildSql } from './register-post-trip-feedback-form.mjs'

assert.notEqual(FORM_ID, '72fa9940-164a-4efb-9ad8-e819bfeb8c91')
assert.equal(payload.saveToMetadata, false)
assert.equal(payload.onSubmitTagId, null)
assert.equal(payload.onSubmitScenarioId, null)
const marketing = payload.fields.filter(f => f.name.startsWith('marketing_'))
assert.equal(marketing.length, 5)
for (const f of marketing) {
  assert.equal(f.required, false)
  assert.equal(f.defaultValue, undefined)
  assert.equal(f.type, 'checkbox')
  assert.equal(f.options.length, 1)
}
const required = payload.fields.filter(f => f.required)
assert.deepEqual(required.map(f => f.name), ['respondent_name', 'overall_rating', 'response_processing_consent_v2'])
// Exercise the same empty-answer rules used by the Worker, with all marketing declined.
const valid = { respondent_name: 'Local QA', overall_rating: payload.fields.find(f => f.name === 'overall_rating').options[2], response_processing_consent_v2: [payload.fields.at(-1).options[0]] }
const missing = data => required.filter(f => data[f.name] == null || data[f.name] === '' || (Array.isArray(data[f.name]) && data[f.name].length === 0))
assert.equal(missing(valid).length, 0)
assert.deepEqual(missing({ ...valid, response_processing_consent_v2: [] }).map(f => f.name), ['response_processing_consent_v2'])
assert.equal(payload.fields.find(f => f.name === 'memory_photos').maxFiles, undefined)
assert.match(payload.fields.find(f => f.name === 'memory_photos').accept, /video/)
assert.doesNotMatch(JSON.stringify(payload), /[\u3040-\u30ff\u4e00-\u9fff]/)
assert.doesNotMatch(buildSql(), /\bUPDATE\b|\bDELETE\b|form_submissions/i)

const exports = {}
const code = fs.readFileSync(new URL('../apps/forms-studio/src/lib/post-trip-upload.ts', import.meta.url), 'utf8')
vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, URL, Error })
const body = new FormData()
assert.equal(exports.appendPostTripUploadScope(body, FORM_ID, 'memory_photos'), true)
assert.equal(body.get('access'), 'form-private')
assert.equal(body.get('formId'), FORM_ID)
assert.equal(body.get('fieldName'), 'memory_photos')
const old = new FormData()
assert.equal(exports.appendPostTripUploadScope(old, '72fa9940-164a-4efb-9ad8-e819bfeb8c91', 'q13'), false)
assert.equal([...old.keys()].length, 0)
exports.validatePostTripUpload({ access: 'form-private', expiresAt: '2027-04-01', url: 'https://example.com/api/form-files/signed' })
for (const data of [undefined, { url: 'https://example.com/api/files/public' }, { access: 'form-private', url: 'https://example.com/api/form-files/no-expiry' }]) {
  assert.throws(() => exports.validatePostTripUpload(data))
}
console.log('POST_TRIP_FEEDBACK_OK: independent form, optional marketing, required processing, private photo upload, fail closed, unrelated form preserved')
