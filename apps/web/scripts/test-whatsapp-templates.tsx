import assert from 'node:assert/strict'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { renderToStaticMarkup } from 'react-dom/server'
import WhatsAppTemplateComposer, { WhatsAppTemplatePreview } from '../src/components/whatsapp-template-composer'
import ChatComposer from '../src/components/chat-composer'
import ChatMessageContent from '../src/components/chat-message-content'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const storage = new Map<string,string>()
;(globalThis as any).localStorage = { getItem: (key:string) => storage.get(key) || null, setItem: (key:string,value:string) => storage.set(key,value), removeItem: (key:string) => storage.delete(key) }
const template = {id:'t',name:'booking',label:'予約確定書',language:'en_US',status:'APPROVED',category:'UTILITY',bodyText:'Hello {{1}}',available:true,unavailableReason:null,documentRequired:false,parameters:[{key:'body:1',label:'お客様名',isUrl:false}],urlButtons:[]}
const preview:any = {friendId:'a',recipientName:'Alex',recipientPhone:'+15555550100',accountName:'Flat Travel',templateName:'booking',templateLanguage:'en_US',category:'UTILITY',text:'Hello Alex',document:null,previewToken:'token',previewExpiresAt:Date.now()+600000,canSend:true}
let sends=0;let postOutcome='accepted';let canSend=true;let refreshes=0
const originalFetch=globalThis.fetch
const calls: any[]=[]
globalThis.fetch=(async(url:any,options:any={})=>{
 const path=String(url);calls.push({path,...options})
 if(path.endsWith('/templates'))return Response.json({success:true,data:{friendId:'a',recipientName:'Alex',recipientPhone:'+15555550100',releaseMode:canSend?'live':'off',canSend,templates:[template]}})
 if(path.endsWith('/template-preview'))return Response.json({success:true,data:{...preview,canSend}})
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
async function make(){let renderer!:ReactTestRenderer;await act(async()=>{renderer=create(<WhatsAppTemplateComposer friendId="a" onSent={()=>{refreshes++}}/>)});return renderer}
async function prepare(renderer:ReactTestRenderer){
 await click(renderer,'予約・見積り・支払い案内')
 await act(async()=>{renderer.root.findByType('select').props.onChange({target:{value:'booking:en_US'}})})
 assert.equal(renderer.root.findByProps({type:'text'}).props.value,'Alex')
 await click(renderer,'宛先・完成文・添付を確認')
 assert.equal(button(renderer,'この案内を送信').props.disabled,true)
 const boxes=renderer.root.findAllByProps({type:'checkbox'});assert.equal(boxes.length,2)
 await act(async()=>{boxes[0].props.onChange({target:{checked:true}});boxes[1].props.onChange({target:{checked:true}})})
}
async function main() {
try{
 const markup=renderToStaticMarkup(<WhatsAppTemplatePreview preview={{...preview,document:{key:'private-key',name:'Quote.pdf',size:100}}}/>)
 assert.match(markup,/15555550100/);assert.match(markup,/Quote.pdf/);assert.ok(!markup.includes('/api/files/'))
 assert.match(renderToStaticMarkup(<ChatMessageContent messageType="whatsapp_template" content={JSON.stringify({...preview,document:{key:'private-key',name:'Quote.pdf'}})}/>),/Hello Alex/)
 const closed=renderToStaticMarkup(<ChatComposer friendId="a" channelType="whatsapp"/>)
 assert.match(closed,/予約・見積り・支払い案内/)
 assert.ok(!renderToStaticMarkup(<ChatComposer friendId="a" channelType="line"/>).includes('予約・見積り・支払い案内'))
 let ui=await make();await prepare(ui)
 // Editing invalidates reviewed content and removes the send action.
 await act(async()=>{ui.root.findByProps({type:'text'}).props.onChange({target:{value:'Changed'}})})
 assert.equal(button(ui,'この案内を送信'),undefined)
 await click(ui,'宛先・完成文・添付を確認')
 await act(async()=>{for(const box of ui.root.findAllByProps({type:'checkbox'}))box.props.onChange({target:{checked:true}})})
 await click(ui,'この案内を送信');assert.equal(sends,1);assert.equal(refreshes,1);assert.equal(button(ui,'この案内を送信').props.disabled,true)
 await act(async()=>{ui.unmount()})
 ui=await make();await click(ui,'予約・見積り・支払い案内');assert.equal(ui.root.findByType('fieldset').props.disabled,true,'refresh restores pending receipt')
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
