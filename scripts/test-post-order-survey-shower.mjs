import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {execFileSync} from 'node:child_process'
const html=fs.readFileSync('apps/forms-studio/public/post-order-survey/index.html','utf8')
const js=fs.readFileSync('apps/forms-studio/public/post-order-survey.js','utf8')
const model=vm.createContext({})
vm.runInContext(html.slice(html.indexOf('const NEED='),html.indexOf('\n',html.indexOf('const NEED=')))+'\n'+html.slice(html.indexOf('const COUNTRIES='),html.indexOf('\nconst UP='))+'\nthis.sections=S;',model)
const gear=model.sections.find(s=>s.n===7)
const fields=gear.extra.filter(f=>f.qn>=55)
assert.equal(fields.length,6)
for(const qn of [55,58,59,60]){const f=fields.find(f=>f.qn===qn);assert.equal(f.r,1);assert.equal(f.after,33)}
assert.equal(fields.find(f=>f.qn===58).o.length,4)
assert.deepEqual(Array.from(fields.find(f=>f.qn===59).o,o=>o[0]),['With wheels','Without wheels','No preference'])
assert.ok(fields.find(f=>f.qn===60).o[1][0].includes('JPY 40,000 extra per hotel where needed'))
assert.equal(gear.f.find(f=>f.id==='gear').items.find(i=>i.v==='Voltage transformer').keyIndex,3)
assert.ok(!gear.f.find(f=>f.id==='gear').items.some(i=>i.v==='Shower chair'))
const cards=fields.map(f=>({number:f.qn,dataset:{...(f.showIf?{showif:JSON.stringify(f.showIf)}:{}),...(f.showIfAll?{showifall:JSON.stringify(f.showIfAll)}:{})},hidden:false,value:''}))
const keys=new Map()
const ctx=vm.createContext({KEYS:keys,QUESTION_COUNT:60,FILE_QUESTIONS:new Set([5,7,13]),document:{querySelectorAll:selector=>selector==='.q[data-showif]'?cards.filter(c=>c.dataset.showif):selector==='.q'?cards:[],getElementById:()=>({checked:true})},isConditionallyVisible:c=>!c.hidden,questionNumber:c=>c.number,serializeQuestionCard:c=>c.value,blockLabel:()=>'',serializeInterests:()=>'',isJapanese:()=>false})
vm.runInContext(html.slice(html.indexOf('function applyConditions(){'),html.indexOf('function refresh(){')),ctx)
vm.runInContext(js.slice(js.indexOf('  function serializeAnswers()'),js.indexOf('  function filesForInput(')),ctx)
let cases=0
for(const request of ['', 'Yes','No'])for(const type of fields.find(f=>f.qn===58).o)for(const wheels of fields.find(f=>f.qn===59).o)for(const fallback of fields.find(f=>f.qn===60).o){
 keys.set('showerRequest',request);keys.set('showerHotel','No')
 const values={55:request,56:'No',57:'Yes',58:type[0],59:wheels[0],60:fallback[0]}
 cards.forEach(c=>c.value=values[c.number]);ctx.applyConditions()
 const answers=ctx.serializeAnswers()
 assert.equal(answers.q55,request)
 for(const qn of [56,57]){assert.equal(answers['q'+qn],'');assert.ok(cards.find(c=>c.number===qn).hidden)}
 for(const qn of [58,59,60]){assert.equal(answers['q'+qn],request==='Yes'?values[qn]:'');assert.equal(!!cards.find(c=>c.number===qn).hidden,request!=='Yes')}
 cases++
}
const payload=JSON.parse(execFileSync(process.execPath,['scripts/register-post-order-survey-form.mjs'],{encoding:'utf8'})).payload
assert.equal(payload.fields.length,63)
for(const name of ['q55','q56','q57','q58','q59','q60'])assert.ok(payload.fields.find(f=>f.name===name))
console.log(`SHOWER_OK ${cases} combinations; 4 chair types; 3 wheel choices; 3 fallback choices; legacy consent never reused; hidden answers excluded; 63 fields`)
