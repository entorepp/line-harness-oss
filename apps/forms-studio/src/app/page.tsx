'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Form as HarnessForm, Scenario, Tag } from '@line-crm/shared'
import PageHeader from '@/components/page-header'
import { api } from '@/lib/api'

type FormSubmissionRecord = {
  id: string
  formId: string
  formIssueId: string | null
  friendId: string | null
  slackChannelId: string | null
  data: Record<string, unknown>
  createdAt: string
}

function fieldTypeLabel(type: HarnessForm['fields'][number]['type']): string {
  switch (type) {
    case 'text':
      return 'テキスト'
    case 'email':
      return 'メール'
    case 'tel':
      return '電話番号'
    case 'number':
      return '数値'
    case 'textarea':
      return '長文'
    case 'select':
      return 'プルダウン'
    case 'radio':
      return '単一選択'
    case 'checkbox':
      return '複数選択'
    case 'date':
      return '日付'
    case 'time':
      return '時刻'
    default:
      return type
  }
}

function formatSubmissionValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => formatSubmissionValue(item))
      .filter(Boolean)
      .join(' / ')
  }

  if (value === undefined || value === null) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value).trim()
}

function hasSubmissionValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (value === undefined || value === null) return false
  return String(value).trim().length > 0
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function buildSubmissionEntries(form: HarnessForm, submission: FormSubmissionRecord) {
  const knownFieldNames = new Set(form.fields.map((field) => field.name))

  const orderedEntries = form.fields
    .filter((field) => hasSubmissionValue(submission.data[field.name]))
    .map((field) => ({
      key: field.name,
      label: field.label,
      value: formatSubmissionValue(submission.data[field.name]),
      type: field.type,
    }))

  const extraEntries = Object.entries(submission.data)
    .filter(([key, value]) => !knownFieldNames.has(key) && hasSubmissionValue(value))
    .map(([key, value]) => ({
      key,
      label: key,
      value: formatSubmissionValue(value),
      type: 'text',
    }))

  return [...orderedEntries, ...extraEntries]
}

function findSubmissionDisplay(form: HarnessForm, submission: FormSubmissionRecord) {
  const candidateFields = [
    (field: HarnessForm['fields'][number]) => /representative|name/i.test(field.name),
    (field: HarnessForm['fields'][number]) => /氏名|名前|姓名|성함|이름|name/i.test(field.label),
    (field: HarnessForm['fields'][number]) => /email|mail/i.test(field.name),
    (field: HarnessForm['fields'][number]) => /メール|郵件|이메일|email/i.test(field.label),
  ]

  for (const matcher of candidateFields) {
    const matchedField = form.fields.find((field) => matcher(field) && hasSubmissionValue(submission.data[field.name]))
    if (matchedField) {
      return {
        title: formatSubmissionValue(submission.data[matchedField.name]),
        subtitle: matchedField.label,
      }
    }
  }

  const firstAnsweredField = form.fields.find((field) => hasSubmissionValue(submission.data[field.name]))
  if (firstAnsweredField) {
    return {
      title: formatSubmissionValue(submission.data[firstAnsweredField.name]),
      subtitle: firstAnsweredField.label,
    }
  }

  return {
    title: '回答内容',
    subtitle: '値なし',
  }
}

export default function FormsDashboardPage() {
  const submissionsPerPage = 10
  const [forms, setForms] = useState<HarnessForm[]>([])
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [publicOrigin, setPublicOrigin] = useState('')
  const [shareRouteFriendId, setShareRouteFriendId] = useState('')
  const [shareSlackChannelId, setShareSlackChannelId] = useState('')
  const [submissions, setSubmissions] = useState<FormSubmissionRecord[]>([])
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null)
  const [showSubmissionDetails, setShowSubmissionDetails] = useState(false)
  const [showSubmissionModal, setShowSubmissionModal] = useState(false)
  const [submissionPage, setSubmissionPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [submissionsLoading, setSubmissionsLoading] = useState(false)
  const [submissionSlackDraft, setSubmissionSlackDraft] = useState('')
  const [submissionSaving, setSubmissionSaving] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setPublicOrigin(window.location.origin)
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined') return

    if (showSubmissionModal) {
      const previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'

      return () => {
        document.body.style.overflow = previousOverflow
      }
    }
  }, [showSubmissionModal])

  useEffect(() => {
    if (!showSubmissionModal || typeof window === 'undefined') return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowSubmissionModal(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showSubmissionModal])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const [formsRes, tagsRes, scenariosRes] = await Promise.all([
        api.forms.list(),
        api.tags.list(),
        api.scenarios.list(),
      ])

      if (formsRes.success) {
        setForms(formsRes.data)
        setSelectedFormId((current) => {
          if (current && formsRes.data.some((form) => form.id === current)) return current
          return formsRes.data[0]?.id ?? null
        })
      }

      if (tagsRes.success) setTags(tagsRes.data)
      if (scenariosRes.success) setScenarios(scenariosRes.data)
    } catch {
      setError('フォーム情報の読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!selectedFormId) {
      setSubmissions([])
      setSelectedSubmissionId(null)
      setShowSubmissionDetails(false)
      setShowSubmissionModal(false)
      setSubmissionPage(1)
      return
    }

    setSubmissionsLoading(true)
    setShowSubmissionDetails(false)
    setShowSubmissionModal(false)
    setSubmissionPage(1)

    void api.forms.submissions(selectedFormId)
      .then((res) => {
        if (res.success) {
          setSubmissions(res.data)
          setSelectedSubmissionId(res.data[0]?.id ?? null)
        }
      })
      .catch(() => {
        setError('回答一覧の読み込みに失敗しました')
        setSubmissions([])
        setSelectedSubmissionId(null)
      })
      .finally(() => {
        setSubmissionsLoading(false)
      })
  }, [selectedFormId])

  const selectedForm = useMemo(
    () => forms.find((form) => form.id === selectedFormId) ?? null,
    [forms, selectedFormId],
  )

  const selectedTagName = useMemo(
    () => tags.find((tag) => tag.id === selectedForm?.onSubmitTagId)?.name ?? null,
    [selectedForm?.onSubmitTagId, tags],
  )

  const selectedScenarioName = useMemo(
    () => scenarios.find((scenario) => scenario.id === selectedForm?.onSubmitScenarioId)?.name ?? null,
    [selectedForm?.onSubmitScenarioId, scenarios],
  )

  const selectedSubmission = useMemo(
    () => submissions.find((submission) => submission.id === selectedSubmissionId) ?? submissions[0] ?? null,
    [selectedSubmissionId, submissions],
  )

  const selectedSubmissionEntries = useMemo(
    () => (selectedForm && selectedSubmission ? buildSubmissionEntries(selectedForm, selectedSubmission) : []),
    [selectedForm, selectedSubmission],
  )

  const totalSubmissionPages = Math.max(1, Math.ceil(submissions.length / submissionsPerPage))

  const paginatedSubmissions = useMemo(() => {
    const startIndex = (submissionPage - 1) * submissionsPerPage
    return submissions.slice(startIndex, startIndex + submissionsPerPage)
  }, [submissionPage, submissions, submissionsPerPage])

  useEffect(() => {
    setSubmissionSlackDraft(selectedSubmission?.slackChannelId ?? '')
  }, [selectedSubmission])

  const publicShareUrl = useMemo(() => {
    if (!selectedFormId || !publicOrigin) return ''

    const url = new URL('/public-form', publicOrigin)
    url.searchParams.set('id', selectedFormId)
    if (shareSlackChannelId.trim()) {
      url.searchParams.set('slackChannelId', shareSlackChannelId.trim())
    }
    if (shareRouteFriendId.trim()) {
      url.searchParams.set('sharedBy', shareRouteFriendId.trim())
    }
    return url.toString()
  }, [publicOrigin, selectedFormId, shareRouteFriendId, shareSlackChannelId])

  const copyTarget = async () => {
    if (!publicShareUrl) return
    try {
      await navigator.clipboard.writeText(publicShareUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('URLのコピーに失敗しました')
    }
  }

  const openSubmissionDetails = () => {
    setError('')
    setShowSubmissionDetails(true)
    setShowSubmissionModal(false)
    window.setTimeout(() => {
      document.getElementById('submission-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
  }

  const openSubmissionModal = (submissionId: string) => {
    setSelectedSubmissionId(submissionId)
    setError('')
    setShowSubmissionModal(true)
  }

  const saveSubmissionSlackChannel = async () => {
    if (!selectedSubmission) return

    setSubmissionSaving(true)
    setError('')

    try {
      const res = await api.forms.updateSubmission(selectedSubmission.id, {
        slackChannelId: submissionSlackDraft.trim() || null,
      })

      if (!res.success) {
        throw new Error('Slack ID の保存に失敗しました')
      }

      setSubmissions((current) => current.map((submission) => (
        submission.id === res.data.id ? res.data : submission
      )))
      setSelectedSubmissionId(res.data.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Slack ID の保存に失敗しました')
    } finally {
      setSubmissionSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Standalone Forms"
        title="LIFFForm Studio"
        description="Harness と完全に分けて、フォーム作成・公開URL共有・回答確認だけを扱う管理画面です。"
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          公開フォーム URL に `Slack channel ID` と `sharedBy` を焼き込めます。
        </p>
        <Link
          href="/forms/new"
          className="rounded-full bg-emerald-800 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          新規フォームを作成
        </Link>
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-3xl border border-slate-200 bg-white/90 p-10 text-center text-sm text-slate-400 shadow-sm">
          読み込み中...
        </div>
      ) : forms.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white/90 p-10 text-center shadow-sm">
          <p className="text-sm text-slate-400">フォームがありません</p>
          <Link
            href="/forms/new"
            className="mt-4 inline-flex rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            最初のフォームを作る
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="rounded-3xl border border-slate-200 bg-white/90 p-3 shadow-sm">
            <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Forms
            </p>
            <div className="space-y-2">
              {forms.map((form) => (
                <button
                  key={form.id}
                  onClick={() => setSelectedFormId(form.id)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                    selectedFormId === form.id
                      ? 'border-emerald-200 bg-emerald-50'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{form.name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {form.fields.length}項目 / 回答 {form.submitCount} 件
                      </p>
                    </div>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        form.isActive
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {form.isActive ? '受付中' : '停止中'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selectedForm && (
            <div className="space-y-6">
              <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-bold text-slate-950">{selectedForm.name}</h2>
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                          selectedForm.isActive
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {selectedForm.isActive ? '受付中' : '停止中'}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {selectedForm.description || '説明文はありません'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={openSubmissionDetails}
                      className="rounded-2xl bg-slate-50 px-4 py-3 text-right transition-colors hover:bg-slate-100"
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                        Submissions
                      </p>
                      <p className="mt-1 text-2xl font-bold text-slate-900">{selectedForm.submitCount}</p>
                      <p className="mt-1 text-xs text-slate-500">一覧を開く</p>
                    </button>
                    <Link
                      href={`/forms/edit?id=${selectedForm.id}`}
                      className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      フォームを編集
                    </Link>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      保存設定
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-900">
                      {selectedForm.saveToMetadata ? 'metadata に保存' : '保存しない'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      送信時タグ
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-900">
                      {selectedTagName || selectedForm.onSubmitTagId || 'なし'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                      送信時シナリオ
                    </p>
                    <p className="mt-2 text-sm font-medium text-slate-900">
                      {selectedScenarioName || selectedForm.onSubmitScenarioId || 'なし'}
                    </p>
                  </div>
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">共有URL</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      公開フォームURLだけをメール / WA / LINE で共有できます。
                    </p>
                  </div>
                  <button
                    onClick={copyTarget}
                    disabled={!publicShareUrl}
                    className="rounded-full bg-emerald-800 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {copied ? 'コピー済み' : 'URLをコピー'}
                  </button>
                </div>

                <div className="mt-4 space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      共有者 Friend ID を付ける場合
                    </label>
                    <input
                      value={shareRouteFriendId}
                      onChange={(event) => setShareRouteFriendId(event.target.value)}
                      placeholder="未入力なら回答者本人のSlack連携で通知"
                      className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm"
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      指定すると、回答通知の Slack ルーティングはその Friend ID を優先します。
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Slack チャンネル ID を固定する場合
                    </label>
                    <input
                      value={shareSlackChannelId}
                      onChange={(event) => setShareSlackChannelId(event.target.value)}
                      placeholder="例: C08ABCDEF12 / 未入力なら C0AL6RG7V9Q"
                      className="w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm"
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      URLごとに通知先チャンネルを固定できます。未入力なら C0AL6RG7V9Q に送ります。
                    </p>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      公開フォームURL
                    </label>
                    <input
                      readOnly
                      value={publicShareUrl || '生成中...'}
                      className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                    />
                    <p className="mt-1 text-xs text-slate-400">
                      この URL は公開フォームです。チャンネルや配布媒体を問わず使えます。
                    </p>
                  </div>
                </div>
              </section>

              <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900">設問内容</h3>
                <div className="mt-4 space-y-4">
                  {selectedForm.fields.map((field, index) => (
                    <div key={`${field.name}-${index}`} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-slate-900 px-2 text-xs font-semibold text-white">
                              {index + 1}
                            </span>
                            <p className="text-sm font-semibold text-slate-900">{field.label}</p>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                              {fieldTypeLabel(field.type)}
                            </span>
                            {field.required && (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
                                必須
                              </span>
                            )}
                          </div>
                          <p className="mt-2 text-xs text-slate-500">キー: {field.name}</p>
                        </div>
                      </div>

                      {(field.placeholder || field.options?.length) && (
                        <div className="mt-4 space-y-3">
                          {field.placeholder && (
                            <div className="rounded-2xl bg-slate-50 p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                                Placeholder
                              </p>
                              <p className="mt-1 text-sm text-slate-700">{field.placeholder}</p>
                            </div>
                          )}
                          {field.options && field.options.length > 0 && (
                            <div className="rounded-2xl bg-slate-50 p-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                                Options
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {field.options.map((option) => (
                                  <span
                                    key={option}
                                    className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
                                  >
                                    {option}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      )}

      {showSubmissionDetails && selectedForm && (
        <section id="submission-list" className="mt-6 rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">回答一覧</h3>
              <p className="mt-1 text-xs text-slate-500">
                回答者一覧はページ内で確認し、詳細はモーダルで開きます。
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {submissions.length} 件
              </span>
              {totalSubmissionPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSubmissionPage((current) => Math.max(1, current - 1))}
                    disabled={submissionPage === 1}
                    className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    前へ
                  </button>
                  <span className="text-xs text-slate-500">
                    {submissionPage} / {totalSubmissionPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSubmissionPage((current) => Math.min(totalSubmissionPages, current + 1))}
                    disabled={submissionPage === totalSubmissionPages}
                    className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    次へ
                  </button>
                </div>
              )}
            </div>
          </div>

          {submissionsLoading ? (
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400">
              回答を読み込み中...
            </div>
          ) : submissions.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-400">
              まだ回答はありません。
            </div>
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {paginatedSubmissions.map((submission) => {
                const display = findSubmissionDisplay(selectedForm, submission)

                return (
                  <button
                    key={submission.id}
                    type="button"
                    onClick={() => openSubmissionModal(submission.id)}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left transition-colors hover:border-emerald-200 hover:bg-emerald-50/40"
                  >
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {display.title}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {display.subtitle}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-400">
                      <span>{formatDateTime(submission.createdAt)}</span>
                      {submission.slackChannelId && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-500">
                          Slack: {submission.slackChannelId}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      )}

      {showSubmissionModal && selectedForm && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/45 p-4">
          <div
            className="absolute inset-0"
            onClick={() => setShowSubmissionModal(false)}
            aria-hidden="true"
          />
          <section className="relative z-10 flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
              <div>
                <h3 className="text-lg font-semibold text-slate-950">回答詳細</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedForm.name} の回答を回答者ごとに確認できます。
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                  {selectedForm.submitCount} 件
                </span>
                <button
                  type="button"
                  onClick={() => setShowSubmissionModal(false)}
                  className="rounded-full border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
                >
                  閉じる
                </button>
              </div>
            </div>

            {error && (
              <div className="border-b border-red-100 bg-red-50 px-6 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {submissionsLoading ? (
              <div className="p-8 text-center text-sm text-slate-400">
                回答を読み込み中...
              </div>
            ) : submissions.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-400">
                まだ回答はありません。
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                  {selectedSubmission && (
                    <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h4 className="text-lg font-semibold text-slate-900">
                            {findSubmissionDisplay(selectedForm, selectedSubmission).title}
                          </h4>
                          <p className="mt-1 text-sm text-slate-500">
                            {formatDateTime(selectedSubmission.createdAt)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const currentIndex = submissions.findIndex((submission) => submission.id === selectedSubmission.id)
                              if (currentIndex > 0) {
                                setSelectedSubmissionId(submissions[currentIndex - 1].id)
                              }
                            }}
                            disabled={submissions.findIndex((submission) => submission.id === selectedSubmission.id) <= 0}
                            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            前の回答
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const currentIndex = submissions.findIndex((submission) => submission.id === selectedSubmission.id)
                              if (currentIndex >= 0 && currentIndex < submissions.length - 1) {
                                setSelectedSubmissionId(submissions[currentIndex + 1].id)
                              }
                            }}
                            disabled={submissions.findIndex((submission) => submission.id === selectedSubmission.id) >= submissions.length - 1}
                            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            次の回答
                          </button>
                          {selectedSubmission.formIssueId && (
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                              issue: {selectedSubmission.formIssueId}
                            </span>
                          )}
                          {selectedSubmission.friendId && (
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                              friend: {selectedSubmission.friendId}
                            </span>
                          )}
                          {selectedSubmission.slackChannelId && (
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                              slack: {selectedSubmission.slackChannelId}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-5 space-y-3">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="flex flex-wrap items-end gap-3">
                            <div className="min-w-[240px] flex-1">
                              <label className="text-sm font-semibold text-slate-900">
                                回答に紐づく Slack Channel ID
                              </label>
                              <input
                                value={submissionSlackDraft}
                                onChange={(event) => setSubmissionSlackDraft(event.target.value)}
                                placeholder="例: C08ABCDEF12"
                                className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                              />
                              <p className="mt-1 text-xs text-slate-400">
                                この回答に対して通知先チャンネルを明示的に紐づけます。
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={saveSubmissionSlackChannel}
                              disabled={submissionSaving}
                              className="rounded-full bg-emerald-800 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {submissionSaving ? '保存中...' : 'Slack ID を保存'}
                            </button>
                          </div>
                        </div>

                        {selectedSubmissionEntries.map((entry) => (
                          <div key={entry.key} className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-semibold text-slate-900">{entry.label}</p>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                                {fieldTypeLabel(entry.type as HarnessForm['fields'][number]['type'])}
                              </span>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                              {entry.value}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
