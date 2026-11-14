import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { MediaUploader, FORM_ID } from '../apps/forms-studio/public/post-trip-feedback.js'
let chunkFail = true
let chunkOneAttempts = 0
let starts = 0
let posts = 0
const partCalls = []
const requests = []
const uploader = new MediaUploader(async (path, options) => {
  requests.push(path)
  let data
  if (path.endsWith('/start')) { starts++; data = { id: 'local', chunkBytes: 3, count: 3, token: 'private' } }
  else if (path.includes('/chunks/')) {
    const index = Number(path.split('/').at(-1)); partCalls.push(index)
    if (index === 1 && chunkFail) { chunkOneAttempts++; throw new TypeError('Disconnected') }
    data = { index }
  } else if (path.endsWith('/complete')) data = { file: { key: 'local.media', url: 'https://fixture/api/form-files/local.media?sig=private', access: 'form-private' } }
  else if (path.endsWith('/collection')) { posts++; const body = JSON.parse(options.body); assert.ok(body.files.length <= 64); data = { key: 'album', url: `https://fixture/album-${posts}`, count: body.files.length } }
  else throw new Error('Unexpected request')
  return new Response(JSON.stringify({ success: true, data }), { status: 200 })
}, async () => {})
const file = new File(['123456789'], 'a.mov')
await assert.rejects(uploader.uploadAll([file], () => {}), /Connection interrupted/)
assert.equal(starts, 1)
assert.deepEqual(partCalls, [0,1,1,1,1])
chunkFail = false
const collection = await uploader.uploadAll([file], () => {})
assert.equal(starts, 1, 'Retry resumes the same upload session')
assert.equal(partCalls.filter(i => i === 0).length, 1, 'Completed parts are not resent')
assert.deepEqual(partCalls, [0,1,1,1,1,1,2])
assert.equal(collection.length, 1)
const before = requests.length
assert.deepEqual(await uploader.uploadAll([file], () => {}), collection)
assert.equal(requests.length, before, 'Failed answer submission can reuse completed media and its collection')
// Many files use sequential uploads and bounded collection pages, with no count cap.
const many = new MediaUploader(async (path, options) => {
  assert.ok(path.endsWith('/collection'))
  const body = JSON.parse(options.body)
  const count = Number(body.previous?.split('=').at(-1) || 0) + body.files.length
  return new Response(JSON.stringify({ success: true, data: { url: `https://fixture/album?n=${count}`, count } }))
})
many.upload = async f => ({ key: f.name, url: `https://fixture/${f.name}` })
const all = Array.from({length: 1025}, (_, i) => ({ name: `${i}.mp4` }))
assert.equal((await many.uploadAll(all, () => {}))[0].count, 1025)
const html = fs.readFileSync(new URL('../apps/forms-studio/public/post-trip-feedback/index.html', import.meta.url), 'utf8')
assert.match(html, /lang="en"/)
assert.doesNotMatch(html, /[\u3040-\u30ff\u4e00-\u9fff]/)
// Canonical public URL serves the custom English page without changing any other form.
const source = fs.readFileSync(new URL('../apps/forms-studio/public/_worker.js', import.meta.url), 'utf8').replace('export default', 'const worker =')
const worker = vm.runInNewContext(source + '\nworker', { URL, Request, Response, Headers })
let assetPath
const response = await worker.fetch(new Request('https://forms.example/public-form?id=8dc19365-8dd7-49e7-92fb-fdd697572771&issue=opaque-issue'), { ASSETS: { fetch: async r => { assetPath = new URL(r.url).pathname; return new Response(html) } } }, {})
assert.equal(response.status, 200)
assert.equal(assetPath, '/post-trip-feedback/')
console.log('POST_TRIP_MEDIA_CLIENT_OK resume after repeated network failure, no completed-part resend, answer-retry reuse, 1025 files, bounded album pages, English custom canonical/issue route')

// Exercise both real picker handlers through the mounted form, including
// repeated additions, cancelling, removal and the normal submission entry point.
const { mountFeedback } = await import('../apps/forms-studio/public/post-trip-feedback.js')
class Element {
  constructor(tag) { this.tagName = tag; this.childNodes = []; this.handlers = {}; this.value = ''; this.hidden = false }
  append(...nodes) { this.childNodes.push(...nodes) }
  replaceChildren(...nodes) { this.childNodes = nodes }
  addEventListener(event, callback) { this.handlers[event] = callback }
  setAttribute() {}
  reportValidity() { return true }
  focus() {}
  scrollIntoView() {}
  querySelectorAll() { return this.childNodes.flatMap(node => [node, ...node.querySelectorAll()]) }
}
const elements = Object.fromEntries(['intro', 'error', 'submit', 'feedback', 'fields', 'status', 'success'].map(id => [id, new Element('div')]))
elements.feedback.append(elements.fields, elements.submit)
const doc = { getElementById: id => elements[id], createElement: tag => new Element(tag) }
const originalFetch = globalThis.fetch
const originalLocation = globalThis.location
const originalAddEventListener = globalThis.addEventListener
let submitted
let selectedUploads = 0
globalThis.location = { search: '' }
globalThis.addEventListener = () => {}
globalThis.fetch = async (path, options = {}) => {
  let data
  if (path === `/api/forms/${FORM_ID}`) data = { isActive: true, fields: [{ name: 'memory_photos', type: 'file', label: 'Photos', accept: 'image/*,video/*,.heic,.m4v' }], submitButtonLabel: 'Send feedback' }
  else if (path.endsWith('/start')) data = { id: `file-${++selectedUploads}`, chunkBytes: 1024, count: 1, token: 'test' }
  else if (path.includes('/chunks/')) data = { received: 1 }
  else if (path.endsWith('/complete')) data = { file: { key: `${path.split('/')[3]}.media`, url: 'https://fixture/media' } }
  else if (path.endsWith('/collection')) data = { key: 'test.album', url: 'https://fixture/album', count: JSON.parse(options.body).files.length }
  else if (path.endsWith('/submit')) { submitted = JSON.parse(options.body); data = { id: 'test-only' } }
  else throw new Error(`Unexpected path ${path}`)
  return new Response(JSON.stringify({ success: true, data }))
}
try {
  await mountFeedback(doc)
  const section = elements.fields.childNodes[0]
  const pickers = section.childNodes.filter(node => node.className === 'picker')
  const [photos, generic] = pickers.map(node => node.childNodes[0])
  assert.equal(photos.accept, 'image/*,video/*', 'Android photo picker must not receive unknown extensions')
  assert.equal(generic.accept, '', 'File-provider fallback must allow formats with missing MIME mappings')
  assert.equal(photos.multiple, true)
  assert.equal(generic.multiple, true)
  const list = section.childNodes.find(node => node.tagName === 'ul')
  photos.files = [new File(['a'], 'one.jpg'), new File(['b'], 'two.heic')]
  photos.handlers.change()
  generic.files = [new File(['c'], 'three.mov')]
  generic.handlers.change()
  assert.equal(list.childNodes.length, 3)
  photos.files = []
  photos.handlers.change()
  assert.equal(list.childNodes.length, 3, 'Cancelling keeps earlier selections')
  list.childNodes[1].childNodes[1].handlers.click()
  assert.equal(list.childNodes.length, 2)
  await elements.feedback.handlers.submit({ preventDefault() {} })
  assert.equal(selectedUploads, 2)
  assert.equal(submitted.data.memory_photos[0].count, 2)
  assert.equal(elements.feedback.hidden, true)
  assert.equal(elements.success.hidden, false)
  console.log('POST_TRIP_PICKERS_OK MIME-only photo picker, generic fallback, repeated additions, cancellation, removal, normal upload and submit')
} finally {
  globalThis.fetch = originalFetch
  globalThis.location = originalLocation
  globalThis.addEventListener = originalAddEventListener
}
