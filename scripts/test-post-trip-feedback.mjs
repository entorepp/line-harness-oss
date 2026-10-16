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
assert.equal(marketing.length, 1)
assert.equal(marketing[0].name, 'marketing_publication_consent_v3')
assert.equal(marketing[0].required, false)
assert.equal(marketing[0].defaultValue, undefined)
assert.equal(marketing[0].type, 'radio')
assert.deepEqual(marketing[0].options, ['Yes', 'No'])
assert.match(marketing[0].helperText, /No or no selection means no permission/)
assert.equal(payload.fields.length, 8)
assert.deepEqual(payload.fields.filter(f => f.required).map(f => f.name), ['respondent_name', 'overall_rating'])
const teamFeedback = payload.fields.find(f => f.name === 'team_service_feedback')
assert.equal(teamFeedback.type, 'textarea')
assert.equal(teamFeedback.required, false)
assert.match(teamFeedback.label, /Flat Travel team/)
const services = payload.fields.find(f => f.name === 'good_service')
assert.equal(services.type, 'checkbox')
assert.ok(services.options.includes('Other'))
for (const removed of ['trip_reference', 'contact_email', 'photo_context', 'publication_notes', 'response_processing_consent_v2']) {
  assert.ok(!payload.fields.some(f => f.name === removed))
}
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
console.log('POST_TRIP_FEEDBACK_OK: independent form, optional Yes/No publication, required internal name, service choices, private photo upload, fail closed, unrelated form preserved')
