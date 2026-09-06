'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  api,
  type FormResponseCopyPreview,
  type FormResponseCopyState,
  type FormResponseEmailRecipient,
} from '@/lib/api'

type RecipientDraft = {
  contactName: string
  companyName: string
  email: string
  emailConfirmation: string
}

const emptyDraft: RecipientDraft = {
  contactName: '',
  companyName: '',
  email: '',
  emailConfirmation: '',
}

const deliveryLabels: Record<string, string> = {
  pending: '送信処理中',
  accepted: 'メール事業者受付済み',
  failed: '送信失敗',
  unknown: '送信結果不明',
}

function formatDateTime(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function RecipientCard({
  recipient,
  selected,
  onToggle,
  onRemove,
  busy,
}: {
  recipient: FormResponseEmailRecipient
  selected: boolean
  onToggle: () => void
  onRemove: () => void
  busy: boolean
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-700"
          aria-label={`${recipient.contactName}を送信先に含める`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-900">{recipient.contactName}</p>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              recipient.role === 'respondent'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-violet-100 text-violet-800'
            }`}>
              {recipient.role === 'respondent' ? '回答者' : '代理店担当者'}
            </span>
          </div>
          {recipient.companyName && (
            <p className="mt-1 text-xs text-slate-500">{recipient.companyName}</p>
          )}
          <p className="mt-1 break-all text-sm text-slate-700">{recipient.email}</p>
          <p className="mt-1 text-[11px] text-slate-400">
            更新: {recipient.updatedBy} / {formatDateTime(recipient.updatedAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          className="rounded-full border border-rose-200 px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        >
          削除
        </button>
      </div>
    </div>
  )
}

export default function ResponseCopyPanel({
  submissionId,
  defaultRespondentName,
}: {
  submissionId: string
  defaultRespondentName: string
}) {
  const [state, setState] = useState<FormResponseCopyState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [respondentDraft, setRespondentDraft] = useState<RecipientDraft>(emptyDraft)
  const [respondentCorrectionReason, setRespondentCorrectionReason] = useState('')
  const [agencyDraft, setAgencyDraft] = useState<RecipientDraft>(emptyDraft)
  const [showAgencyForm, setShowAgencyForm] = useState(false)
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<string[]>([])
  const [agencyFieldNames, setAgencyFieldNames] = useState<string[]>([])
  const [preview, setPreview] = useState<FormResponseCopyPreview | null>(null)
  const [sendIdempotencyKey, setSendIdempotencyKey] = useState('')
  const [contentConfirmed, setContentConfirmed] = useState(false)
  const [agencySharingConfirmed, setAgencySharingConfirmed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.forms.responseCopy(submissionId)
      if (!res.success) throw new Error(res.error)
      setState(res.data)
      setSelectedRecipientIds(res.data.recipients.map((recipient) => recipient.id))
      setAgencyFieldNames(res.data.fields
        .filter((field) => field.answered && !field.attachmentExcluded)
        .map((field) => field.name))
      const respondent = res.data.recipients.find((recipient) => recipient.role === 'respondent')
      setRespondentDraft(respondent ? {
        contactName: respondent.contactName,
        companyName: respondent.companyName || '',
        email: respondent.email,
        emailConfirmation: respondent.email,
      } : {
        ...emptyDraft,
        contactName: defaultRespondentName === '回答内容' ? '' : defaultRespondentName,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '回答コピー設定の読み込みに失敗しました')
      setState(null)
    } finally {
      setLoading(false)
    }
  }, [defaultRespondentName, submissionId])

  useEffect(() => {
    setPreview(null)
    setNotice('')
    void load()
  }, [load])

  const respondent = useMemo(
    () => state?.recipients.find((recipient) => recipient.role === 'respondent') ?? null,
    [state],
  )
  const agencyRecipients = useMemo(
    () => state?.recipients.filter((recipient) => recipient.role === 'agency_contact') ?? [],
    [state],
  )
  const selectedHasAgency = useMemo(
    () => Boolean(state?.recipients.some((recipient) => (
      recipient.role === 'agency_contact' && selectedRecipientIds.includes(recipient.id)
    ))),
    [selectedRecipientIds, state],
  )

  const resetPreview = () => {
    setPreview(null)
    setSendIdempotencyKey('')
    setContentConfirmed(false)
    setAgencySharingConfirmed(false)
    setNotice('')
  }

  const saveRecipient = async (role: 'respondent' | 'agency_contact') => {
    if (!state) return
    const draft = role === 'respondent' ? respondentDraft : agencyDraft
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await api.forms.saveEmailRecipient(submissionId, {
        id: role === 'respondent' ? respondent?.id : undefined,
        role,
        companyName: draft.companyName || null,
        contactName: draft.contactName,
        email: draft.email,
        emailConfirmation: draft.emailConfirmation,
        expectedSubmissionHash: state.submissionHash,
        correctionReason: role === 'respondent' && respondent ? respondentCorrectionReason : undefined,
      })
      if (!res.success) throw new Error(res.error)
      setAgencyDraft(emptyDraft)
      setRespondentCorrectionReason('')
      setShowAgencyForm(false)
      resetPreview()
      await load()
      setNotice(role === 'respondent' ? '回答者メールを保存しました。まだ送信されていません。' : '代理店担当者を追加しました。まだ送信されていません。')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'メールアドレスの保存に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const removeRecipient = async (recipient: FormResponseEmailRecipient) => {
    if (!window.confirm(`${recipient.contactName} を送信先から削除しますか？`)) return
    setBusy(true)
    setError('')
    try {
      const res = await api.forms.removeEmailRecipient(submissionId, recipient.id)
      if (!res.success) throw new Error(res.error)
      resetPreview()
      await load()
      setNotice('送信先を削除しました。過去の送信履歴は保持されます。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '送信先の削除に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const createPreview = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await api.forms.previewResponseCopy(submissionId, {
        recipientIds: selectedRecipientIds,
        agencyIncludedFieldNames: agencyFieldNames,
      })
      if (!res.success) throw new Error(res.error)
      setPreview(res.data)
      setSendIdempotencyKey(crypto.randomUUID())
      setContentConfirmed(false)
      setAgencySharingConfirmed(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '送信内容の作成に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const send = async () => {
    if (!state || !preview || !sendIdempotencyKey) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await api.forms.sendResponseCopy(submissionId, {
        recipientIds: selectedRecipientIds,
        agencyIncludedFieldNames: agencyFieldNames,
        expectedSubmissionHash: preview.submissionHash,
        expectedPreviewHash: preview.previewHash,
        idempotencyKey: sendIdempotencyKey,
        confirmed: contentConfirmed,
        agencySharingConfirmed,
      })
      if (!res.success) throw new Error(res.error)
      const accepted = res.data.results.filter((result) => result.status === 'accepted').length
      const unresolved = res.data.results.length - accepted
      resetPreview()
      await load()
      setNotice(`メール事業者受付済み ${accepted}件${unresolved ? `、要確認 ${unresolved}件` : ''}。受信箱への到達・開封とは区別されます。`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '回答コピーメールの送信に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-400">回答コピー設定を読み込み中...</div>
  }

  if (!state) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        <p>{error || '回答コピー設定を読み込めませんでした。'}</p>
        <button type="button" onClick={() => void load()} className="mt-3 rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium">
          再読み込み
        </button>
      </div>
    )
  }

  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/45 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h5 className="font-semibold text-slate-950">回答コピーをメール送信</h5>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            回答者と必要な代理店担当者へ別々のメールを送ります。登録・追加だけでは送信されません。
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${
          state.emailEnabled && state.providerConfigured
            ? 'bg-emerald-700 text-white'
            : 'bg-amber-100 text-amber-800'
        }`}>
          {state.emailEnabled && state.providerConfigured ? '送信可能' : '送信機能OFF'}
        </span>
      </div>

      {error && <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {notice && <div className="mt-4 rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm text-emerald-800">{notice}</div>}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h6 className="text-sm font-semibold text-slate-900">回答者メール</h6>
          <div className="mt-3 grid gap-3">
            <input
              value={respondentDraft.contactName}
              onChange={(event) => setRespondentDraft((current) => ({ ...current, contactName: event.target.value }))}
              placeholder="回答者名"
              maxLength={120}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="email"
              autoComplete="email"
              value={respondentDraft.email}
              onChange={(event) => setRespondentDraft((current) => ({ ...current, email: event.target.value }))}
              placeholder="回答者メールアドレス"
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="email"
              autoComplete="off"
              value={respondentDraft.emailConfirmation}
              onChange={(event) => setRespondentDraft((current) => ({ ...current, emailConfirmation: event.target.value }))}
              placeholder="確認のためもう一度入力"
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            {respondent && (
              <textarea
                value={respondentCorrectionReason}
                onChange={(event) => setRespondentCorrectionReason(event.target.value)}
                placeholder="訂正理由（5文字以上・監査履歴に保存）"
                minLength={5}
                maxLength={500}
                rows={2}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            )}
            <button
              type="button"
              onClick={() => void saveRecipient('respondent')}
              disabled={busy || !respondentDraft.contactName.trim() || !respondentDraft.email.trim() || !respondentDraft.emailConfirmation.trim() || Boolean(respondent && respondentCorrectionReason.trim().length < 5)}
              className="rounded-full bg-emerald-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {respondent ? '回答者メールを更新' : '回答者メールを登録'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h6 className="text-sm font-semibold text-slate-900">代理店担当者</h6>
              <p className="mt-1 text-xs text-slate-400">案件ごとに最大3名</p>
            </div>
            <button
              type="button"
              onClick={() => setShowAgencyForm((current) => !current)}
              disabled={agencyRecipients.length >= 3}
              className="rounded-full border border-violet-200 px-3 py-1.5 text-xs font-medium text-violet-700 disabled:opacity-40"
            >
              担当者を追加
            </button>
          </div>
          {showAgencyForm && (
            <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3">
              <input value={agencyDraft.companyName} onChange={(event) => setAgencyDraft((current) => ({ ...current, companyName: event.target.value }))} placeholder="会社名" maxLength={160} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <input value={agencyDraft.contactName} onChange={(event) => setAgencyDraft((current) => ({ ...current, contactName: event.target.value }))} placeholder="担当者名" maxLength={120} className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <input type="email" value={agencyDraft.email} onChange={(event) => setAgencyDraft((current) => ({ ...current, email: event.target.value }))} placeholder="メールアドレス" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <input type="email" value={agencyDraft.emailConfirmation} onChange={(event) => setAgencyDraft((current) => ({ ...current, emailConfirmation: event.target.value }))} placeholder="確認のためもう一度入力" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
              <button type="button" onClick={() => void saveRecipient('agency_contact')} disabled={busy || !agencyDraft.contactName.trim() || !agencyDraft.email.trim() || !agencyDraft.emailConfirmation.trim()} className="rounded-full bg-violet-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                追加する（まだ送信しない）
              </button>
            </div>
          )}
        </div>
      </div>

      {state.recipients.length > 0 && (
        <div className="mt-5">
          <h6 className="text-sm font-semibold text-slate-900">今回の送信先</h6>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {state.recipients.map((recipient) => (
              <RecipientCard
                key={recipient.id}
                recipient={recipient}
                selected={selectedRecipientIds.includes(recipient.id)}
                onToggle={() => {
                  resetPreview()
                  setSelectedRecipientIds((current) => current.includes(recipient.id)
                    ? current.filter((id) => id !== recipient.id)
                    : [...current, recipient.id])
                }}
                onRemove={() => void removeRecipient(recipient)}
                busy={busy}
              />
            ))}
          </div>
        </div>
      )}

      {selectedHasAgency && (
        <div className="mt-5 rounded-2xl border border-violet-200 bg-white p-4">
          <h6 className="text-sm font-semibold text-slate-900">代理店へ共有する回答項目</h6>
          <p className="mt-1 text-xs text-slate-500">添付ファイルは選択できず、URLも送信されません。</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {state.fields.filter((field) => field.answered).map((field) => (
              <label key={field.name} className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${field.attachmentExcluded ? 'border-slate-100 bg-slate-50 text-slate-400' : 'border-slate-200 text-slate-700'}`}>
                <input
                  type="checkbox"
                  disabled={field.attachmentExcluded}
                  checked={!field.attachmentExcluded && agencyFieldNames.includes(field.name)}
                  onChange={() => {
                    resetPreview()
                    setAgencyFieldNames((current) => current.includes(field.name)
                      ? current.filter((name) => name !== field.name)
                      : [...current, field.name])
                  }}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-700"
                />
                <span>{field.label}{field.attachmentExcluded ? '（添付除外）' : ''}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={() => void createPreview()}
          disabled={busy || selectedRecipientIds.length === 0}
          className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {busy ? '処理中...' : '送信内容を確認'}
        </button>
      </div>

      {preview && (
        <div className="mt-5 rounded-2xl border border-slate-300 bg-white p-4">
          <h6 className="text-sm font-semibold text-slate-950">送信前プレビュー</h6>
          <div className="mt-3 space-y-4">
            {preview.recipients.map((item) => (
              <article key={item.recipientId} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-semibold text-slate-800">{item.contactName}</span>
                  {item.companyName && <span>{item.companyName}</span>}
                  <span>{item.email}</span>
                  <span>{item.role === 'respondent' ? '回答者' : '代理店担当者'}</span>
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-900">件名: {item.subject}</p>
                <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 font-sans text-xs leading-5 text-slate-700">{item.text}</pre>
              </article>
            ))}
          </div>
          <div className="mt-4 space-y-3 rounded-xl bg-amber-50 p-4 text-sm text-slate-700">
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={contentConfirmed} onChange={(event) => setContentConfirmed(event.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300" />
              <span>宛先・件名・本文を確認しました。</span>
            </label>
            {selectedHasAgency && (
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={agencySharingConfirmed} onChange={(event) => setAgencySharingConfirmed(event.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300" />
                <span>回答者から代理店への回答共有同意を確認しました。</span>
              </label>
            )}
          </div>
          {(!state.emailEnabled || !state.providerConfigured) && (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              現在は送信機能OFFです。テスト受信先、送信ドメイン、配信設定の承認後に有効化します。
            </p>
          )}
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || !state.emailEnabled || !state.providerConfigured || !contentConfirmed || (selectedHasAgency && !agencySharingConfirmed)}
              className="rounded-full bg-emerald-800 px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              回答コピーを送信
            </button>
          </div>
        </div>
      )}

      {state.deliveries.length > 0 && (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
          <h6 className="text-sm font-semibold text-slate-900">送信履歴</h6>
          <div className="mt-3 space-y-2">
            {state.deliveries.map((delivery) => {
              const recipient = state.recipients.find((item) => item.id === delivery.recipientId)
              return (
                <div key={delivery.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
                  <span className="text-slate-700">{recipient?.contactName || '削除済み送信先'} / {deliveryLabels[delivery.status] || delivery.status}</span>
                  <span className="text-slate-400">{delivery.requestedBy} / {formatDateTime(delivery.requestedAt)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
