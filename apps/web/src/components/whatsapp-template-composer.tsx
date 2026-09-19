'use client'

import { useEffect, useRef, useState } from 'react'
import { ApiError, fetchApi, openWhatsAppDocument } from '@/lib/api'

type Template = {
  id: string; name: string; label: string; language: string; status: string; category: string
  bodyText: string; available: boolean; unavailableReason: string | null; documentRequired: boolean
  parameters: { key: string; label: string; isUrl: boolean }[]
  urlButtons: { index: number; label: string; url: string; dynamic: boolean }[]
}
type Catalogue = { friendId: string; recipientName: string; recipientPhone: string; releaseMode: string; canSend: boolean; templates: Template[] }
export type TemplatePreview = {
  friendId: string; recipientName: string; recipientPhone: string; accountName: string
  templateName: string; templateLanguage: string; category: string; text: string
  document: { key: string; name: string; size: number } | null
  previewToken: string; previewExpiresAt: number; canSend: boolean
}
type Receipt = { status: 'accepted' | 'pending' | 'failed' | 'unknown'; errorCode?: string | null }
type Response<T> = { success: boolean; data: T; error?: string }
const errorText = (error: unknown) => error instanceof Error ? error.message : '処理に失敗しました'
const fieldClass = 'w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900'
const buttonClass = 'rounded-full border border-emerald-700 px-4 py-2 text-sm font-medium text-emerald-800 disabled:opacity-40'

export function WhatsAppTemplatePreview({ preview }: { preview: TemplatePreview }) {
  return <div className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-gray-900">
    <p className="font-semibold">送信前の確認</p>
    <p>宛先: {preview.recipientName} / {preview.recipientPhone}</p>
    <p className="text-xs">送信元: {preview.accountName} · {preview.templateLanguage} · {preview.category}</p>
    <p className="whitespace-pre-wrap break-words">{preview.text}</p>
    {preview.document && <button type="button" className="break-all text-left underline" onClick={() => void openWhatsAppDocument(preview.friendId, preview.document!.key, preview.document!.name).catch(() => alert('PDFを開けませんでした。添付を確認してください'))}>
      PDFを開いて確認: {preview.document.name} ({Math.ceil(preview.document.size / 1024)} KB)
    </button>}
  </div>
}

export default function WhatsAppTemplateComposer({ friendId, onSent }: { friendId: string; onSent?: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null)
  const [selected, setSelected] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [buttonValues, setButtonValues] = useState<Record<string, string>>({})
  const [document, setDocument] = useState<{ key: string; name: string; size: number } | null>(null)
  const [preview, setPreview] = useState<TemplatePreview | null>(null)
  const [consent, setConsent] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [storageReady, setStorageReady] = useState(false)
  const alive = useRef(true)
  const inFlight = useRef(false)
  const path = `/api/whatsapp/friends/${encodeURIComponent(friendId)}`
  const storageKey = `wa-template-send:${friendId}`
  const template = catalogue?.templates.find((item) => `${item.name}:${item.language}` === selected)
  useEffect(() => {
    alive.current = true
    try { setPendingKey(localStorage.getItem(storageKey)); setStorageReady(true) }
    catch { setError('送信結果を保存できません。ブラウザーの保存設定を確認してください') }
    return () => { alive.current = false }
  }, [storageKey])

  function changeDraft() { setPreview(null); setConfirmed(false); setReceipt(null); setError('') }
  async function task(action: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try { await action() } catch (error) { if (alive.current) setError(errorText(error)) }
    finally { inFlight.current = false; if (alive.current) setBusy(false) }
  }
  async function load() {
    await task(async () => {
      const result = await fetchApi<Response<Catalogue>>(`${path}/templates`)
      if (!result.success || result.data.friendId !== friendId) throw new Error(result.error || '宛先を確認できませんでした')
      if (!alive.current) return
      setCatalogue(result.data)
    })
  }
  function select(value: string) {
    const item = catalogue?.templates.find((item) => `${item.name}:${item.language}` === value)
    setSelected(value); setDocument(null); setButtonValues({}); setConsent(false)
    setValues(item?.parameters.some((field) => field.key === 'body:1' && field.label === 'お客様名') ? { 'body:1': catalogue?.recipientName || '' } : {})
    changeDraft()
  }
  const draft = { templateName: template?.name, templateLanguage: template?.language, values, buttonValues, documentKey: document?.key || null }
  async function checkReceipt(key = pendingKey) {
    if (!key) return
    await task(async () => {
      const result = await fetchApi<Response<Receipt>>(`${path}/template-messages/${encodeURIComponent(key)}`)
      if (!alive.current) return
      setReceipt(result.data)
      if (result.data.status === 'accepted') await onSent?.()
    })
  }
  async function send() {
    if (!preview || !consent || !confirmed || !preview.canSend || pendingKey || !storageReady) return
    await task(async () => {
      const key = crypto.randomUUID()
      // Persist before contacting the server, so refresh/network failure cannot silently resend.
      localStorage.setItem(storageKey, key)
      setPendingKey(key)
      try {
        const result = await fetchApi<Response<Receipt>>(`${path}/template-messages`, { method: 'POST', body: JSON.stringify({ ...draft,
          idempotencyKey: key, previewToken: preview.previewToken, previewExpiresAt: preview.previewExpiresAt, optInConfirmed: true, contentConfirmed: true }) })
        if (!alive.current) return
        setReceipt(result.data)
        if (result.data.status === 'accepted') await onSent?.()
      } catch (error) {
        if (error instanceof ApiError && error.outcome === 'not_started') {
          localStorage.removeItem(storageKey)
          if (alive.current) { setPendingKey(null); setPreview(null); setConfirmed(false) }
        }
        throw error
      }
    })
  }
  const locked = busy || Boolean(pendingKey)
  return <div className="rounded-2xl border border-emerald-200 bg-white p-3">
    <button type="button" className={buttonClass} aria-expanded={open} onClick={() => { setOpen(!open); if (!open && !catalogue) void load() }}>予約・見積り・支払い案内（PDF対応）</button>
    {pendingKey && !open && <span className="ml-2 text-xs text-amber-900">前回の送信結果を確認してください</span>}
    {open && <div className="mt-3 space-y-3">
      <p className="text-xs text-gray-600">承認済みの案内は24時間外も送信できます。変数とPDFはお客様ごとに設定します。</p>
      {catalogue && !catalogue.canSend && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{catalogue.releaseMode === 'off' ? '送信機能は受信テストの確認待ちです。文面の準備・プレビューは利用できます。' : '現在は指定されたテスト番号だけに送信できます。'}</p>}
      {catalogue && <p className="text-sm">宛先: {catalogue.recipientName} / {catalogue.recipientPhone}</p>}
      <button type="button" disabled={busy} className="text-xs underline" onClick={() => void load()}>Metaの承認状況を更新</button>
      <fieldset disabled={locked} className="space-y-3 disabled:opacity-60">
        <label className="block text-sm">用途
          <select className={fieldClass} value={selected} onChange={(event) => select(event.target.value)}>
            <option value="">用途を選択してください</option>
            {catalogue?.templates.map((item) => <option key={`${item.name}:${item.language}`} value={`${item.name}:${item.language}`}>{item.label} · {item.language}{!item.available ? `（${item.status} / ${item.category}）` : ''}</option>)}
          </select>
        </label>
        {template && !template.available && <p className="text-sm text-amber-900">{template.unavailableReason}</p>}
        {template && <p className="whitespace-pre-wrap rounded-xl bg-gray-50 p-3 text-xs text-gray-600">{template.bodyText}</p>}
        {template?.parameters.map((field) => <label key={field.key} className="block text-sm">{field.label}
          <input type={field.isUrl ? 'url' : 'text'} className={fieldClass} value={values[field.key] || ''} maxLength={512} onChange={(event) => { setValues({ ...values, [field.key]: event.target.value }); changeDraft() }} />
        </label>)}
        {template?.urlButtons.filter((button) => button.dynamic).map((button) => <label key={button.index} className="block text-sm">{button.label}（URL末尾）
          <span className="block break-all text-xs text-gray-500">{button.url}</span>
          <input className={fieldClass} value={buttonValues[String(button.index)] || ''} maxLength={512} onChange={(event) => { setButtonValues({ ...buttonValues, [button.index]: event.target.value }); changeDraft() }} />
        </label>)}
        {template?.documentRequired && <label className="block text-sm">PDF（10MB以下・保存期間180日）
          <input key={selected} type="file" accept="application/pdf,.pdf" className={`${fieldClass} block`} onChange={(event) => {
            const file = event.target.files?.[0]; changeDraft(); setDocument(null)
            if (!file) return
            if (!file.name.toLowerCase().endsWith('.pdf') || file.size > 10 * 1024 * 1024) { setError('10MB以下のPDFを選択してください'); return }
            void task(async () => { const form = new FormData(); form.set('file', file)
              const result = await fetchApi<Response<{ key: string; name: string; size: number }>>(`${path}/documents`, { method: 'POST', rawBody: true, body: form })
              if (alive.current) setDocument(result.data)
            })
          }} />
          {document && <span className="block break-all text-xs">添付済み: {document.name}</span>}
        </label>}
        <button type="button" disabled={!template?.available || Boolean(template.documentRequired && !document)} className={buttonClass} onClick={() => void task(async () => {
          const result = await fetchApi<Response<TemplatePreview>>(`${path}/template-preview`, { method: 'POST', body: JSON.stringify(draft) })
          if (alive.current) { setPreview(result.data); setConfirmed(false) }
        })}>宛先・完成文・添付を確認</button>
      </fieldset>
      {preview && <>
        <WhatsAppTemplatePreview preview={preview} />
        <label className="flex gap-2 text-sm"><input type="checkbox" disabled={locked} checked={consent} onChange={(event) => setConsent(event.target.checked)} />このお客様はWhatsAppでこの予約・問合せの連絡を受けることに同意しています</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" disabled={locked} checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />宛先・文面・添付の内容を確認しました</label>
        <button type="button" disabled={locked || !storageReady || !preview.canSend || !consent || !confirmed} className="rounded-full bg-emerald-700 px-5 py-2 text-sm text-white disabled:opacity-40" onClick={() => void send()}>この案内を送信</button>
        <p className="text-xs text-gray-500">送信後の取り消しはできません。Metaの料金が発生する場合があります。</p>
      </>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {busy && <p role="status" className="text-sm">処理中…</p>}
      {pendingKey && <div className="space-y-2 rounded-xl bg-gray-50 p-3 text-sm">
        <p role="status">{receipt?.status === 'accepted' ? 'Metaが受け付けました。配達・既読はチャット内の表示で確認してください。' : receipt?.status === 'failed' ? `送信に失敗しました（${receipt.errorCode || '理由未取得'}）。内容とMetaの状態を確認してください。` : '送信結果を確認中、または結果不明です。重複送信を防ぐため、新たな送信を止めています。'}</p>
        <button type="button" disabled={busy} className={buttonClass} onClick={() => void checkReceipt()}>送信結果を確認</button>
        {(receipt?.status === 'accepted' || receipt?.status === 'failed') && <button type="button" disabled={busy} className="ml-2 text-sm underline" onClick={() => {
          localStorage.removeItem(storageKey); setPendingKey(null); setSelected(''); setValues({}); setDocument(null); setConsent(false); changeDraft()
        }}>確認して別の案内を作成</button>}
      </div>}
    </div>}
  </div>
}
