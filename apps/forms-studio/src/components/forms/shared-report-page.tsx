'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

type ReportLead = {
  id: string
  receivedAt: string
  firstName: string
  lastName: string
  email: string
  hotelGrade: string
  legacyBudget: string
  travellers: string
  roomCount: string
  bedType: string
  citySchedule: string[]
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
  const [selectedMonth, setSelectedMonth] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadReport = useCallback(async () => {
    const accessToken = window.location.hash.replace(/^#/, '').trim()
    if (!accessToken) {
      setError('共有URLが正しくありません。Flat Travelから発行された専用URLを開いてください。')
      setLoading(false)
      return
    }

    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/shared-reports/accessible-japan', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        cache: 'no-store',
      })
      const body = await response.json() as ReportResponse
      if (!response.ok || !body.success || !body.data) {
        throw new Error(body.error || '共有レポートを取得できませんでした。')
      }
      setReport(body.data)
      setSelectedMonth((current) => (
        body.data?.months.some((item) => item.month === current)
          ? current
          : body.data?.months[0]?.month || ''
      ))
    } catch (caught) {
      setReport(null)
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
              <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">リード共有レポート</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">
                Accessible Japan専用フォームの回答だけを表示します。他のアンケートや管理機能にはアクセスできません。
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
                        <Detail label="Hotel grade" value={lead.hotelGrade} />
                        {lead.legacyBudget && <Detail label="Legacy total budget" value={lead.legacyBudget} />}
                        <Detail label="Travellers" value={lead.travellers} />
                        <Detail label="Rooms" value={lead.roomCount} />
                        <Detail label="Bed type" value={lead.bedType} />
                        <Detail label="Cities & dates" value={lead.citySchedule.join('\n')} />
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
