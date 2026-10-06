import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const source = read('apps/forms-studio/src/lib/issued-survey-route.ts')
const exports = {}
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, URL })
const post = '72fa9940-164a-4efb-9ad8-e819bfeb8c91'
const pre = 'fdbc9106-9b21-43ac-b840-52d741242a56'
const old = 'https://liffform-studio.pages.dev/public-form?issue=case-opaque'
const route = exports.issuedSurveyRoute(old, post, 'case-opaque')
const url = new URL(route)
assert.equal(url.searchParams.get('id'), post)
assert.equal(url.searchParams.get('issue'), 'case-opaque')
assert.equal(url.searchParams.get('lang'), 'en')
assert.equal(exports.issuedSurveyRoute(old, pre, 'case-opaque'), null)
assert.equal(exports.issuedSurveyRoute(old, post, 'other-case'), null)
assert.equal(exports.issuedSurveyRoute(old, post, ''), null)

const workerSource = read('apps/forms-studio/public/_worker.js').replace('export default', 'const worker =')
let assetPath
const worker = vm.runInNewContext(workerSource + '\nworker', { URL, Request, Response, Headers })
const response = await worker.fetch(new Request(route), {
  ASSETS: { fetch: async request => { assetPath = new URL(request.url).pathname; return new Response('<html lang="en"><title>Before You Travel</title>') } },
}, {})
assert.equal(response.status, 200)
assert.equal(assetPath, '/post-order-survey/')
assert.match(await response.text(), /Before You Travel/)

const integration = read('apps/forms-studio/public/post-order-survey.js')
const languageFunction = integration.slice(integration.indexOf('  function applyRequestedLanguage()'), integration.indexOf('  applyRequestedLanguage()'))
for (const [search, stored, expected] of [['?lang=en&issue=case-opaque', 'ja', 'en'], ['?lang=ja', 'en', 'ja'], ['', 'ja', null], ['?lang=invalid', 'ja', null]]) {
  let clicked = null
  const sandbox = { URLSearchParams, window: { location: { search } }, document: { documentElement: { lang: stored }, querySelector: selector => ({ click: () => { clicked = selector.match(/"(.*?)"/)[1] } }) } }
  vm.runInNewContext(languageFunction + '\napplyRequestedLanguage()', sandbox)
  assert.equal(clicked, expected)
}
assert.match(integration, /issueId: params.get\('issue'\)/)
assert.match(read('apps/forms-studio/src/components/forms/public-form-page.tsx'), /issuedSurveyRoute\(window.location.href, json.data.form.id, json.data.issue.id\)/)
console.log('ISSUED_SURVEY_ROUTE_OK legacy/canonical/case-binding/English-over-saved-Japanese')
