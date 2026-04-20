'use client'

import { useEffect, useState } from 'react'

function safeJsonParse(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // ignore
  }

  return null
}

function extractFlexPreview(content: string): string {
  try {
    const parsed = JSON.parse(content)
    const texts: string[] = []

    const collectText = (node: unknown) => {
      if (!node || typeof node !== 'object' || texts.join(' ').length > 240) return
      const record = node as Record<string, unknown>

      if (record.type === 'text' && typeof record.text === 'string') {
        const text = record.text.trim()
        if (text && !text.startsWith('{{')) texts.push(text)
      }

      if (Array.isArray(record.contents)) {
        for (const child of record.contents) collectText(child)
      }

      for (const key of ['header', 'body', 'footer']) {
        if (record[key]) collectText(record[key])
      }
    }

    collectText(parsed)
    return texts.slice(0, 4).join('\n') || '[Flex Message]'
  } catch {
    return '[Flex Message]'
  }
}

function getStickerPreviewUrl(stickerId: string): string {
  return `https://stickershop.line-scdn.net/stickershop/v1/sticker/${stickerId}/iPhone/sticker.png`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function getFileNameFromUrl(url: string): string {
  const sanitized = url.split('?')[0]?.split('#')[0] || ''
  const candidate = sanitized.split('/').pop() || ''

  try {
    return decodeURIComponent(candidate)
  } catch {
    return candidate
  }
}

function getFileExtension(fileName: string, url: string): string {
  const source = fileName || getFileNameFromUrl(url)
  const dotIndex = source.lastIndexOf('.')
  if (dotIndex === -1) return ''
  return source.slice(dotIndex + 1).toLowerCase()
}

function getFileIcon(extension: string): string {
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) return '\u{1F5BC}'
  if (extension === 'pdf') return '\u{1F4C4}'
  if (['doc', 'docx'].includes(extension)) return '\u{1F4DD}'
  if (['ppt', 'pptx', 'xls', 'xlsx', 'csv'].includes(extension)) return '\u{1F4CA}'
  if (['mp4', 'mov', 'avi'].includes(extension)) return '\u{1F3AC}'
  if (['mp3', 'wav', 'm4a'].includes(extension)) return '\u{1F3B5}'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension)) return '\u{1F4E6}'
  return '\u{1F4CE}'
}

function normalizeFilePayload(content: string): {
  url: string
  fileName: string
  fileSize: string
  fileIcon: string
  extension: string
  isPdf: boolean
} {
  const parsed = safeJsonParse(content)
  const url = typeof parsed?.url === 'string' ? parsed.url : content
  const fileName =
    typeof parsed?.fileName === 'string'
      ? parsed.fileName
      : getFileNameFromUrl(url) || 'ファイル'
  const extension = getFileExtension(fileName, url)
  const fileSize =
    typeof parsed?.fileSize === 'string'
      ? parsed.fileSize
      : typeof parsed?.fileSize === 'number'
        ? formatFileSize(parsed.fileSize)
        : typeof parsed?.fileSizeBytes === 'number'
          ? formatFileSize(parsed.fileSizeBytes)
          : ''
  const fileIcon =
    typeof parsed?.fileIcon === 'string'
      ? parsed.fileIcon
      : getFileIcon(extension)

  return {
    url,
    fileName,
    fileSize,
    fileIcon,
    extension,
    isPdf: extension === 'pdf',
  }
}

function summarizeFile(content: string): string {
  return normalizeFilePayload(content).fileName
}

export function getMessagePreviewText(messageType: string, content: string): string {
  if (messageType === 'text') return content
  if (messageType === 'image') return '画像'
  if (messageType === 'file') return summarizeFile(content)
  if (messageType === 'sticker') {
    const parsed = safeJsonParse(content)
    const packageId = typeof parsed?.packageId === 'string' ? parsed.packageId : '?'
    const stickerId = typeof parsed?.stickerId === 'string' ? parsed.stickerId : '?'
    return `スタンプ ${packageId}/${stickerId}`
  }
  if (messageType === 'location') return '位置情報'
  if (messageType === 'audio') return '音声'
  if (messageType === 'video') return '動画'
  if (messageType === 'flex') return extractFlexPreview(content)
  return `[${messageType}]`
}

function ChatMedia({ url, type }: { url: string; type: 'image' | 'video' | 'audio' }) {
  const [failed, setFailed] = useState(false)

  if (failed) {
    const label = type === 'image' ? '画像' : type === 'video' ? '動画' : '音声'
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm underline underline-offset-2"
      >
        {label}を開く
      </a>
    )
  }

  if (type === 'video') {
    return (
      <video
        controls
        className="max-w-full rounded-2xl max-h-64"
        preload="metadata"
        onError={() => setFailed(true)}
      >
        <source src={url} type="video/mp4" />
      </video>
    )
  }

  if (type === 'audio') {
    return (
      <audio
        controls
        className="max-w-full"
        preload="metadata"
        onError={() => setFailed(true)}
      >
        <source src={url} type="audio/mp4" />
      </audio>
    )
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      <img
        src={url}
        alt="送信された画像"
        className="max-w-full rounded-2xl max-h-64 cursor-pointer"
        onError={() => setFailed(true)}
      />
    </a>
  )
}

function FileAttachmentCard({ content }: { content: string }) {
  const file = normalizeFilePayload(content)
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    if (!previewOpen) return undefined

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreviewOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [previewOpen])

  return (
    <>
      <div className="space-y-3">
        <div className="rounded-2xl border border-current/15 bg-black/5 p-3">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-white/80 text-xl shadow-sm">
              {file.fileIcon}
            </div>
            <div className="min-w-0 flex-1">
              <p className="break-all text-sm font-medium leading-5">{file.fileName}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] opacity-75">
                {file.extension && (
                  <span className="rounded-full bg-white/70 px-2 py-0.5 font-medium uppercase tracking-[0.14em]">
                    {file.extension}
                  </span>
                )}
                {file.fileSize && <span>{file.fileSize}</span>}
              </div>
            </div>
          </div>

          {file.url && (
            <div className="mt-3 flex flex-wrap gap-2">
              {file.isPdf && (
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="rounded-full border border-current/15 bg-white/85 px-3 py-1.5 text-xs font-medium text-gray-900 transition-colors hover:bg-white"
                >
                  PDFを確認
                </button>
              )}
              <a
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-current/15 bg-white/85 px-3 py-1.5 text-xs font-medium text-gray-900 transition-colors hover:bg-white"
              >
                {file.isPdf ? '別タブで開く' : 'ファイルを開く'}
              </a>
            </div>
          )}
        </div>
      </div>

      {previewOpen && file.url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="flex h-[min(88vh,960px)] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900">{file.fileName}</p>
                <p className="text-xs text-gray-500">受信ファイルのプレビュー</p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
                >
                  別タブで開く
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewOpen(false)}
                  className="rounded-full bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-700"
                >
                  閉じる
                </button>
              </div>
            </div>
            <iframe
              src={file.url}
              title={file.fileName}
              className="h-full w-full bg-gray-100"
            />
          </div>
        </div>
      )}
    </>
  )
}

export default function ChatMessageContent({
  messageType,
  content,
}: {
  messageType: string
  content: string
}) {
  if (messageType === 'text') {
    return <span className="whitespace-pre-wrap break-words">{content}</span>
  }

  if (messageType === 'flex') {
    return <span className="whitespace-pre-wrap break-words">{extractFlexPreview(content)}</span>
  }

  if (messageType === 'image') {
    const parsed = safeJsonParse(content)
    const imageUrl =
      typeof parsed?.url === 'string'
        ? parsed.url
        : typeof parsed?.originalContentUrl === 'string'
          ? parsed.originalContentUrl
          : content

    if (imageUrl) {
      return <ChatMedia url={imageUrl} type="image" />
    }

    return <span>画像</span>
  }

  if (messageType === 'video') {
    const parsed = safeJsonParse(content)
    const url = typeof parsed?.url === 'string' ? parsed.url : ''
    return url ? <ChatMedia url={url} type="video" /> : <span>動画</span>
  }

  if (messageType === 'audio') {
    const parsed = safeJsonParse(content)
    const url = typeof parsed?.url === 'string' ? parsed.url : ''
    return url ? <ChatMedia url={url} type="audio" /> : <span>音声</span>
  }

  if (messageType === 'file') {
    return <FileAttachmentCard content={content} />
  }

  if (messageType === 'location') {
    const parsed = safeJsonParse(content)
    const latitude = typeof parsed?.latitude === 'number' ? parsed.latitude : null
    const longitude = typeof parsed?.longitude === 'number' ? parsed.longitude : null
    const label =
      typeof parsed?.title === 'string'
        ? parsed.title
        : typeof parsed?.address === 'string'
          ? parsed.address
          : '位置情報'

    if (latitude !== null && longitude !== null) {
      return (
        <a
          href={`https://www.google.com/maps?q=${latitude},${longitude}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          {label}
        </a>
      )
    }

    return <span>{label}</span>
  }

  if (messageType === 'sticker') {
    const parsed = safeJsonParse(content)
    const packageId =
      typeof parsed?.packageId === 'string'
        ? parsed.packageId
        : typeof parsed?.packageId === 'number'
          ? String(parsed.packageId)
          : ''
    const stickerId =
      typeof parsed?.stickerId === 'string'
        ? parsed.stickerId
        : typeof parsed?.stickerId === 'number'
          ? String(parsed.stickerId)
          : ''

    return (
      <div className="space-y-2">
        {stickerId ? (
          <img
            src={getStickerPreviewUrl(stickerId)}
            alt="スタンプ"
            className="w-24 h-24 object-contain"
          />
        ) : (
          <span>スタンプ</span>
        )}
        <div className="text-[11px] opacity-70">
          {packageId && <span className="mr-2">package {packageId}</span>}
          {stickerId && <span>sticker {stickerId}</span>}
        </div>
      </div>
    )
  }

  return <span className="whitespace-pre-wrap break-words">{content}</span>
}
