'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  Form as HarnessForm,
  FormField as HarnessFormField,
  FormIssue,
  Scenario,
  Tag,
} from '@line-crm/shared'
import { api } from '@/lib/api'

type FormDraft = {
  name: string
  description: string
  fields: HarnessFormField[]
  locale: string
  translationGroupId: string
  submitButtonLabel: string
  successTitle: string
  successDescription: string
  onSubmitTagId: string
  onSubmitScenarioId: string
  saveToMetadata: boolean
  isActive: boolean
}

type ImportedDraft = Partial<Omit<FormDraft, 'fields'>> & {
  fields: HarnessFormField[]
}

type SavedIssue = FormIssue & {
  publicUrl: string
  liffUrl: string | null
}

type IssueDraft = {
  name: string
  slackChannelId: string
  sharedByFriendId: string
  locale: string
}

const fieldTypeOptions: Array<{ value: HarnessFormField['type']; label: string }> = [
  { value: 'text', label: '短文' },
  { value: 'textarea', label: '段落' },
  { value: 'email', label: 'メール' },
  { value: 'tel', label: '電話番号' },
  { value: 'number', label: '数値' },
  { value: 'radio', label: 'ラジオボタン' },
  { value: 'checkbox', label: 'チェックボックス' },
  { value: 'select', label: 'プルダウン' },
  { value: 'date', label: '日付' },
  { value: 'time', label: '時刻' },
]

const selectableTypes = new Set<HarnessFormField['type']>(['select', 'radio', 'checkbox'])

const importExample = `{
  "name": "海外旅行ヒアリングフォーム",
  "description": "Google Form のように公開URLを発行できる基本フォーム",
  "fields": [
    {
      "label": "代表者氏名",
      "type": "text",
      "required": true
    },
    {
      "label": "希望言語",
      "type": "radio",
      "required": true,
      "options": ["日本語", "English", "中文"],
      "allowOtherOption": true
    }
  ]
}`

const localeOptions = [
  { value: '', label: '既定' },
  { value: 'ja', label: '日本語' },
  { value: 'en', label: 'English' },
  { value: 'ko', label: '한국어' },
  { value: 'zh-TW', label: '繁體中文' },
]

const localizedTextDefaults: Record<string, {
  submitButtonLabel: string
  successTitle: string
  successDescription: string
}> = {
  ja: {
    submitButtonLabel: '送信',
    successTitle: '送信が完了しました',
    successDescription: 'ご回答ありがとうございます。内容を確認してご連絡します。',
  },
  en: {
    submitButtonLabel: 'Submit',
    successTitle: 'Your response has been submitted',
    successDescription: 'Thank you for your response. We will review it and get back to you.',
  },
  ko: {
    submitButtonLabel: '제출',
    successTitle: '제출이 완료되었습니다',
    successDescription: '응답해 주셔서 감사합니다. 내용을 확인한 뒤 연락드리겠습니다.',
  },
  'zh-TW': {
    submitButtonLabel: '送出',
    successTitle: '表單已送出',
    successDescription: '感謝您的填寫，我們會確認內容後再與您聯繫。',
  },
}

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

function getLocaleLabel(locale: string | null | undefined) {
  return localeOptions.find((option) => option.value === normalizeLocale(locale))?.label || '既定'
}

function createEmptyField(): HarnessFormField {
  return {
    name: '',
    label: '',
    type: 'text',
    required: false,
    options: [],
    placeholder: '',
    helperText: '',
    allowOtherOption: false,
    otherOptionLabel: 'その他',
  }
}

function createEmptyDraft(): FormDraft {
  const localizedTexts = getLocalizedTexts('ja')
  return {
    name: '',
    description: '',
    fields: [createEmptyField()],
    locale: 'ja',
    translationGroupId: '',
    submitButtonLabel: localizedTexts.submitButtonLabel,
    successTitle: localizedTexts.successTitle,
    successDescription: localizedTexts.successDescription,
    onSubmitTagId: '',
    onSubmitScenarioId: '',
    saveToMetadata: true,
    isActive: true,
  }
}

function createEmptyIssueDraft(): IssueDraft {
  return {
    name: '',
    slackChannelId: '',
    sharedByFriendId: '',
    locale: '',
  }
}

function formToDraft(form: HarnessForm): FormDraft {
  const locale = normalizeLocale(form.locale)
  const localizedTexts = getLocalizedTexts(locale)
  return {
    name: form.name,
    description: form.description ?? '',
    fields: form.fields.length > 0
      ? form.fields.map((field) => ({
        ...field,
        options: field.options ?? [],
        placeholder: field.placeholder ?? '',
        helperText: field.helperText ?? '',
        allowOtherOption: Boolean(field.allowOtherOption),
        otherOptionLabel: field.otherOptionLabel ?? 'その他',
      }))
      : [createEmptyField()],
    locale,
    translationGroupId: form.translationGroupId ?? '',
    submitButtonLabel: form.submitButtonLabel ?? localizedTexts.submitButtonLabel,
    successTitle: form.successTitle ?? localizedTexts.successTitle,
    successDescription: form.successDescription ?? localizedTexts.successDescription,
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
    case 'time':
      return 'time'
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
      helperText: '',
      allowOtherOption: false,
      otherOptionLabel: 'その他',
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
    pickValue(value, ['placeholder', 'example', 'プレースホルダ', '例']),
  )

  const helperText = stringifyValue(
    pickValue(value, ['helperText', 'description', 'help', 'hint', '説明', '補足']),
  )

  const options = normalizeOptions(
    pickValue(value, ['options', 'choices', 'items', 'values', '選択肢']),
  )

  const required = parseBoolean(
    pickValue(value, ['required', 'mandatory', 'isRequired', '必須']),
  )

  const allowOtherOption = parseBoolean(
    pickValue(value, ['allowOtherOption', 'allow_other_option', 'allowOther', 'other']),
  )

  return {
    name: stringifyValue(pickValue(value, ['name', 'key', 'id'])) || slugifyFieldName(label) || `field_${index + 1}`,
    label,
    type,
    required: required ?? false,
    placeholder,
    helperText,
    options,
    allowOtherOption: allowOtherOption ?? false,
    otherOptionLabel: stringifyValue(
      pickValue(value, ['otherOptionLabel', 'other_option_label', 'otherLabel']),
    ) || 'その他',
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

  const locale = stringifyValue(
    pickValue(parsed, ['locale', 'language', 'lang', '言語']),
  )
  if (locale) next.locale = normalizeLocale(locale)

  const submitButtonLabel = stringifyValue(
    pickValue(parsed, ['submitButtonLabel', 'submit_label', 'submitText', '送信文言']),
  )
  if (submitButtonLabel) next.submitButtonLabel = submitButtonLabel

  const successTitle = stringifyValue(
    pickValue(parsed, ['successTitle', 'thanksTitle', 'thankYouTitle', '完了タイトル']),
  )
  if (successTitle) next.successTitle = successTitle

  const successDescription = stringifyValue(
    pickValue(parsed, ['successDescription', 'thanksDescription', 'thankYouDescription', '完了説明']),
  )
  if (successDescription) next.successDescription = successDescription

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
    const helperText = field.helperText?.trim() ?? ''
    const allowOtherOption = selectableTypes.has(type) ? Boolean(field.allowOtherOption) : false

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

    if (placeholder) nextField.placeholder = placeholder
    if (helperText) nextField.helperText = helperText

    if (selectableTypes.has(type)) {
      const options = normalizeOptions(field.options)
      if (options.length === 0) {
        throw new Error(`${label} の選択肢を入力してください`)
      }
      nextField.options = options
      if (allowOtherOption) {
        nextField.allowOtherOption = true
        nextField.otherOptionLabel = field.otherOptionLabel?.trim() || 'その他'
      }
    }

    return nextField
  })

  return {
    name,
    description: draft.description.trim() || null,
    fields,
    locale: normalizeLocale(draft.locale),
    translationGroupId: draft.translationGroupId.trim() || null,
    submitButtonLabel: draft.submitButtonLabel.trim() || null,
    successTitle: draft.successTitle.trim() || null,
    successDescription: draft.successDescription.trim() || null,
    onSubmitTagId: draft.onSubmitTagId || null,
    onSubmitScenarioId: draft.onSubmitScenarioId || null,
    saveToMetadata: draft.saveToMetadata,
    isActive: draft.isActive,
  }
}

function copy(text: string) {
  return navigator.clipboard.writeText(text)
}

function FieldChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-[#f1ecfb] px-3 py-1 text-xs font-medium text-[#5f43b2]">
      {children}
    </span>
  )
}

function IconButton({
  label,
  onClick,
  children,
  danger = false,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
        danger
          ? 'border-red-200 bg-white text-red-500 hover:bg-red-50'
          : 'border-[#d7d0e9] bg-white text-slate-500 hover:bg-[#f6f3fd] hover:text-[#5f43b2]'
      }`}
    >
      {children}
    </button>
  )
}

export default function FormBuilder({ formId }: { formId?: string }) {
  const router = useRouter()

  const [draft, setDraft] = useState<FormDraft>(createEmptyDraft())
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(createEmptyDraft()))
  const [formMeta, setFormMeta] = useState<HarnessForm | null>(null)
  const [allForms, setAllForms] = useState<HarnessForm[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [issues, setIssues] = useState<SavedIssue[]>([])
  const [selectedFieldIndex, setSelectedFieldIndex] = useState(0)
  const [loading, setLoading] = useState(Boolean(formId))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [issueLoading, setIssueLoading] = useState(Boolean(formId))
  const [issueSaving, setIssueSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [importJson, setImportJson] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [issueDraft, setIssueDraft] = useState<IssueDraft>(createEmptyIssueDraft())
  const [translationLocale, setTranslationLocale] = useState('en')

  const loadOptions = useCallback(async () => {
    const [formsRes, tagsRes, scenariosRes] = await Promise.all([
      api.forms.list(),
      api.tags.list(),
      api.scenarios.list(),
    ])

    if (formsRes.success) setAllForms(formsRes.data)
    if (tagsRes.success) setTags(tagsRes.data)
    if (scenariosRes.success) setScenarios(scenariosRes.data)
  }, [])

  const loadForm = useCallback(async () => {
    if (!formId) {
      setLoading(false)
      setFormMeta(null)
      const nextDraft = createEmptyDraft()
      setDraft(nextDraft)
      setSavedSnapshot(JSON.stringify(nextDraft))
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await api.forms.get(formId)
      if (!res.success) {
        throw new Error('フォームが見つかりません')
      }

      const nextDraft = formToDraft(res.data)
      setFormMeta(res.data)
      setDraft(nextDraft)
      setSavedSnapshot(JSON.stringify(nextDraft))
    } catch {
      setError('フォーム情報の読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [formId])

  const loadIssues = useCallback(async () => {
    if (!formId) {
      setIssues([])
      setIssueLoading(false)
      return
    }

    setIssueLoading(true)
    try {
      const res = await api.forms.issues(formId)
      if (res.success) {
        setIssues(res.data)
      }
    } catch {
      setError('発行済みフォームの読み込みに失敗しました')
    } finally {
      setIssueLoading(false)
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

  useEffect(() => {
    void loadIssues()
  }, [loadIssues])

  const selectedQuestion = draft.fields[selectedFieldIndex] ?? null
  const questionCount = draft.fields.length
  const requiredCount = draft.fields.filter((field) => field.required).length

  const tagName = useMemo(
    () => tags.find((tag) => tag.id === draft.onSubmitTagId)?.name ?? null,
    [draft.onSubmitTagId, tags],
  )

  const scenarioName = useMemo(
    () => scenarios.find((scenario) => scenario.id === draft.onSubmitScenarioId)?.name ?? null,
    [draft.onSubmitScenarioId, scenarios],
  )

  const translationGroupId = useMemo(
    () => draft.translationGroupId || formMeta?.translationGroupId || formMeta?.id || formId || '',
    [draft.translationGroupId, formId, formMeta?.id, formMeta?.translationGroupId],
  )

  const translationForms = useMemo(
    () => allForms.filter((form) => (
      translationGroupId
        ? form.id === translationGroupId || form.translationGroupId === translationGroupId
        : form.id === formMeta?.id
    )),
    [allForms, formMeta?.id, translationGroupId],
  )

  const translationLocales = useMemo(
    () => new Set(translationForms.map((form) => normalizeLocale(form.locale))),
    [translationForms],
  )
  const availableTranslationOptions = useMemo(
    () => localeOptions.filter((option) => option.value && !translationLocales.has(option.value)),
    [translationLocales],
  )
  const isDirty = useMemo(
    () => JSON.stringify(draft) !== savedSnapshot,
    [draft, savedSnapshot],
  )
  const saveButtonLabel = saving ? '保存中...' : formId ? '変更を保存' : 'フォームを作成'

  useEffect(() => {
    if (!formId) return

    if (availableTranslationOptions.length === 0) {
      if (translationLocale !== '') {
        setTranslationLocale('')
      }
      return
    }

    if (!availableTranslationOptions.some((option) => option.value === translationLocale)) {
      setTranslationLocale(availableTranslationOptions[0].value)
    }
  }, [availableTranslationOptions, formId, translationLocale])

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

  const addField = (insertAfter?: number) => {
    setDraft((current) => {
      const nextFields = [...current.fields]
      const position = typeof insertAfter === 'number' ? insertAfter + 1 : nextFields.length
      nextFields.splice(position, 0, createEmptyField())
      return {
        ...current,
        fields: nextFields,
      }
    })
    setSelectedFieldIndex(typeof insertAfter === 'number' ? insertAfter + 1 : draft.fields.length)
  }

  const duplicateField = (index: number) => {
    setDraft((current) => {
      const field = current.fields[index]
      if (!field) return current
      const nextFields = [...current.fields]
      nextFields.splice(index + 1, 0, { ...field, name: '' })
      return { ...current, fields: nextFields }
    })
    setSelectedFieldIndex(index + 1)
  }

  const removeField = (index: number) => {
    setDraft((current) => {
      const nextFields = current.fields.length === 1
        ? [createEmptyField()]
        : current.fields.filter((_, fieldIndex) => fieldIndex !== index)

      return { ...current, fields: nextFields }
    })
    setSelectedFieldIndex((current) => Math.max(0, Math.min(current, draft.fields.length - 2)))
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
    setSelectedFieldIndex((current) => current + direction)
  }

  const updateOption = (fieldIndex: number, optionIndex: number, value: string) => {
    const options = [...(draft.fields[fieldIndex]?.options ?? [])]
    options[optionIndex] = value
    updateField(fieldIndex, { options })
  }

  const addOption = (fieldIndex: number) => {
    const options = [...(draft.fields[fieldIndex]?.options ?? []), '']
    updateField(fieldIndex, { options })
  }

  const removeOption = (fieldIndex: number, optionIndex: number) => {
    const options = (draft.fields[fieldIndex]?.options ?? []).filter((_, index) => index !== optionIndex)
    updateField(fieldIndex, { options })
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
      setSelectedFieldIndex(0)
      setSuccess('Codex JSON をフォーム編集画面に反映しました')
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'JSON の取り込みに失敗しました')
      setSuccess('')
    }
  }

  const handleLocaleChange = (nextLocale: string) => {
    const normalizedLocale = normalizeLocale(nextLocale)
    const localizedTexts = getLocalizedTexts(normalizedLocale)

    setDraft((current) => ({
      ...current,
      locale: normalizedLocale,
      submitButtonLabel: current.submitButtonLabel === getLocalizedTexts(current.locale).submitButtonLabel
        ? localizedTexts.submitButtonLabel
        : current.submitButtonLabel,
      successTitle: current.successTitle === getLocalizedTexts(current.locale).successTitle
        ? localizedTexts.successTitle
        : current.successTitle,
      successDescription: current.successDescription === getLocalizedTexts(current.locale).successDescription
        ? localizedTexts.successDescription
        : current.successDescription,
    }))
  }

  const handleCreateTranslation = async () => {
    if (!formId) return
    if (!translationLocale) {
      setError('追加できる言語はありません')
      return
    }

    const targetLocale = normalizeLocale(translationLocale)
    const sourceLocale = normalizeLocale(draft.locale)

    if (targetLocale === sourceLocale) {
      setError('同じ言語のフォームは追加できません')
      return
    }

    if (translationLocales.has(targetLocale)) {
      setError(`${getLocaleLabel(targetLocale)} はすでに追加されています`)
      return
    }

    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const sanitized = sanitizeDraft(draft)
      const groupId = translationGroupId || formId

      if (!formMeta?.translationGroupId) {
        const sourceUpdated = await api.forms.update(formId, {
          translationGroupId: groupId,
          locale: sourceLocale,
        })

        if (sourceUpdated.success) {
          const nextDraft = formToDraft(sourceUpdated.data)
          setFormMeta(sourceUpdated.data)
          setDraft(nextDraft)
          setSavedSnapshot(JSON.stringify(nextDraft))
          setAllForms((current) => {
            const others = current.filter((item) => item.id !== sourceUpdated.data.id)
            return [sourceUpdated.data, ...others]
          })
        }
      }

      const localizedTexts = getLocalizedTexts(targetLocale)
      const created = await api.forms.create({
        ...sanitized,
        name: `${sanitized.name} / ${getLocaleLabel(targetLocale)}`,
        locale: targetLocale,
        translationGroupId: groupId,
        submitButtonLabel: localizedTexts.submitButtonLabel,
        successTitle: localizedTexts.successTitle,
        successDescription: localizedTexts.successDescription,
      })

      if (!created.success) {
        throw new Error('翻訳フォームの複製に失敗しました')
      }

      router.push(`/forms/edit?id=${created.data.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '翻訳フォームの複製に失敗しました')
    } finally {
      setSaving(false)
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

        const nextDraft = formToDraft(res.data)
        setFormMeta(res.data)
        setDraft(nextDraft)
        setSavedSnapshot(JSON.stringify(nextDraft))
        setAllForms((current) => {
          const others = current.filter((item) => item.id !== res.data.id)
          return [res.data, ...others]
        })
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

  const handleIssueCreate = async () => {
    if (!formId) return

    setIssueSaving(true)
    setError('')
    setSuccess('')

    try {
      const res = await api.forms.createIssue(formId, {
        name: issueDraft.name || undefined,
        lineAccountId: null,
        slackChannelId: issueDraft.slackChannelId || null,
        sharedByFriendId: issueDraft.sharedByFriendId || null,
        locale: issueDraft.locale || null,
      })
      if (!res.success) throw new Error('チャンネル用フォームの発行に失敗しました')

      setIssues((current) => [res.data, ...current])
      setIssueDraft(createEmptyIssueDraft())
      setSuccess('チャンネル用フォームを発行しました')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'チャンネル用フォームの発行に失敗しました')
    } finally {
      setIssueSaving(false)
    }
  }

  const toggleIssueActive = async (issue: SavedIssue) => {
    try {
      const res = await api.forms.updateIssue(issue.id, { isActive: !issue.isActive })
      if (!res.success) throw new Error('更新に失敗しました')
      setIssues((current) => current.map((item) => item.id === issue.id ? res.data : item))
    } catch {
      setError('発行済みフォームの更新に失敗しました')
    }
  }

  if (loading) {
    return (
      <div className="rounded-[20px] border border-[#ded7ef] bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
        フォームを読み込んでいます...
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1080px]">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-[#d8d1ea] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-[#f7f4fd]"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.78 4.22a.75.75 0 010 1.06L7.06 10l4.72 4.72a.75.75 0 11-1.06 1.06l-5.25-5.25a.75.75 0 010-1.06l5.25-5.25a.75.75 0 011.06 0z" clipRule="evenodd" />
            </svg>
            一覧へ戻る
          </Link>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#6c52be]">
              {formId ? 'Edit form' : 'Create form'}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
              {formId ? 'フォーム編集' : '新規フォーム'}
            </h1>
          </div>
        </div>
      </div>

      <div className="sticky top-3 z-30 mb-6">
        <div className="rounded-[24px] border border-[#d8d1ea] bg-white/95 px-4 py-4 shadow-[0_12px_28px_rgba(103,58,183,0.12)] backdrop-blur sm:px-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                  saving
                    ? 'bg-[#ede7fb] text-[#5f43b2]'
                    : isDirty
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-emerald-100 text-emerald-700'
                }`}
              >
                {saving ? '保存中...' : isDirty ? '未保存の変更あり' : '保存済み'}
              </span>
              <FieldChip>{questionCount} 問</FieldChip>
              <FieldChip>必須 {requiredCount} 問</FieldChip>
              <FieldChip>{getLocaleLabel(draft.locale)}</FieldChip>
              <FieldChip>{draft.isActive ? '回答受付中' : '受付停止中'}</FieldChip>
              {tagName && <FieldChip>タグ: {tagName}</FieldChip>}
              {scenarioName && <FieldChip>シナリオ: {scenarioName}</FieldChip>}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={resetDraft}
                disabled={saving || !isDirty}
                className="rounded-full border border-[#d8d1ea] bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-[#f7f4fd] disabled:cursor-not-allowed disabled:opacity-60"
              >
                リセット
              </button>
              {formId && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting || saving}
                  className="rounded-full border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deleting ? '削除中...' : '削除'}
                </button>
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || (!isDirty && Boolean(formId))}
                className="rounded-full bg-[#673ab7] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#5d33aa] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saveButtonLabel}
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_72px]">
        <div className="space-y-5">
          <section className="overflow-hidden rounded-[28px] border border-[#dad3ed] bg-white shadow-[0_1px_3px_rgba(103,58,183,0.08)]">
            <div className="h-4 bg-[#673ab7]" />
            <div className="px-8 py-7">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <input
                    value={draft.name}
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="フォームのタイトル"
                    className="w-full border-b border-[#d8d1ea] bg-transparent pb-3 text-[32px] font-normal tracking-tight text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#673ab7]"
                  />
                  <textarea
                    value={draft.description}
                    onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                    placeholder="フォームの説明"
                    rows={3}
                    className="mt-4 w-full resize-none border-b border-transparent bg-transparent pb-2 text-sm leading-6 text-slate-600 outline-none placeholder:text-slate-400 focus:border-[#d8d1ea]"
                  />
                </div>

                <div className="w-full rounded-[24px] border border-[#e3def0] bg-[#faf8fe] p-5 lg:max-w-[280px]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#6c52be]">
                    Form language
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    この言語設定に合わせて送信ボタンや thanks 文面の既定値を切り替えます。
                  </p>
                  <select
                    value={draft.locale}
                    onChange={(event) => handleLocaleChange(event.target.value)}
                    className="mt-4 w-full rounded-2xl border border-[#ddd6f0] bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#673ab7]"
                  >
                    {localeOptions.filter((option) => option.value).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </section>

          {draft.fields.map((field, index) => {
            const selected = index === selectedFieldIndex
            const isSelectable = selectableTypes.has(field.type)

            return (
              <section
                key={`${field.name || 'new'}-${index}`}
                onClick={() => setSelectedFieldIndex(index)}
                className={`overflow-hidden rounded-[24px] border bg-white shadow-[0_1px_3px_rgba(103,58,183,0.08)] transition-all ${
                  selected
                    ? 'border-[#b8a8e8] ring-2 ring-[#ede7fb]'
                    : 'border-[#e3def0]'
                }`}
              >
                <div className={`h-2 ${selected ? 'bg-[#673ab7]' : 'bg-transparent'}`} />
                <div className="px-6 py-5">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="flex flex-1 flex-wrap items-start gap-3">
                      <input
                        value={field.label}
                        onChange={(event) => updateField(index, { label: event.target.value })}
                        placeholder="質問"
                        className="min-w-[260px] flex-1 rounded-2xl bg-[#f8f6fd] px-4 py-3 text-base text-slate-900 outline-none ring-1 ring-transparent transition focus:bg-white focus:ring-[#673ab7]"
                      />

                      <select
                        value={field.type}
                        onChange={(event) => updateField(index, {
                          type: normalizeFieldType(event.target.value),
                          options: selectableTypes.has(normalizeFieldType(event.target.value))
                            ? field.options ?? ['']
                            : [],
                          allowOtherOption: selectableTypes.has(normalizeFieldType(event.target.value))
                            ? field.allowOtherOption
                            : false,
                        })}
                        className="min-w-[180px] rounded-2xl border border-[#ddd6f0] bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#673ab7]"
                      >
                        {fieldTypeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-2">
                      <IconButton label="複製" onClick={() => duplicateField(index)}>
                        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v1h-1.5V4a.5.5 0 00-.5-.5H7a.5.5 0 00-.5.5v7a.5.5 0 00.5.5H8V13H7a2 2 0 01-2-2V4z" />
                          <path d="M9 8a2 2 0 012-2h4a2 2 0 012 2v6a2 2 0 01-2 2h-4a2 2 0 01-2-2V8z" />
                        </svg>
                      </IconButton>
                      <IconButton label="削除" onClick={() => removeField(index)} danger>
                        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M8.5 3a1 1 0 00-1 1V5H5a.75.75 0 000 1.5h10A.75.75 0 0015 5h-2.5V4a1 1 0 00-1-1h-3zM8 8a.75.75 0 011.5 0v5A.75.75 0 018 13V8zm3 0a.75.75 0 011.5 0v5A.75.75 0 0111 13V8z" clipRule="evenodd" />
                          <path d="M6.5 6.5h7l-.57 9.1a2 2 0 01-2 1.9H9.07a2 2 0 01-2-1.9L6.5 6.5z" />
                        </svg>
                      </IconButton>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <input
                      value={field.helperText ?? ''}
                      onChange={(event) => updateField(index, { helperText: event.target.value })}
                      placeholder="説明文"
                      className="rounded-2xl border border-[#ddd6f0] bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#673ab7]"
                    />
                    <input
                      value={field.placeholder ?? ''}
                      onChange={(event) => updateField(index, { placeholder: event.target.value })}
                      placeholder={field.type === 'date' ? '日付のプレースホルダは不要です' : 'プレースホルダ'}
                      disabled={field.type === 'date' || field.type === 'time' || field.type === 'radio' || field.type === 'checkbox' || field.type === 'select'}
                      className="rounded-2xl border border-[#ddd6f0] bg-white px-4 py-3 text-sm text-slate-700 outline-none transition disabled:cursor-not-allowed disabled:bg-[#f5f3fa] disabled:text-slate-400 focus:border-[#673ab7]"
                    />
                  </div>

                  {isSelectable && (
                    <div className="mt-5 space-y-3 rounded-[20px] bg-[#faf8fe] p-4">
                      {(field.options ?? []).map((option, optionIndex) => (
                        <div key={`${field.name || index}-option-${optionIndex}`} className="flex items-center gap-3">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs text-slate-500 ring-1 ring-[#ddd6f0]">
                            {field.type === 'checkbox' ? '□' : field.type === 'select' ? optionIndex + 1 : '○'}
                          </span>
                          <input
                            value={option}
                            onChange={(event) => updateOption(index, optionIndex, event.target.value)}
                            placeholder={`選択肢 ${optionIndex + 1}`}
                            className="flex-1 border-b border-[#dad2ee] bg-transparent px-1 py-2 text-sm text-slate-700 outline-none focus:border-[#673ab7]"
                          />
                          <button
                            type="button"
                            onClick={() => removeOption(index, optionIndex)}
                            className="rounded-full p-2 text-slate-400 transition hover:bg-white hover:text-red-500"
                          >
                            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path d="M5.22 5.22a.75.75 0 011.06 0L10 8.94l3.72-3.72a.75.75 0 111.06 1.06L11.06 10l3.72 3.72a.75.75 0 11-1.06 1.06L10 11.06l-3.72 3.72a.75.75 0 11-1.06-1.06L8.94 10 5.22 6.28a.75.75 0 010-1.06z" />
                            </svg>
                          </button>
                        </div>
                      ))}

                      <div className="flex flex-wrap items-center gap-3 pt-2">
                        <button
                          type="button"
                          onClick={() => addOption(index)}
                          className="rounded-full border border-[#d7d0e9] bg-white px-4 py-2 text-sm font-medium text-[#5f43b2] transition-colors hover:bg-[#f6f3fd]"
                        >
                          選択肢を追加
                        </button>
                        <label className="flex items-center gap-3 text-sm text-slate-600">
                          <input
                            type="checkbox"
                            checked={Boolean(field.allowOtherOption)}
                            onChange={(event) => updateField(index, { allowOtherOption: event.target.checked })}
                            className="h-4 w-4 rounded border-[#cbbbe9] text-[#673ab7] focus:ring-[#673ab7]"
                          />
                          その他入力を許可
                        </label>
                      </div>

                      {field.allowOtherOption && (
                        <input
                          value={field.otherOptionLabel ?? 'その他'}
                          onChange={(event) => updateField(index, { otherOptionLabel: event.target.value })}
                          placeholder="その他ラベル"
                          className="w-full rounded-2xl border border-[#ddd6f0] bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#673ab7]"
                        />
                      )}
                    </div>
                  )}

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#eee8fb] pt-4">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="rounded-full bg-[#f5f1fd] px-3 py-1 font-medium text-[#5f43b2]">
                        name: {field.name || slugifyFieldName(field.label) || `field_${index + 1}`}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => moveField(index, -1)}
                          disabled={index === 0}
                          className="rounded-full border border-[#d7d0e9] px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-[#f6f3fd] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          上へ
                        </button>
                        <button
                          type="button"
                          onClick={() => moveField(index, 1)}
                          disabled={index === draft.fields.length - 1}
                          className="rounded-full border border-[#d7d0e9] px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-[#f6f3fd] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          下へ
                        </button>
                      </div>

                      <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
                        必須
                        <button
                          type="button"
                          onClick={() => updateField(index, { required: !field.required })}
                          className={`relative inline-flex h-7 w-12 rounded-full transition ${
                            field.required ? 'bg-[#673ab7]' : 'bg-slate-300'
                          }`}
                        >
                          <span
                            className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${
                              field.required ? 'left-6' : 'left-1'
                            }`}
                          />
                        </button>
                      </label>
                    </div>
                  </div>
                </div>
              </section>
            )
          })}

          <button
            type="button"
            onClick={() => addField(selectedFieldIndex)}
            className="inline-flex items-center gap-2 rounded-full border border-dashed border-[#cbbbe9] bg-white px-5 py-3 text-sm font-medium text-[#5f43b2] transition-colors hover:bg-[#faf7fe]"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 4.25a.75.75 0 01.75.75v4.25H15a.75.75 0 010 1.5h-4.25V15a.75.75 0 01-1.5 0v-4.25H5a.75.75 0 010-1.5h4.25V5a.75.75 0 01.75-.75z" />
            </svg>
            質問を追加
          </button>

          <section className="rounded-[24px] border border-[#e3def0] bg-white p-6 shadow-[0_1px_3px_rgba(103,58,183,0.08)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">完了画面 / 多言語</h2>
                <p className="mt-1 text-sm text-slate-500">
                  上で選んだフォーム言語を基準に、送信ボタン文言や thanks 画面を言語ごとに調整できます。
                </p>
              </div>
              <div className="rounded-full bg-[#f5f1fd] px-3 py-1 text-xs font-medium text-[#5f43b2]">
                I18n
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-700">送信ボタン文言</span>
                <input
                  value={draft.submitButtonLabel}
                  onChange={(event) => setDraft((current) => ({ ...current, submitButtonLabel: event.target.value }))}
                  placeholder={getLocalizedTexts(draft.locale).submitButtonLabel}
                  className="w-full rounded-2xl border border-[#ddd6f0] bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#673ab7]"
                />
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-sm font-medium text-slate-700">完了タイトル</span>
                <input
                  value={draft.successTitle}
                  onChange={(event) => setDraft((current) => ({ ...current, successTitle: event.target.value }))}
                  placeholder={getLocalizedTexts(draft.locale).successTitle}
                  className="w-full rounded-2xl border border-[#ddd6f0] bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#673ab7]"
                />
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-sm font-medium text-slate-700">完了説明</span>
                <textarea
                  value={draft.successDescription}
                  onChange={(event) => setDraft((current) => ({ ...current, successDescription: event.target.value }))}
                  placeholder={getLocalizedTexts(draft.locale).successDescription}
                  rows={3}
                  className="w-full rounded-2xl border border-[#ddd6f0] bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#673ab7]"
                />
              </label>
            </div>

            {formId && (
              <div className="mt-6 rounded-[20px] bg-[#faf8fe] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">言語を追加</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      現在の設問構成を複製して別言語フォームを作ります。作成後にその言語の文面へ編集できます。
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {translationForms.map((form) => (
                      <Link
                        key={form.id}
                        href={`/forms/edit?id=${form.id}`}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          form.id === formId
                            ? 'border-[#b8a8e8] bg-[#ede7fb] text-[#5f43b2]'
                            : 'border-[#ddd6f0] bg-white text-slate-600 hover:bg-[#f6f3fd]'
                        }`}
                      >
                        {getLocaleLabel(form.locale)}
                      </Link>
                    ))}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <select
                    value={translationLocale}
                    onChange={(event) => setTranslationLocale(event.target.value)}
                    disabled={availableTranslationOptions.length === 0}
                    className="min-w-[200px] rounded-2xl border border-[#ddd6f0] bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#673ab7]"
                  >
                    {availableTranslationOptions.length > 0 ? (
                      <>
                        <optgroup label="追加可能">
                          {availableTranslationOptions.map((option) => (
                            <option
                              key={option.value}
                              value={option.value}
                            >
                              {option.label}
                            </option>
                          ))}
                        </optgroup>
                        {translationLocales.size > 0 && (
                          <optgroup label="作成済み（選択不可）">
                            {localeOptions
                              .filter((option) => option.value && translationLocales.has(option.value))
                              .map((option) => (
                                <option
                                  key={option.value}
                                  value={option.value}
                                  disabled
                                >
                                  {option.label}
                                </option>
                              ))}
                          </optgroup>
                        )}
                      </>
                    ) : (
                      <option value="">すべて作成済みです</option>
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={handleCreateTranslation}
                    disabled={saving || availableTranslationOptions.length === 0}
                    className="rounded-full border border-[#d7d0e9] bg-white px-4 py-2 text-sm font-medium text-[#5f43b2] transition-colors hover:bg-[#f6f3fd] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    言語フォームを複製
                  </button>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  グレーアウトされる言語は、すでに作成済みです。右上の言語タブからそのフォームをそのまま編集できます。
                </p>
              </div>
            )}
          </section>

          <section className="rounded-[24px] border border-[#e3def0] bg-white p-6 shadow-[0_1px_3px_rgba(103,58,183,0.08)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">回答後の処理</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Tag / Scenario / metadata 保存などの routing 設定です。
                </p>
              </div>
              <div className="rounded-full bg-[#f5f1fd] px-3 py-1 text-xs font-medium text-[#5f43b2]">
                Settings
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-700">送信時タグ</span>
                <select
                  value={draft.onSubmitTagId}
                  onChange={(event) => setDraft((current) => ({ ...current, onSubmitTagId: event.target.value }))}
                  className="w-full rounded-2xl border border-[#ddd6f0] bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#673ab7]"
                >
                  <option value="">なし</option>
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-700">送信時シナリオ</span>
                <select
                  value={draft.onSubmitScenarioId}
                  onChange={(event) => setDraft((current) => ({ ...current, onSubmitScenarioId: event.target.value }))}
                  className="w-full rounded-2xl border border-[#ddd6f0] bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#673ab7]"
                >
                  <option value="">なし</option>
                  {scenarios.map((scenario) => (
                    <option key={scenario.id} value={scenario.id}>
                      {scenario.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="flex items-center justify-between rounded-2xl border border-[#ece5fb] bg-[#faf8fe] px-4 py-4">
                <div>
                  <p className="text-sm font-medium text-slate-800">友だち metadata に保存</p>
                  <p className="mt-1 text-xs text-slate-500">LINE 文脈のユーザーと紐づいた場合のみ保存</p>
                </div>
                <input
                  type="checkbox"
                  checked={draft.saveToMetadata}
                  onChange={(event) => setDraft((current) => ({ ...current, saveToMetadata: event.target.checked }))}
                  className="h-4 w-4 rounded border-[#cbbbe9] text-[#673ab7] focus:ring-[#673ab7]"
                />
              </label>

              <label className="flex items-center justify-between rounded-2xl border border-[#ece5fb] bg-[#faf8fe] px-4 py-4">
                <div>
                  <p className="text-sm font-medium text-slate-800">回答受付を有効化</p>
                  <p className="mt-1 text-xs text-slate-500">停止すると公開URLから送信できません</p>
                </div>
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))}
                  className="h-4 w-4 rounded border-[#cbbbe9] text-[#673ab7] focus:ring-[#673ab7]"
                />
              </label>
            </div>
          </section>

          <section className="rounded-[24px] border border-[#e3def0] bg-white p-6 shadow-[0_1px_3px_rgba(103,58,183,0.08)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Codex JSON を取り込む</h2>
                <p className="mt-1 text-sm text-slate-500">
                  `fields` 配列だけでも、フォーム全体オブジェクトでも反映できます。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setImportOpen((current) => !current)}
                className="rounded-full border border-[#d7d0e9] bg-white px-4 py-2 text-sm font-medium text-[#5f43b2] transition-colors hover:bg-[#f6f3fd]"
              >
                {importOpen ? '閉じる' : '開く'}
              </button>
            </div>

            {importOpen && (
              <div className="mt-5 space-y-4">
                <textarea
                  value={importJson}
                  onChange={(event) => setImportJson(event.target.value)}
                  placeholder={importExample}
                  rows={14}
                  className="w-full rounded-3xl border border-[#ddd6f0] bg-[#faf8fe] px-5 py-4 font-mono text-[13px] leading-6 text-slate-700 outline-none transition focus:border-[#673ab7]"
                />
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleImport}
                    className="rounded-full bg-[#673ab7] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#5d33aa]"
                  >
                    JSON を反映
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportJson(importExample)}
                    className="rounded-full border border-[#d7d0e9] bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-[#f6f3fd]"
                  >
                    サンプルを入れる
                  </button>
                </div>
              </div>
            )}
          </section>

          <section id="issue-publisher" className="rounded-[24px] border border-[#e3def0] bg-white p-6 shadow-[0_1px_3px_rgba(103,58,183,0.08)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">チャンネル用フォームを発行</h2>
                <p className="mt-1 text-sm text-slate-500">
                  発行した URL には `slackChannelId` と `sharedByFriendId` を保存しておけます。配布は公開 URL をそのまま使います。
                </p>
              </div>
              <div className="rounded-full bg-[#f5f1fd] px-3 py-1 text-xs font-medium text-[#5f43b2]">
                Issue Links
              </div>
            </div>

            {!formId ? (
              <div className="mt-5 rounded-2xl border border-[#ece5fb] bg-[#faf8fe] px-4 py-4 text-sm text-slate-600">
                先にフォームを保存すると、チャンネルに紐づいた URL を発行できます。
              </div>
            ) : (
              <>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <input
                    value={issueDraft.name}
                    onChange={(event) => setIssueDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="案件名や配布用途"
                    className="rounded-2xl border border-[#ddd6f0] bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#673ab7]"
                  />
                  <input
                    value={issueDraft.slackChannelId}
                    onChange={(event) => setIssueDraft((current) => ({ ...current, slackChannelId: event.target.value }))}
                    placeholder="Slack Channel ID"
                    className="rounded-2xl border border-[#ddd6f0] bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#673ab7]"
                  />
                  <input
                    value={issueDraft.sharedByFriendId}
                    onChange={(event) => setIssueDraft((current) => ({ ...current, sharedByFriendId: event.target.value }))}
                    placeholder="sharedBy Friend ID"
                    className="rounded-2xl border border-[#ddd6f0] bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#673ab7]"
                  />
                  <select
                    value={issueDraft.locale}
                    onChange={(event) => setIssueDraft((current) => ({ ...current, locale: event.target.value }))}
                    className="rounded-2xl border border-[#ddd6f0] bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#673ab7]"
                  >
                    {localeOptions.map((locale) => (
                      <option key={locale.value || 'default'} value={locale.value}>
                        {locale.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleIssueCreate}
                    disabled={issueSaving}
                    className="rounded-full bg-[#673ab7] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#5d33aa] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {issueSaving ? '発行中...' : 'チャンネル用フォームを発行'}
                  </button>
                  <p className="text-xs text-slate-500">
                    `slackChannelId` 未入力なら C0AL6RG7V9Q に落ちます。
                  </p>
                </div>

                <div className="mt-6 space-y-4">
                  {issueLoading ? (
                    <div className="rounded-2xl border border-[#ece5fb] bg-[#faf8fe] px-4 py-4 text-sm text-slate-500">
                      発行済みフォームを読み込んでいます...
                    </div>
                  ) : issues.length === 0 ? (
                    <div className="rounded-2xl border border-[#ece5fb] bg-[#faf8fe] px-4 py-4 text-sm text-slate-500">
                      発行済みフォームはまだありません。
                    </div>
                  ) : (
                    issues.map((issue) => (
                      <div key={issue.id} className="rounded-[20px] border border-[#ebe5fa] bg-[#fcfbff] p-4">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate text-sm font-semibold text-slate-900">{issue.name}</h3>
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${issue.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                                {issue.isActive ? '有効' : '無効'}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                              <span className="rounded-full bg-white px-3 py-1 ring-1 ring-[#ece5fb]">
                                Channel: {issue.slackChannelId || 'C0AL6RG7V9Q'}
                              </span>
                              {issue.sharedByFriendId && (
                                <span className="rounded-full bg-white px-3 py-1 ring-1 ring-[#ece5fb]">
                                  sharedBy: {issue.sharedByFriendId}
                                </span>
                              )}
                              {issue.locale && (
                                <span className="rounded-full bg-white px-3 py-1 ring-1 ring-[#ece5fb]">
                                  locale: {issue.locale}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void copy(issue.publicUrl)}
                              className="rounded-full border border-[#d7d0e9] bg-white px-4 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-[#f6f3fd]"
                            >
                              公開URLをコピー
                            </button>
                            <button
                              type="button"
                              onClick={() => void toggleIssueActive(issue)}
                              className="rounded-full border border-[#d7d0e9] bg-white px-4 py-2 text-xs font-medium text-[#5f43b2] transition-colors hover:bg-[#f6f3fd]"
                            >
                              {issue.isActive ? '無効化' : '再有効化'}
                            </button>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3">
                          <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-[#ece5fb]">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Public URL</p>
                            <p className="mt-1 break-all text-sm text-slate-700">{issue.publicUrl}</p>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </section>
        </div>

        <aside className="hidden xl:block">
          <div className="sticky top-24 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => addField(selectedFieldIndex)}
              className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-[#d7d0e9] bg-white text-[#5f43b2] shadow-sm transition hover:bg-[#f6f3fd]"
              aria-label="質問を追加"
            >
              <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10 4.25a.75.75 0 01.75.75v4.25H15a.75.75 0 010 1.5h-4.25V15a.75.75 0 01-1.5 0v-4.25H5a.75.75 0 010-1.5h4.25V5a.75.75 0 01.75-.75z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => duplicateField(selectedFieldIndex)}
              disabled={!selectedQuestion}
              className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-[#d7d0e9] bg-white text-[#5f43b2] shadow-sm transition hover:bg-[#f6f3fd] disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="選択中の質問を複製"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v1h-1.5V4a.5.5 0 00-.5-.5H7a.5.5 0 00-.5.5v7a.5.5 0 00.5.5H8V13H7a2 2 0 01-2-2V4z" />
                <path d="M9 8a2 2 0 012-2h4a2 2 0 012 2v6a2 2 0 01-2 2h-4a2 2 0 01-2-2V8z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-[#d7d0e9] bg-white text-[#5f43b2] shadow-sm transition hover:bg-[#f6f3fd]"
              aria-label="JSON import を開く"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3.75 4A1.75 1.75 0 015.5 2.25h2.879c.464 0 .91.184 1.238.512l.621.621c.328.328.773.512 1.237.512H14.5A1.75 1.75 0 0116.25 5.75v8.75A3.25 3.25 0 0113 17.75H7A3.25 3.25 0 013.75 14.5V4zm3.47 3.22a.75.75 0 10-1.06 1.06L7.94 10l-1.78 1.72a.75.75 0 101.04 1.08l2.34-2.25a.75.75 0 000-1.08L7.22 7.22zm5.56 0a.75.75 0 011.06 1.06L12.06 10l1.78 1.72a.75.75 0 11-1.04 1.08l-2.34-2.25a.75.75 0 010-1.08l2.34-2.25z" clipRule="evenodd" />
              </svg>
            </button>
            {formId && (
              <a
                href="#issue-publisher"
                className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-[#d7d0e9] bg-white text-[#5f43b2] shadow-sm transition hover:bg-[#f6f3fd]"
                aria-label="チャンネル用フォーム発行へ移動"
              >
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M3 5.75A2.75 2.75 0 015.75 3h4.19a2.75 2.75 0 011.945.805l.31.31a2.75 2.75 0 001.945.805h.11A2.75 2.75 0 0117 7.67v6.58A2.75 2.75 0 0114.25 17h-8.5A2.75 2.75 0 013 14.25v-8.5zm5.47 2.72a.75.75 0 10-1.06 1.06L8.94 11H6.75a.75.75 0 000 1.5h2.19l-1.53 1.47a.75.75 0 101.04 1.08l2.81-2.7a.75.75 0 000-1.08L8.47 8.47zm5.78 5.28a.75.75 0 000-1.5h-2.5a.75.75 0 000 1.5h2.5z" />
                </svg>
              </a>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
