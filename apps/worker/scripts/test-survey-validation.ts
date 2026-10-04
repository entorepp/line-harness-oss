import assert from 'node:assert/strict';
import { POST_ORDER_FORM_ID, PRE_ORDER_FORM_ID, isCaseBoundPreOrder, validatePostOrderAnswers } from '../src/lib/survey-validation.js';

const valid = {q2:'test@example.com', consent:'Agreed / 同意済み', q42:'Flight number: AF274\nArrival date (Japan time): 2026-10-05', q43:'Flight number: KL862\nDeparture date (Japan time): 2026-10-12'};
assert.equal(validatePostOrderAnswers(valid), null);
for (const number of ['Air France', 'AF', '274', 'AF274/AF275', 'AF274; send']) {
  assert.match(validatePostOrderAnswers({...valid, q42:`Flight number: ${number}\nArrival date (Japan time): 2026-10-05`}) || '', /Q42/);
}
for (const day of ['', '2026-02-30', '10/05/2026', 'tomorrow']) {
  assert.match(validatePostOrderAnswers({...valid, q43:`Flight number: AF275\nDeparture date (Japan time): ${day}`}) || '', /Q43/);
}
for (const number of ['Not booked', 'Not flying', 'Unknown']) {
  assert.equal(validatePostOrderAnswers({...valid, q42:`Flight number: ${number}`}), null);
}
for (const [question, value] of [['q17','Device 1\nWidth: 1000'],['q18','Device 1\n150lb'],['q22','Traveller 1 — Example\nHeight: 165-175'],['q22','Height: -1']]) {
  assert.ok(validatePostOrderAnswers({...valid,[question]:value}));
}
assert.equal(validatePostOrderAnswers({...valid,q17:'Device 1\nLength: 95\nWidth: 65\nHeight: 90',q18:'Device 1\n12',q22:'Traveller 1 — Example\nHeight: 165\nWeight: 60'}),null);
assert.ok(validatePostOrderAnswers({...valid,consent:'No'}));
assert.ok(validatePostOrderAnswers({...valid,q2:'not email'}));
assert.equal(isCaseBoundPreOrder({form_id:PRE_ORDER_FORM_ID,name:'FlatWorker受注前アンケート'}),true);
assert.equal(isCaseBoundPreOrder(null),false);
assert.equal(isCaseBoundPreOrder({form_id:POST_ORDER_FORM_ID,name:'FlatWorker受注前アンケート'}),false);
assert.equal(isCaseBoundPreOrder({form_id:PRE_ORDER_FORM_ID,name:'Ordinary public inquiry'}),false);
console.log('SURVEY_VALIDATION_OK flight/date/metric/consent/email/case-bound-trigger');

// Exercise the actual public route: validation must precede persistence and any
// notification/quote side effect, including callers that bypass the browser.
const { Hono } = await import('hono');
const { forms } = await import('../src/routes/forms.js');
const app = new Hono();
app.route('/', forms);
let writes = 0;
const db = {prepare(sql:string) {return {bind() {return this;}, async first() {return sql.includes('FROM forms WHERE id') ? {id:POST_ORDER_FORM_ID,is_active:1,fields:JSON.stringify(Object.keys(valid).map(name=>({name,label:name,type:'textarea',required:false})))} : null;}, async run(){writes++; return {success:true};}, async all(){return {results:[]};}};}};
for (const change of [{q42:'Flight number: Air France'}, {q43:'Flight number: AF275\nDeparture date (Japan time): 2026-02-30'}, {consent:'No'}, {q2:'invalid'}]) {
 const response = await app.request(`/api/forms/${POST_ORDER_FORM_ID}/submit`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data:{...valid,...change}})}, {DB:db,FORMS_ENABLE_LINE_FOLLOWUP:'false'});
 assert.equal(response.status,400);
 assert.equal(writes,0);
}
console.log('SURVEY_PUBLIC_ROUTE_GUARD_OK invalid_requests_write_nothing');
