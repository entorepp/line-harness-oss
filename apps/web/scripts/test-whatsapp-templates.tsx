import assert from 'node:assert/strict'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { renderToStaticMarkup } from 'react-dom/server'
import WhatsAppTemplateComposer, { WhatsAppTemplatePreview } from '../src/components/whatsapp-template-composer'
import ChatComposer from '../src/components/chat-composer'
import ChatMessageContent from '../src/components/chat-message-content'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const storage = new Map<string,string>()
;(globalThis as any).localStorage = { getItem: (key:string) => storage.get(key) || null, setItem: (key:string,value:string) => storage.set(key,value), removeItem: (key:string) => storage.delete(key) }
const template = {id:'t',name:'flat_travel_booking_confirmation_v1',label:'予約確定書',language:'en_US',status:'APPROVED',category:'UTILITY',bodyText:'Hello {{1}}',available:true,unavailableReason:null,documentRequired:false,parameters:[{key:'body:1',label:'お客様名',isUrl:false}],urlButtons:[]}
const preview:any = {friendId:'a',recipientName:'Alex',recipientPhone:'+15555550100',accountName:'Flat Travel',templateName:'flat_travel_booking_confirmation_v1',templateLanguage:'en_US',category:'UTILITY',text:'Hello Alex',quickReplies:['Continue chat'],document:null,previewToken:'token',previewExpiresAt:Date.now()+600000,canSend:true}
let sends=0;let postOutcome='accepted';let canSend=true;let refreshes=0
let previewError=false;let resultScrolls=0;let quoteApproved=true
const focusedFields: string[]=[]
const originalFetch=globalThis.fetch
const calls: any[]=[]
globalThis.fetch=(async(url:any,options:any={})=>{
 const path=String(url);calls.push({path,...options})
 if(path.endsWith('/templates'))return Response.json({success:true,data:{friendId:'a',recipientName:'Alex',recipientPhone:'+15555550100',releaseMode:canSend?'live':'off',canSend,templates:[{...template,name:'flat_travel_requested_info_ready_v1'},template, {...template,name:'flat_travel_requested_quote_v2',documentRequired:true,available:quoteApproved,status:quoteApproved?'APPROVED':'PENDING'}, {...template,name:'flat_travel_requested_quote_v1',documentRequired:true,parameters:[...template.parameters,{key:'body:2',label:'問合せ・見積り番号',isUrl:false}]}, {...template,name:'flat_travel_payment_link_v1',urlButtons:[{index:0,label:'お支払い',url:'https://example.com/pay/{{1}}',dynamic:true}]}, {...template,name:'flat_travel_rail_document_v1'}, {...template,name:'hello_world'}]}})
 if(path.endsWith('/documents'))return Response.json({success:true,data:{key:'private-quote',name:'Quote.pdf',size:100}})
 if(path.endsWith('/template-preview')) {
  if(previewError)return Response.json({success:false,error:'承認状態が更新されました。再確認してください'},{status:400})
  return Response.json({success:true,data:{...preview,canSend}})
 }
 if(path.endsWith('/template-messages')){
  sends++;const body=JSON.parse(options.body);assert.equal(body.optInConfirmed,true);assert.equal(body.contentConfirmed,true);assert.equal(body.previewToken,'token');assert.ok(storage.get('wa-template-send:a'),'receipt key persisted before network')
  if(postOutcome==='network')throw Error('Network stopped')
  if(postOutcome==='not_started')return Response.json({success:false,error:'Preview expired',outcome:'not_started'},{status:400})
  return Response.json({success:true,data:{status:'accepted'}})
 }
 if(path.includes('/template-messages/'))return Response.json({success:true,data:{status:'accepted'}})
 throw Error('Unexpected request '+path)
}) as typeof fetch
const textOf=(node:any):string=> typeof node==='string'?node:(node?.children||[]).map(textOf).join('')
function button(renderer:ReactTestRenderer,label:string){return renderer.root.findAllByType('button').find(node=>textOf(node).includes(label))!}
async function click(renderer:ReactTestRenderer,label:string){const node=button(renderer,label);assert.ok(node,label);assert.ok(!node.props.disabled,label+' is enabled');await act(async()=>{await node.props.onClick();await new Promise(resolve=>setTimeout(resolve,0))})}
async function make(){
 let renderer!:ReactTestRenderer
 await act(async()=>{renderer=create(<WhatsAppTemplateComposer friendId="a" onSent={()=>{refreshes++}}/>,{
  createNodeMock:(element)=>element.type==='input'
   ?{focus:()=>focusedFields.push((element.props as { 'aria-label': string })['aria-label'])}
   :element.type==='div'?{scrollIntoView:()=>resultScrolls++}:null,
 })})
 return renderer
}
async function prepare(renderer:ReactTestRenderer){
 await click(renderer,'会話再開・見積書・決済リンク・予約確定書')
 assert.deepEqual(renderer.root.findAllByType('option').map(node=>node.props.value), ['', 'flat_travel_requested_info_ready_v1:en_US', 'flat_travel_requested_quote_v2:en_US', 'flat_travel_payment_link_v1:en_US', 'flat_travel_booking_confirmation_v1:en_US'])
 assert.match(textOf(renderer.toJSON()), /見積書を送る（PDF）/)
 assert.match(textOf(renderer.toJSON()), /決済リンクを送る/)
 assert.match(textOf(renderer.toJSON()), /予約確定書を送る（PDF）/)
 await act(async()=>renderer.root.findByType('select').props.onChange({target:{value:'flat_travel_requested_quote_v2:en_US'}}))
 assert.equal(renderer.root.findByProps({type:'file'}).props.accept,'application/pdf,.pdf')
 assert.equal(button(renderer,'宛先・完成文・添付を確認').props.disabled,true,'quotation needs PDF before preview')
 await act(async()=>renderer.root.findByType('select').props.onChange({target:{value:'flat_travel_payment_link_v1:en_US'}}))
 assert.equal(renderer.root.findAllByProps({type:'file'}).length,0,'payment link does not request a PDF')
 if(!canSend) assert.match(textOf(renderer.toJSON()), /ハーネス側の送信機能が停止中/)
 await act(async()=>{renderer.root.findByType('select').props.onChange({target:{value:'flat_travel_booking_confirmation_v1:en_US'}})})
 assert.equal(renderer.root.findByProps({type:'text'}).props.value,'Alex')
 await click(renderer,'宛先・完成文・添付を確認')
 assert.match(textOf(renderer.toJSON()),/Continue chat/);assert.match(textOf(renderer.toJSON()),/案内を送るだけでは再開しません/);assert.equal(button(renderer,'Continue chat'),undefined,'preview is display-only, never a simulated customer reply')
 assert.equal(button(renderer,'この案内を送信').props.disabled,true)
 const boxes=renderer.root.findAllByProps({type:'checkbox'});assert.equal(boxes.length,2)
 await act(async()=>{boxes[0].props.onChange({target:{checked:true}});boxes[1].props.onChange({target:{checked:true}})})
}
async function main() {
try{
 const markup=renderToStaticMarkup(<WhatsAppTemplatePreview preview={{...preview,document:{key:'private-key',name:'Quote.pdf',size:100}}}/>)
 assert.match(markup,/Continue chat/);assert.match(markup,/その時点から24時間/);assert.match(markup,/15555550100/);assert.match(markup,/Quote.pdf/);assert.ok(!markup.includes('/api/files/'))
 assert.match(renderToStaticMarkup(<ChatMessageContent messageType="whatsapp_template" content={JSON.stringify({...preview,document:{key:'private-key',name:'Quote.pdf'}})}/>),/Continue chat/)
 const closed=renderToStaticMarkup(<ChatComposer friendId="a" channelType="whatsapp"/>)
 assert.match(closed,/会話再開・見積書・決済リンク・予約確定書/)
 assert.ok(!renderToStaticMarkup(<ChatComposer friendId="a" channelType="line"/>).includes('会話再開・見積書・決済リンク・予約確定書'))
 // Meta's asynchronous review must not disable the existing quotation workflow.
 quoteApproved=false
 let pendingQuote=await make();await click(pendingQuote,'会話再開・見積書・決済リンク・予約確定書')
 assert.ok(pendingQuote.root.findAllByType('option').some(node=>node.props.value==='flat_travel_requested_quote_v1:en_US'))
 assert.ok(!pendingQuote.root.findAllByType('option').some(node=>node.props.value==='flat_travel_requested_quote_v2:en_US'))
 await act(async()=>pendingQuote.root.findByType('select').props.onChange({target:{value:'flat_travel_requested_quote_v1:en_US'}}))
 await act(async()=>pendingQuote.root.findByProps({'aria-label':'問合せ・見積り番号'}).props.onChange({target:{value:'EXISTING-DRAFT'}}))
 await act(async()=>{pendingQuote.root.findByProps({type:'file'}).props.onChange({target:{files:[new File(['%PDF-test'],'Quote.pdf',{type:'application/pdf'})]}});await new Promise(resolve=>setTimeout(resolve,0))})
 quoteApproved=true
 await click(pendingQuote,'Metaの承認状況を更新')
 assert.equal(pendingQuote.root.findByProps({'aria-label':'問合せ・見積り番号'}).props.value,'EXISTING-DRAFT','approval never silently rewrites an open draft')
 assert.match(textOf(pendingQuote.toJSON()),/添付済み: Quote.pdf/)
 assert.equal(button(pendingQuote,'宛先・完成文・添付を確認').props.disabled,false)
 await act(async()=>pendingQuote.unmount())
 // The new quotation has no reference input or hidden reference parameter.
 let quote=await make();await click(quote,'会話再開・見積書・決済リンク・予約確定書')
 await act(async()=>quote.root.findByType('select').props.onChange({target:{value:'flat_travel_requested_quote_v2:en_US'}}))
 await act(async()=>{quote.root.findByProps({type:'file'}).props.onChange({target:{files:[new File(['%PDF-test'],'Quote.pdf',{type:'application/pdf'})]}});await new Promise(resolve=>setTimeout(resolve,0))})
 assert.equal(quote.root.findAllByProps({type:'text'}).length,1,'name is the only quotation text input')
 assert.doesNotMatch(textOf(quote.toJSON()),/問合せ・見積り番号/)
 const previewCalls=()=>calls.filter(call=>call.path.endsWith('/template-preview'))
 const before=previewCalls().length
 for(const value of ['', '   ']) {
  await act(async()=>quote.root.findByProps({'aria-label':'お客様名'}).props.onChange({target:{value}}))
  await click(quote,'宛先・完成文・添付を確認')
  assert.equal(previewCalls().length,before,'missing name stays local and never submits an invalid preview')
  assert.equal(focusedFields.at(-1),'お客様名')
  assert.equal(quote.root.findByProps({'aria-label':'お客様名'}).props['aria-invalid'],true)
  assert.match(textOf(quote.toJSON()),/お客様名を入力してください/)
  assert.match(textOf(quote.toJSON()),/添付済み: Quote.pdf/,'validation preserves the attached PDF')
 }
 await act(async()=>quote.root.findByProps({'aria-label':'お客様名'}).props.onChange({target:{value:'Alex'}}))
 const scrollsBefore=resultScrolls
 await click(quote,'宛先・完成文・添付を確認')
 assert.equal(previewCalls().length,before+1)
 assert.equal(JSON.parse(previewCalls().at(-1).body).documentKey,'private-quote')
 assert.equal(JSON.parse(previewCalls().at(-1).body).templateName,'flat_travel_requested_quote_v2')
 assert.deepEqual(JSON.parse(previewCalls().at(-1).body).values,{'body:1':'Alex'},'no reference is generated or sent behind the form')
 assert.ok(resultScrolls>scrollsBefore,'successful preview is scrolled into view')
 assert.equal(button(quote,'この案内を送信').props.disabled,true,'preview still requires both confirmations')
 await act(async()=>quote.root.findByProps({'aria-label':'お客様名'}).props.onChange({target:{value:'Changed Alex'}}))
 previewError=true
 const errorScrolls=resultScrolls
 await click(quote,'宛先・完成文・添付を確認')
 assert.match(textOf(quote.toJSON()),/承認状態が更新されました/)
 assert.ok(resultScrolls>errorScrolls,'server rejection is scrolled into view')
 assert.equal(button(quote,'この案内を送信'),undefined)
 previewError=false
 await act(async()=>quote.root.findByType('select').props.onChange({target:{value:'flat_travel_payment_link_v1:en_US'}}))
 const beforeButton=previewCalls().length
 await click(quote,'宛先・完成文・添付を確認')
 assert.equal(previewCalls().length,beforeButton)
 assert.equal(focusedFields.at(-1),'お支払い（URL末尾）')
 assert.equal(sends,0,'validation and previews never send messages')
 await act(async()=>quote.unmount())
 let ui=await make();await prepare(ui)
 // Editing invalidates reviewed content and removes the send action.
 await act(async()=>{ui.root.findByProps({type:'text'}).props.onChange({target:{value:'Changed'}})})
 assert.equal(button(ui,'この案内を送信'),undefined)
 await click(ui,'宛先・完成文・添付を確認')
 await act(async()=>{for(const box of ui.root.findAllByProps({type:'checkbox'}))box.props.onChange({target:{checked:true}})})
 await click(ui,'この案内を送信');assert.equal(sends,1);assert.equal(refreshes,1);assert.equal(button(ui,'この案内を送信').props.disabled,true)
 await act(async()=>{ui.unmount()})
 ui=await make();await click(ui,'会話再開・見積書・決済リンク・予約確定書');assert.equal(ui.root.findByType('fieldset').props.disabled,true,'refresh restores pending receipt')
 await click(ui,'送信結果を確認');assert.equal(sends,1,'receipt lookup is never a send')
 await click(ui,'確認して別の案内を作成');assert.equal(storage.size,0)
 await act(async()=>{ui.unmount()})
 postOutcome='network';ui=await make();await prepare(ui);await click(ui,'この案内を送信');assert.equal(sends,2);assert.ok(storage.get('wa-template-send:a'));assert.equal(button(ui,'この案内を送信').props.disabled,true)
 await click(ui,'送信結果を確認');assert.equal(sends,2);await click(ui,'確認して別の案内を作成');await act(async()=>ui.unmount())
 postOutcome='not_started';ui=await make();await prepare(ui);await click(ui,'この案内を送信');assert.equal(storage.size,0,'explicit pre-send rejection permits a corrected preview');assert.equal(button(ui,'この案内を送信'),undefined);await act(async()=>ui.unmount())
 canSend=false;ui=await make();await prepare(ui);assert.equal(button(ui,'この案内を送信').props.disabled,true,'off mode permits preview but never sending');await act(async()=>ui.unmount())
 console.log('PASS: actual React consent/preview/send flow, editable variables, draft invalidation, receipt persistence on refresh/network failure, server rejection recovery, off gate, private PDF/history rendering and LINE isolation')
}finally{globalThis.fetch=originalFetch}

}
main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1) })
