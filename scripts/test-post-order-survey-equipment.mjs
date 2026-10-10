import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { execFileSync } from 'node:child_process'

const html = fs.readFileSync(new URL('../apps/forms-studio/public/post-order-survey/index.html', import.meta.url), 'utf8')
const integration = fs.readFileSync(new URL('../apps/forms-studio/public/post-order-survey.js', import.meta.url), 'utf8')
const model = vm.createContext({})
vm.runInContext(html.slice(html.indexOf('const NEED='), html.indexOf('\n', html.indexOf('const NEED='))) + '\n' + html.slice(html.indexOf('const COUNTRIES='), html.indexOf('\nconst UP=')) + '\nthis.sections=S;', model)
const gear = model.sections.find(section => section.n === 7)
const sling = gear.f.find(field => field.id === 'sling')
assert.deepEqual(Array.from(sling.o, option => option[0]), ['Yes, bringing my own', 'No, please arrange one', 'Other'], 'Previously saved choices must keep their identity')
assert.deepEqual(Array.from(sling.o, option => option[2]), ['No, I will bring my own', 'Yes, please arrange a rental sling', 'Not sure / please discuss with me'])
assert.equal(gear.extra[0].qn, 54)
assert.equal(gear.extra[0].r, undefined, 'A new preference must not prevent an existing draft from being submitted')
const payload = JSON.parse(execFileSync(process.execPath, ['scripts/register-post-order-survey-form.mjs'], { encoding: 'utf8' })).payload
assert.equal(new Set(payload.fields.map(field => field.name)).size, 57)
assert.equal(payload.fields.length, 57)
assert.equal(payload.fields.find(field => field.name === 'q42').label.includes('Arrival flight'), true)
assert.equal(payload.fields.find(field => field.name === 'q54').label.includes('リフト搬入'), true)

// Exercise the actual answer serializer with visible and hidden equipment cards.
const start = integration.indexOf('  function serializeAnswers()')
const end = integration.indexOf('  function filesForInput(', start)
const context = vm.createContext({
  QUESTION_COUNT:54, FILE_QUESTIONS:new Set([5,7,13]),
  document:{querySelectorAll:()=>context.cards,getElementById:()=>({checked:true})},
  isConditionallyVisible:card=>!card.hidden, questionNumber:card=>card.number,
  serializeQuestionCard:card=>card.value, blockLabel:()=>'', serializeInterests:()=>'', isJapanese:()=>false,
})
vm.runInContext(integration.slice(start,end),context)
for (const choice of ['Explanation requested','Explanation not requested','Please discuss with me']) {
  context.cards = [{number:32,value:'Yes, please arrange a rental sling'},{number:54,value:choice},{number:42,value:'AF274 / 2026-10-20'}]
  const answer=context.serializeAnswers()
  assert.equal(answer.q54,choice)
  assert.equal(answer.q32,'Yes, please arrange a rental sling')
  assert.equal(answer.q42,'AF274 / 2026-10-20')
  context.cards.forEach(card=>{if(card.number===32||card.number===54) card.hidden=true})
  assert.equal(context.serializeAnswers().q54,'')
  assert.equal(context.serializeAnswers().q32,'')
}
console.log('POST_ORDER_EQUIPMENT_OK existing option identities preserved; 57 unique fields; optional hoist preference; all 3 choices serialize; hidden answers excluded; flight mapping preserved')
