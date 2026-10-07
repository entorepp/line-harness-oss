import { callingReturnPath, callingLoginDestination } from '../src/lib/whatsapp-call-link'
import assert from 'node:assert/strict'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import WhatsAppCallingProvider, { WhatsAppCallButton, WhatsAppCallLink } from '../src/components/whatsapp-calling'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const deepId = '12345678-1234-4234-8234-123456789abc'
assert.equal(callingReturnPath('/calls', '?wa_call='+deepId), '/calls?wa_call='+deepId)
assert.equal(callingLoginDestination('?next='+encodeURIComponent('/calls?wa_call='+deepId)), '/calls?wa_call='+deepId)
for (const next of ['https://evil.test', '//evil.test/calls?wa_call='+deepId, '/calls?wa_call=bad', '/chats', '/calls?wa_call='+deepId+'%0aevil']) assert.equal(callingLoginDestination('?next='+encodeURIComponent(next)), '/')
const store = new Map<string,string>()
;(globalThis as any).localStorage = { getItem:()=> 'test' }
;(globalThis as any).sessionStorage = { getItem:(k:string)=>store.get(k)||null,setItem:(k:string,v:string)=>store.set(k,v),removeItem:(k:string)=>store.delete(k) }
;(globalThis as any).window = { addEventListener(){},removeEventListener(){},focus(){} }
let stopped=0;const tracks:any[]=[]
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>{const t={enabled:true,stop(){stopped++}};tracks.push(t);return {getTracks:()=>[t],getAudioTracks:()=>[t]}}}}})
;(globalThis as any).Notification = {permission:'denied'}
;(globalThis as any).AudioContext = class {state='running';currentTime=0;destination={};async resume(){}async close(){}createOscillator(){return {frequency:{value:0},connect(){},start(){},stop(){}}}createGain(){return {gain:{value:0},connect(){}}}}
const sdp='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n'
let peerClosed=0
;(globalThis as any).RTCRtpSender = {getCapabilities:()=>({codecs:[{mimeType:'audio/opus'}]})}
;(globalThis as any).RTCPeerConnection = class {iceGatheringState='complete';localDescription:any=null;remoteDescription:any=null;sender={};async setRemoteDescription(d:any){this.remoteDescription=d}addTrack(){return this.sender}getTransceivers(){return [{sender:this.sender,setCodecPreferences(){}}]}async createAnswer(){return {type:'answer',sdp}}async createOffer(){return {type:'offer',sdp}}async setLocalDescription(d:any){this.localDescription=d}close(){peerClosed++}}
let active:any={id:'incoming-id',friendId:'f',direction:'inbound',state:'incoming',ownerId:null,recipientPhone:'+15555550100',recipientName:'Internal Test',providerCallId:'wacid.test',offerSdp:sdp,answerSdp:null}
let incoming=true;const requests:any[]=[];const originalFetch=globalThis.fetch
let allowed=false; let held=false
// Real route adapter is covered by Worker tests; UI assertions exercise user actions.
globalThis.fetch=(async(url:any,init:any={})=>{
 const path=String(url);const body=init.body?JSON.parse(init.body):null;requests.push({path,body})
 if(path.includes('/calling/incoming')) {
  if(path.includes('wait=20') && held) return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))
  if(path.includes('wait=20'))held=true
  return Response.json({success:true,data:{enabled:true,calls:incoming?[active]:[],cursor:incoming?active.id:''}})
 }
 if(path.endsWith('/status'))return Response.json({success:true,data:{recipientName:'Internal Test',recipientPhone:'+15555550100',enabled:true,callingEnabled:true,canCall:allowed,canRequestPermission:false,permissionStatus:'no_permission',permissionText:'test',replyWindowOpen:true,activeCall:null}})
 if(path.endsWith('/answer')){assert.equal(tracks.at(-1).enabled,false,'microphone muted until provider accepts');active={...active,state:'accepted',ownerId:body.ownerId,offerSdp:null};incoming=false;return Response.json({success:true,data:active})}
 if(path.endsWith('/end')){active={...active,state:'ended'};return Response.json({success:true,data:active})}
 if(path.endsWith('/calls')){throw new Error('unexpected dial without permission')}
 if(path.includes('/calls/'))return Response.json({success:true,data:active})
 throw new Error(path)
}) as typeof fetch
const text=(x:any):string=>typeof x==='string'?x:(Array.isArray(x)?x:(x?.children||[])).map(text).join('')
function button(r:ReactTestRenderer,label:string){const b=r.root.findAllByType('button').find(n=>text(n)===label);assert.ok(b,label);return b}
async function click(r:ReactTestRenderer,label:string){await act(async()=>{await button(r,label).props.onClick();await new Promise(resolve=>setTimeout(resolve,0))})}
let r:ReactTestRenderer
async function main() {
try {
 await act(async()=>{r=create(<WhatsAppCallingProvider><WhatsAppCallButton friendId="f" name="Internal Test"/></WhatsAppCallingProvider>,{createNodeMock:node=>node.type==='audio'?{srcObject:null,play:async()=>{}}:null})})
 assert.equal(requests.some(r=>r.body),false,'mount never answers or dials')
 await click(r!,'待受を開始');assert.match(text(r!.toJSON()),/WhatsApp着信/)
 await click(r!,'応答');assert.equal(requests.filter(r=>r.path.endsWith('/answer')).length,1);assert.equal(tracks.at(-1).enabled,true)
 assert.match(text(r!.toJSON()),/Internal Test/,'active call keeps customer name');
 await click(r!,'ミュート');assert.equal(tracks.at(-1).enabled,false)
 await click(r!,'ミュート解除');assert.equal(tracks.at(-1).enabled,true)
 await click(r!,'終了');assert.ok(stopped>=2);assert.ok(peerClosed>=1);assert.equal(requests.filter(r=>r.path.endsWith('/end')).length,1)
 await click(r!,'閉じる');await click(r!,'☎ 通話');assert.match(text(r!.toJSON()),/通話許可が必要/)
 assert.equal(r!.root.findAllByType('button').some(n=>text(n)==='このお客様に発信'),false,'no dial control without permission')
 await act(async()=>r!.unmount())
 // Slack links work without standby and opening a link never answers or grabs audio.
 store.clear();active={...active,id:deepId,state:'incoming',ownerId:null,offerSdp:sdp};incoming=true;held=false
 const writes=requests.filter(r=>r.body).length;const audioCount=tracks.length
 await act(async()=>{r=create(<WhatsAppCallingProvider><WhatsAppCallLink callId={deepId}/></WhatsAppCallingProvider>,{createNodeMock:node=>node.type==='audio'?{srcObject:null,play:async()=>{}}:null});await new Promise(resolve=>setTimeout(resolve,0))})
 assert.match(text(r!.toJSON()),/Internal Test/);button(r!,'応答')
 assert.equal(requests.filter(r=>r.body).length,writes);assert.equal(tracks.length,audioCount)
 await click(r!,'応答');assert.match(text(r!.toJSON()),/通話中/);await click(r!,'終了');await act(async()=>r!.unmount())
 store.clear();active={...active,state:'accepted',ownerId:'another-operator'};const beforeObserved=requests.filter(r=>r.body).length
 await act(async()=>{r=create(<WhatsAppCallingProvider><WhatsAppCallLink callId={deepId}/></WhatsAppCallingProvider>);await new Promise(resolve=>setTimeout(resolve,0))})
 assert.match(text(r!.toJSON()),/別の担当者が応答済み/)
 assert.equal(r!.root.findAllByType('button').some(n=>text(n)==='応答'||text(n)==='終了'),false)
 await act(async()=>r!.unmount());assert.equal(requests.filter(r=>r.body).length,beforeObserved,'observing another operator never terminates their call')
 active={...active,state:'ended'}
 await act(async()=>{r=create(<WhatsAppCallingProvider><WhatsAppCallLink callId={deepId}/></WhatsAppCallingProvider>);await new Promise(resolve=>setTimeout(resolve,0))})
 assert.match(text(r!.toJSON()),/この着信は終了/);assert.match(text(r!.toJSON()),/Internal Test/)
 assert.equal(r!.root.findAllByType('button').some(n=>text(n)==='応答'),false)
 await act(async()=>r!.unmount())
 console.log('PASS WhatsApp call UI: explicit standby, incoming alert, manual answer, microphone gate, mute, termination, permission guard and cleanup')
} finally {globalThis.fetch=originalFetch}
}
main().then(()=>process.exit(0),error=>{console.error(error);process.exit(1)})
