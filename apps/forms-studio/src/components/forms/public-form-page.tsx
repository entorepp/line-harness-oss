'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Form as HarnessForm, FormField, FormIssue } from '@line-crm/shared'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'
const OTHER_SENTINEL = '__other__'

type ApiResponse<T> = {
  success: boolean
  data?: T
  error?: string
}

type PublicIssue = FormIssue & {
  publicUrl: string
  liffUrl: string | null
}

type MissingField = {
  name: string
  label: string
  reason: string
}

const localizedTextDefaults: Record<string, {
  submitButtonLabel: string
  submittingLabel: string
  successTitle: string
  successDescription: string
  helperNote: string
  missingGuideTitle: string
  missingGuideBody: string
  remainingLabel: string
  submitShortcutLabel: string
}> = {
  ja: {
    submitButtonLabel: '送信',
    submittingLabel: '送信中...',
    successTitle: '送信が完了しました',
    successDescription: 'ご回答ありがとうございます。内容を確認してご連絡します。',
    helperNote: '公開フォームとして回答できます。',
    missingGuideTitle: '未入力の必須項目があります',
    missingGuideBody: '先頭の未入力項目へ移動しました。下のボタンから各項目へ直接ジャンプできます。',
    remainingLabel: '残り',
    submitShortcutLabel: '必須入力は完了しています。送信エリアへ',
  },
  en: {
    submitButtonLabel: 'Submit',
    submittingLabel: 'Submitting...',
    successTitle: 'Your response has been submitted',
    successDescription: 'Thank you for your response. We will review it and get back to you.',
    helperNote: 'This form is ready for public responses.',
    missingGuideTitle: 'Some required fields are still missing',
    missingGuideBody: 'We moved you to the first missing field. You can jump directly using the buttons below.',
    remainingLabel: 'Remaining',
    submitShortcutLabel: 'Required fields are complete. Go to submit',
  },
  ko: {
    submitButtonLabel: '제출',
    submittingLabel: '제출 중...',
    successTitle: '제출이 완료되었습니다',
    successDescription: '응답해 주셔서 감사합니다. 내용을 확인한 뒤 연락드리겠습니다.',
    helperNote: '공개 폼으로 바로 응답할 수 있습니다.',
    missingGuideTitle: '아직 입력이 필요한 필수 항목이 있습니다',
    missingGuideBody: '가장 위의 미입력 항목으로 이동했습니다. 아래 버튼으로 바로 이동할 수 있습니다.',
    remainingLabel: '남은 항목',
    submitShortcutLabel: '필수 입력이 완료되었습니다. 제출 영역으로 이동',
  },
  'zh-TW': {
    submitButtonLabel: '送出',
    submittingLabel: '送出中...',
    successTitle: '表單已送出',
    successDescription: '感謝您的填寫，我們會確認內容後再與您聯繫。',
    helperNote: '這份表單可直接作為公開回覆表單使用。',
    missingGuideTitle: '還有必填項目尚未完成',
    missingGuideBody: '已移動到最上方未填寫的項目，也可以用下方按鈕直接跳轉。',
    remainingLabel: '剩餘',
    submitShortcutLabel: '必填項目已完成，前往送出區塊',
  },
}

const PAGE_BACKGROUND_IMAGE = '/travel-background.jpg'
const HERO_BACKGROUND_IMAGE = '/travel-header.jpg'

function normalizeLocale(value: string | null | undefined): string {
  const locale = value?.trim() || ''
  if (!locale) return 'ja'

  const lowered = locale.toLowerCase()
  if (lowered === 'ja' || lowered === 'ja-jp') return 'ja'
  if (lowered === 'en' || lowered === 'en-us' || lowered === 'en-gb') return 'en'
  if (lowered === 'ko' || lowered === 'ko-kr') return 'ko'
  if (lowered === 'zh-tw' || lowered === 'zh_tw') return 'zh-TW'
  return locale
}

function getLocalizedTexts(locale: string | null | undefined) {
  return localizedTextDefaults[normalizeLocale(locale)] || localizedTextDefaults.ja
}

function collectInitialValues(fields: FormField[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((field) => [field.name, field.type === 'checkbox' ? [] : '']),
  )
}

function collectInitialOtherValues(fields: FormField[]): Record<string, string> {
  return Object.fromEntries(
    fields
      .filter((field) => field.allowOtherOption)
      .map((field) => [field.name, '']),
  )
}

function helperText(field: FormField) {
  return field.helperText?.trim() || null
}

function getMissingReason(
  field: FormField,
  value: unknown,
  otherValue: string | undefined,
): string | null {
  const otherText = otherValue?.trim() || ''

  if (field.required) {
    if (field.type === 'checkbox') {
      if (!Array.isArray(value) || value.length === 0) {
        return `${field.label} を入力してください`
      }
    } else if (value === undefined || value === null || String(value).trim() === '') {
      return `${field.label} を入力してください`
    }
  }

  if (field.allowOtherOption) {
    if (field.type === 'checkbox') {
      if (Array.isArray(value) && value.includes(OTHER_SENTINEL) && !otherText) {
        return `${field.otherOptionLabel || 'その他'}の内容を入力してください`
      }
    } else if (value === OTHER_SENTINEL && !otherText) {
      return `${field.otherOptionLabel || 'その他'}の内容を入力してください`
    }
  }

  return null
}

function focusFirstControl(container: HTMLElement | null) {
  const control = container?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'input, textarea, select',
  )
  control?.focus({ preventScroll: true })
}

function fieldControlClass(isMissing: boolean) {
  return `w-full rounded-xl border px-4 py-3 text-sm text-slate-900 outline-none transition ${
    isMissing
      ? 'border-rose-300 bg-rose-50/70 focus:border-rose-400'
      : 'border-[#d7e5dc] bg-white focus:border-[#1d5c47]'
  }`
}

function choiceControlClass(isMissing: boolean) {
  return `rounded-xl border px-4 py-3 text-sm text-slate-700 transition ${
    isMissing
      ? 'border-rose-200 bg-rose-50/60'
      : 'border-[#dfe9e2] bg-white'
  }`
}

export default function PublicFormPage() {
  const searchParams = useSearchParams()
  const formId = searchParams.get('id')
  const issueId = searchParams.get('issue')
  const slackChannelId = searchParams.get('slackChannelId')?.trim() || ''
  const sharedByFriendId = searchParams.get('sharedBy')?.trim() || ''

  const fieldRefs = useRef<Record<string, HTMLElement | null>>({})
  const submitAreaRef = useRef<HTMLDivElement | null>(null)

  const [form, setForm] = useState<HarnessForm | null>(null)
  const [issue, setIssue] = useState<PublicIssue | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [otherValues, setOtherValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      setHasTriedSubmit(false)

      try {
        if (issueId) {
          const res = await fetch(`${API_URL}/api/form-issues/${issueId}`)
          const json = await res.json() as ApiResponse<{
            issue: PublicIssue
            form: HarnessForm
          }>

          if (!res.ok || !json.success || !json.data) {
            throw new Error(json.error || 'フォームの読み込みに失敗しました')
          }

          if (!json.data.form.isActive) {
            throw new Error('このフォームは現在受付を停止しています')
          }

          setIssue(json.data.issue)
          setForm(json.data.form)
          setValues(collectInitialValues(json.data.form.fields))
          setOtherValues(collectInitialOtherValues(json.data.form.fields))
          return
        }

        if (!formId) {
          throw new Error('フォームIDが指定されていません')
        }

        const res = await fetch(`${API_URL}/api/forms/${formId}`)
        const json = await res.json() as ApiResponse<HarnessForm>

        if (!res.ok || !json.success || !json.data) {
          throw new Error(json.error || 'フォームの読み込みに失敗しました')
        }

        if (!json.data.isActive) {
          throw new Error('このフォームは現在受付を停止しています')
        }

        setIssue(null)
        setForm(json.data)
        setValues(collectInitialValues(json.data.fields))
        setOtherValues(collectInitialOtherValues(json.data.fields))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'フォームの読み込みに失敗しました')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [formId, issueId])

  const missingFields = useMemo<MissingField[]>(() => {
    if (!form) return []

    return form.fields
      .map((field) => {
        const reason = getMissingReason(field, values[field.name], otherValues[field.name])
        if (!reason) return null
        return {
          name: field.name,
          label: field.label,
          reason,
        }
      })
      .filter((field): field is MissingField => field !== null)
  }, [form, otherValues, values])

  const missingReasonByName = useMemo(
    () => new Map(missingFields.map((field) => [field.name, field.reason])),
    [missingFields],
  )

  const requiredFieldCount = useMemo(
    () => form?.fields.filter((field) => field.required).length ?? 0,
    [form],
  )

  const showMissingGuide = hasTriedSubmit && missingFields.length > 0
  const showSubmitShortcut = !loading && !submitted && requiredFieldCount > 0 && missingFields.length === 0
  const localizedTexts = useMemo(
    () => getLocalizedTexts(form?.locale || issue?.locale),
    [form?.locale, issue?.locale],
  )

  const scrollToField = (fieldName: string) => {
    const target = fieldRefs.current[fieldName]
    if (!target) return

    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => focusFirstControl(target), 260)
  }

  const scrollToSubmit = () => {
    submitAreaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const setFieldValue = (field: FormField, nextValue: unknown) => {
    setValues((current) => ({
      ...current,
      [field.name]: nextValue,
    }))
  }

  const setOtherFieldValue = (field: FormField, nextValue: string) => {
    setOtherValues((current) => ({
      ...current,
      [field.name]: nextValue,
    }))
  }

  const buildSubmissionData = (): Record<string, unknown> => {
    if (!form) return {}

    const data: Record<string, unknown> = {}

    for (const field of form.fields) {
      const value = values[field.name]
      const otherValue = otherValues[field.name]?.trim()
      const otherLabel = field.otherOptionLabel || 'その他'

      if (field.type === 'checkbox') {
        const selected = Array.isArray(value) ? value.filter((item) => item !== OTHER_SENTINEL) : []
        if (Array.isArray(value) && value.includes(OTHER_SENTINEL) && otherValue) {
          data[field.name] = [...selected, `${otherLabel}: ${otherValue}`]
        } else {
          data[field.name] = selected
        }
        continue
      }

      if (value === OTHER_SENTINEL) {
        data[field.name] = otherValue ? `${otherLabel}: ${otherValue}` : ''
        continue
      }

      data[field.name] = value
    }

    return data
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form) return

    setHasTriedSubmit(true)

    if (missingFields.length > 0) {
      setError('')
      scrollToField(missingFields[0].name)
      return
    }

    setSubmitting(true)
    setError('')

    try {
      const res = await fetch(`${API_URL}/api/forms/${form.id}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          issueId: issue?.id || undefined,
          sharedByFriendId: sharedByFriendId || undefined,
          slackChannelId: slackChannelId || undefined,
          data: buildSubmissionData(),
        }),
      })

      const json = await res.json() as ApiResponse<unknown>
      if (!res.ok || !json.success) {
        throw new Error(json.error || '送信に失敗しました')
      }

      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '送信に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  const renderOtherInput = (field: FormField, visible: boolean, isMissing: boolean) => {
    if (!field.allowOtherOption || !visible) return null

    return (
      <input
        type="text"
        value={otherValues[field.name] ?? ''}
        onChange={(event) => setOtherFieldValue(field, event.target.value)}
        placeholder={`${field.otherOptionLabel || 'その他'}の内容`}
        aria-invalid={isMissing}
        className={`mt-3 ${fieldControlClass(isMissing)}`}
      />
    )
  }

  const renderField = (field: FormField, isMissing: boolean) => {
    const value = values[field.name]

    if (field.type === 'textarea') {
      return (
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => setFieldValue(field, e.target.value)}
          placeholder={field.placeholder}
          rows={4}
          aria-invalid={isMissing}
          className={fieldControlClass(isMissing)}
        />
      )
    }

    if (field.type === 'select') {
      return (
        <>
          <select
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => setFieldValue(field, e.target.value)}
            aria-invalid={isMissing}
            className={fieldControlClass(isMissing)}
          >
            <option value="">選択してください</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            {field.allowOtherOption && (
              <option value={OTHER_SENTINEL}>{field.otherOptionLabel || 'その他'}</option>
            )}
          </select>
          {renderOtherInput(field, value === OTHER_SENTINEL, isMissing)}
        </>
      )
    }

    if (field.type === 'radio') {
      return (
        <div className="space-y-2">
          {(field.options ?? []).map((option) => (
            <label key={option} className={`flex items-center gap-3 ${choiceControlClass(isMissing)}`}>
              <input
                type="radio"
                name={field.name}
                checked={value === option}
                onChange={() => setFieldValue(field, option)}
                aria-invalid={isMissing}
                className="h-4 w-4 border-[#b7cebf] text-[#1d5c47] focus:ring-[#1d5c47]"
              />
              {option}
            </label>
          ))}
          {field.allowOtherOption && (
            <label className={`block ${choiceControlClass(isMissing)}`}>
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name={field.name}
                  checked={value === OTHER_SENTINEL}
                  onChange={() => setFieldValue(field, OTHER_SENTINEL)}
                  aria-invalid={isMissing}
                  className="h-4 w-4 border-[#b7cebf] text-[#1d5c47] focus:ring-[#1d5c47]"
                />
                {field.otherOptionLabel || 'その他'}
              </div>
              {renderOtherInput(field, value === OTHER_SENTINEL, isMissing)}
            </label>
          )}
        </div>
      )
    }

    if (field.type === 'checkbox') {
      const selected = Array.isArray(value) ? value : []
      return (
        <div className="space-y-2">
          {(field.options ?? []).map((option) => {
            const checked = selected.includes(option)
            return (
              <label key={option} className={`flex items-center gap-3 ${choiceControlClass(isMissing)}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? selected.filter((item) => item !== option)
                      : [...selected, option]
                    setFieldValue(field, next)
                  }}
                  aria-invalid={isMissing}
                  className="h-4 w-4 rounded border-[#b7cebf] text-[#1d5c47] focus:ring-[#1d5c47]"
                />
                {option}
              </label>
            )
          })}
          {field.allowOtherOption && (
            <label className={`block ${choiceControlClass(isMissing)}`}>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={selected.includes(OTHER_SENTINEL)}
                  onChange={() => {
                    const checked = selected.includes(OTHER_SENTINEL)
                    const next = checked
                      ? selected.filter((item) => item !== OTHER_SENTINEL)
                      : [...selected, OTHER_SENTINEL]
                    setFieldValue(field, next)
                  }}
                  aria-invalid={isMissing}
                  className="h-4 w-4 rounded border-[#b7cebf] text-[#1d5c47] focus:ring-[#1d5c47]"
                />
                {field.otherOptionLabel || 'その他'}
              </div>
              {renderOtherInput(field, selected.includes(OTHER_SENTINEL), isMissing)}
            </label>
          )}
        </div>
      )
    }

    return (
      <input
        type={field.type}
        value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
        onChange={(e) => setFieldValue(field, e.target.value)}
        placeholder={field.placeholder}
        aria-invalid={isMissing}
        className={fieldControlClass(isMissing)}
      />
    )
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#edf5ef] px-4 py-8 sm:px-6">
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-[0.16]"
          style={{ backgroundImage: `url(${PAGE_BACKGROUND_IMAGE})` }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.78),rgba(237,245,239,0.94)_42%,rgba(237,245,239,0.98)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-64 bg-[linear-gradient(180deg,rgba(237,245,239,0),rgba(237,245,239,0.96))]" />
      </div>

      <div className="relative mx-auto max-w-3xl">
        {loading ? (
          <div className="rounded-[24px] border border-[#d7e5dc] bg-white/[0.92] p-10 text-center text-sm text-slate-500 shadow-sm backdrop-blur-sm">
            フォームを読み込んでいます...
          </div>
        ) : error && !form ? (
          <div className="rounded-[24px] border border-red-200 bg-white/[0.92] p-10 text-center text-sm text-red-700 shadow-sm backdrop-blur-sm">
            {error}
          </div>
        ) : submitted ? (
          <div className="overflow-hidden rounded-[28px] border border-[#d7e5dc] bg-white/[0.92] shadow-sm backdrop-blur-sm">
            <div className="h-4 bg-[#1d5c47]" />
            <div className="px-8 py-10 text-center">
              <h1 className="text-2xl font-semibold text-slate-900">{form?.successTitle || localizedTexts.successTitle}</h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {form?.successDescription || localizedTexts.successDescription}
              </p>
            </div>
          </div>
        ) : form ? (
          <>
            <form onSubmit={handleSubmit} className="space-y-4">
              <section className="relative overflow-hidden rounded-[32px] border border-[#d7e5dc] shadow-[0_20px_60px_rgba(29,92,71,0.18)]">
                <div className="absolute inset-0 overflow-hidden">
                  <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url(${HERO_BACKGROUND_IMAGE})` }}
                  />
                  <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(10,40,31,0.88)_0%,rgba(24,87,67,0.76)_42%,rgba(52,127,98,0.32)_100%)]" />
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.28),transparent_32%),linear-gradient(180deg,rgba(17,60,46,0.08),rgba(17,60,46,0.38))]" />
                  <div className="absolute inset-x-0 bottom-0 h-28 bg-[linear-gradient(180deg,rgba(14,48,37,0),rgba(14,48,37,0.72))]" />
                </div>
                <div className="relative px-8 py-10 text-white sm:px-10 sm:py-12">
                  <h1 className="max-w-2xl text-[30px] font-normal tracking-tight text-white sm:text-[40px]">
                    {form.name}
                  </h1>
                  {form.description && (
                    <p className="mt-5 max-w-2xl text-sm leading-7 text-white/88 sm:text-[15px]">
                      {form.description}
                    </p>
                  )}
                  {issue?.name && (
                    <p className="mt-6 text-sm font-medium tracking-[0.12em] text-white/72">
                      {issue.name}
                    </p>
                  )}
                </div>
              </section>

              {showMissingGuide && (
                <section className="rounded-[24px] border border-[#d7e5dc] bg-white/[0.92] px-6 py-5 shadow-sm backdrop-blur-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-900">{localizedTexts.missingGuideTitle}</h2>
                      <p className="mt-1 text-sm text-slate-600">
                        {localizedTexts.missingGuideBody}
                      </p>
                    </div>
                    <span className="rounded-full bg-[#e8f3ed] px-3 py-1 text-xs font-medium text-[#1d5c47]">
                      {localizedTexts.remainingLabel} {missingFields.length}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {missingFields.map((field, index) => (
                      <button
                        key={field.name}
                        type="button"
                        onClick={() => scrollToField(field.name)}
                        className="rounded-full border border-[#cfe1d5] bg-[#f5faf7] px-3 py-1.5 text-xs font-medium text-[#1d5c47] transition-colors hover:bg-[#ebf5ef]"
                      >
                        {index + 1}. {field.label}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {error && (
                <div className="rounded-2xl border border-red-200 bg-white/[0.92] px-4 py-3 text-sm text-red-700 backdrop-blur-sm">
                  {error}
                </div>
              )}

              {form.fields.map((field) => {
                const missingReason = showMissingGuide ? missingReasonByName.get(field.name) : null

                return (
                  <section
                    key={field.name}
                    id={`field-${field.name}`}
                    ref={(node) => {
                      fieldRefs.current[field.name] = node
                    }}
                    className={`scroll-mt-24 overflow-hidden rounded-[24px] border shadow-sm transition-colors ${
                      missingReason
                        ? 'border-rose-200 bg-white/[0.92]'
                        : 'border-[#d7e5dc] bg-white/[0.92]'
                    }`}
                  >
                    <div className="px-8 py-7 backdrop-blur-sm">
                      <div className="flex items-start gap-2">
                        <h2 className="text-base font-medium leading-7 text-slate-900">{field.label}</h2>
                        {field.required && <span className="text-[#d93025]">*</span>}
                      </div>
                      {helperText(field) && (
                        <p className="mt-1 text-sm leading-6 text-slate-500">{helperText(field)}</p>
                      )}
                      <div className="mt-4">
                        {renderField(field, Boolean(missingReason))}
                      </div>
                      {missingReason && (
                        <p className="mt-3 text-sm font-medium text-rose-700">
                          {missingReason}
                        </p>
                      )}
                    </div>
                  </section>
                )
              })}

              <div ref={submitAreaRef} className="flex flex-wrap items-center gap-3 pb-10">
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[#1d5c47] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#174a39] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? localizedTexts.submittingLabel : (form.submitButtonLabel || localizedTexts.submitButtonLabel)}
                </button>
                <p className="text-xs text-slate-500">{localizedTexts.helperNote}</p>
              </div>
            </form>

            {showSubmitShortcut && (
              <div className="pointer-events-none fixed inset-x-0 bottom-4 z-20 flex justify-center px-4">
                <button
                  type="button"
                  onClick={scrollToSubmit}
                  className="pointer-events-auto rounded-full border border-[#cfe1d5] bg-white/95 px-4 py-2 text-sm font-medium text-[#1d5c47] shadow-sm backdrop-blur transition-colors hover:bg-[#f5faf7]"
                >
                  {localizedTexts.submitShortcutLabel}
                </button>
              </div>
            )}
          </>
        ) : null}
      </div>
    </main>
  )
}
