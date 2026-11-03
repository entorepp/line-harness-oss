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
assert.equal(fields.length,3)
for(const f of fields){assert.equal(f.r,1);assert.deepEqual(Array.from(f.o,o=>o[0]),['Yes','No']);assert.equal(f.after,33)}
assert.ok(!gear.f.find(f=>f.id==='gear').items.some(i=>i.v==='Shower chair'))
assert.equal(gear.f.find(f=>f.id==='gear').items.find(i=>i.v==='Voltage transformer').keyIndex,3)
assert.ok(html.includes('inp.dataset.k=QKEY+"_"+(it.keyIndex??i)'))
assert.ok(fields[2].e.includes('40,000 per hotel'))
const cards=fields.map(f=>({number:f.qn,dataset:{...(f.showIf?{showif:JSON.stringify(f.showIf)}:{}),...(f.showIfAll?{showifall:JSON.stringify(f.showIfAll)}:{})},hidden:false,value:''}))
const keys=new Map()
const ctx=vm.createContext({KEYS:keys,QUESTION_COUNT:57,FILE_QUESTIONS:new Set([5,7,13]),document:{querySelectorAll:selector=>selector==='.q[data-showif]'?cards.filter(c=>c.dataset.showif):selector==='.q'?cards:[],getElementById:()=>({checked:true})},isConditionallyVisible:c=>!c.hidden,questionNumber:c=>c.number,serializeQuestionCard:c=>c.value,blockLabel:()=>'',serializeInterests:()=>'',isJapanese:()=>false})
vm.runInContext(html.slice(html.indexOf('function applyConditions(){'),html.indexOf('function refresh(){')),ctx)
vm.runInContext(js.slice(js.indexOf('  function serializeAnswers()'),js.indexOf('  function filesForInput(')),ctx)
for(const request of ['','Yes','No'])for(const hotel of ['','Yes','No'])for(const rental of ['','Yes','No']){
 keys.set('showerRequest',request); keys.set('showerHotel',hotel)
 cards.forEach((c,i)=>c.value=[request,hotel,rental][i]);ctx.applyConditions()
 assert.equal(!!cards[1].hidden,request!=='Yes')
 assert.equal(!!cards[2].hidden,request!=='Yes'||hotel!=='No')
 const answers=ctx.serializeAnswers()
 assert.equal(answers.q55,request)
 assert.equal(answers.q56,request==='Yes'?hotel:'')
 assert.equal(answers.q57,request==='Yes'&&hotel==='No'?rental:'')
}
const payload=JSON.parse(execFileSync(process.execPath,['scripts/register-post-order-survey-form.mjs'],{encoding:'utf8'})).payload
assert.equal(payload.fields.length,60)
for(const name of ['q55','q56','q57'])assert.ok(payload.fields.find(f=>f.name===name))
console.log('SHOWER_OK 27 branch combinations; stale hidden answers excluded; Yes/No identities; per-hotel price; 60 fields')
