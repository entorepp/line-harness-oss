'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  API_URL,
  AUTH_STORAGE_KEY,
  OPERATOR_KEY_SESSION_STORAGE_KEY,
  OPERATOR_STORAGE_KEY,
  normalizeApiKey,
} from '@/lib/api'

export default function LoginPage() {
  const router = useRouter()
  const [apiKey, setApiKey] = useState('')
  const [operatorName, setOperatorName] = useState('')
  const [operatorKey, setOperatorKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const normalizedApiKey = normalizeApiKey(apiKey)
      const normalizedOperatorName = operatorName.trim()
      if (!normalizedOperatorName) throw new Error('管理者名を入力してください')
      const normalizedOperatorKey = operatorKey.trim()
      if (normalizedOperatorKey.length < 24) throw new Error('管理者個別キーを入力してください')
      const res = await fetch(`${API_URL}/api/forms`, {
        headers: { Authorization: `Bearer ${normalizedApiKey}` },
      })

      if (!res.ok) {
        throw new Error('APIキーが正しくありません')
      }

      const operatorSession = await fetch(`${API_URL}/api/form-response-email/session`, {
        headers: {
          Authorization: `Bearer ${normalizedApiKey}`,
          'X-Forms-Operator': encodeURIComponent(normalizedOperatorName),
          'X-Forms-Operator-Key': normalizedOperatorKey,
        },
      })
      if (!operatorSession.ok) {
        let message = '管理者個別キーを確認できませんでした'
        try {
          const body = await operatorSession.json() as { error?: unknown }
          if (typeof body.error === 'string' && body.error.trim()) message = body.error
        } catch {
          // Keep the safe fallback message for non-JSON failures.
        }
        throw new Error(message)
      }

      localStorage.setItem(AUTH_STORAGE_KEY, normalizedApiKey)
      localStorage.setItem(OPERATOR_STORAGE_KEY, normalizedOperatorName)
      sessionStorage.setItem(OPERATOR_KEY_SESSION_STORAGE_KEY, normalizedOperatorKey)
      router.replace('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : '接続に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#11352b,#08140f_55%,#050807)] px-4 py-10 text-[#f3f7f2]">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center">
        <div className="grid w-full gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-2xl shadow-black/20 backdrop-blur md:p-10">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-200/70">
              Standalone Form Stack
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight">
              LIFFForm Studio
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-emerald-50/75">
              Harness から切り離した、フォーム作成と共有 URL 管理専用の管理画面です。
              LINE / WA / メール向けの公開 URL をここでまとめて扱えます。
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                'GUI でフォーム作成',
                'Slack channel ID 付き URL',
                '回答詳細を一覧確認',
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-white/10 bg-black/15 px-4 py-4 text-sm text-emerald-50/80"
                >
                  {item}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[2rem] bg-[#f4f7f1] p-8 text-slate-950 shadow-2xl shadow-black/20 md:p-10">
            <div className="mb-8">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700/60">
                Admin Login
              </p>
              <h2 className="mt-2 text-2xl font-semibold">管理者ログイン</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                共有APIキーと、回答コピー操作を個人に結び付ける管理者個別キーを入力してください。
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  管理者名
                </label>
                <input
                  type="text"
                  autoFocus
                  autoComplete="name"
                  value={operatorName}
                  onChange={(event) => setOperatorName(event.target.value)}
                  placeholder="送信履歴に記録する担当者名"
                  maxLength={80}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-600"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="API key または Bearer key"
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-600"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  管理者個別キー
                </label>
                <input
                  type="password"
                  autoComplete="off"
                  value={operatorKey}
                  onChange={(event) => setOperatorKey(event.target.value)}
                  placeholder="回答コピー操作専用の個人キー"
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-600"
                />
                <p className="mt-1.5 text-xs leading-5 text-slate-500">
                  共有APIキーとは別に、操作した担当者を監査記録へ結び付けます。このキーはタブを閉じると消去されます。
                </p>
              </div>

              {error && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !normalizeApiKey(apiKey) || !operatorName.trim() || operatorKey.trim().length < 24}
                className="w-full rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? '認証中...' : 'Studio に入る'}
              </button>
            </form>
          </section>
        </div>
      </div>
    </main>
  )
}
