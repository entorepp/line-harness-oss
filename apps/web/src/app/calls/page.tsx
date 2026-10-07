'use client'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { WhatsAppCallLink } from '@/components/whatsapp-calling'
import { validCallId } from '@/lib/whatsapp-call-link'

function CallFromLink() {
  const id = useSearchParams().get('wa_call')
  if (!validCallId(id)) return <p className="text-red-700">着信リンクが無効です。Slackの通知から開き直してください。</p>
  return <><WhatsAppCallLink callId={id} /><p className="mt-3 text-gray-600">着信パネルでお客様名を確認し、「応答」を押してください。マイクの利用許可が必要です。</p><p className="mt-2 text-sm text-gray-500">終了済みの着信や、別の担当者が応答した通話は、その状態が表示されます。</p></>
}
export default function CallsPage() {
  return <section className="mx-auto max-w-2xl py-6"><h1 className="text-2xl font-semibold">WhatsApp着信</h1><Suspense fallback={<p>着信を確認中…</p>}><CallFromLink /></Suspense></section>
}
