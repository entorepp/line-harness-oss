'use client'

import { useEffect, useRef, useState } from 'react'
import {
  buildTrafficContext,
  TRAFFIC_CONSENT_KEY,
  TRAFFIC_EVENT_NAME,
  TRAFFIC_ORIGIN,
  type TrafficAnalyticsEvent,
  type TrafficContext,
} from '@/lib/form-traffic'

export default function FormTraffic() {
  const [context, setContext] = useState<TrafficContext | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const counted = useRef(false)
  const frameReady = useRef(false)
  const queuedEvents = useRef<TrafficAnalyticsEvent[]>([])

  useEffect(() => {
    try {
      localStorage.removeItem(TRAFFIC_CONSENT_KEY)
    } catch { /* Storage is optional; the form remains usable. */ }
    // This collector is permanently cookieless. Remove cookies left by the
    // earlier optional-consent implementation before mounting its iframe.
    for (const cookie of document.cookie.split(';')) {
      const name = cookie.trim().split('=')[0]
      if (!/^liffform_ga(?:_|$)/.test(name)) continue
      document.cookie = `${name}=; Max-Age=0; Path=/`
      document.cookie = `${name}=; Max-Age=0; Path=/; Domain=${window.location.hostname}`
      document.cookie = `${name}=; Max-Age=0; Path=/; Domain=.${window.location.hostname}`
    }
    setContext(buildTrafficContext(window.location.href, document.referrer))
  }, [])

  useEffect(() => {
    const forward = (event: Event) => {
      const detail = (event as CustomEvent<TrafficAnalyticsEvent>).detail
      if (!detail) return
      if (!frameReady.current) {
        if (queuedEvents.current.length < 20) queuedEvents.current.push(detail)
        return
      }
      frame.current?.contentWindow?.postMessage(detail, TRAFFIC_ORIGIN)
    }
    window.addEventListener(TRAFFIC_EVENT_NAME, forward)
    return () => window.removeEventListener(TRAFFIC_EVENT_NAME, forward)
  }, [])

  if (!context) return null

  return (
    <iframe
      ref={frame}
      title="Form visit analytics"
      src="/form-traffic.html?v=20260919-2"
      sandbox="allow-scripts allow-same-origin"
      referrerPolicy="no-referrer"
      hidden
      aria-hidden="true"
      onLoad={() => {
        frameReady.current = true
        if (counted.current) return
        counted.current = true
        frame.current?.contentWindow?.postMessage(context, TRAFFIC_ORIGIN)
        for (const event of queuedEvents.current) {
          frame.current?.contentWindow?.postMessage(event, TRAFFIC_ORIGIN)
        }
        queuedEvents.current = []
      }}
    />
  )
}
