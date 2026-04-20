'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { api, fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

const WORKER_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'

interface EntryRoute {
  id: string
  name: string
  refCode: string
  description: string | null
  tagId: string | null
  tagName: string | null
  lineAccountId: string | null
  trackingUrl: string
  isActive: boolean
  createdAt: string
}

interface RefRoute {
  refCode: string
  name: string
  friendCount: number
  clickCount: number
  latestAt: string | null
}

interface RefSummaryData {
  routes: RefRoute[]
  totalFriends: number
  friendsWithRef: number
  friendsWithoutRef: number
}

interface ClickSource {
  source_url: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  click_count: number
  first_click: string
  last_click: string
}

interface ClickTotal {
  ref_code: string
  total_clicks: number
  clicks_with_referrer: number
}

interface ClickAnalytics {
  sources: ClickSource[]
  daily: { date: string; ref_code: string; click_count: number }[]
  totals: ClickTotal[]
}

export default function AttributionPage() {
  const { selectedAccountId } = useAccount()

  // Entry routes CRUD
  const [entryRoutes, setEntryRoutes] = useState<EntryRoute[]>([])
  const [routesLoading, setRoutesLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newRefCode, setNewRefCode] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  // Analytics
  const [summary, setSummary] = useState<RefSummaryData | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [clickAnalytics, setClickAnalytics] = useState<ClickAnalytics | null>(null)
  const [clicksLoading, setClicksLoading] = useState(true)
  const [selectedRefFilter, setSelectedRefFilter] = useState<string>('')

  // Active tab
  const [tab, setTab] = useState<'routes' | 'analytics'>('routes')

  const loadEntryRoutes = useCallback(async () => {
    setRoutesLoading(true)
    try {
      const res = await api.entryRoutes.list(selectedAccountId ? { accountId: selectedAccountId } : undefined)
      if (res.success) setEntryRoutes(res.data)
    } catch { /* silent */ }
    setRoutesLoading(false)
  }, [selectedAccountId])

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true)
    try {
      const query = selectedAccountId ? `?lineAccountId=${selectedAccountId}` : ''
      const res = await fetchApi<{ success: boolean; data: RefSummaryData }>(`/api/analytics/ref-summary${query}`)
      setSummary(res.data)
    } catch { /* silent */ }
    setAnalyticsLoading(false)
  }, [selectedAccountId])

  const loadClickAnalytics = useCallback(async () => {
    setClicksLoading(true)
    try {
      const params = new URLSearchParams()
      if (selectedRefFilter) params.set('refCode', selectedRefFilter)
      params.set('days', '30')
      const res = await fetchApi<{ success: boolean; data: ClickAnalytics }>(`/api/entry-routes/analytics/clicks?${params}`)
      if (res.success) setClickAnalytics(res.data)
    } catch { /* silent */ }
    setClicksLoading(false)
  }, [selectedRefFilter])

  useEffect(() => {
    loadEntryRoutes()
    loadAnalytics()
  }, [loadEntryRoutes, loadAnalytics])

  useEffect(() => {
    if (tab === 'analytics') loadClickAnalytics()
  }, [tab, loadClickAnalytics])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const data: { name: string; refCode?: string; description?: string; lineAccountId?: string } = { name: newName.trim() }
      if (newRefCode.trim()) data.refCode = newRefCode.trim()
      if (newDescription.trim()) data.description = newDescription.trim()
      if (selectedAccountId) data.lineAccountId = selectedAccountId
      await api.entryRoutes.create(data)
      setNewName('')
      setNewRefCode('')
      setNewDescription('')
      setShowCreateForm(false)
      loadEntryRoutes()
    } catch { /* silent */ }
    setCreating(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('この流入経路を削除しますか？')) return
    try {
      await api.entryRoutes.delete(id)
      loadEntryRoutes()
    } catch { /* silent */ }
  }

  const handleCopy = async (url: string, code: string) => {
    await navigator.clipboard.writeText(url)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  const formatDate = (iso: string | null) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
  }

  // Extract page name from URL for display
  const formatSourceUrl = (url: string | null) => {
    if (!url || url === '') return '（直接 / 不明）'
    try {
      const u = new URL(url)
      const path = u.pathname === '/' ? u.hostname : u.pathname
      return path.length > 50 ? path.slice(0, 47) + '...' : path
    } catch {
      return url.length > 50 ? url.slice(0, 47) + '...' : url
    }
  }

  return (
    <div>
      <Header
        title="流入経路"
        description="流入経路の作成・管理とトラッキング分析"
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('routes')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === 'routes' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          経路管理
        </button>
        <button
          onClick={() => setTab('analytics')}
          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === 'analytics' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          分析
        </button>
      </div>

      {/* ===== Routes Management Tab ===== */}
      {tab === 'routes' && (
        <div>
          {/* Info banner */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-blue-800 font-medium mb-1">トラッキングURLの使い方</p>
            <p className="text-xs text-blue-600 leading-relaxed">
              生成されたURLをサイトのCTAボタンに貼ると、クリック時に<strong>どのページから遷移したか自動記録</strong>されてLINE友だち追加画面にリダイレクトします。<br/>
              同じページ内にCTAが複数ある場合やA/Bテスト時は、UTMパラメータで区別できます。
            </p>
          </div>

          {/* Create button */}
          <div className="mb-4">
            {!showCreateForm ? (
              <button
                onClick={() => setShowCreateForm(true)}
                className="px-4 py-2.5 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#06C755' }}
              >
                + 新しい流入経路を作成
              </button>
            ) : (
              <div className="bg-white border border-gray-200 rounded-lg p-5 space-y-3">
                <p className="text-sm font-semibold text-gray-700">新しい流入経路</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">経路名 *</label>
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="例: Instagram広告"
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">refコード（空欄で自動生成）</label>
                    <input
                      type="text"
                      value={newRefCode}
                      onChange={(e) => setNewRefCode(e.target.value)}
                      placeholder="例: ig-ad-2026"
                      className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">説明</label>
                  <input
                    type="text"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="例: 2026年春キャンペーン用"
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCreate}
                    disabled={!newName.trim() || creating}
                    className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity hover:opacity-90"
                    style={{ backgroundColor: '#06C755' }}
                  >
                    {creating ? '作成中...' : '作成'}
                  </button>
                  <button
                    onClick={() => { setShowCreateForm(false); setNewName(''); setNewRefCode(''); setNewDescription('') }}
                    className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Entry Routes List */}
          {routesLoading ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
              読み込み中...
            </div>
          ) : entryRoutes.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
              流入経路がまだ作成されていません。上のボタンから作成してください。
            </div>
          ) : (
            <div className="space-y-3">
              {entryRoutes.map((route) => {
                // Use API-returned trackingUrl (server-generated, always correct)
                const trackingUrl = route.trackingUrl
                const utmUrl = `${trackingUrl}?utm_source=web&utm_medium=cta&utm_campaign=${encodeURIComponent(route.name)}&utm_content=hero`
                return (
                  <div key={route.id} className="bg-white border border-gray-200 rounded-lg p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-semibold text-gray-900">{route.name}</p>
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            route.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {route.isActive ? '有効' : '無効'}
                          </span>
                          {route.tagName && (
                            <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                              タグ: {route.tagName}
                            </span>
                          )}
                        </div>
                        {route.description && (
                          <p className="text-xs text-gray-500 mb-2">{route.description}</p>
                        )}
                        <div className="space-y-2">
                          {/* Basic tracking URL - full display, click to copy */}
                          <div>
                            <p className="text-xs text-gray-400 mb-1">トラッキングURL（このままCTAに貼る）:</p>
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                readOnly
                                value={trackingUrl}
                                className="flex-1 text-xs bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg font-mono text-gray-700 focus:outline-none cursor-text"
                                onClick={(e) => (e.target as HTMLInputElement).select()}
                              />
                              <button
                                onClick={() => handleCopy(trackingUrl, route.refCode)}
                                className="px-3 py-2 text-xs font-medium text-white rounded-lg shrink-0 transition-colors"
                                style={{ backgroundColor: copiedCode === route.refCode ? '#10B981' : '#3B82F6' }}
                              >
                                {copiedCode === route.refCode ? 'OK!' : 'コピー'}
                              </button>
                            </div>
                          </div>
                          {/* UTM URL for specific CTA tracking */}
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleCopy(utmUrl, `${route.refCode}-utm`)}
                              className="text-xs text-purple-500 hover:text-purple-700 font-medium"
                            >
                              {copiedCode === `${route.refCode}-utm` ? 'UTMコピー済!' : 'UTM付きURLをコピー'}
                            </button>
                            <span className="text-xs text-gray-400">（同じページにCTAが複数あるとき用）</span>
                          </div>
                        </div>
                        <p className="text-xs text-gray-400 mt-2">
                          ref: <span className="font-mono">{route.refCode}</span> ・ 作成日: {formatDate(route.createdAt)}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDelete(route.id)}
                        className="text-xs text-red-400 hover:text-red-600 shrink-0 transition-colors"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ===== Analytics Tab ===== */}
      {tab === 'analytics' && (
        <div>
          {/* Summary cards */}
          {summary && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-xl p-5 border border-gray-100">
                <p className="text-sm text-gray-500">総友だち数</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{summary.totalFriends}</p>
              </div>
              <div className="bg-white rounded-xl p-5 border border-gray-100">
                <p className="text-sm text-gray-500">経路特定済み</p>
                <p className="text-3xl font-bold text-green-600 mt-1">{summary.friendsWithRef}</p>
              </div>
              <div className="bg-white rounded-xl p-5 border border-gray-100">
                <p className="text-sm text-gray-500">経路不明</p>
                <p className="text-3xl font-bold text-gray-400 mt-1">{summary.friendsWithoutRef}</p>
              </div>
              <div className="bg-white rounded-xl p-5 border border-gray-100">
                <p className="text-sm text-gray-500">経路数</p>
                <p className="text-3xl font-bold text-blue-600 mt-1">{summary.routes.length}</p>
              </div>
            </div>
          )}

          {/* Click analytics - filter */}
          <div className="flex items-center gap-3 mb-4">
            <label className="text-sm text-gray-600 font-medium">経路フィルタ:</label>
            <select
              value={selectedRefFilter}
              onChange={(e) => setSelectedRefFilter(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">全経路</option>
              {entryRoutes.map((r) => (
                <option key={r.refCode} value={r.refCode}>{r.name} ({r.refCode})</option>
              ))}
            </select>
          </div>

          {/* Referrer sources - THE KEY FEATURE */}
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">流入元ページ（過去30日）</h3>
            {clicksLoading ? (
              <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-400 text-sm">
                読み込み中...
              </div>
            ) : !clickAnalytics || clickAnalytics.sources.length === 0 ? (
              <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-400 text-sm">
                クリックデータがまだありません
              </div>
            ) : (
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">流入元ページ</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">UTM</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">クリック数</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">最終クリック</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {clickAnalytics.sources.map((src, i) => {
                      const hasUtm = src.utm_source || src.utm_medium || src.utm_campaign || src.utm_content
                      return (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm ${src.source_url ? 'text-gray-900' : 'text-gray-400 italic'}`}>
                                {formatSourceUrl(src.source_url)}
                              </span>
                              {src.source_url && (
                                <a
                                  href={src.source_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-400 hover:text-blue-600 text-xs"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  ↗
                                </a>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {hasUtm ? (
                              <div className="flex flex-wrap gap-1">
                                {src.utm_source && (
                                  <span className="text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">
                                    src:{src.utm_source}
                                  </span>
                                )}
                                {src.utm_medium && (
                                  <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                                    med:{src.utm_medium}
                                  </span>
                                )}
                                {src.utm_campaign && (
                                  <span className="text-xs bg-green-50 text-green-600 px-1.5 py-0.5 rounded">
                                    cmp:{src.utm_campaign}
                                  </span>
                                )}
                                {src.utm_content && (
                                  <span className="text-xs bg-orange-50 text-orange-600 px-1.5 py-0.5 rounded">
                                    cnt:{src.utm_content}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className="text-sm font-semibold text-gray-900">{src.click_count}</span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {formatDate(src.last_click)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Per-route totals */}
          {clickAnalytics && clickAnalytics.totals.length > 0 && !selectedRefFilter && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">経路別クリック数</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {clickAnalytics.totals.map((t) => {
                  const routeName = entryRoutes.find(r => r.refCode === t.ref_code)?.name || t.ref_code
                  const pct = t.total_clicks > 0 ? Math.round((t.clicks_with_referrer / t.total_clicks) * 100) : 0
                  return (
                    <div key={t.ref_code} className="bg-white border border-gray-200 rounded-lg p-4">
                      <p className="text-sm font-medium text-gray-900 truncate">{routeName}</p>
                      <p className="text-xs text-gray-400 font-mono">{t.ref_code}</p>
                      <div className="mt-2 flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-gray-900">{t.total_clicks}</span>
                        <span className="text-xs text-gray-400">クリック</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        流入元特定: {t.clicks_with_referrer}件 ({pct}%)
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Friend ref summary table */}
          {summary && summary.routes.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3">経路別の友だち追加</h3>
              <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
                <table className="w-full min-w-[500px]">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ref コード</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">経路名</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">友だち数</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">クリック数</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">CVR</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">最新追加日</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {summary.routes.map((route) => {
                      const cvr = route.clickCount > 0
                        ? `${((route.friendCount / route.clickCount) * 100).toFixed(1)}%`
                        : '—'
                      return (
                        <tr key={route.refCode} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-mono text-blue-600">{route.refCode}</td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{route.name}</td>
                          <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">{route.friendCount}</td>
                          <td className="px-4 py-3 text-sm text-right text-gray-600">{route.clickCount}</td>
                          <td className="px-4 py-3 text-sm text-right font-medium text-green-600">{cvr}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">{formatDate(route.latestAt)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {analyticsLoading && (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
              読み込み中...
            </div>
          )}
        </div>
      )}
    </div>
  )
}
