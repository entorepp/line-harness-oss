'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ClipboardEvent, KeyboardEvent } from 'react'
import { api, fetchApi, type ApiScheduledMessage, type ChannelType } from '@/lib/api'

type AttachmentDraft = {
  file: File
  previewUrl: string
  isImage: boolean
}

type EmojiPreset = {
  key: string
  label: string
  value: string
  aliases: string[]
}

const EMOJI_STORAGE_KEY = 'line-crm-chat-emoji-presets'

const DEFAULT_EMOJI_PRESETS: EmojiPreset[] = [
  { key: 'plane', label: '飛行機', value: '✈️', aliases: ['airplane', 'plane', 'flight', 'travel_plane', 'fly', '飛行機'] },
  { key: 'hotel', label: 'ホテル', value: '🏨', aliases: ['hotel', 'stay', 'lodging', 'room', 'checkin', 'ホテル'] },
  { key: 'taxi', label: 'タクシー', value: '🚕', aliases: ['taxi', 'cab', 'pickup', 'pick_up', 'タクシー'] },
  { key: 'smile', label: '笑顔', value: '😊', aliases: ['smile', 'smiley', 'happy', 'grin', '笑顔'] },
  { key: 'calendar', label: '日程', value: '📅', aliases: ['calendar', 'schedule', 'date', '日程'] },
  { key: 'clock', label: '時間', value: '🕒', aliases: ['clock', 'time', 'alarm', '時間'] },
  { key: 'pin', label: '場所', value: '📍', aliases: ['location', 'pin', 'place', '場所'] },
  { key: 'check', label: '確認', value: '✅', aliases: ['check', 'done', 'ok', '確認'] },
]

function formatDatetime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function defaultScheduleValue(): string {
  const date = new Date(Date.now() + 10 * 60 * 1000)
  date.setSeconds(0, 0)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}`
}

function toJstScheduleValue(value: string): string | null {
  if (!value) return null
  return `${value}:00.000+09:00`
}

function toDatetimeLocalValue(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function parseEmojiAliases(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.replace(/^:+|:+$/g, '').toLowerCase()),
    ),
  )
}

function normalizeEmojiPresets(raw: unknown): EmojiPreset[] {
  if (!Array.isArray(raw)) return []

  return raw.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []

    const preset = item as Record<string, unknown>
    const label = typeof preset.label === 'string' ? preset.label.trim() : ''
    const value = typeof preset.value === 'string' ? preset.value.trim() : ''
    const aliases = parseEmojiAliases(Array.isArray(preset.aliases) ? preset.aliases.join(',') : '')

    if (!label || !value) return []

    return [{
      key: typeof preset.key === 'string' && preset.key.trim() ? preset.key : `custom-${index}`,
      label,
      value,
      aliases,
    }]
  })
}

function replaceEmojiShortcodes(value: string, presets: EmojiPreset[]): string {
  if (!value.includes(':')) return value

  const aliasMap = new Map<string, string>()
  for (const preset of presets) {
    for (const alias of preset.aliases) {
      aliasMap.set(alias.toLowerCase(), preset.value)
    }
  }

  return value.replace(/:([^:\s]+):/g, (match, alias) => aliasMap.get(String(alias).toLowerCase()) ?? match)
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null

  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // ignore
  }

  return null
}

function summarizeScheduledMessage(item: ApiScheduledMessage): string {
  if (item.messageType === 'text') {
    return item.content.trim() || 'テキストメッセージ'
  }

  if (item.messageType === 'sticker') {
    return 'スタンプ'
  }

  if (item.messageType === 'image') {
    return '画像'
  }

  if (item.messageType === 'file') {
    const metadata = parseJsonObject(item.metadata)
    if (typeof metadata?.fileName === 'string' && metadata.fileName.trim()) {
      return metadata.fileName
    }
    return 'ファイル'
  }

  return item.messageType
}

function scheduledStatusCopy(status: ApiScheduledMessage['status']): string {
  switch (status) {
    case 'scheduled':
      return '予約送信設定中'
    case 'sending':
      return '送信中'
    case 'failed':
      return '送信失敗'
    case 'cancelled':
      return 'キャンセル済み'
    case 'sent':
      return '送信済み'
    default:
      return status
  }
}

function scheduledStatusClassName(status: ApiScheduledMessage['status']): string {
  switch (status) {
    case 'scheduled':
      return 'bg-emerald-50 text-emerald-700'
    case 'sending':
      return 'bg-amber-50 text-amber-700'
    case 'failed':
      return 'bg-rose-50 text-rose-700'
    default:
      return 'bg-slate-100 text-slate-600'
  }
}

export default function ChatComposer({
  friendId,
  chatId,
  channelType,
  onSent,
  onError,
}: {
  friendId: string
  chatId?: string | null
  channelType?: ChannelType
  onSent?: () => void | Promise<void>
  onError?: (message: string) => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [messageContent, setMessageContent] = useState('')
  const [attachment, setAttachment] = useState<AttachmentDraft | null>(null)
  const [sending, setSending] = useState(false)
  const [reserveMode, setReserveMode] = useState(false)
  const [scheduledAt, setScheduledAt] = useState('')
  const [customEmojiPresets, setCustomEmojiPresets] = useState<EmojiPreset[]>([])
  const [emojiPanelOpen, setEmojiPanelOpen] = useState(false)
  const [emojiEditorOpen, setEmojiEditorOpen] = useState(false)
  const [emojiDraftValue, setEmojiDraftValue] = useState('')
  const [emojiDraftLabel, setEmojiDraftLabel] = useState('')
  const [emojiDraftAliases, setEmojiDraftAliases] = useState('')
  const [scheduledMessages, setScheduledMessages] = useState<ApiScheduledMessage[]>([])
  const [cancellingScheduledId, setCancellingScheduledId] = useState<string | null>(null)
  const [editingScheduledId, setEditingScheduledId] = useState<string | null>(null)
  const [editingScheduledAt, setEditingScheduledAt] = useState('')
  const [savingScheduledId, setSavingScheduledId] = useState<string | null>(null)
  const isWhatsApp = channelType === 'whatsapp'
  const isKakao = channelType === 'kakao'
  const isTextOnlyChannel = isWhatsApp || isKakao
  const allEmojiPresets = [...DEFAULT_EMOJI_PRESETS, ...customEmojiPresets]

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = '0px'
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, 56), 320)
    textarea.style.height = `${nextHeight}px`
  }, [messageContent])

  useEffect(() => {
    return () => {
      if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
    }
  }, [attachment])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(EMOJI_STORAGE_KEY)
      setCustomEmojiPresets(normalizeEmojiPresets(raw ? JSON.parse(raw) : []))
    } catch {
      setCustomEmojiPresets([])
    }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(EMOJI_STORAGE_KEY, JSON.stringify(customEmojiPresets))
    } catch {
      // ignore storage failures
    }
  }, [customEmojiPresets])

  useEffect(() => {
    if (!isTextOnlyChannel) return
    clearAttachment()
  }, [isTextOnlyChannel])

  const loadScheduledMessages = useCallback(async (silent = false) => {
    try {
      const response = await api.friends.listScheduledMessages(friendId)
      if (response.success) {
        setScheduledMessages(response.data)
      }
    } catch {
      if (!silent) {
        setScheduledMessages([])
      }
    }
  }, [friendId])

  useEffect(() => {
    void loadScheduledMessages()

    const interval = window.setInterval(() => {
      void loadScheduledMessages(true)
    }, 15000)

    return () => window.clearInterval(interval)
  }, [loadScheduledMessages])

  function clearAttachment() {
    if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
    setAttachment(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function insertTextAtCursor(value: string) {
    const textarea = textareaRef.current
    if (!textarea) {
      setMessageContent((current) => `${current}${value}`)
      return
    }

    const start = textarea.selectionStart ?? messageContent.length
    const end = textarea.selectionEnd ?? messageContent.length
    const nextValue = `${messageContent.slice(0, start)}${value}${messageContent.slice(end)}`
    const cursor = start + value.length

    setMessageContent(nextValue)
    window.requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(cursor, cursor)
    })
  }

  function applyQuickInsert(value: string) {
    insertTextAtCursor(value)
  }

  function resetEmojiDraft() {
    setEmojiDraftValue('')
    setEmojiDraftLabel('')
    setEmojiDraftAliases('')
  }

  function handleAddEmojiPreset() {
    const value = emojiDraftValue.trim()
    const label = emojiDraftLabel.trim()
    const aliases = parseEmojiAliases(emojiDraftAliases)

    if (!value || !label) {
      onError?.('絵文字と名前を入れてください。')
      return
    }

    setCustomEmojiPresets((current) => [
      ...current,
      {
        key: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label,
        value,
        aliases,
      },
    ])
    resetEmojiDraft()
    onError?.('')
  }

  function removeCustomEmojiPreset(key: string) {
    setCustomEmojiPresets((current) => current.filter((preset) => preset.key !== key))
  }

  function setAttachmentFromFile(file: File) {
    if (isTextOnlyChannel) {
      onError?.(`${isKakao ? 'KakaoTalk' : 'WhatsApp'} では現在ファイル・画像送信に未対応です。`)
      return
    }

    if (file.size > 25 * 1024 * 1024) {
      onError?.('ファイルサイズは25MB以下にしてください。')
      return
    }

    clearAttachment()

    const isImage = file.type.startsWith('image/')
    const previewUrl = isImage ? URL.createObjectURL(file) : ''
    setAttachment({ file, previewUrl, isImage })
  }

  async function uploadAttachment(): Promise<Record<string, string>> {
    if (!attachment) {
      throw new Error('添付ファイルがありません。')
    }

    const formData = new FormData()
    formData.append('file', attachment.file)

    const uploadRes = await fetchApi<{
      success: boolean
      data?: {
        url: string
        fileName: string
        fileSizeFormatted: string
        isImage: boolean
        icon: string
      }
      error?: string
    }>('/api/upload', {
      method: 'POST',
      body: formData,
      rawBody: true,
    })

    if (!uploadRes.success || !uploadRes.data) {
      throw new Error(uploadRes.error || 'ファイルのアップロードに失敗しました。')
    }

    const { url, fileName, fileSizeFormatted, isImage, icon } = uploadRes.data
    if (isImage) {
      return {
        messageType: 'image',
        content: JSON.stringify({
          url,
          originalContentUrl: url,
          previewImageUrl: url,
        }),
      }
    }

    return {
      messageType: 'file',
      content: url,
      fileName,
      fileSize: fileSizeFormatted,
      fileIcon: icon,
    }
  }

  async function sendPayloads(schedule: boolean) {
    onError?.('')

    const scheduledAtValue = schedule ? toJstScheduleValue(scheduledAt) : null
    if (schedule && !scheduledAtValue) {
      throw new Error('予約日時を指定してください。')
    }

    const payloads: Record<string, string | null | undefined>[] = []

    if (attachment) {
      payloads.push(await uploadAttachment())
    }

    const normalizedMessage = replaceEmojiShortcodes(messageContent.trim(), allEmojiPresets)
    if (normalizedMessage.trim()) {
      payloads.push({
        messageType: 'text',
        content: normalizedMessage.trim(),
      })
    }

    if (!payloads.length) {
      throw new Error('送信内容がありません。')
    }

    for (const payload of payloads) {
      let response:
        | { success?: boolean; error?: string }
        | undefined

      if (schedule) {
        payload.scheduledAt = scheduledAtValue
      }

      if (chatId) {
        response = await api.chats.send(chatId, payload)
      } else {
        response = await api.friends.sendMessage(friendId, payload)
      }

      if (!response?.success) {
        throw new Error(response?.error || (schedule ? '予約登録に失敗しました。' : '送信に失敗しました。'))
      }
    }
  }

  async function handleSubmit(schedule: boolean) {
    setSending(true)

    try {
      await sendPayloads(schedule)

      setMessageContent('')
      clearAttachment()
      setReserveMode(false)
      setScheduledAt('')

      await loadScheduledMessages(true)

      await onSent?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : '送信に失敗しました。'
      onError?.(message)
    } finally {
      setSending(false)
    }
  }

  async function handleCancelScheduledMessage(id: string) {
    setCancellingScheduledId(id)
    onError?.('')

    try {
      await api.scheduledMessages.cancel(id)
      await loadScheduledMessages(true)
      await onSent?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : '予約送信の取消に失敗しました。'
      onError?.(message)
    } finally {
      setCancellingScheduledId(null)
    }
  }

  function beginEditScheduledMessage(item: ApiScheduledMessage) {
    setEditingScheduledId(item.id)
    setEditingScheduledAt(toDatetimeLocalValue(item.scheduledAt))
  }

  function stopEditScheduledMessage() {
    setEditingScheduledId(null)
    setEditingScheduledAt('')
  }

  async function handleUpdateScheduledMessage(id: string) {
    const nextScheduledAt = toJstScheduleValue(editingScheduledAt)
    if (!nextScheduledAt) {
      onError?.('予約日時を指定してください。')
      return
    }

    setSavingScheduledId(id)
    onError?.('')

    try {
      const response = await api.scheduledMessages.update(id, { scheduledAt: nextScheduledAt })
      if (!response.success) {
        throw new Error(response.error || '予約時刻の変更に失敗しました。')
      }

      await loadScheduledMessages(true)
      stopEditScheduledMessage()
      await onSent?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : '予約時刻の変更に失敗しました。'
      onError?.(message)
    } finally {
      setSavingScheduledId(null)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void handleSubmit(reserveMode)
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const fileItem = Array.from(event.clipboardData.items).find((item) => item.kind === 'file')
    if (fileItem) {
      const file = fileItem.getAsFile()
      if (file) {
        event.preventDefault()
        if (isTextOnlyChannel) {
          onError?.(`${isKakao ? 'KakaoTalk' : 'WhatsApp'} では現在ファイル・画像送信に未対応です。`)
          return
        }
        setAttachmentFromFile(file)
        return
      }
    }

    const pastedText = event.clipboardData.getData('text/plain')
    if (!pastedText) return

    const normalized = replaceEmojiShortcodes(pastedText, allEmojiPresets)
    if (normalized !== pastedText) {
      event.preventDefault()
      insertTextAtCursor(normalized)
    }
  }

  const isExpanded =
    messageContent.length > 160 ||
    messageContent.split('\n').length > 4 ||
    reserveMode ||
    emojiPanelOpen ||
    emojiEditorOpen

  return (
    <div className="space-y-3 rounded-[32px] border border-[#DDE4E8] bg-white p-3 shadow-[0_16px_50px_rgba(28,39,60,0.08)]">
      {(emojiPanelOpen || emojiEditorOpen) && (
        <div className="rounded-3xl border border-gray-200 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-gray-900">絵文字ショートカット</p>
              <p className="mt-1 text-[11px] text-gray-500">`:hotel:` `:taxi:` `:airplane:` `:smile:` は貼り付け時と送信前に変換します。</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setEmojiPanelOpen(true)
                  setEmojiEditorOpen((current) => !current)
                }}
                className="rounded-full bg-[#F2F5F7] px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-[#E8EDF0]"
              >
                {emojiEditorOpen ? '登録を閉じる' : '絵文字を登録'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmojiPanelOpen(false)
                  setEmojiEditorOpen(false)
                }}
                className="rounded-full bg-[#F2F5F7] px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-[#E8EDF0]"
              >
                閉じる
              </button>
            </div>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {allEmojiPresets.map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => applyQuickInsert(preset.value)}
                className="whitespace-nowrap rounded-full border border-gray-200 bg-[#F7F9FB] px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
              >
                {preset.value} {preset.label}
              </button>
            ))}
          </div>

          {emojiEditorOpen && (
            <>
              <div className="mt-4 grid gap-3 md:grid-cols-[100px_1fr_1.4fr_auto]">
                <input
                  type="text"
                  value={emojiDraftValue}
                  onChange={(event) => setEmojiDraftValue(event.target.value)}
                  placeholder="😊"
                  className="rounded-2xl border border-gray-200 px-3 py-2 text-sm focus:border-[#06C755] focus:outline-none"
                />
                <input
                  type="text"
                  value={emojiDraftLabel}
                  onChange={(event) => setEmojiDraftLabel(event.target.value)}
                  placeholder="表示名"
                  className="rounded-2xl border border-gray-200 px-3 py-2 text-sm focus:border-[#06C755] focus:outline-none"
                />
                <input
                  type="text"
                  value={emojiDraftAliases}
                  onChange={(event) => setEmojiDraftAliases(event.target.value)}
                  placeholder="shortcode 例: hotel, room, stay"
                  className="rounded-2xl border border-gray-200 px-3 py-2 text-sm focus:border-[#06C755] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddEmojiPreset}
                  className="rounded-full px-4 py-2 text-sm font-medium text-white shadow-sm"
                  style={{ backgroundColor: '#06C755' }}
                >
                  登録
                </button>
              </div>

              {customEmojiPresets.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {customEmojiPresets.map((preset) => (
                    <div
                      key={preset.key}
                      className="flex items-center gap-2 rounded-full border border-gray-200 bg-[#F7F9FB] px-3 py-2 text-xs text-gray-600"
                    >
                      <span className="font-medium">{preset.value} {preset.label}</span>
                      <span className="text-gray-400">
                        {preset.aliases.map((alias) => `:${alias}:`).join(' / ') || 'alias なし'}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeCustomEmojiPreset(preset.key)}
                        className="rounded-full bg-white px-2 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-rose-50 hover:text-rose-600"
                      >
                        削除
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {attachment && (
        <div className="relative rounded-3xl border border-gray-200 bg-[#F9FBFC] p-3">
          {attachment.isImage ? (
            <img
              src={attachment.previewUrl}
              alt="添付画像プレビュー"
              className="max-h-40 rounded-2xl"
            />
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-2xl">{'\u{1F4CE}'}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{attachment.file.name}</p>
                <p className="text-xs text-gray-500">{formatFileSize(attachment.file.size)}</p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={clearAttachment}
            className="absolute right-3 top-3 rounded-full bg-black/65 px-2 py-1 text-xs text-white"
          >
            削除
          </button>
        </div>
      )}

      <div className={`rounded-[28px] border border-gray-200 bg-[#F7F9FB] p-2.5 transition-all ${isExpanded ? 'shadow-sm' : ''}`}>
        <div className="flex flex-wrap items-end gap-2 md:flex-nowrap">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.zip,.mp4,.mp3,.wav,.m4a"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) setAttachmentFromFile(file)
            }}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isTextOnlyChannel}
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm transition-colors hover:bg-[#F1F5F8] disabled:cursor-not-allowed disabled:opacity-50"
            title={isTextOnlyChannel ? `${isKakao ? 'KakaoTalk' : 'WhatsApp'} では現在添付未対応` : '画像やファイルを追加'}
          >
            ＋
          </button>

          <textarea
            ref={textareaRef}
            value={messageContent}
            onChange={(event) => setMessageContent(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              isTextOnlyChannel
                ? 'メッセージを入力。:hotel: や :taxi: を貼ると絵文字に変換します。'
                : 'メッセージを入力。:hotel: や :taxi: を貼ると絵文字に変換します。画像貼り付けやPDF添付にも対応しています。'
            }
            className="min-h-[56px] min-w-0 flex-1 basis-[240px] resize-none rounded-[22px] bg-transparent px-3 py-3 text-sm text-gray-900 outline-none"
            style={{ maxHeight: 320 }}
          />

          <div className="ml-auto flex w-full flex-col items-stretch gap-2 md:w-auto md:items-end">
            {reserveMode && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-700">
                  予約送信設定中
                </span>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(event) => setScheduledAt(event.target.value)}
                  className="min-w-[180px] rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs text-gray-900 focus:border-[#06C755] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    setReserveMode(false)
                    setScheduledAt('')
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-emerald-200 bg-white text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
                  aria-label="予約設定を閉じる"
                >
                  ×
                </button>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEmojiPanelOpen((current) => {
                    const next = !current
                    if (!next) setEmojiEditorOpen(false)
                    return next
                  })
                }}
                disabled={sending}
                aria-pressed={emojiPanelOpen}
                aria-label="絵文字ショートカットを表示"
                title="絵文字ショートカット"
                className={`flex h-10 w-10 items-center justify-center rounded-full border text-sm shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  emojiPanelOpen
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-gray-200 bg-white text-gray-500 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700'
                }`}
              >
                😀
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!scheduledAt) setScheduledAt(defaultScheduleValue())
                  setReserveMode((current) => !current)
                }}
                disabled={sending}
                aria-pressed={reserveMode}
                aria-label="予約送信を設定"
                title="予約送信を設定"
                className={`flex h-10 w-10 items-center justify-center rounded-full border text-sm shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  reserveMode
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-gray-200 bg-white text-gray-500 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700'
                }`}
              >
                🕒
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit(reserveMode)}
                disabled={sending}
                className="rounded-full px-4 py-2 text-sm font-medium text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: '#06C755' }}
              >
                {sending ? (reserveMode ? '予約中...' : '送信中...') : reserveMode ? '予約送信' : '送信'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {scheduledMessages.length > 0 && (
        <div className="space-y-2">
          {scheduledMessages.map((item) => {
            const isCancellable = item.status === 'scheduled' || item.status === 'failed'
            const isCancelling = cancellingScheduledId === item.id
            const isEditing = editingScheduledId === item.id
            const isSaving = savingScheduledId === item.id
            const canEdit = item.status === 'scheduled' || item.status === 'failed'

            return (
              <div
                key={item.id}
                className="rounded-2xl border border-[#E4ECE8] bg-[#F8FCF9] px-3 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${scheduledStatusClassName(item.status)}`}>
                        {scheduledStatusCopy(item.status)}
                      </span>
                      <span className="text-[11px] text-gray-500">
                        {formatDatetime(item.scheduledAt)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-gray-700">
                      {summarizeScheduledMessage(item)}
                    </p>
                    {item.lastError && (
                      <p className="mt-1 text-[11px] text-rose-600">
                        {item.lastError}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => beginEditScheduledMessage(item)}
                        disabled={isSaving || isCancelling}
                        className="rounded-full border border-gray-200 px-3 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        変更
                      </button>
                    )}
                    {isCancellable && (
                      <button
                        type="button"
                        onClick={() => void handleCancelScheduledMessage(item.id)}
                        disabled={isCancelling || isSaving}
                        className="rounded-full border border-gray-200 px-3 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isCancelling ? '処理中...' : item.status === 'failed' ? '削除' : '取消'}
                      </button>
                    )}
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[#E4ECE8] pt-2">
                    <input
                      type="datetime-local"
                      value={editingScheduledAt}
                      onChange={(event) => setEditingScheduledAt(event.target.value)}
                      className="min-w-[190px] rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs text-gray-900 focus:border-[#06C755] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void handleUpdateScheduledMessage(item.id)}
                      disabled={isSaving}
                      className="rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isSaving ? '保存中...' : '保存'}
                    </button>
                    <button
                      type="button"
                      onClick={stopEditScheduledMessage}
                      disabled={isSaving}
                      className="rounded-full border border-gray-200 px-3 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      閉じる
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
