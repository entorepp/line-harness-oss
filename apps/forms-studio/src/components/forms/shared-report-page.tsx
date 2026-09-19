'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type ReportLead = {
  id: string
  receivedAt: string
  sourcePartner: string
  sourceHotelName: string
  sourceHotelSlug: string
  sourcePageUrl: string
  sourceAttributionMethod: string
  sourceAttributionConfidence: string
  utmSource: string
  utmMedium: string
  utmCampaign: string
  utmContent: string
  utmTerm: string
  firstName: string
  lastName: string
  email: string
  hotelInterest: string[]
  hotelMatchPreference: string
  hotelGrade: string
  legacyBudget: string
  travellers: string
  roomCount: string
  bedType: string
  datesDecided: string
  citySchedule: string[]
  preferredCities: string[]
  approximateTiming: string
  approximateDuration: string
  notes: string
}

type ReportMonth = {
  month: string
  count: number
  leads: ReportLead[]
}

type ReportData = {
  reportName: string
  totalCount: number
  generatedAt: string
  months: ReportMonth[]
}

type ReportResponse = {
  success: boolean
  data?: ReportData
  error?: string
}

type TrafficDay = {
  date: string
  totalArrivals: number
  accessibleJapanArrivals: number
  confirmedAccessibleJapanArrivals: number
  inferredAccessibleJapanArrivals: number
  trackedClicks: number
}

type TrafficCountry = {
  countryCode: string
  totalArrivals: number
  accessibleJapanArrivals: number
  inferredAccessibleJapanArrivals: number
}

type TrafficSessionSummary = {
  firstRecordedAt: string | null
  total: number
  submitted: number
  active: number
  abandoned: number
  conversionRate: number
  dropoffRate: number
  accessibleJapan: number
  accessibleJapanStarted: number
  accessibleJapanNotStarted: number
  accessibleJapanSubmitted: number
  accessibleJapanActive: number
  accessibleJapanAbandoned: number
  accessibleJapanConversionRate: number
  accessibleJapanDropoffRate: number
}

type TrafficSessionDay = {
  date: string
  total: number
  submitted: number
  accessibleJapan: number
  accessibleJapanSubmitted: number
  accessibleJapanActive: number
  accessibleJapanAbandoned: number
}

type TrafficChannel = {
  source: string
  medium: string
  campaign: string
  sessions: number
  submitted: number
}

type TrafficSourcePage = {
  sourcePageKey: string
  sessions: number
  submitted: number
}

type TrafficFieldFunnel = {
  fieldIndex: number
  fieldKey: string
  fieldLabel: string
  reachedSessions: number
  dropoffSessions: number
}

type TrafficData = {
  generatedAt: string
  firstRecordedAt: string | null
  totalArrivals: number
  accessibleJapanArrivals: number
  confirmedAccessibleJapanArrivals: number
  inferredAccessibleJapanArrivals: number
  trackedClicks: number
  trackedUrl: string
  formUrl: string
  daily: TrafficDay[]
  countries: TrafficCountry[]
  sessions: TrafficSessionSummary
  sessionDaily: TrafficSessionDay[]
  channels: TrafficChannel[]
  sourcePages: TrafficSourcePage[]
  fieldFunnel: TrafficFieldFunnel[]
}

type TrafficResponse = {
  success: boolean
  data?: TrafficData
  error?: string
}

function monthLabel(value: string) {
  const [year, month] = value.split('-').map(Number)
  if (!year || !month) return value
  return `${year}年${month}月`
}

function dateTimeLabel(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

function percentLabel(value: number) {
  if (!Number.isFinite(value)) return '0.0%'
  return new Intl.NumberFormat('ja-JP', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)
}

function displayName(lead: ReportLead) {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ')
  return name || lead.email || 'Name not provided'
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-900">{value || '—'}</dd>
    </div>
  )
}

export default function SharedReportPage() {
  const [report, setReport] = useState<ReportData | null>(null)
  const [trafficReport, setTrafficReport] = useState<TrafficData | null>(null)
  const [selectedMonth, setSelectedMonth] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [trafficError, setTrafficError] = useState('')

  const loadReport = useCallback(async () => {
    const accessToken = window.location.hash.replace(/^#/, '').trim()
    if (!accessToken) {
      setError('共有URLが正しくありません。Flat Travelから発行された専用URLを開いてください。')
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')
    setTrafficError('')
    try {
      const headers = { Authorization: `Bearer ${accessToken}` }
      const [leadResult, trafficResult] = await Promise.allSettled([
        fetch('/api/shared-reports/accessible-japan', { headers, cache: 'no-store' }),
        fetch('/api/shared-reports/accessible-japan-traffic', { headers, cache: 'no-store' }),
      ])

      if (leadResult.status === 'rejected') throw leadResult.reason
      const leadBody = await leadResult.value.json() as ReportResponse
      if (!leadResult.value.ok || !leadBody.success || !leadBody.data) {
        throw new Error(leadBody.error || '共有レポートを取得できませんでした。')
      }
      setReport(leadBody.data)
      setSelectedMonth((current) => (
        leadBody.data?.months.some((item) => item.month === current)
          ? current
          : leadBody.data?.months[0]?.month || ''
      ))

      if (trafficResult.status === 'fulfilled') {
        try {
          const trafficBody = await trafficResult.value.json() as TrafficResponse
          if (trafficResult.value.ok && trafficBody.success && trafficBody.data) {
            setTrafficReport(trafficBody.data)
          } else {
            setTrafficReport(null)
            setTrafficError(trafficBody.error || '流入レポートを取得できませんでした。')
          }
        } catch {
          setTrafficReport(null)
          setTrafficError('流入レポートを取得できませんでした。')
        }
      } else {
        setTrafficReport(null)
        setTrafficError('流入レポートを取得できませんでした。')
      }
    } catch (caught) {
      setReport(null)
      setTrafficReport(null)
      setError(caught instanceof Error ? caught.message : '共有レポートを取得できませんでした。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadReport()
  }, [loadReport])

  const activeMonth = useMemo(
    () => report?.months.find((item) => item.month === selectedMonth) || null,
    [report, selectedMonth],
  )

  return (
    <main className="min-h-screen bg-[#f4f1eb] px-4 py-8 text-[#171717] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="overflow-hidden rounded-[28px] bg-[#151515] px-6 py-7 text-white shadow-sm sm:px-9 sm:py-9">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#ff3945]">Flat Travel × Accessible Japan</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">流入・リード共有レポート</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">
                Accessible Japan専用フォームへの流入と回答だけを表示します。他のアンケートや管理機能にはアクセスできません。
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadReport()}
              disabled={loading}
              className="rounded-full border border-white/25 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? '更新中…' : '最新情報に更新'}
            </button>
          </div>
        </header>

        {loading && !report ? (
          <div className="mt-6 rounded-[24px] bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
            回答を読み込んでいます…
          </div>
        ) : error ? (
          <div className="mt-6 rounded-[24px] border border-red-200 bg-white p-8 shadow-sm">
            <h2 className="text-lg font-semibold text-red-700">レポートを表示できません</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{error}</p>
          </div>
        ) : report ? (
          <>
            {trafficReport ? (
              <section className="mt-6 rounded-[24px] bg-white p-5 shadow-sm sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#ff3945]">Traffic</p>
                    <h2 className="mt-1 text-2xl font-semibold">クリック・フォーム到達</h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                      <code>utm_source=accessible_japan</code> が付いた到達だけを、匿名30分セッションとして集計します。<code>utm_content</code>別に流入・完了・CVRを確認でき、回答値・氏名・メール・旅行日は保存しません。
                    </p>
                  </div>
                  <p className="text-xs text-slate-400">最終取得 {dateTimeLabel(trafficReport.generatedAt)}</p>
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl bg-[#fff2f3] p-5">
                    <p className="text-sm font-semibold text-[#b71924]">AJ UTM流入</p>
                    <p className="mt-2 text-3xl font-semibold text-[#b71924]">{trafficReport.sessions.accessibleJapan}<span className="ml-1 text-sm">件</span></p>
                    <p className="mt-1 text-xs text-[#b71924]/70">操作開始 {trafficReport.sessions.accessibleJapanStarted}件・未開始 {trafficReport.sessions.accessibleJapanNotStarted}件・進行中 {trafficReport.sessions.accessibleJapanActive}件</p>
                  </div>
                  <div className="rounded-2xl bg-emerald-50 p-5">
                    <p className="text-sm font-semibold text-emerald-800">AJ UTM送信成功</p>
                    <p className="mt-2 text-3xl font-semibold text-emerald-800">{trafficReport.sessions.accessibleJapanSubmitted}<span className="ml-1 text-sm">件</span></p>
                  </div>
                  <div className="rounded-2xl bg-amber-50 p-5">
                    <p className="text-sm font-semibold text-amber-800">AJ UTM離脱</p>
                    <p className="mt-2 text-3xl font-semibold text-amber-800">{trafficReport.sessions.accessibleJapanAbandoned}<span className="ml-1 text-sm">件</span></p>
                  </div>
                  <div className="rounded-2xl bg-[#151515] p-5 text-white">
                    <p className="text-sm font-semibold text-white/70">AJ UTM離脱率</p>
                    <p className="mt-2 text-3xl font-semibold">{percentLabel(trafficReport.sessions.accessibleJapanDropoffRate)}</p>
                    <p className="mt-1 text-xs text-white/60">CVR {percentLabel(trafficReport.sessions.accessibleJapanConversionRate)}</p>
                  </div>
                </div>

                <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                      <tr>
                        <th className="px-3 py-3 font-semibold">日付（JST）</th>
                        <th className="px-3 py-3 text-right font-semibold">AJ UTM流入</th>
                        <th className="px-3 py-3 text-right font-semibold">送信成功</th>
                        <th className="px-3 py-3 text-right font-semibold">進行中</th>
                        <th className="px-3 py-3 text-right font-semibold">離脱</th>
                        <th className="px-3 py-3 text-right font-semibold">CVR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trafficReport.sessionDaily.length > 0 ? trafficReport.sessionDaily.map((day) => {
                        return (
                          <tr key={day.date} className="border-b border-slate-100 last:border-0">
                            <td className="px-3 py-3 font-semibold">{day.date}</td>
                            <td className="px-3 py-3 text-right">{day.accessibleJapan}</td>
                            <td className="px-3 py-3 text-right">{day.accessibleJapanSubmitted}</td>
                            <td className="px-3 py-3 text-right">{day.accessibleJapanActive}</td>
                            <td className="px-3 py-3 text-right">{day.accessibleJapanAbandoned}</td>
                            <td className="px-3 py-3 text-right">{percentLabel((day.accessibleJapanSubmitted + day.accessibleJapanAbandoned) > 0 ? day.accessibleJapanSubmitted / (day.accessibleJapanSubmitted + day.accessibleJapanAbandoned) : 0)}</td>
                          </tr>
                        )
                      }) : (
                        <tr><td className="px-3 py-6 text-center text-slate-500" colSpan={6}>セッション計測開始後の本番アクセスはまだありません。</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {trafficReport.channels.length > 0 ? (
                  <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200">
                    <table className="min-w-full text-left text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                        <tr>
                          <th className="px-3 py-3 font-semibold">チャネル</th>
                          <th className="px-3 py-3 font-semibold">キャンペーン</th>
                          <th className="px-3 py-3 text-right font-semibold">流入</th>
                          <th className="px-3 py-3 text-right font-semibold">送信</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trafficReport.channels.map((channel) => (
                          <tr key={`${channel.source}/${channel.medium}/${channel.campaign}`} className="border-b border-slate-100 last:border-0">
                            <td className="px-3 py-3 font-semibold">{channel.source} / {channel.medium}</td>
                            <td className="px-3 py-3">{channel.campaign}</td>
                            <td className="px-3 py-3 text-right">{channel.sessions}</td>
                            <td className="px-3 py-3 text-right">{channel.submitted}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {trafficReport.sourcePages.length > 0 ? (
                  <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200">
                    <table className="min-w-full text-left text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                        <tr>
                          <th className="px-3 py-3 font-semibold">utm_content（流入元ページ）</th>
                          <th className="px-3 py-3 text-right font-semibold">流入</th>
                          <th className="px-3 py-3 text-right font-semibold">送信</th>
                          <th className="px-3 py-3 text-right font-semibold">CVR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trafficReport.sourcePages.map((page) => (
                          <tr key={page.sourcePageKey} className="border-b border-slate-100 last:border-0">
                            <td className="px-3 py-3 font-semibold">{page.sourcePageKey}</td>
                            <td className="px-3 py-3 text-right">{page.sessions}</td>
                            <td className="px-3 py-3 text-right">{page.submitted}</td>
                            <td className="px-3 py-3 text-right">{percentLabel(page.sessions > 0 ? page.submitted / page.sessions : 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {trafficReport.fieldFunnel.length > 0 ? (
                  <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200">
                    <table className="min-w-full text-left text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                        <tr>
                          <th className="px-3 py-3 font-semibold">項目</th>
                          <th className="px-3 py-3 text-right font-semibold">到達セッション</th>
                          <th className="px-3 py-3 text-right font-semibold">ここで離脱</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trafficReport.fieldFunnel.map((field) => (
                          <tr key={field.fieldKey} className="border-b border-slate-100 last:border-0">
                            <td className="px-3 py-3"><span className="mr-2 text-slate-400">{field.fieldIndex}</span><span className="font-semibold">{field.fieldLabel}</span></td>
                            <td className="px-3 py-3 text-right">{field.reachedSessions}</td>
                            <td className="px-3 py-3 text-right">{field.dropoffSessions}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                <h3 className="mt-7 text-sm font-semibold text-slate-700">監査用リクエスト件数（再読込を含む）</h3>
                <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl bg-slate-100 p-5">
                    <p className="text-sm font-semibold text-slate-500">フォーム到達（全流入）</p>
                    <p className="mt-2 text-3xl font-semibold">{trafficReport.totalArrivals}<span className="ml-1 text-sm text-slate-500">件</span></p>
                  </div>
                  <div className="rounded-2xl bg-[#fff2f3] p-5">
                    <p className="text-sm font-semibold text-[#b71924]">AJ UTM到達</p>
                    <p className="mt-2 text-3xl font-semibold text-[#b71924]">{trafficReport.confirmedAccessibleJapanArrivals}<span className="ml-1 text-sm">件</span></p>
                    <p className="mt-1 text-xs text-[#b71924]/70"><code>utm_source=accessible_japan</code></p>
                  </div>
                  <div className="rounded-2xl bg-amber-50 p-5">
                    <p className="text-sm font-semibold text-amber-800">AJ推定（国外・流入元不明）</p>
                    <p className="mt-2 text-3xl font-semibold text-amber-800">{trafficReport.inferredAccessibleJapanArrivals}<span className="ml-1 text-sm">件</span></p>
                    <p className="mt-1 text-xs text-amber-700">国コードが日本以外</p>
                  </div>
                  <div className="rounded-2xl bg-[#151515] p-5 text-white">
                    <p className="text-sm font-semibold text-white/70">専用リンククリック</p>
                    <p className="mt-2 text-3xl font-semibold">{trafficReport.trackedClicks}<span className="ml-1 text-sm text-white/70">件</span></p>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Accessible Japan用 計測URL</p>
                  <code className="mt-2 block break-all text-sm font-semibold text-slate-900">{trafficReport.trackedUrl}</code>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    現在のフォームURLも到達数は記録しますが、参照元が消える場合があります。今後の掲載リンクはこの計測URLを使うと、クリックと到達を分けて確認できます。
                  </p>
                </div>

                <div className="mt-5 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-slate-200 text-xs text-slate-500">
                      <tr>
                        <th className="px-3 py-3 font-semibold">日付（JST）</th>
                        <th className="px-3 py-3 text-right font-semibold">専用リンククリック</th>
                        <th className="px-3 py-3 text-right font-semibold">AJ UTM</th>
                        <th className="px-3 py-3 text-right font-semibold">AJ推定</th>
                        <th className="px-3 py-3 text-right font-semibold">全フォーム到達</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trafficReport.daily.length > 0 ? trafficReport.daily.map((day) => (
                        <tr key={day.date} className="border-b border-slate-100 last:border-0">
                          <td className="px-3 py-3 font-semibold">{day.date}</td>
                          <td className="px-3 py-3 text-right">{day.trackedClicks}</td>
                          <td className="px-3 py-3 text-right">{day.confirmedAccessibleJapanArrivals}</td>
                          <td className="px-3 py-3 text-right">{day.inferredAccessibleJapanArrivals}</td>
                          <td className="px-3 py-3 text-right">{day.totalArrivals}</td>
                        </tr>
                      )) : (
                        <tr><td className="px-3 py-6 text-center text-slate-500" colSpan={5}>計測開始後の本番アクセスはまだありません。</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {trafficReport.countries.length > 0 ? (
                  <div className="mt-5 overflow-x-auto rounded-2xl border border-slate-200">
                    <table className="min-w-full text-left text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
                        <tr>
                          <th className="px-3 py-3 font-semibold">国コード</th>
                          <th className="px-3 py-3 text-right font-semibold">AJ UTM</th>
                          <th className="px-3 py-3 text-right font-semibold">うち国外推定</th>
                          <th className="px-3 py-3 text-right font-semibold">全到達</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trafficReport.countries.map((country) => (
                          <tr key={country.countryCode} className="border-b border-slate-100 last:border-0">
                            <td className="px-3 py-3 font-semibold">{country.countryCode}</td>
                            <td className="px-3 py-3 text-right">{country.accessibleJapanArrivals}</td>
                            <td className="px-3 py-3 text-right">{country.inferredAccessibleJapanArrivals}</td>
                            <td className="px-3 py-3 text-right">{country.totalArrivals}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                <p className="mt-4 text-xs leading-5 text-amber-800">
                  国コードだけを保存し、IPアドレスは保存しません。国外判定は推定であり、VPNや別経路の流入を含む可能性があります。国情報追加前の履歴には遡及反映していません。初回記録: {trafficReport.firstRecordedAt ? dateTimeLabel(trafficReport.firstRecordedAt) : 'まだありません'}
                </p>
              </section>
            ) : trafficError ? (
              <section className="mt-6 rounded-[24px] border border-amber-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-amber-800">流入レポートのみ取得できません</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{trafficError}</p>
              </section>
            ) : null}

            <section className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-[24px] bg-white p-6 shadow-sm">
                <p className="text-sm font-semibold text-slate-500">累計リード数</p>
                <p className="mt-2 text-4xl font-semibold">{report.totalCount}<span className="ml-1 text-base text-slate-500">件</span></p>
              </div>
              <div className="rounded-[24px] bg-[#ff3945] p-6 text-white shadow-sm">
                <p className="text-sm font-semibold text-white/75">{activeMonth ? monthLabel(activeMonth.month) : '選択月'}</p>
                <p className="mt-2 text-4xl font-semibold">{activeMonth?.count ?? 0}<span className="ml-1 text-base text-white/75">件</span></p>
              </div>
            </section>

            <section className="mt-6 rounded-[24px] bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">月別件数</h2>
                  <p className="mt-1 text-xs text-slate-500">月を選ぶと、その月のリード一覧を確認できます。</p>
                </div>
                <p className="text-xs text-slate-400">最終取得 {dateTimeLabel(report.generatedAt)}</p>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {report.months.map((item) => {
                  const selected = item.month === selectedMonth
                  return (
                    <button
                      type="button"
                      key={item.month}
                      onClick={() => setSelectedMonth(item.month)}
                      className={`flex items-center justify-between rounded-2xl border px-4 py-4 text-left transition ${
                        selected
                          ? 'border-[#ff3945] bg-[#fff2f3]'
                          : 'border-slate-200 hover:border-slate-400 hover:bg-slate-50'
                      }`}
                    >
                      <span className="font-semibold">{monthLabel(item.month)}</span>
                      <span className={`rounded-full px-3 py-1 text-sm font-semibold ${selected ? 'bg-[#ff3945] text-white' : 'bg-slate-100 text-slate-700'}`}>
                        {item.count}件
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="mt-6">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#ff3945]">Lead list</p>
                  <h2 className="mt-1 text-2xl font-semibold">{activeMonth ? monthLabel(activeMonth.month) : 'リード一覧'}</h2>
                </div>
                <p className="text-sm font-semibold text-slate-600">合計 {activeMonth?.count ?? 0}件</p>
              </div>

              {activeMonth && activeMonth.leads.length > 0 ? (
                <ol className="mt-4 space-y-4">
                  {activeMonth.leads.map((lead, index) => (
                    <li key={lead.id} className="rounded-[24px] bg-white p-5 shadow-sm sm:p-6">
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#151515] text-sm font-semibold text-white">
                            {index + 1}
                          </span>
                          <div className="min-w-0">
                            <h3 className="truncate text-lg font-semibold">{displayName(lead)}</h3>
                            <p className="mt-0.5 text-xs text-slate-500">受付 {dateTimeLabel(lead.receivedAt)}</p>
                          </div>
                        </div>
                        {lead.email && (
                          <a className="break-all text-sm font-semibold text-[#d91f2b] underline-offset-4 hover:underline" href={`mailto:${lead.email}`}>
                            {lead.email}
                          </a>
                        )}
                      </div>
                      <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="rounded-2xl border border-[#ffd0d4] bg-[#fff7f7] p-4 sm:col-span-2 lg:col-span-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#d91f2b]">流入ホテル</p>
                          <p className="mt-1 text-lg font-semibold text-slate-900">
                            {lead.sourceHotelName || lead.sourceHotelSlug || '特定できませんでした'}
                          </p>
                          <dl className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            <Detail label="Partner" value={lead.sourcePartner} />
                            <Detail label="Hotel slug" value={lead.sourceHotelSlug} />
                            <Detail
                              label="Attribution"
                              value={[lead.sourceAttributionMethod, lead.sourceAttributionConfidence].filter(Boolean).join(' / ')}
                            />
                            <Detail label="UTM source / medium" value={[lead.utmSource, lead.utmMedium].filter(Boolean).join(' / ')} />
                            <Detail label="UTM campaign" value={lead.utmCampaign} />
                            <Detail label="UTM content" value={lead.utmContent} />
                            <Detail label="UTM term" value={lead.utmTerm} />
                            {lead.sourcePageUrl && (
                              <div className="sm:col-span-2 lg:col-span-3">
                                <dt className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">Source page</dt>
                                <dd className="mt-1 break-all text-sm leading-6">
                                  <a
                                    className="font-semibold text-[#d91f2b] underline-offset-4 hover:underline"
                                    href={lead.sourcePageUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {lead.sourcePageUrl}
                                  </a>
                                </dd>
                              </div>
                            )}
                          </dl>
                        </div>
                        <Detail label="ホテルで魅力を感じた点" value={lead.hotelInterest.join(', ')} />
                        <Detail label="提案での扱い" value={lead.hotelMatchPreference} />
                        <Detail label="Hotel grade" value={lead.hotelGrade} />
                        {lead.legacyBudget && <Detail label="Legacy total budget" value={lead.legacyBudget} />}
                        <Detail label="Travellers" value={lead.travellers} />
                        <Detail label="Rooms" value={lead.roomCount} />
                        <Detail label="Bed type" value={lead.bedType} />
                        <Detail label="日程は確定済みか" value={lead.datesDecided} />
                        <Detail label="都市・確定日程" value={lead.citySchedule.join('\n')} />
                        <Detail label="行きたい都市（日程未定）" value={lead.preferredCities.join(', ')} />
                        <Detail label="大まかな時期" value={lead.approximateTiming} />
                        <Detail label="大まかな旅行期間" value={lead.approximateDuration} />
                        <div className="sm:col-span-2 lg:col-span-3">
                          <Detail label="Notes" value={lead.notes} />
                        </div>
                      </dl>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="mt-4 rounded-[24px] border border-dashed border-slate-300 bg-white/65 p-10 text-center">
                  <p className="text-lg font-semibold">この月のリードはまだありません</p>
                  <p className="mt-2 text-sm text-slate-500">回答が入ると、この一覧と月別件数に自動で反映されます。</p>
                </div>
              )}
            </section>
          </>
        ) : null}

        <footer className="mt-8 border-t border-black/10 pt-5 text-xs leading-5 text-slate-500">
          このURLはAccessible JapanとFlat Travelの共有用です。回答には個人情報が含まれるため、第三者へ転送しないでください。
        </footer>
      </div>
    </main>
  )
}
