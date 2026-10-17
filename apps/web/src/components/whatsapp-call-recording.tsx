'use client'
import { useEffect, useRef, useState } from 'react'
import { fetchApi } from '@/lib/api'
import type { WhatsAppAudio } from '@/lib/whatsapp-audio'

type Settings = {enabled:boolean;noticeVersion:string;noticeMode:'announced'|'staff_confirmed';retentionDays:number;recording:{state:string;errorCode?:string|null}|null}
type Props = {callId:string;ownerId:string;connected:boolean;audio:()=>WhatsAppAudio|null;isOwner:boolean;onPending:(pending:boolean)=>void}
export default function WhatsAppCallRecording({callId,ownerId,connected,audio,isOwner,onPending}:Props) {
 const [settings,setSettings]=useState<Settings|null>(null)
 const [consent,setConsent]=useState(false)
 const [state,setState]=useState('idle')
 const [error,setError]=useState('')
 const started=useRef(false)
 const mounted=useRef(true)
 const path=`/api/whatsapp/calling/calls/${callId}/recording`
 useEffect(()=>{
  mounted.current=true
  let ignored=false
  if(isOwner)void fetchApi<{data:Settings}>(path+'/status').then(r=>{if(!ignored){setSettings(r.data);if(r.data.recording)setState(r.data.recording.state==='published'?'published':r.data.recording.state==='attention'?'failed':r.data.recording.state)}}).catch(()=>{})
  return ()=>{ignored=true;mounted.current=false}
 },[path,isOwner])
 const update=(value:string)=>{if(mounted.current)setState(value)}
 useEffect(()=>{
  if(!isOwner || !connected || !settings?.enabled || settings.recording || started.current || (settings.noticeMode!=='announced' && !consent))return
  const connection=audio();if(!connection)return
  started.current=true;setState('starting');onPending(true)
  void (async()=>{
   const method=settings.noticeMode==='announced'?'announced':'staff_confirmed'
   const start=await fetchApi<{success:boolean;error?:string}>(path+'/start',{method:'POST',body:JSON.stringify({ownerId,consentConfirmed:true,noticeVersion:settings.noticeVersion,consentMethod:method})})
   if(!start.success)throw Error(start.error||'録音を開始できませんでした')
   if(method==='announced'){update('announcing');await connection.announceRecording()}
   await connection.startRecording({
    async part(part){
     update('saving')
     const result=await fetchApi<{success:boolean;error?:string}>(`${path}/parts/${part.index}`,{method:'PUT',rawBody:true,headers:{'Content-Type':part.blob.type,'X-Recording-Owner':ownerId},body:part.blob})
     if(!result.success)throw Error(result.error||'録音を保存できませんでした')
     update('recording')
    },
    async complete(partCount){
     update('saving')
     const result=await fetchApi<{success:boolean;error?:string}>(path+'/complete',{method:'POST',body:JSON.stringify({ownerId,partCount})})
     if(!result.success)throw Error(result.error||'録音の保存を確認できませんでした')
     update('queued');onPending(false)
    },
    failure(message){onPending(false);if(mounted.current){setState('failed');setError(message)}},
   })
   update('recording')
  })().catch(e=>{onPending(false);if(mounted.current){setState('failed');setError(e instanceof Error?e.message:'録音を開始できませんでした')}})
 },[isOwner,connected,settings,consent,path,ownerId,audio,onPending])
 if(!isOwner || !settings?.enabled)return null
 return <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm" aria-label="通話録音">
  {state==='idle' && settings.noticeMode!=='announced' && <label className="flex gap-2"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>相手に録音・AI要約・社内Slack共有を案内し、同意を確認しました。接続後に自動録音します。</label>}
  {state==='idle' && settings.noticeMode==='announced' && <p>接続後に英語の録音案内を流し、自動録音します。拒否された場合は録音を停止してください。</p>}
  <p role="status">{{idle:'録音待機',starting:'録音を準備中',announcing:'相手に録音案内を再生中',recording:'● 録音中',saving:'録音を保存中',queued:'音声を保存済み・Slackへの投稿を準備中',published:'音声と要約をSlackに投稿済み',processing:'文字起こし・要約中',publishing:'Slackへ投稿中',stopped:'録音を停止中',failed:'録音・保存に失敗しました'}[state]||state}</p>
  {['recording','saving','announcing'].includes(state) && <button type="button" onClick={()=>{update('stopped');void audio()?.stopRecording()}} className="mt-2 rounded border px-3 py-1">録音を停止（通話は続ける）</button>}
  <p className="mt-1 text-xs">音声は{settings.retentionDays}日保存します。Slack側には別の保存設定が適用されます。</p>
  {error && <p role="alert" className="text-red-700">{error} 通話は継続できます。</p>}
 </div>
}
