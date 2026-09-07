'use client'

import { useEffect, useRef, useState } from 'react'
import { buildTrafficContext, TRAFFIC_CONSENT_KEY, TRAFFIC_ORIGIN, type TrafficContext } from '@/lib/form-traffic'

type Choice = 'granted' | 'denied' | null

export default function FormTraffic() {
  const [context, setContext] = useState<TrafficContext | null>(null)
  const [choice, setChoice] = useState<Choice>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const counted = useRef(false)

  useEffect(() => {
    setContext(buildTrafficContext(window.location.href, document.referrer))
    try {
      const saved = JSON.parse(localStorage.getItem(TRAFFIC_CONSENT_KEY) || 'null')
      if (saved?.expires > Date.now() && ['granted', 'denied'].includes(saved.choice)) {
        setChoice(saved.choice)
      }
    } catch { /* Storage is optional; the form remains usable. */ }
  }, [])

  const choose = (next: Exclude<Choice, null>) => {
    setChoice(next)
    setSettingsOpen(false)
    try {
      localStorage.setItem(TRAFFIC_CONSENT_KEY, JSON.stringify({ choice: next, expires: Date.now() + 180 * 86400000 }))
    } catch { /* In-memory consent still applies to this page. */ }
    if (next === 'denied') {
      // Also remove cookies from an earlier consented visit.
      for (const cookie of document.cookie.split(';')) {
        const name = cookie.trim().split('=')[0]
        if (!/^liffform_ga(?:_|$)/.test(name)) continue
        document.cookie = `${name}=; Max-Age=0; Path=/`
        document.cookie = `${name}=; Max-Age=0; Path=/; Domain=${window.location.hostname}`
        document.cookie = `${name}=; Max-Age=0; Path=/; Domain=.${window.location.hostname}`
      }
    }
  }

  if (!context) return null

  return <>
    {choice === 'granted' && <iframe
      ref={frame}
      title="Form visit analytics"
      src="/form-traffic.html"
      sandbox="allow-scripts allow-same-origin"
      referrerPolicy="no-referrer"
      hidden
      aria-hidden="true"
      onLoad={() => {
        if (counted.current) return
        counted.current = true
        frame.current?.contentWindow?.postMessage(context, TRAFFIC_ORIGIN)
      }}
    />}
    {choice === null || settingsOpen ? <aside
      aria-label="Analytics cookie choice"
      className="relative z-30 mx-auto mb-6 max-w-4xl rounded-2xl border border-[#d7e5dc] bg-white px-5 py-4 text-sm text-slate-700 shadow-sm"
    >
      <p className="leading-6">May we use Google Analytics cookies to understand how visitors find this form? Your answers are not included. You can use the form either way.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" onClick={() => choose('granted')} className="rounded-full border border-[#1d5c47] px-5 py-2 font-medium text-[#1d5c47] hover:bg-[#edf5ef]">Allow analytics</button>
        <button type="button" onClick={() => choose('denied')} className="rounded-full border border-[#1d5c47] px-5 py-2 font-medium text-[#1d5c47] hover:bg-[#edf5ef]">Decline analytics</button>
      </div>
    </aside> : <div className="relative mx-auto mb-4 max-w-4xl text-right">
      <button type="button" className="text-xs text-slate-600 underline underline-offset-4" onClick={() => setSettingsOpen(true)}>Analytics cookie settings</button>
    </div>}
  </>
}
