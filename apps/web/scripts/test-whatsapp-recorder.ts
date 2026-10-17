import assert from 'node:assert/strict'
import { WhatsAppRecorder } from '../src/lib/whatsapp-recorder'

let originalStops=0, mixedStops=0, sources=0, disconnected=0, closed=0
const original:any={getAudioTracks:()=>[{}],getTracks:()=>[{stop(){originalStops++}}]}
;(globalThis as any).AudioContext=class {
 state='running'
 async resume(){} async close(){this.state='closed';closed++}
 createMediaStreamDestination(){return {stream:{getTracks:()=>[{stop(){mixedStops++}}]}}}
 createMediaStreamSource(){sources++;return {connect(){},disconnect(){disconnected++}}}
}
const recorders:any[]=[]
;(globalThis as any).MediaRecorder=class {
 static isTypeSupported(type:string){return type.includes('webm')}
 state='inactive';ondataavailable:any;onstop:any;onerror:any
 constructor(){recorders.push(this)}
 start(){this.state='recording'}
 stop(){this.state='inactive';this.ondataavailable({data:new Blob(['independent-webm'])});queueMicrotask(()=>this.onstop())}
}
const events:string[]=[]
const recorder=new WhatsAppRecorder({async part(part){events.push(`part${part.index}`);await new Promise(r=>setTimeout(r,1));assert.ok(part.blob.size)},async complete(n){events.push(`complete${n}`)},failure(e){throw Error(e)}})
await recorder.start(original,original)
assert.equal(sources,2,'mixes both existing audio sides')
assert.equal(originalStops,0,'recording never stops call tracks')
;(recorder as any).rotate();(recorder as any).rotate()
await recorder.stop();await recorder.stop()
assert.deepEqual(events,['part0','part1','part2','complete3'],'ordered uploads and exactly one finalization after last segment')
assert.equal(closed,1);assert.equal(disconnected,2);assert.equal(mixedStops,1);assert.equal(originalStops,0)
let finalized=false,failed=0
const failure=new WhatsAppRecorder({async part(){throw Error('offline')},async complete(){finalized=true},failure(){failed++}})
await failure.start(original,original);await failure.stop()
assert.equal(failed,1);assert.equal(finalized,false,'incomplete audio cannot be queued or labelled saved')
const missing=new WhatsAppRecorder({async part(){},async complete(){},failure(){}})
await assert.rejects(missing.start(original,{getAudioTracks:()=>[]} as any),/双方/)
assert.equal(originalStops,0)
console.log('PASS two-sided recorder, independently decodable segmentation, ordered finalization, no duplicate stop, upload failure, missing remote audio and original track preservation')
