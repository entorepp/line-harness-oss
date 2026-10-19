import assert from 'node:assert/strict'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import Modal from '../src/components/whatsapp-initiation-modal'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as any).localStorage = { getItem: () => 'test-only' }
let mode = 'off'; let sends = 0; let payload: any; let outcome = 'accepted'
let complete: (() => void) | undefined
const original = globalThis.fetch
const template = { id: 't', name: 'welcome', language: 'en', status: 'APPROVED', category: 'UTILITY', bodyText: 'Welcome', headerText: null, footerText: null, buttonLabels: [], parameters: [], supportedForInitiation: true }
globalThis.fetch = (async (url: any, options: any = {}) => {
 if (String(url).endsWith('/templates')) return Response.json({success:true,data:{configured:true,releaseMode:mode,templates:[template]}})
 sends++; payload = JSON.parse(options.body)
 if (outcome === 'unknown') throw Error('Connection lost')
 if (outcome === 'pending') await new Promise<void>(resolve => { complete = resolve })
 return Response.json({success:true,data:{accepted:true,status:'accepted',chatId:'chat',friendId:'friend'}})
}) as typeof fetch
const text = (node: any): string => typeof node === 'string' ? node : (node?.children || []).map(text).join('')
async function make() {
 let r!: ReactTestRenderer
 await act(async () => { r = create(<Modal accounts={[{id:'wa',name:'Travel'}]} onClose={()=>{}} onCreated={()=>{}} />) })
 return r
}
async function fill(r: ReactTestRenderer) {
 await act(async()=>{
  const inputs = r.root.findAllByType('input')
  inputs.find(n=>n.props.placeholder === '例: Alex Smith')!.props.onChange({target:{value:'Alex'}})
  inputs.find(n=>n.props.type === 'tel')!.props.onChange({target:{value:'+15555550100'}})
  inputs.find(n=>n.props.type === 'datetime-local')!.props.onChange({target:{value:'2026-10-01T12:00'}})
  inputs.filter(n=>n.props.type === 'checkbox').forEach(n=>n.props.onChange({target:{checked:true}}))
 })
}
const submit = (r: ReactTestRenderer) => r.root.findByProps({type:'submit'})
async function main() { try {
 let r = await make(); await fill(r)
 assert.equal(submit(r).props.disabled,true,'off gate remains disabled even after consent')
 assert.equal(sends,0); await act(async()=>r.unmount())
 mode='live'; r=await make()
 assert.equal(r.root.findByProps({type:'datetime-local'}).props.value,'','never invent consent time')
 assert.equal(submit(r).props.disabled,true)
 await fill(r); assert.equal(submit(r).props.disabled,false)
 outcome='pending'; let pending!: Promise<void>
 await act(async()=> { pending=r.root.findByType('form').props.onSubmit({preventDefault(){}}); await Promise.resolve() })
 assert.ok(r.root.findAllByType('input').every(n=>n.props.disabled),'payload locked while in flight')
 assert.equal(submit(r).props.disabled,true)
 await act(async()=>{complete!(); await pending})
 assert.equal(payload.numberProvidedConfirmed,true); assert.equal(payload.optInConfirmed,true)
 assert.equal(payload.recipientPhone,'+15555550100'); assert.ok(payload.idempotencyKey)
 await act(async()=>r.unmount())
 outcome='unknown'; r=await make(); await fill(r)
 await act(async()=>r.root.findByType('form').props.onSubmit({preventDefault(){}}))
 assert.equal(submit(r).props.disabled,true,'ambiguous result cannot resend')
 assert.match(text(r.toJSON()),/再送せず/)
 const count=sends
 await act(async()=>r.root.findByType('form').props.onSubmit({preventDefault(){}}))
 assert.equal(sends,count)
 await act(async()=>r.unmount())
 console.log('PASS: off gate, explicit consent, frozen request, accepted payload, unknown outcome lock')
} finally { globalThis.fetch=original }

}
main().catch(error => { console.error(error); process.exitCode = 1 })
