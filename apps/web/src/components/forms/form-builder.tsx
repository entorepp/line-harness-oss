'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  Form as HarnessForm,
  FormField as HarnessFormField,
  Scenario,
  Tag,
} from '@line-crm/shared'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'

type FormDraft = {
  name: string
  description: string
  fields: HarnessFormField[]
  onSubmitTagId: string
  onSubmitScenarioId: string
  saveToMetadata: boolean
  isActive: boolean
}

type ImportedDraft = Partial<Omit<FormDraft, 'fields'>> & {
  fields: HarnessFormField[]
}

const fieldTypeOptions: Array<{ value: HarnessFormField['type']; label: string }> = [
  { value: 'text', label: 'テキスト' },
  { value: 'email', label: 'メール' },
  { value: 'tel', label: '電話番号' },
  { value: 'number', label: '数値' },
  { value: 'textarea', label: '長文' },
  { value: 'select', label: 'プルダウン' },
  { value: 'radio', label: '単一選択' },
  { value: 'checkbox', label: '複数選択' },
  { value: 'date', label: '日付' },
]

const selectableTypes = new Set<HarnessFormField['type']>(['select', 'radio', 'checkbox'])

const importExample = `{
  "name": "セミナー申込フォーム",
  "description": "参加者の基本情報を集めます",
  "saveToMetadata": true,
  "fields": [
    {
      "label": "お名前",
      "type": "text",
      "required": true,
      "placeholder": "山田 太郎"
    },
    {
      "label": "メールアドレス",
      "type": "email",
      "required": true
    },
    {
      "label": "参加希望日",
      "type": "select",
      "options": ["4/20", "4/21", "4/22"]
    }
  ]
}`

function fieldTypeLabel(type: HarnessFormField['type']): string {
  return fieldTypeOptions.find((option) => option.value === type)?.label ?? type
}

function createEmptyField(): HarnessFormField {
  return {
    name: '',
    label: '',
    type: 'text',
    required: false,
    options: [],
    placeholder: '',
  }
}

function createEmptyDraft(): FormDraft {
  return {
    name: '',
    description: '',
    fields: [createEmptyField()],
    onSubmitTagId: '',
    onSubmitScenarioId: '',
    saveToMetadata: true,
    isActive: true,
  }
}

function formToDraft(form: HarnessForm): FormDraft {
  return {
    name: form.name,
    description: form.description ?? '',
    fields: form.fields.length > 0
      ? form.fields.map((field) => ({
        ...field,
        options: field.options ?? [],
        placeholder: field.placeholder ?? '',
      }))
      : [createEmptyField()],
    onSubmitTagId: form.onSubmitTagId ?? '',
    onSubmitScenarioId: form.onSubmitScenarioId ?? '',
    saveToMetadata: form.saveToMetadata,
    isActive: form.isActive,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record && record[key] !== undefined && record[key] !== null) {
      return record[key]
    }
  }
  return undefined
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'y', 'on', 'required', '必須'].includes(normalized)) return true
    if (['false', '0', 'no', 'n', 'off', 'optional', '任意'].includes(normalized)) return false
  }
  return undefined
}

function slugifyFieldName(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

  return normalized
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizeFieldType(value: unknown): HarnessFormField['type'] {
  const normalized = stringifyValue(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_')

  switch (normalized) {
    case 'email':
      return 'email'
    case 'tel':
    case 'phone':
    case 'phone_number':
      return 'tel'
    case 'number':
    case 'numeric':
    case 'integer':
      return 'number'
    case 'textarea':
    case 'long_text':
    case 'paragraph':
      return 'textarea'
    case 'select':
    case 'dropdown':
      return 'select'
    case 'radio':
    case 'single_choice':
    case 'single_select':
      return 'radio'
    case 'checkbox':
    case 'multi_choice':
    case 'multiple_choice':
    case 'multi_select':
      return 'checkbox'
    case 'date':
      return 'date'
    default:
      return 'text'
  }
}

function normalizeOptions(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => {
        if (typeof item === 'string') return [item.trim()]
        if (isRecord(item)) {
          const text = stringifyValue(pickValue(item, ['label', 'value', 'name', 'title', 'text']))
          return text ? [text] : []
        }
        const text = stringifyValue(item)
        return text ? [text] : []
      })
      .filter(Boolean)
  }

  if (isRecord(value)) {
    return Object.values(value)
      .map((item) => stringifyValue(item))
      .filter(Boolean)
  }

  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  return []
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('```')) return trimmed

  return trimmed
    .replace(/^```[a-zA-Z0-9_-]*\s*/, '')
    .replace(/\s*```$/, '')
    .trim()
}

function normalizeImportedField(value: unknown, index: number): HarnessFormField {
  if (typeof value === 'string') {
    const label = value.trim() || `Field ${index + 1}`
    return {
      name: slugifyFieldName(label) || `field_${index + 1}`,
      label,
      type: 'text',
      required: false,
    }
  }

  if (!isRecord(value)) {
    throw new Error(`設問 ${index + 1} の形式が不正です`)
  }

  const label = stringifyValue(
    pickValue(value, ['label', 'title', 'question', 'prompt', 'text', '項目名', '設問', '質問']),
  ) || `Field ${index + 1}`

  const type = normalizeFieldType(
    pickValue(value, ['type', 'kind', 'inputType', 'fieldType', '形式', '入力タイプ']),
  )

  const placeholder = stringifyValue(
    pickValue(value, ['placeholder', 'helpText', 'example', 'プレースホルダ', '例']),
  )

  const options = normalizeOptions(
    pickValue(value, ['options', 'choices', 'items', 'values', '選択肢']),
  )

  const required = parseBoolean(
    pickValue(value, ['required', 'mandatory', 'isRequired', '必須']),
  )

  return {
    name: stringifyValue(pickValue(value, ['name', 'key', 'id'])) || slugifyFieldName(label) || `field_${index + 1}`,
    label,
    type,
    required: required ?? false,
    placeholder,
    options,
  }
}

function parseImportedDraft(value: string): ImportedDraft {
  const raw = stripCodeFence(value)
  if (!raw) {
    throw new Error('JSON を入力してください')
  }

  const parsed = JSON.parse(raw) as unknown

  if (Array.isArray(parsed)) {
    return {
      fields: parsed.map((field, index) => normalizeImportedField(field, index)),
    }
  }

  if (!isRecord(parsed)) {
    throw new Error('JSON はオブジェクトか配列で入力してください')
  }

  const rawFields = pickValue(parsed, ['fields', 'questions', 'items', '設問', '項目', '質問'])
  if (!Array.isArray(rawFields)) {
    throw new Error('fields / questions / items の配列が必要です')
  }

  const next: ImportedDraft = {
    fields: rawFields.map((field, index) => normalizeImportedField(field, index)),
  }

  const name = stringifyValue(
    pickValue(parsed, ['name', 'title', 'formName', 'form_name', 'フォーム名', 'タイトル']),
  )
  if (name) next.name = name

  const description = stringifyValue(
    pickValue(parsed, ['description', 'summary', 'details', '説明', '概要']),
  )
  if (description) next.description = description

  const onSubmitTagId = stringifyValue(
    pickValue(parsed, ['onSubmitTagId', 'on_submit_tag_id']),
  )
  if (onSubmitTagId) next.onSubmitTagId = onSubmitTagId

  const onSubmitScenarioId = stringifyValue(
    pickValue(parsed, ['onSubmitScenarioId', 'on_submit_scenario_id']),
  )
  if (onSubmitScenarioId) next.onSubmitScenarioId = onSubmitScenarioId

  const saveToMetadata = parseBoolean(
    pickValue(parsed, ['saveToMetadata', 'save_to_metadata']),
  )
  if (saveToMetadata !== undefined) next.saveToMetadata = saveToMetadata

  const isActive = parseBoolean(
    pickValue(parsed, ['isActive', 'is_active']),
  )
  if (isActive !== undefined) next.isActive = isActive

  return next
}

function sanitizeDraft(draft: FormDraft) {
  const name = draft.name.trim()
  if (!name) throw new Error('フォーム名は必須です')

  if (draft.fields.length === 0) {
    throw new Error('設問を1つ以上追加してください')
  }

  const usedNames = new Set<string>()
  const fields = draft.fields.map((field, index) => {
    const label = field.label.trim()
    if (!label) throw new Error(`${index + 1} 番目の設問ラベルは必須です`)

    const type = normalizeFieldType(field.type)
    const placeholder = field.placeholder?.trim() ?? ''

    const baseName = slugifyFieldName(field.name.trim())
      || slugifyFieldName(label)
      || `field_${index + 1}`

    let nextName = baseName
    let suffix = 2
    while (usedNames.has(nextName)) {
      nextName = `${baseName}_${suffix}`
      suffix += 1
    }
    usedNames.add(nextName)

    const nextField: HarnessFormField = {
      name: nextName,
      label,
      type,
      required: Boolean(field.required),
    }

    if (placeholder) {
      nextField.placeholder = placeholder
    }

    if (selectableTypes.has(type)) {
      const options = normalizeOptions(field.options)
      if (options.length === 0) {
        throw new Error(`${label} の選択肢を入力してください`)
      }
      nextField.options = options
    }

    return nextField
  })

  return {
    name,
    description: draft.description.trim() || null,
    fields,
    onSubmitTagId: draft.onSubmitTagId || null,
    onSubmitScenarioId: draft.onSubmitScenarioId || null,
    saveToMetadata: draft.saveToMetadata,
    isActive: draft.isActive,
  }
}

function optionsToTextareaValue(options?: string[]): string {
  return (options ?? []).join('\n')
}

export default function FormBuilder({ formId }: { formId?: string }) {
  const router = useRouter()
  const { selectedAccountId } = useAccount()

  const [draft, setDraft] = useState<FormDraft>(createEmptyDraft())
  const [formMeta, setFormMeta] = useState<HarnessForm | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [loading, setLoading] = useState(Boolean(formId))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [importJson, setImportJson] = useState('')

  const loadOptions = useCallback(async () => {
    const [tagsRes, scenariosRes] = await Promise.all([
      api.tags.list(),
      api.scenarios.list({ accountId: selectedAccountId || undefined }),
    ])

    if (tagsRes.success) setTags(tagsRes.data)
    if (scenariosRes.success) setScenarios(scenariosRes.data)
  }, [selectedAccountId])

  const loadForm = useCallback(async () => {
    if (!formId) {
      setLoading(false)
      setFormMeta(null)
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await api.forms.get(formId)
      if (!res.success) {
        throw new Error('フォームが見つかりません')
      }

      setFormMeta(res.data)
      setDraft(formToDraft(res.data))
    } catch {
      setError('フォーム情報の読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [formId])

  useEffect(() => {
    void loadOptions().catch(() => {
      setError('タグまたはシナリオの読み込みに失敗しました')
    })
  }, [loadOptions])

  useEffect(() => {
    void loadForm()
  }, [loadForm])

  const pageTitle = formId ? 'フォーム編集' : '新規フォーム'
  const pageDescription = formId
    ? '設問、送信後アクション、Codex JSON 取込を編集します'
    : 'Google Form 風のフォームを GUI と JSON 取込で作成します'

  const tagName = useMemo(
    () => tags.find((tag) => tag.id === draft.onSubmitTagId)?.name ?? null,
    [draft.onSubmitTagId, tags],
  )

  const scenarioName = useMemo(
    () => scenarios.find((scenario) => scenario.id === draft.onSubmitScenarioId)?.name ?? null,
    [draft.onSubmitScenarioId, scenarios],
  )

  const updateField = (index: number, patch: Partial<HarnessFormField>) => {
    setDraft((current) => ({
      ...current,
      fields: current.fields.map((field, fieldIndex) => (
        fieldIndex === index
          ? { ...field, ...patch }
          : field
      )),
    }))
  }

  const addField = () => {
    setDraft((current) => ({
      ...current,
      fields: [...current.fields, createEmptyField()],
    }))
  }

  const removeField = (index: number) => {
    setDraft((current) => ({
      ...current,
      fields: current.fields.length === 1
        ? [createEmptyField()]
        : current.fields.filter((_, fieldIndex) => fieldIndex !== index),
    }))
  }

  const moveField = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= current.fields.length) return current

      const nextFields = [...current.fields]
      const [target] = nextFields.splice(index, 1)
      nextFields.splice(nextIndex, 0, target)

      return {
        ...current,
        fields: nextFields,
      }
    })
  }

  const resetDraft = () => {
    setError('')
    setSuccess('')
    setImportJson('')
    if (formMeta) {
      setDraft(formToDraft(formMeta))
      return
    }
    setDraft(createEmptyDraft())
  }

  const handleImport = () => {
    try {
      const imported = parseImportedDraft(importJson)
      setDraft((current) => ({
        ...current,
        ...imported,
        fields: imported.fields,
      }))
      setSuccess('Codex JSON をフォーム編集画面に反映しました')
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'JSON の取り込みに失敗しました')
      setSuccess('')
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const payload = sanitizeDraft(draft)

      if (formId) {
        const res = await api.forms.update(formId, payload)
        if (!res.success) throw new Error('フォームの保存に失敗しました')

        setFormMeta(res.data)
        setDraft(formToDraft(res.data))
        setSuccess('フォームを更新しました')
      } else {
        const { isActive, ...createPayload } = payload
        let created = await api.forms.create(createPayload)
        if (!created.success) throw new Error('フォームの作成に失敗しました')

        if (!isActive) {
          const disabled = await api.forms.update(created.data.id, { isActive: false })
          if (disabled.success) {
            created = disabled
          }
        }

        router.push(`/forms/edit?id=${created.data.id}`)
        return
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'フォームの保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!formId) return
    if (!window.confirm('このフォームを削除しますか？')) return

    setDeleting(true)
    setError('')
    setSuccess('')

    try {
      await api.forms.delete(formId)
      router.push('/forms')
    } catch {
      setError('フォームの削除に失敗しました')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <Header title={pageTitle} description={pageDescription} />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/forms"
          className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          フォーム一覧へ戻る
        </Link>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={resetDraft}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            入力をリセット
          </button>

          {formId && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleting ? '削除中...' : 'フォームを削除'}
            </button>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
            style={{ backgroundColor: '#06C755' }}
          >
            {saving ? '保存中...' : (formId ? '変更を保存' : 'フォームを作成')}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">
          {success}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
          読み込み中...
        </div>
      ) : (
        <div className="space-y-6">
          <section className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">基本情報</h2>
                <p className="mt-1 text-sm text-gray-500">
                  フォーム名と送信後アクションを設定します
                </p>
              </div>

              {formMeta && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">回答数</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">{formMeta.submitCount}</p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-700">フォーム名</label>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
                  placeholder="例: 無料相談 事前ヒアリング"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-700">説明文</label>
                <textarea
                  value={draft.description}
                  onChange={(e) => setDraft((current) => ({ ...current, description: e.target.value }))}
                  placeholder="フォーム上部に表示する説明文"
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">送信時タグ</label>
                <select
                  value={draft.onSubmitTagId}
                  onChange={(e) => setDraft((current) => ({ ...current, onSubmitTagId: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">なし</option>
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">送信時シナリオ</label>
                <select
                  value={draft.onSubmitScenarioId}
                  onChange={(e) => setDraft((current) => ({ ...current, onSubmitScenarioId: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                >
                  <option value="">なし</option>
                  {scenarios.map((scenario) => (
                    <option key={scenario.id} value={scenario.id}>
                      {scenario.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={draft.saveToMetadata}
                  onChange={(e) => setDraft((current) => ({ ...current, saveToMetadata: e.target.checked }))}
                  className="h-4 w-4"
                />
                回答を metadata に保存
              </label>

              <label className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(e) => setDraft((current) => ({ ...current, isActive: e.target.checked }))}
                  className="h-4 w-4"
                />
                フォームを受付中にする
              </label>

              <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                {tagName || scenarioName
                  ? `タグ: ${tagName ?? 'なし'} / シナリオ: ${scenarioName ?? 'なし'}`
                  : 'タグ・シナリオは未設定です'}
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Codex JSON 取込</h2>
                <p className="mt-1 text-sm text-gray-500">
                  `fields` 配列だけでも、フォーム全体オブジェクトでも取り込めます
                </p>
              </div>

              <button
                type="button"
                onClick={handleImport}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                JSON を反映
              </button>
            </div>

            <textarea
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              placeholder={importExample}
              rows={14}
              className="mt-4 w-full rounded-lg border border-gray-300 px-3 py-3 text-sm font-mono"
            />
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-6">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">設問エディタ</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Google Form 風に GUI で追加・並び替え・選択肢編集ができます
                </p>
              </div>

              <button
                type="button"
                onClick={addField}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#06C755' }}
              >
                設問を追加
              </button>
            </div>

            <div className="space-y-4">
              {draft.fields.map((field, index) => {
                const showOptions = selectableTypes.has(field.type)

                return (
                  <div key={`field-${index}`} className="rounded-xl border border-gray-200 p-5">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-gray-900 px-2 text-xs font-semibold text-white">
                          {index + 1}
                        </span>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          {fieldTypeLabel(field.type)}
                        </span>
                        {field.required && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
                            必須
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => moveField(index, -1)}
                          disabled={index === 0}
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          上へ
                        </button>
                        <button
                          type="button"
                          onClick={() => moveField(index, 1)}
                          disabled={index === draft.fields.length - 1}
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          下へ
                        </button>
                        <button
                          type="button"
                          onClick={() => removeField(index)}
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600"
                        >
                          削除
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">表示ラベル</label>
                        <input
                          value={field.label}
                          onChange={(e) => updateField(index, { label: e.target.value })}
                          placeholder="例: お名前"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">項目キー</label>
                        <input
                          value={field.name}
                          onChange={(e) => updateField(index, { name: e.target.value })}
                          placeholder="未入力なら自動生成"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">入力形式</label>
                        <select
                          value={field.type}
                          onChange={(e) => updateField(index, { type: e.target.value as HarnessFormField['type'] })}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        >
                          {fieldTypeOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">プレースホルダ</label>
                        <input
                          value={field.placeholder ?? ''}
                          onChange={(e) => updateField(index, { placeholder: e.target.value })}
                          placeholder="任意"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        />
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-4">
                      <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={Boolean(field.required)}
                          onChange={(e) => updateField(index, { required: e.target.checked })}
                          className="h-4 w-4"
                        />
                        必須にする
                      </label>
                    </div>

                    {showOptions && (
                      <div className="mt-4">
                        <label className="mb-1 block text-sm font-medium text-gray-700">選択肢</label>
                        <textarea
                          value={optionsToTextareaValue(field.options)}
                          onChange={(e) => updateField(index, { options: normalizeOptions(e.target.value) })}
                          placeholder={'1行に1つ入力\n例:\nはい\nいいえ'}
                          rows={5}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-gray-900">プレビュー</h2>
            <p className="mt-1 text-sm text-gray-500">
              保存前でも現在のフォーム構成を確認できます
            </p>

            <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-6">
              <div className="border-b border-gray-200 pb-4">
                <h3 className="text-xl font-bold text-gray-900">
                  {draft.name.trim() || 'フォーム名を入力してください'}
                </h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  {draft.description.trim() || '説明文はまだ入力されていません'}
                </p>
              </div>

              <div className="mt-6 space-y-4">
                {draft.fields.map((field, index) => (
                  <div key={`preview-${index}`} className="rounded-xl border border-gray-200 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-gray-900 px-2 text-xs font-semibold text-white">
                        {index + 1}
                      </span>
                      <p className="text-sm font-semibold text-gray-900">
                        {field.label.trim() || '未設定の設問'}
                      </p>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        {fieldTypeLabel(field.type)}
                      </span>
                      {field.required && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
                          必須
                        </span>
                      )}
                    </div>

                    {field.placeholder && (
                      <p className="mt-2 text-xs text-gray-500">プレースホルダ: {field.placeholder}</p>
                    )}

                    {selectableTypes.has(field.type) && (field.options ?? []).length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(field.options ?? []).map((option) => (
                          <span
                            key={`${field.name}-${option}`}
                            className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700"
                          >
                            {option}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
