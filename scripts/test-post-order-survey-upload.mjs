import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../apps/forms-studio/public/post-order-survey.js', import.meta.url), 'utf8')
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
const fixtures = [
  ['scan.PNG', png, 'image/png'],
  ['scan.jpg', Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]), 'image/jpeg'],
  ['scan.pdf', Buffer.from('%PDF-1.7\n% synthetic QA'), 'application/pdf'],
  ['scan.heic', Buffer.from([0, 0, 0, 24, ...Buffer.from('ftypheic'), 0, 0, 0, 0]), 'image/heic'],
  ['scan.heif', Buffer.from([0, 0, 0, 24, ...Buffer.from('ftypmif1'), 0, 0, 0, 0]), 'image/heif'],
]
const accept = { accept: 'image/jpeg,image/png,image/heic,image/heif,application/pdf,.jpg,.jpeg,.png,.heic,.heif,.pdf' }
const button = { dataset: {}, disabled: false, textContent: 'Send' }
const fileInput = { dataset: { privateUploadKey: 'q13:0' }, closest: () => ({}) }
let files = []
let mode = 'success'
let draftCleared = false
let message = ''
const calls = []
const context = vm.createContext({
  Blob, File, FormData, Uint8Array, AbortController, setTimeout, clearTimeout, URLSearchParams,
  formId: '72fa9940-164a-4efb-9ad8-e819bfeb8c91', PRIVATE_UPLOAD_ACCESS: 'form-private',
  FILE_QUESTIONS: new Set([5, 7, 13]), STORE_KEY: 'flattravel_intake_v2',
  uploadedFileCache: new Map(),
  clean: value => String(value ?? '').replace(/\s+/g, ' ').trim(),
  text: (en) => en,
  window: { location: { search: '?issue=local-issue' } },
  localStorage: { removeItem(key) { assert.equal(key, 'flattravel_intake_v2'); draftCleared = true } },
  document: {
    querySelector: selector => selector === 'button.submit' ? button : null,
    querySelectorAll: selector => selector === '.q input[type="file"]' ? [fileInput] : [],
    getElementById: () => ({ checked: true }),
  },
  isConditionallyVisible: () => true,
  questionNumber: () => 13,
  fileInputKey: () => 'q13:0',
  filesForInput: () => files,
  fileFingerprint: list => list.map(file => `${file.name}:${file.size}:${file.type}`).join('|'),
  blockLabel: () => 'Traveller 1 — Atle QA',
  serializeAnswers: () => ({ q10: 'First name: Atle\nLast name(s): QA', consent: 'Agreed / 同意済み' }),
  validateBeforeSubmit: () => true,
  showSubmitMessage: text => { message = text },
  fileError: (_, text) => { message = `Q13: ${text}`; return message },
  fetch: async (url, init) => {
    calls.push({ url, init })
    if (url === '/api/upload') {
      if (mode === 'network') throw new TypeError('Failed to fetch')
      if (mode === 'timeout') { const error = new Error('Aborted'); error.name = 'AbortError'; throw error }
      if (mode === 'upload400') return { ok: false, json: async () => ({ success: false, error: 'File type is not allowed for this field' }) }
      const file = init.body.get('file')
      assert.ok(accept.accept.includes(file.type), `Unsupported transmitted MIME: ${file.type}`)
      assert.equal(init.body.get('access'), 'form-private')
      assert.equal(init.body.get('fieldName'), 'q13')
      return { ok: true, json: async () => ({ success: true, data: {
        access: 'form-private', expiresAt: '2027-03-28', url: 'https://qa.invalid/api/form-files/qa', fileName: file.name,
      } }) }
    }
    assert.match(url, /\/submit$/)
    const body = JSON.parse(init.body)
    assert.equal(body.issueId, 'local-issue')
    assert.match(body.data.q10, /Atle/)
    assert.equal(body.data.q13.length, 1)
    return { ok: mode !== 'submit500', json: async () => mode === 'submit500'
      ? { success: false, error: 'Internal server error' } : { success: true, data: { id: 'local-only' } } }
  },
})
vm.runInContext([
  between('  const FILE_TYPES =', '\n  const clean ='),
  between('  function acceptedFile(', '  function requiredCardComplete('),
  between('  async function uploadPrivateFile(', "  document.addEventListener('input'"),
  between('  function setCardInvalid(', '  function showSubmitMessage('),
].join('\n'), context)

let checked = 0
for (const [name, bytes, expectedType] of fixtures) {
  for (const suppliedType of ['', 'application/octet-stream', expectedType]) {
    const file = new File([bytes], name, { type: suppliedType })
    assert.equal(context.acceptedFile(accept, file), true)
    const normalized = await context.fileForUpload(file)
    assert.equal(normalized.type, expectedType)
    assert.deepEqual(Buffer.from(await normalized.arrayBuffer()), bytes)
    await context.uploadPrivateFile(file, 'q13')
    checked++
  }
}
assert.equal(context.acceptedFile(accept, new File(['text'], 'fake.jpg', { type: 'text/html' })), false)
await assert.rejects(context.fileForUpload(new File(['not a PNG'], 'fake.png')), /could not be recognised/)
await assert.rejects(context.fileForUpload(new File([Buffer.from([0,0,0,24,...Buffer.from('ftypavif')])], 'fake.heic')), /could not be recognised/)
assert.equal((await context.fileForUpload(new File([fixtures[1][1]], 'scan.jpg', {type:'image/jpg'}))).type, 'image/jpeg')

for (const failure of ['network', 'timeout', 'upload400', 'submit500']) {
  context.uploadedFileCache.clear(); button.dataset = {}; draftCleared = false; message = ''; calls.length = 0
  files = [new File([png], 'scan.png')]; mode = failure
  await context.submitSurvey()
  assert.equal(draftCleared, false)
  assert.equal(files.length, 1)
  assert.equal(button.disabled, false)
  assert.notEqual(button.dataset.submitted, 'true')
  assert.ok(message)
  if (failure !== 'submit500') assert.equal(calls.filter(call => /\/submit$/.test(call.url)).length, 0)
  if (failure === 'timeout') assert.match(message, /timed out/)
  if (failure === 'network') assert.match(message, /could not connect/)
  const uploadCount = calls.filter(call => call.url === '/api/upload').length
  mode = 'success'
  await context.submitSurvey()
  assert.equal(button.dataset.submitted, 'true')
  assert.equal(draftCleared, true)
  if (failure === 'submit500') assert.equal(calls.filter(call => call.url === '/api/upload').length, uploadCount)
}
const controls = ['Atle', '', ''].map((value, i) => ({ type: 'text', value, dataset: { optional: String(i === 2) },
  setAttribute(key, value) { this[key] = value }, removeAttribute(key) { delete this[key] } }))
context.setCardInvalid({ querySelectorAll: () => controls, style: {} }, true)
assert.equal(controls[0]['aria-invalid'], undefined)
assert.equal(controls[1]['aria-invalid'], 'true')
assert.equal(controls[2]['aria-invalid'], undefined)
console.log(`POST_ORDER_UPLOAD_REGRESSION_OK formats=${checked} byte_preservation=passed unknown_content=rejected error_retry=draft_and_files_preserved submit_success_gate=passed name_error_target=passed`)
