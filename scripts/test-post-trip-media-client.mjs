import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { MediaUploader } from '../apps/forms-studio/public/post-trip-feedback.js'
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
