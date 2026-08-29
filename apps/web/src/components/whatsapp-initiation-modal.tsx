'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  ApiRequestError,
  type WhatsAppInitiationResult,
  type WhatsAppInitiationTemplate,
} from '@/lib/api'

type WhatsAppAccount = {
  id: string
  name: string
  displayName?: string
}

type ConsentSource = 'web_form' | 'email' | 'phone' | 'in_person' | 'other'

const consentSources: Array<{ value: ConsentSource; label: string }> = [
  { value: 'web_form', label: 'Webフォーム' },
  { value: 'email', label: 'メール' },
  { value: 'phone', label: '電話・口頭' },
  { value: 'in_person', label: '対面' },
  { value: 'other', label: 'その他' },
]

function localDatetimeValue(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function newIdempotencyKey(): string {
  return `whatsapp-initiation:${crypto.randomUUID()}`
}

function renderComponent(
  text: string | null,
  component: 'header' | 'body',
  template: WhatsAppInitiationTemplate,
  values: Record<string, string>,
): string {
  let rendered = text || ''
  for (const parameter of template.parameters.filter((item) => item.component === component)) {
    const token = parameter.name || String(parameter.index)
    rendered = rendered.replace(new RegExp(`{{\\s*${token}\\s*}}`, 'g'), values[parameter.key] || `{{${token}}}`)
  }
  return rendered
}

export default function WhatsAppInitiationModal({
  accounts,
  initialAccountId,
  onClose,
  onCreated,
}: {
  accounts: WhatsAppAccount[]
  initialAccountId?: string | null
  onClose: () => void
  onCreated: (accountId: string, result: WhatsAppInitiationResult) => void
}) {
  const [accountId, setAccountId] = useState(
    accounts.some((account) => account.id === initialAccountId) ? initialAccountId! : accounts[0]?.id || '',
  )
  const [customerName, setCustomerName] = useState('')
  const [recipientPhone, setRecipientPhone] = useState('')
  const [consentSource, setConsentSource] = useState<ConsentSource>('web_form')
  const [consentObtainedAt, setConsentObtainedAt] = useState(localDatetimeValue())
  const [consentConfirmed, setConsentConfirmed] = useState(false)
  const [templates, setTemplates] = useState<WhatsAppInitiationTemplate[]>([])
  const [templateKey, setTemplateKey] = useState('')
  const [templateParameters, setTemplateParameters] = useState<Record<string, string>>({})
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [releaseMode, setReleaseMode] = useState<'off' | 'test' | 'live' | null>(null)
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [failedAttempt, setFailedAttempt] = useState(false)
  const [unknownOutcome, setUnknownOutcome] = useState(false)
  const idempotencyKey = useRef(newIdempotencyKey())

  const selectedTemplate = useMemo(
    () => templates.find((template) => `${template.name}:${template.language}` === templateKey) || null,
    [templateKey, templates],
  )

  const preview = useMemo(() => {
    if (!selectedTemplate) return ''
    return [
      renderComponent(selectedTemplate.headerText, 'header', selectedTemplate, templateParameters),
      renderComponent(selectedTemplate.bodyText, 'body', selectedTemplate, templateParameters),
      selectedTemplate.footerText || '',
      ...(selectedTemplate.buttonLabels || []).map((label) => `[${label}]`),
    ].filter(Boolean).join('\n\n')
  }, [selectedTemplate, templateParameters])

  const resetFailedAttemptForEdit = () => {
    if (failedAttempt && !unknownOutcome) {
      idempotencyKey.current = newIdempotencyKey()
      setFailedAttempt(false)
    }
    setError('')
  }

  useEffect(() => {
    let cancelled = false
    if (!accountId) return
    setLoadingTemplates(true)
    setConfigured(null)
    setReleaseMode(null)
    setTemplates([])
    setTemplateKey('')
    setTemplateParameters({})
    setError('')
    setFailedAttempt(false)
    setUnknownOutcome(false)
    idempotencyKey.current = newIdempotencyKey()

    api.whatsapp.listInitiationTemplates(accountId)
      .then((response) => {
        if (cancelled) return
        if (!response.success) throw new Error(response.error)
        setConfigured(response.data.configured)
        setReleaseMode(response.data.releaseMode)
        setTemplates(response.data.templates)
        const first = response.data.templates.find((template) => template.supportedForInitiation)
        if (first) setTemplateKey(`${first.name}:${first.language}`)
        if (!response.data.configured) setError(response.data.reason || 'WABA IDが未設定です')
        else if (response.data.releaseMode === 'off') setError('初回連絡はレビュー待ちのため、現在は送信できません。')
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'テンプレートを取得できませんでした')
      })
      .finally(() => {
        if (!cancelled) setLoadingTemplates(false)
      })

    return () => { cancelled = true }
  }, [accountId])

  useEffect(() => {
    if (!selectedTemplate) {
      setTemplateParameters({})
      return
    }
    setTemplateParameters(Object.fromEntries(selectedTemplate.parameters.map((parameter) => [parameter.key, ''])))
  }, [selectedTemplate?.id])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedTemplate || unknownOutcome) return
    setSubmitting(true)
    setError('')
    try {
      const consentDate = new Date(consentObtainedAt)
      if (Number.isNaN(consentDate.getTime())) throw new Error('同意取得日時を入力してください')
      const response = await api.whatsapp.initiate({
        idempotencyKey: idempotencyKey.current,
        lineAccountId: accountId,
        recipientPhone,
        customerName,
        numberProvidedConfirmed: consentConfirmed,
        optInConfirmed: consentConfirmed,
        consentSource,
        consentObtainedAt: consentDate.toISOString(),
        templateName: selectedTemplate.name,
        templateLanguage: selectedTemplate.language,
        templateParameters,
      })
      if (!response.success) throw new Error(response.error)
      onCreated(accountId, response.data)
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'WhatsApp送信に失敗しました'
      const providerOutcome = submitError instanceof ApiRequestError ? submitError.body?.outcome : null
      const mustVerify = providerOutcome === 'unknown' || !(submitError instanceof ApiRequestError)
      setUnknownOutcome(mustVerify)
      setFailedAttempt(providerOutcome === 'failed')
      setError(mustVerify
        ? `${message} 再送せず、WhatsApp Managerまたは受信端末で結果を確認してください。`
        : message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="whatsapp-initiation-title">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-gray-200 bg-white px-5 py-4">
          <div>
            <h2 id="whatsapp-initiation-title" className="text-base font-bold text-gray-900">WhatsAppで新規連絡</h2>
            <p className="mt-1 text-xs text-gray-500">お客様が番号を提供し、WhatsApp連絡に同意した場合のみ送信できます。</p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="閉じる">✕</button>
        </div>

        <form onSubmit={submit} className="space-y-5 p-5">
          {error && (
            <div className={`rounded-lg border p-3 text-sm ${unknownOutcome ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {error}
            </div>
          )}
          {releaseMode === 'test' && !unknownOutcome && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              テストモードです。事前登録したテスト番号以外への送信はAPI側で拒否されます。
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-gray-700">
              WhatsAppアカウント
              <select value={accountId} onChange={(event) => setAccountId(event.target.value)} disabled={submitting || unknownOutcome} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName || account.name}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-gray-700">
              お客様名
              <input value={customerName} onChange={(event) => { resetFailedAttemptForEdit(); setCustomerName(event.target.value) }} disabled={unknownOutcome} maxLength={120} required className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="例: Alex Smith" />
            </label>
          </div>

          <label className="block text-sm font-medium text-gray-700">
            電話番号（国番号付き）
            <input type="tel" value={recipientPhone} onChange={(event) => { resetFailedAttemptForEdit(); setRecipientPhone(event.target.value) }} disabled={unknownOutcome} required className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="例: +81 90 1234 5678" />
            <span className="mt-1 block text-xs font-normal text-gray-500">国番号は推測しません。必ず「+」から始まる番号を入力してください。</span>
          </label>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-gray-700">
              同意取得元
              <select value={consentSource} onChange={(event) => { resetFailedAttemptForEdit(); setConsentSource(event.target.value as ConsentSource) }} disabled={unknownOutcome} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                {consentSources.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium text-gray-700">
              同意取得日時
              <input type="datetime-local" value={consentObtainedAt} onChange={(event) => { resetFailedAttemptForEdit(); setConsentObtainedAt(event.target.value) }} disabled={unknownOutcome} max={localDatetimeValue()} required className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <label className="flex items-start gap-3 text-sm text-amber-950">
              <input type="checkbox" checked={consentConfirmed} onChange={(event) => { resetFailedAttemptForEdit(); setConsentConfirmed(event.target.checked) }} disabled={unknownOutcome} className="mt-0.5 h-4 w-4" />
              <span>お客様本人から番号を受け取り、Flat TravelからWhatsAppで連絡することに同意済みです。</span>
            </label>
          </div>

          <label className="block text-sm font-medium text-gray-700">
            Meta承認済みテンプレート
            <select value={templateKey} onChange={(event) => { resetFailedAttemptForEdit(); setTemplateKey(event.target.value) }} disabled={loadingTemplates || configured !== true || unknownOutcome} required className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100">
              <option value="">{loadingTemplates ? '読み込み中...' : '選択してください'}</option>
              {templates.map((template) => (
                <option key={`${template.id}:${template.language}`} value={`${template.name}:${template.language}`} disabled={!template.supportedForInitiation}>
                  {template.name} / {template.language}{template.supportedForInitiation ? '' : `（利用不可: ${template.unsupportedReason}）`}
                </option>
              ))}
            </select>
          </label>

          {selectedTemplate?.parameters.map((parameter) => (
            <label key={parameter.key} className="block text-sm font-medium text-gray-700">
              {parameter.label}
              <input value={templateParameters[parameter.key] || ''} onChange={(event) => { resetFailedAttemptForEdit(); setTemplateParameters((current) => ({ ...current, [parameter.key]: event.target.value })) }} disabled={unknownOutcome} maxLength={1024} required className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
          ))}

          {selectedTemplate && (
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">送信プレビュー</p>
              <pre className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm leading-6 text-gray-800">{preview}</pre>
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50">キャンセル</button>
            <button type="submit" disabled={submitting || unknownOutcome || configured !== true || releaseMode === null || releaseMode === 'off' || !selectedTemplate || !consentConfirmed} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {submitting ? 'Metaへ送信中...' : unknownOutcome ? '結果確認が必要です' : '承認済みテンプレートを送信'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
