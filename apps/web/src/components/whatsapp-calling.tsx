'use client'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { ApiError, fetchApi } from '@/lib/api'
import { validCallId } from '@/lib/whatsapp-call-link'
import { WhatsAppAudio } from '@/lib/whatsapp-audio'

type Call = { id: string; friendId: string | null; direction: 'inbound' | 'outbound'; state: string; ownerId: string | null; recipientPhone: string; recipientName?: string; providerCallId: string | null; offerSdp: string | null; answerSdp: string | null; errorCode?: string | null }
type Readiness = { recipientName: string; recipientPhone: string; enabled: boolean; callingEnabled: boolean; canCall: boolean; canRequestPermission: boolean; permissionStatus: string; permissionText: string; replyWindowOpen: boolean; activeCall: Call | null }
const CallLinkContext = createContext<(id: string) => void>(() => {})
export function WhatsAppCallLink({ callId }: { callId: string }) {
  const open = useContext(CallLinkContext)
  useEffect(() => { open(callId) }, [callId, open])
  return null
}
const CallingContext = createContext<(friendId: string, name: string) => void>(() => {})
const ended = (call: Call | null) => !call || ['ended', 'failed', 'rejected'].includes(call.state)
const api = async <T,>(path: string, body?: unknown, keepalive = false, signal?: AbortSignal) => {
  const response = await fetchApi<{ success: boolean; data: T; error?: string }>(path, body ? { method: 'POST', body: JSON.stringify(body), keepalive, signal } : { signal })
  if (!response.success) throw new Error(response.error || '通話処理を確認できません')
  return response.data
}
const ROOT = '/api/whatsapp/calling'
const statusLabels: Record<string, string> = { incoming: 'WhatsApp着信', starting: '発信準備中', connecting: '接続中', ringing: '呼び出し中', answering: '応答中', accepted: '通話中', unknown: '結果確認中 — 再発信しないでください', ended: '通話終了', failed: '通話できませんでした', rejected: '応答なし・拒否' }

export function WhatsAppCallButton({ friendId, name }: { friendId: string; name: string }) {
  const open = useContext(CallingContext)
  return <button type="button" onClick={() => open(friendId, name)} className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100">☎ 通話</button>
}

export default function WhatsAppCallingProvider({ children }: { children: React.ReactNode }) {
  const [soundReady, setSoundReady] = useState(false)
  const [monitorConnected, setMonitorConnected] = useState(false)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [incoming, setIncoming] = useState<Call[]>([])
  const [linkedId, setLinkedId] = useState<string | null>(null)
  const [linkedCall, setLinkedCall] = useState<Call | null>(null)
  const [call, setCall] = useState<Call | null>(null)
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null)
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [muted, setMuted] = useState(false)
  const [mediaState, setMediaState] = useState('')
  const audio = useRef<HTMLAudioElement>(null)
  const rtc = useRef<WhatsAppAudio | null>(null)
  const ringing = useRef<AudioContext | null>(null)
  const current = useRef<Call | null>(null)
  const lock = useRef(false)
  const ownsCall = useRef(false)
  const mediaFailed = useRef(false)
  const mounted = useRef(true)
  const notified = useRef(new Set<string>())
  const ownerId = useRef<string>('')
  const updateCall = useCallback((next: Call | null) => { current.current = next; setCall(next) }, [])
  const cleanup = useCallback(() => { rtc.current?.close(); rtc.current = null; setMediaState(''); setMuted(false) }, [])
  const refresh = useCallback(async (id: string) => {
    const next = await api<Readiness>(`/api/whatsapp/friends/${encodeURIComponent(id)}/calling/status`)
    setReadiness(next)
    if (next.activeCall && ended(current.current)) {
      if (next.activeCall.state === 'incoming') setIncoming(items => [next.activeCall!, ...items.filter(c => c.id !== next.activeCall!.id)])
      else { ownsCall.current = false; updateCall(next.activeCall) }
    }
  }, [updateCall])
  const open = useCallback((id: string, name: string) => {
    if (!ended(current.current) || lock.current) { setError('現在の通話を終了してから別のお客様へ発信してください'); return }
    setTarget({ id, name }); setReadiness(null); setError(''); setNotice(''); updateCall(null)
    void refresh(id).catch(e => setError(e.message))
  }, [refresh, updateCall])

  const openLink = useCallback((id: string) => {
    if (!validCallId(id)) { setError('着信リンクが無効です'); return }
    setError(''); setLinkedCall(null); setLinkedId(id)
  }, [])
  useEffect(() => {
    if (!linkedId) return
    let cancelled = false; let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    const poll = async () => {
      try {
        const next = await api<Call>(`${ROOT}/calls/${linkedId}`, undefined, false, controller.signal)
        if (cancelled) return
        setLinkedCall(next)
        if (ended(next)) return
        timer = setTimeout(poll, 1000)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '着信を確認できません')
      }
    }
    void poll()
    return () => { cancelled = true; controller.abort(); clearTimeout(timer) }
  }, [linkedId])

  useEffect(() => {
    mounted.current = true; ownerId.current = crypto.randomUUID()
    const abandoned = sessionStorage.getItem('wa-active-call')
    if (abandoned) void api<Call>(`${ROOT}/calls/${abandoned}`).then(saved => { if (!ended(saved)) { ownsCall.current = true; updateCall(saved) } else sessionStorage.removeItem('wa-active-call') }).catch(() => {})
    const leaving = (event: BeforeUnloadEvent) => { if ((ownsCall.current && !ended(current.current)) || lock.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', leaving)
    return () => {
      mounted.current = false; window.removeEventListener('beforeunload', leaving)
      rtc.current?.close(); void ringing.current?.close()
      if (ownsCall.current && current.current && !ended(current.current)) void api(`${ROOT}/calls/${current.current.id}/end`, {}, true).catch(() => {})
    }
  }, [])

  useEffect(() => {
    let cancelled = false; let timer: ReturnType<typeof setTimeout>
    let cursor = ''; const controller = new AbortController()
    const poll = async () => {
      try {
        const data = await api<{ enabled: boolean; calls: Call[]; cursor?: string }>(`${ROOT}/incoming?wait=20&cursor=${encodeURIComponent(cursor)}`, undefined, false, controller.signal)
        cursor = data.cursor || ''
        if (cancelled) return
        setAvailable(data.enabled); setIncoming(data.calls); setMonitorConnected(true)
        if (!data.enabled) { timer = setTimeout(poll, 30000); return }
        for (const item of data.calls) if (!notified.current.has(item.id)) {
          notified.current.add(item.id)
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            const notification = new Notification('WhatsApp着信', { body: item.recipientName || item.recipientPhone, tag: item.id })
            notification.onclick = () => { window.focus(); notification.close() }
          }
        }
        if (data.calls.length && ended(current.current) && ringing.current?.state === 'running') {
          const oscillator = ringing.current.createOscillator(); const gain = ringing.current.createGain()
          oscillator.frequency.value = 660; gain.gain.value = 0.08
          oscillator.connect(gain); gain.connect(ringing.current.destination)
          oscillator.start(); oscillator.stop(ringing.current.currentTime + 0.4)
        }
        if (!cancelled) void poll()
      } catch { if (!cancelled) { setMonitorConnected(false); timer = setTimeout(poll, 5000) } }
    }
    void poll()
    return () => { cancelled = true; controller.abort(); clearTimeout(timer) }
  }, [])

  useEffect(() => {
    if (!call || ended(call)) return
    let cancelled = false; let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const next = await api<Call>(`${ROOT}/calls/${call.id}`)
        if (cancelled) return
        updateCall(next)
        if (ended(next)) { cleanup(); ownsCall.current = false; sessionStorage.removeItem('wa-active-call'); return }
        if (ownsCall.current && (!rtc.current || mediaFailed.current) && next.providerCallId) {
          const closed = await api<Call>(`${ROOT}/calls/${next.id}/end`, {}); updateCall(closed); cleanup(); ownsCall.current = false; sessionStorage.removeItem('wa-active-call'); return
        }
        if (next.answerSdp && rtc.current) await rtc.current.answer(next.answerSdp)
        if (next.state === 'accepted' || (next.direction === 'outbound' && next.answerSdp)) rtc.current?.mute(muted)
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : '通話状態を確認できません') }
      if (!cancelled) timer = setTimeout(poll, 1000)
    }
    void poll()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [call?.id, Boolean(call && ended(call)), muted, cleanup, updateCall])

  async function end(item = current.current) {
    if (!item || lock.current) return
    lock.current = true; setBusy(true); cleanup(); setError('')
    try { const next = await api<Call>(`${ROOT}/calls/${item.id}/end`, {}); updateCall(next); setIncoming(items => items.filter(c => c.id !== item.id)) }
    catch (e) { setError(e instanceof Error ? e.message : '終話を確認できません。もう一度終了してください。') }
    finally { lock.current = false; setBusy(false) }
  }
  async function prepareAudio(remoteOffer?: string) {
    if (!audio.current) throw new Error('通話画面を読み直してください')
    const connection = new WhatsAppAudio(audio.current, state => {
      if (!mounted.current) return
      setMediaState(state)
      if (state === 'failed') { mediaFailed.current = true; setError('音声接続が切れました。通話を終了します。'); void end() }
    })
    mediaFailed.current = false
    rtc.current = connection
    return connection.prepare(remoteOffer)
  }
  async function answer(item: Call) {
    if (lock.current || !ended(current.current)) return
    lock.current = true; setBusy(true); setError(''); setTarget(null); setNotice('')
    let submitted = false
    try {
      const latest = await api<Call>(`${ROOT}/calls/${item.id}`)
      if (latest.state !== 'incoming' || !latest.offerSdp) throw new Error('着信が終了したか、別の担当者が応答しました')
      const sdp = await prepareAudio(latest.offerSdp)
      submitted = true; ownsCall.current = true; sessionStorage.setItem('wa-active-call', latest.id); updateCall(latest)
      const next = await api<Call>(`${ROOT}/calls/${item.id}/answer`, { ownerId: ownerId.current, sdp })
      updateCall(next); setIncoming(items => items.filter(c => c.id !== item.id))
      if (next.state === 'accepted') rtc.current?.mute(false)
      if (ended(next)) cleanup()
    } catch (e) {
      cleanup(); setError(e instanceof Error ? e.message : '応答できませんでした')
      if (submitted) {
        try { const latest = await api<Call>(`${ROOT}/calls/${item.id}`); ownsCall.current = latest.ownerId === ownerId.current; updateCall(ownsCall.current ? latest : null); if (!ownsCall.current) sessionStorage.removeItem('wa-active-call') } catch { updateCall({ ...item, state: 'unknown' }) }
      }
    } finally { lock.current = false; setBusy(false) }
  }
  async function dial() {
    if (!target || lock.current || !ended(current.current)) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    const id = crypto.randomUUID(); let submitted = false
    try {
      const sdp = await prepareAudio()
      submitted = true; ownsCall.current = true
      // Durable request id is retained before the network call; never redial automatically.
      sessionStorage.setItem('wa-active-call', id)
      const next = await api<Call>(`/api/whatsapp/friends/${target.id}/calling/calls`, { requestId: id, sdp, confirmed: true })
      updateCall(next)
      if (ended(next)) cleanup()
    } catch (e) {
      cleanup(); setError(e instanceof Error ? e.message : '発信を確認できません')
      if (submitted && !(e instanceof ApiError && e.outcome === 'not_started')) {
        try { updateCall(await api<Call>(`${ROOT}/calls/${id}`)) }
        catch { setNotice('発信結果が未確認です。「状態を更新」で確認してください。'); updateCall({ id, friendId: target.id, recipientPhone: readiness?.recipientPhone || '', direction: 'outbound', state: 'unknown', ownerId: null, providerCallId: null, offerSdp: null, answerSdp: null }) }
      }
    } finally { lock.current = false; setBusy(false) }
  }
  async function requestPermission() {
    if (!target || lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      const key = `wa-call-permission:${target.id}`
      const requestId = sessionStorage.getItem(key) || crypto.randomUUID(); sessionStorage.setItem(key, requestId)
      const result = await api<{ status: string }>(`/api/whatsapp/friends/${target.id}/calling/permission`, { requestId, confirmed: true })
      setNotice(result.status === 'accepted' ? '通話許可の依頼を受け付けました。お客様の許可後に「状態を更新」を押してください。' : '送信結果を確認中です。重ねて送らず状態を確認してください。')
      if (result.status === 'accepted' || result.status === 'failed') sessionStorage.removeItem(key)
      await refresh(target.id)
    } catch (e) { setError(e instanceof Error ? e.message : '許可依頼を確認できません') }
    finally { lock.current = false; setBusy(false) }
  }
  // Browsers require a user gesture for ringtone playback, not for incoming polling.
  const enableSound = useCallback(async () => {
    try {
      if (!ringing.current || ringing.current.state === 'closed') ringing.current = new AudioContext()
      if (ringing.current.state !== 'running') await ringing.current.resume()
      if (mounted.current) setSoundReady(ringing.current.state === 'running')
    } catch { if (mounted.current) setSoundReady(false) }
  }, [])
  useEffect(() => {
    const activate = () => { void enableSound() }
    window.addEventListener('pointerdown', activate)
    window.addEventListener('keydown', activate)
    return () => { window.removeEventListener('pointerdown', activate); window.removeEventListener('keydown', activate) }
  }, [enableSound])
  async function enableAlerts() {
    await enableSound()
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try { await Notification.requestPermission() } catch { /* Slack and in-page alerts remain available. */ }
    }
  }

  const ringingCall = linkedCall?.state === 'incoming' && linkedCall.id !== call?.id ? linkedCall : incoming.find(item => item.id !== call?.id)
  const otherLinkedCall = linkedCall && linkedCall.id !== call?.id && linkedCall.state !== 'incoming' ? linkedCall : null
  return <CallingContext.Provider value={open}><CallLinkContext.Provider value={openLink}>
    {children}
    <audio ref={audio} autoPlay playsInline />
    <div className={`fixed ${target || call || ringingCall || linkedId || error ? 'bottom-4 w-[min(360px,calc(100vw-2rem))]' : 'top-3 w-auto'} right-4 z-50 rounded-2xl border border-emerald-200 bg-white p-3 shadow-xl`} aria-label="WhatsApp通話">
      <div className="flex items-center justify-between gap-2"><strong className="text-sm">☎ WhatsApp通話</strong><span role="status" className={`rounded-full px-3 py-1 text-xs font-semibold ${monitorConnected && available ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-700'}`}>{monitorConnected && available ? '常時待受 ON' : available === false ? '待受準備中' : '待受に接続中'}</span></div>

      <button type="button" onClick={() => void enableAlerts()} className="mt-1 text-xs text-emerald-800 underline">{soundReady ? '着信音・通知の設定' : '着信音・通知を有効にする'}</button>
      {!monitorConnected && <p className="mt-1 text-xs text-gray-500">着信確認に自動接続します。閉じている間の着信はSlackで通知します。</p>}
      {available === false && <p className="mt-2 text-xs text-amber-700">通話設定を準備中</p>}
      {ringingCall && ended(call) && <div className="mt-3 rounded-xl bg-emerald-50 p-3" role="alert"><p className="font-semibold">WhatsApp着信</p><p className="break-all text-sm">{ringingCall.recipientName || 'お客様（名前未登録）'}</p><p className="text-xs text-gray-500">{ringingCall.recipientPhone}</p><div className="mt-3 flex gap-2"><button disabled={busy} onClick={() => void answer(ringingCall)} className="rounded-lg bg-emerald-600 px-5 py-2 font-semibold text-white">応答</button><button disabled={busy} onClick={() => void end(ringingCall)} className="rounded-lg bg-gray-200 px-4 py-2">拒否</button></div></div>}
      {otherLinkedCall && <div className="mt-3 rounded-xl bg-gray-50 p-3" role="status"><p className="font-semibold">{ended(otherLinkedCall) ? 'この着信は終了しています' : 'この着信は別の担当者が応答済み、または対応中です'}</p><p className="break-all text-sm">{otherLinkedCall.recipientName || 'お客様（名前未登録）'}</p><p className="text-xs text-gray-500">{otherLinkedCall.recipientPhone}</p><button onClick={() => { setLinkedId(null); setLinkedCall(null) }} className="mt-2 text-sm underline">通知を閉じる</button></div>}
      {call && <div className="mt-3" aria-live="polite"><p className="font-semibold">{statusLabels[call.state] || call.state}</p><p className="break-all text-sm font-medium">{call.recipientName || target?.name || 'お客様（名前未登録）'}</p><p className="text-xs text-gray-500">{call.recipientPhone}</p>{mediaState === 'disconnected' && <button type="button" onClick={() => void audio.current?.play().catch(() => setError('スピーカーの再生を許可してください'))} className="text-xs underline">音声を再生</button>}{mediaState && !ended(call) && <p className="text-xs text-gray-500">{mediaState === 'connected' ? '音声接続済み' : '音声接続を確認中'}</p>}{!ended(call) ? <div className="mt-3 flex gap-2"><button disabled={busy || !rtc.current} onClick={() => { rtc.current?.mute(!muted); setMuted(!muted) }} className="rounded-lg bg-gray-100 px-3 py-2">{muted ? 'ミュート解除' : 'ミュート'}</button><button disabled={busy} onClick={() => void end()} className="rounded-lg bg-red-600 px-4 py-2 font-semibold text-white">終了</button></div> : <button onClick={() => { updateCall(null); if (target) void refresh(target.id).catch(e => setError(e.message)) }} className="mt-2 text-sm text-gray-600 underline">閉じる</button>}</div>}
      {target && ended(call) && <div className="mt-3 border-t pt-3"><p className="font-semibold">{readiness?.recipientName || target.name}</p><p className="text-sm">{readiness?.recipientPhone}</p>{readiness?.canCall ? <button disabled={busy} onClick={() => void dial()} className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white">このお客様に発信</button> : readiness && <><p className="mt-2 text-xs text-gray-600">{!readiness.enabled || !readiness.callingEnabled ? 'この番号の通話はまだ有効になっていません。' : !readiness.replyWindowOpen ? '通話許可がない場合は、お客様から返信を受けて許可依頼を送るか、お客様から電話をかけてもらってください。' : '発信にはお客様の通話許可が必要です。'}</p>{readiness.canRequestPermission && <><p className="mt-2 rounded bg-gray-50 p-2 text-xs">{readiness.permissionText}</p><button disabled={busy} onClick={() => void requestPermission()} className="mt-2 rounded-lg border px-3 py-2 text-sm">この文面で通話許可を依頼</button></>}</>}<div className="mt-2 flex gap-4"><button disabled={busy} onClick={() => void refresh(target.id).catch(e => setError(e.message))} className="text-xs underline">状態を更新</button><button disabled={busy} onClick={() => setTarget(null)} className="text-xs underline">閉じる</button></div></div>}
      {busy && <p className="mt-2 text-xs text-gray-500" role="status">処理中…</p>}
      {notice && <p className="mt-2 text-xs text-gray-600" role="status">{notice}</p>}
      {error && <p className="mt-2 text-xs text-red-700" role="alert">{error}</p>}
    </div>
  </CallLinkContext.Provider></CallingContext.Provider>
}
