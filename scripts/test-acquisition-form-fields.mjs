import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const {createAcquisitionFunnel}=await import('data:text/javascript,'+encodeURIComponent(fs.readFileSync('packages/acquisition-funnel/core.js','utf8')));
const f=createAcquisitionFunnel({origin:'https://form.example',surface:'form',submitPath:'/submit'});
const listeners={},sent=[],mutations=[],timers=new Map();let timerId=0,intersections;
const attrs={'data-traffic-field':'email','data-traffic-complete':'false'};
const field={getAttribute:k=>attrs[k],getBoundingClientRect:()=>({height:100})};
const document={documentElement:{},visibilityState:'visible',querySelectorAll:()=>[field],querySelector:()=>field,addEventListener:(name,fn)=>{(listeners[name]||=[]).push(fn)}};
const window={fetch:async(url,init)=>{sent.push(JSON.parse(init.body));return {ok:true}},addEventListener:(name,fn)=>{(listeners[name]||=[]).push(fn)}};
const dispatch=(name,event)=>listeners[name]?.forEach(fn=>fn(event));
vm.runInNewContext(f.client(crypto.randomUUID()),{window,document,location:{origin:'https://form.example',href:'https://form.example/public-form'},URL,Headers,Request,crypto,console,
 MutationObserver:class{constructor(fn){mutations.push(fn)}observe(){}disconnect(){}},
 IntersectionObserver:class{constructor(fn){intersections=fn}observe(){}},requestAnimationFrame:fn=>fn(),
 setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id},clearTimeout:id=>timers.delete(id)});
const tick=async()=>{await new Promise(r=>setTimeout(r,0))};await tick();
const events=()=>sent.flatMap(b=>b.events||[]);
assert(!events().some(e=>e.event==='field_complete'));
intersections([{target:field,isIntersecting:true,intersectionRatio:0.5}]);intersections([{target:field,isIntersecting:false,intersectionRatio:0}]);
for(const [id,t] of timers)if(t.delay===1000){timers.delete(id);t.fn()};await tick();
assert(!events().some(e=>e.event==='field_visible'),'Brief exposure must not be counted');
intersections([{target:field,isIntersecting:true,intersectionRatio:0.5}]);
for(const [id,t] of timers)if(t.delay===1000){timers.delete(id);t.fn()};await tick();
assert.equal(events().filter(e=>e.event==='field_visible').length,1);
attrs['data-traffic-complete']='true';mutations.forEach(fn=>fn());await tick();
mutations.forEach(fn=>fn());await tick();assert.equal(events().filter(e=>e.event==='field_complete').length,1);
dispatch('flat-travel:form-validation',{detail:{fields:['email','city_schedule','private@example.com']}});await tick();
assert.equal(events().filter(e=>e.event==='validation_error').length,2);
assert(!JSON.stringify(sent).includes('private@example.com'));
assert(!JSON.stringify(sent).includes('data-traffic-complete'));
console.log('PASS form diagnostics: 1-second exposure, cancelled brief exposure, completion without values, dedupe, conditional DOM scanning and allowlisted validation errors');
