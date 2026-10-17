import assert from 'node:assert/strict'
import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import WhatsAppCallRecording from '../src/components/whatsapp-call-recording'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
;(globalThis as any).localStorage={getItem:()=> 'test'}
const originalFetch=globalThis.fetch
const events:string[]=[];let sink:any;let noticeMode='staff_confirmed';let persisted:any=null;let noticeFails=false
globalThis.fetch=(async(url:any,init:any={})=>{
 const path=String(url)
 if(path.endsWith('/status'))return Response.json({data:{enabled:true,noticeVersion:'wa-recording-v1',noticeMode,retentionDays:30,recording:persisted}})
 events.push(path.endsWith('/start')?'server-start':path.endsWith('/complete')?'complete':path.endsWith('/discard')?'discard':'upload')
 return Response.json({success:true})
}) as any
const connection:any={async announceRecording(){events.push('notice');if(noticeFails)throw Error('notice unavailable')},async startRecording(value:any){events.push('capture');sink=value},async stopRecording(){events.push('stop');await sink.part({index:0,blob:new Blob(['audio'],{type:'audio/webm'})});await sink.complete(1)}}
const audio=()=>connection;const pending:boolean[]=[];const onPending=(value:boolean)=>pending.push(value)
const props={callId:'call',ownerId:'owner',connected:true,audio,isOwner:true,onPending}
const text=(x:any):string=>typeof x==='string'?x:(Array.isArray(x)?x:x?.children||[]).map(text).join('')
let r:ReactTestRenderer
async function mount(overrides:any={}){await act(async()=>{r=create(<WhatsAppCallRecording {...props} {...overrides}/>);await new Promise(r=>setTimeout(r,0))})}
async function unmount(){await act(async()=>r!.unmount())}
async function main(){
try{
 await mount({isOwner:false});assert.deepEqual(events,[]);assert.equal(r!.toJSON(),null);await unmount()
 await mount();assert.deepEqual(events,[],'no recording before notice/consent confirmation')
 await act(async()=>{r!.root.findByType('input').props.onChange({target:{checked:true}});await new Promise(r=>setTimeout(r,0))})
 assert.deepEqual(events,['server-start','capture']);assert.deepEqual(pending,[true]);assert.match(text(r!.toJSON()),/録音中/)
 await act(async()=>{await r!.root.findAllByType('button')[0].props.onClick();await new Promise(r=>setTimeout(r,0))})
 assert.deepEqual(events,['server-start','capture','stop','upload','complete']);assert.equal(pending.at(-1),false);assert.match(text(r!.toJSON()),/投稿を準備中/);await unmount()
 events.length=0;noticeMode='announced'
 await mount({connected:false});assert.deepEqual(events,[],'never starts on unconnected call');await unmount()
 await mount();assert.deepEqual(events,['server-start','notice','capture'],'announcement completes before recording starts');await unmount()
 events.length=0;noticeFails=true
 await mount();assert.deepEqual(events,['server-start','notice'],'announcement failure prevents recording');assert.equal(pending.at(-1),false);assert.match(text(r!.toJSON()),/録音・保存に失敗/);await unmount();noticeFails=false
 events.length=0;noticeMode='staff_confirmed'
 await mount()
 await act(async()=>{r!.root.findByType('input').props.onChange({target:{checked:true}});await new Promise(r=>setTimeout(r,0))})
 await act(async()=>{await r!.root.findAllByType('button')[1].props.onClick();await new Promise(r=>setTimeout(r,0))})
 assert.deepEqual(events,['server-start','capture','stop','discard'],'refusal stops capture without completing or posting the recording');assert.match(text(r!.toJSON()),/録音・共有を中止しました/);await unmount()
 events.length=0;persisted={state:'published'}
 await mount();assert.deepEqual(events,[],'reload cannot rerecord or republish an existing call');assert.match(text(r!.toJSON()),/投稿済み/);await unmount()
 console.log('PASS call recording UI: explicit staff consent, owned/connected-call gate, automatic announcement before capture, stop without hangup, upload-finalize sequence, pending state and no rerecord on reload')
}finally{globalThis.fetch=originalFetch}

}
main().then(()=>process.exit(0),error=>{console.error(error);process.exit(1)})
