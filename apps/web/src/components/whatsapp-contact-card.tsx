'use client'

import { useCallback, useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'

type Identity = {
  status: 'linked' | 'unlinked' | 'review_required' | 'unavailable'
  email?: string
  whatsappNumber?: string
  leadSource?: string
  evidenceSource?: string
  cases?: { caseId: string; title: string; url: string }[]
}

const evidenceLabels: Record<string, string> = {
  customer_email: 'WhatsAppで申告されたメール',
  email_handoff: 'メール内のWhatsAppボタン',
  journey_reference: 'Journeyの回答',
  form_submission: 'Accessible Japanのフォーム回答',
}

export default function WhatsappContactCard({ friendId }: { friendId: string }) {
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    setIdentity(null)
    fetchApi<{ success: boolean; data: Identity }>(`/api/friends/${encodeURIComponent(friendId)}/whatsapp-identity`)
      .then(result => { if (active) setIdentity(result.success ? result.data : { status: 'unavailable' }) })
      .catch(() => { if (active) setIdentity({ status: 'unavailable' }) })
    return () => { active = false }
  }, [friendId])

  const reconcile = useCallback(async () => {
    setBusy(true)
    try {
      const result = await fetchApi<{ success: boolean; data: Identity }>(`/api/friends/${encodeURIComponent(friendId)}/whatsapp-identity/reconcile`, { method: 'POST' })
      setIdentity(result.success ? result.data : { status: 'unavailable' })
    } catch {
      setIdentity({ status: 'unavailable' })
    } finally {
      setBusy(false)
    }
  }, [friendId])

  return <section className="border-b border-emerald-100 bg-emerald-50/50 px-4 py-3 text-sm" aria-label="WhatsAppと顧客の連携">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong className="text-emerald-950">顧客・案件</strong>
      <button type="button" onClick={() => void reconcile()} disabled={busy || !identity} className="min-h-[36px] rounded border border-emerald-200 bg-white px-3 py-1 text-xs text-emerald-800 disabled:opacity-50">
        {busy ? '確認中…' : '受信履歴から連携を確認'}
      </button>
    </div>
    {!identity ? <p className="mt-1 text-xs text-gray-500">連携情報を読み込み中…</p>
      : identity.status === 'linked' ? <div className="mt-2 space-y-1 break-words">
        <p><span className="text-gray-500">メール：</span>{identity.email}</p>
        <p><span className="text-gray-500">WhatsApp：</span>{identity.whatsappNumber}</p>
        <div className="flex flex-wrap gap-2">{identity.cases?.map(item => <a key={item.caseId} href={`https://travelworker-web.pages.dev/cases/${encodeURIComponent(item.caseId)}`} target="_blank" rel="noopener noreferrer" className="text-emerald-800 underline underline-offset-2">{item.title}</a>)}</div>
        {!identity.cases?.length && <p className="text-xs text-gray-500">リード連携済み・案件はまだ紐付いていません</p>}
        <p className="text-xs text-gray-500">{[identity.leadSource, evidenceLabels[identity.evidenceSource || ''] || '登録済みの連絡先'].filter(Boolean).join(' → ')}</p>
      </div>
      : <p className="mt-1 text-xs text-gray-600">{identity.status === 'review_required' ? '複数の候補または連絡先の違いがあるため、確認が必要です。' : identity.status === 'unavailable' ? '連携情報を取得できませんでした。再度確認してください。' : 'メール・案件は未連携です。受信した参照番号やご本人のメール申告から確認できます。'}</p>}
  </section>
}
