import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const code = fs.readFileSync(new URL('../apps/forms-studio/public/post-order-survey.js', import.meta.url), 'utf8')
const start = code.indexOf('  function validateBeforeSubmit()')
const end = code.indexOf('  function fileFingerprint(', start)
function validate(number, values, required = true) {
  const inputs = values.map(value => ({value}))
  const card = {querySelector: selector => selector === '.must' ? required : inputs[0], querySelectorAll: () => inputs}
  const context = vm.createContext({document:{querySelectorAll: selector => selector === '.q' ? [card] : [], getElementById: () => ({checked:true})}, questionNumber:()=>number, isConditionallyVisible:()=>true, requiredCardComplete:()=>inputs.every(i=>i.value.trim()), setCardInvalid(){}, showSubmitMessage(){}, revealCard(){}, text:(en)=>en})
  vm.runInContext(code.slice(start,end),context)
  return {accepted:context.validateBeforeSubmit(), inputs}
}
for (const q of [42,43]) {
  for (const number of ['Air France','AF','274','AF274/AF275']) assert.equal(validate(q,[number,'2026-10-05']).accepted,false)
  for (const day of ['','2026-02-30','10/05/2026']) assert.equal(validate(q,['AF274',day]).accepted,false)
  for (const unknown of ['Not booked','Not flying','未定']) assert.equal(validate(q,[unknown,'']).accepted,true)
  const result = validate(q,['ａｆ 274','2026-10-05'])
  assert.equal(result.accepted,true)
  assert.equal(result.inputs[0].value,'AF274')
}
for (const values of [['350','60','90'],['100','200lb','90'],['100','60','70-80']]) assert.equal(validate(17,values,false).accepted,false)
assert.equal(validate(17,['','',''],false).accepted,true)
assert.equal(validate(17,['100','65','95'],false).accepted,true)
assert.equal(validate(18,['160lb'],false).accepted,false)
assert.equal(validate(18,[''],false).accepted,true)
assert.equal(validate(22,['20','60']).accepted,false)
assert.equal(validate(22,['165','60']).accepted,true)
assert.equal(validate(28,[''],false).accepted,true)
console.log('POST_ORDER_INPUT_GUARDS_OK flights/date/units/optional-equipment/optional-room')
