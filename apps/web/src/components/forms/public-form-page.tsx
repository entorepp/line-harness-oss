'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { Form as HarnessForm, FormField } from '@line-crm/shared'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'

type ApiResponse<T> = {
  success: boolean
  data?: T
  error?: string
}

function fieldTypeLabel(type: FormField['type']): string {
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
    default:
      return type
  }
}

function collectInitialValues(fields: FormField[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((field) => [field.name, field.type === 'checkbox' ? [] : '']),
  )
}

export default function PublicFormPage() {
  const searchParams = useSearchParams()
  const formId = searchParams.get('id')
  const slackChannelId = searchParams.get('slackChannelId')?.trim() || ''
  const sharedByFriendId = searchParams.get('sharedBy')?.trim() || ''

  const [form, setForm] = useState<HarnessForm | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      if (!formId) {
        setError('フォームIDが指定されていません')
        setLoading(false)
        return
      }

      setLoading(true)
      setError('')

      try {
        const res = await fetch(`${API_URL}/api/forms/${formId}`)
        const json = await res.json() as ApiResponse<HarnessForm>

        if (!res.ok || !json.success || !json.data) {
          throw new Error(json.error || 'フォームの読み込みに失敗しました')
        }

        if (!json.data.isActive) {
          throw new Error('このフォームは現在受付を停止しています')
        }

        setForm(json.data)
        setValues(collectInitialValues(json.data.fields))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'フォームの読み込みに失敗しました')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [formId])

  const routeHint = useMemo(() => {
    if (slackChannelId) return `回答は Slack チャンネル ${slackChannelId} に通知されます`
    return '回答はデフォルト通知チャンネルに送られます'
  }, [slackChannelId])

  const setFieldValue = (field: FormField, nextValue: unknown) => {
    setValues((current) => ({
      ...current,
      [field.name]: nextValue,
    }))
  }

  const validate = (): string | null => {
    if (!form) return 'フォームが読み込まれていません'

    for (const field of form.fields) {
      if (!field.required) continue

      const value = values[field.name]
      if (field.type === 'checkbox') {
        if (!Array.isArray(value) || value.length === 0) {
          return `${field.label} は必須項目です`
        }
        continue
      }

      if (value === undefined || value === null || String(value).trim() === '') {
        return `${field.label} は必須項目です`
      }
    }

    return null
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form) return

    const validationError = validate()
    if (validationError) {
      setError(validationError)
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
          sharedByFriendId: sharedByFriendId || undefined,
          slackChannelId: slackChannelId || undefined,
          data: values,
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

  const renderField = (field: FormField) => {
    const value = values[field.name]

    if (field.type === 'textarea') {
      return (
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => setFieldValue(field, e.target.value)}
          placeholder={field.placeholder}
          rows={4}
          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition-colors focus:border-green-500"
        />
      )
    }

    if (field.type === 'select') {
      return (
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => setFieldValue(field, e.target.value)}
          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition-colors focus:border-green-500"
        >
          <option value="">選択してください</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )
    }

    if (field.type === 'radio') {
      return (
        <div className="space-y-2">
          {(field.options ?? []).map((option) => (
            <label key={option} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
              <input
                type="radio"
                name={field.name}
                checked={value === option}
                onChange={() => setFieldValue(field, option)}
              />
              {option}
            </label>
          ))}
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
              <label key={option} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = checked
                      ? selected.filter((item) => item !== option)
                      : [...selected, option]
                    setFieldValue(field, next)
                  }}
                />
                {option}
              </label>
            )
          })}
        </div>
      )
    }

    return (
      <input
        type={field.type}
        value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
        onChange={(e) => setFieldValue(field, e.target.value)}
        placeholder={field.placeholder}
        className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition-colors focus:border-green-500"
      />
    )
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#effaf3,white_50%)] px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-2xl">
        {loading ? (
          <div className="rounded-3xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-400 shadow-sm">
            読み込み中...
          </div>
        ) : error && !form ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-10 text-center text-sm text-red-700 shadow-sm">
            {error}
          </div>
        ) : submitted ? (
          <div className="rounded-3xl border border-green-200 bg-white p-10 text-center shadow-sm">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500 text-3xl text-white">
              ✓
            </div>
            <h1 className="mt-5 text-2xl font-bold text-gray-900">送信完了</h1>
            <p className="mt-3 text-sm leading-6 text-gray-600">
              ご回答ありがとうございました。内容は正常に受け付けられました。
            </p>
          </div>
        ) : form ? (
          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="border-b border-gray-100 pb-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-green-600">Public Form</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-900">{form.name}</h1>
              <p className="mt-3 text-sm leading-6 text-gray-600">
                {form.description || '必要事項をご入力ください'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
                  {form.fields.length} 項目
                </span>
                <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
                  {routeHint}
                </span>
                {sharedByFriendId && (
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                    sharedBy: {sharedByFriendId}
                  </span>
                )}
              </div>
            </div>

            <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
              {form.fields.map((field, index) => (
                <section key={`${field.name}-${index}`} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-gray-900 px-2 text-xs font-semibold text-white">
                      {index + 1}
                    </span>
                    <p className="text-sm font-semibold text-gray-900">{field.label}</p>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-500">
                      {fieldTypeLabel(field.type)}
                    </span>
                    {field.required && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
                        必須
                      </span>
                    )}
                  </div>

                  {renderField(field)}
                </section>
              ))}

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-2xl px-5 py-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                style={{ backgroundColor: '#06C755' }}
              >
                {submitting ? '送信中...' : '送信する'}
              </button>
            </form>
          </div>
        ) : null}
      </div>
    </main>
  )
}
