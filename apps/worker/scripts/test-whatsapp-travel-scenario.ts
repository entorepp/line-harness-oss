import { extractionRequest } from '../src/services/whatsapp-intake-ai.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newIntake, type Locale, type CatalogueItem } from '../src/services/whatsapp-intake.js';
import { enableTravelScenario, nextTravelPrompt, selectTravelChoice, renderTravelScenario, nativeTravelInteractive, trackedTravelUrl, travelTextAnswer, reconcileTravelScenario } from '../src/services/whatsapp-travel-scenario.js';
const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const model=(locale:Locale):CatalogueItem=>({id:'C07',title:'Published model',kind:'package',locale,url:`https://flat-travel.com/${locale}/journeys/c07`,publication:{status:'published',revision:'one',validUntil:new Date(Date.now()+60000).toISOString()},cities:['Tokyo','Kyoto'],minDays:7,maxDays:7,supportedPartySizes:[1,2,3,4],supportEvidence:{}});
for(const locale of ['en','tc','sc','kr'] as Locale[]) test(`${locale}: native choices fit limits, unknowns are valid and no model is needed`,()=>{
 let s=enableTravelScenario(newIntake(locale,true));
 for(let n=0;n<20;n++) {
  const q=nextTravelPrompt(s)!;assert.ok(q);
  const rendered=renderTravelScenario(s,[model(locale)]);assert.ok(nativeTravelInteractive(rendered,id));
  assert.ok(q.choices.every(x=>x.length<=24));assert.ok(q.choices.length<=10);
  if(q.key==='progress') {assert.ok(rendered.vision!==undefined);assert.equal(selectTravelChoice(s,1).travel!.answers.progress,undefined);s.travel!.visionShownFor=s.travel!.tripRevision;s=selectTravelChoice(s,1);break;}
  const i=q.values.indexOf('unknown');s=selectTravelChoice(s,i>=0?i:0);assert.notEqual(s.phase,'human');
 }
 const result=renderTravelScenario(s,[model(locale)]);assert.equal(result.plan.action,'recommend');assert.match(result.text,/utm_content=whole_trip/);
});
test('range and total party preserve uncertainty without converting to exact days or adults',()=>{
 let s=enableTravelScenario(newIntake('en',true));s=travelTextAnswer(s,'10–14 days')!;s=travelTextAnswer(s,'2 people')!;
 assert.equal(s.travel!.answers.duration,'10-14');assert.equal(s.travel!.answers.party,'2');assert.equal(s.slots.party,undefined);assert.equal(s.slots.duration,undefined);
});
test('qualified and stopped states never restart',()=>{
 assert.equal(enableTravelScenario(newIntake('en',false)).travel,undefined);
 const s=newIntake('en',true);s.phase='stopped';assert.equal(enableTravelScenario(s).travel,undefined);
});
test('UTM is fixed, private query fields fail closed and product path is retained',()=>{
 const u=new URL(trackedTravelUrl('https://flat-travel.com/en/journeys/c07','travel_vision'));
 assert.equal(u.pathname,'/en/journeys/c07');assert.deepEqual(Object.fromEntries(u.searchParams),{utm_source:'whatsapp',utm_medium:'messaging',utm_campaign:'wa_travel_scenario_v2',utm_content:'travel_vision'});
 for(const value of ['https://evil.example/en/journeys/c07','https://flat-travel.com/en/journeys/c07?phone=08000000000','https://flat-travel.com/en/journeys/c07#private']) assert.throws(()=>trackedTravelUrl(value,'whole_trip'));
});
test('large changes and relaxed pace do not silently claim a published model is a fit',()=>{
 const s=enableTravelScenario(newIntake('en',true));s.slots={cities:['Tokyo'],timing:'November',duration:{value:15,unit:'days'},party:{adults:2,children:0},budget:{amount:null,currency:null,basis:null,scope:null},support:['none']};s.travel!.answers.progress='whole';s.travel!.visionShownFor=s.travel!.tripRevision;reconcileTravelScenario(s);
 assert.equal(renderTravelScenario(s,[model('en')]).plan.reason,'tailor_made_route');
});

test('free-text extraction sees the actual scenario question, never the legacy product-first question',()=>{
 let s=enableTravelScenario(newIntake('en',true));s=selectTravelChoice(s,0);
 const request=extractionRequest(s,'Kyoto please','fixture');assert.deepEqual(JSON.parse(request.input).pendingQuestions,['cities']);
});
