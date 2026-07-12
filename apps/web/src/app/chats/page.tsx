'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { api, fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import ChatComposer from '@/components/chat-composer'
import ChatMessageContent from '@/components/chat-message-content'

interface Chat {
  id: string
  friendId: string
  friendName: string
  friendPictureUrl: string | null
  operatorId: string | null
  status: 'unread' | 'in_progress' | 'resolved'
  notes: string | null
  lastMessageAt: string | null
  lastMessageId: string | null
  lastMessageDirection: 'incoming' | 'outgoing' | null
  createdAt: string
  updatedAt: string
}

interface ChatMessage {
  id: string
  direction: 'incoming' | 'outgoing'
  messageType: string
  content: string
  createdAt: string
}

interface ChatDetail extends Chat {
  friendName: string
  friendPictureUrl: string | null
  slackChannelId: string | null
  messages?: ChatMessage[]
  hasMoreMessages?: boolean
  oldestMessageId?: string | null
}

type StatusFilter = 'all' | 'unread' | 'in_progress' | 'resolved'

const statusConfig: Record<Chat['status'], { label: string; className: string }> = {
  unread: { label: '未読', className: 'bg-red-100 text-red-700' },
  in_progress: { label: '対応中', className: 'bg-yellow-100 text-yellow-700' },
  resolved: { label: '解決済', className: 'bg-green-100 text-green-700' },
}

const statusFilters: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全て' },
  { key: 'unread', label: '未読' },
  { key: 'in_progress', label: '対応中' },
  { key: 'resolved', label: '解決済' },
]

const MESSAGE_SCROLL_BOTTOM_THRESHOLD = 120
const MESSAGE_SCROLL_TOP_LOAD_THRESHOLD = 80
const MESSAGE_HISTORY_PAGE_SIZE = 200

function isNearScrollBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= MESSAGE_SCROLL_BOTTOM_THRESHOLD
}

function mergeChatMessages(...groups: Array<ChatMessage[] | undefined>): ChatMessage[] {
  const byId = new Map<string, ChatMessage>()
  for (const group of groups) {
    for (const message of group ?? []) {
      byId.set(message.id, message)
    }
  }

  return [...byId.values()].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime()
    const rightTime = new Date(right.createdAt).getTime()
    if (leftTime !== rightTime) return leftTime - rightTime
    return left.id.localeCompare(right.id)
  })
}

function formatDatetime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface FriendItem {
  id: string
  displayName: string
  pictureUrl: string | null
  isFollowing: boolean
}

interface MessageLog {
  id: string
  direction: 'incoming' | 'outgoing'
  messageType: string
  content: string
  createdAt: string
}

function DirectMessagePanel({ friendId, friend, channelType, onBack, onSent, onError }: {
  friendId: string
  friend: FriendItem | null
  channelType?: 'line' | 'whatsapp'
  onBack: () => void
  onSent: () => void
  onError: (message: string) => void
}) {
  const [messages, setMessages] = useState<MessageLog[]>([])
  const [loadingMessages, setLoadingMessages] = useState(true)

  const loadMessages = useCallback(async (silent = false) => {
    if (!silent) setLoadingMessages(true)
    try {
      const res = await fetchApi<{ success: boolean; data: MessageLog[] }>(
        `/api/friends/${friendId}/messages`
      )
      if (res.success) setMessages(res.data)
    } catch { /* silent */ }
    if (!silent) setLoadingMessages(false)
  }, [friendId])

  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  // Polling: auto-refresh messages every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => loadMessages(true), 5000)
    return () => clearInterval(interval)
  }, [loadMessages])

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-4 border-b border-gray-200 flex items-center gap-3">
        <button onClick={onBack} className="lg:hidden text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        {friend?.pictureUrl ? (
          <img src={friend.pictureUrl} alt="" className="w-8 h-8 rounded-full" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
            <span className="text-gray-500 text-xs">{(friend?.displayName || '?').charAt(0)}</span>
          </div>
        )}
        <div>
          <p className="text-sm font-bold text-gray-900">{friend?.displayName || '不明'}</p>
          <p className="text-xs text-gray-400">メッセージ履歴</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loadingMessages ? (
          <p className="text-center text-gray-400 text-sm">読み込み中...</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-gray-400 text-sm">メッセージ履歴がありません</p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${
                msg.direction === 'outgoing'
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}>
                <div className="text-sm">
                  <ChatMessageContent messageType={msg.messageType} content={msg.content} />
                </div>
                <p className={`text-xs mt-1 ${msg.direction === 'outgoing' ? 'text-green-200' : 'text-gray-400'}`}>
                  {new Date(msg.createdAt).toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="px-4 py-3 border-t border-gray-200">
        <ChatComposer
          friendId={friendId}
          channelType={channelType}
          onSent={() => {
            void loadMessages()
            onSent()
          }}
          onError={onError}
        />
      </div>
    </div>
  )
}

export default function ChatsPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [chats, setChats] = useState<Chat[]>([])
  const [allFriends, setAllFriends] = useState<FriendItem[]>([])
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null)
  const [chatDetail, setChatDetail] = useState<ChatDetail | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const shouldStickToBottomRef = useRef(true)
  const forceScrollToBottomRef = useRef(false)
  const userReviewingHistoryRef = useRef(false)
  const loadingOlderMessagesRef = useRef(false)
  const prependScrollRestoreRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
  const renderedMessagesRef = useRef<{
    chatId: string | null
    messageCount: number
    lastMessageId: string | null
  }>({ chatId: null, messageCount: 0, lastMessageId: null })
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editingSlack, setEditingSlack] = useState(false)
  const [slackInput, setSlackInput] = useState('')
  const [savingSlack, setSavingSlack] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)

  // Track previous chat state for notification
  const prevUnreadRef = useRef(0)
  const prevLatestIncomingSignatureRef = useRef<string | null>(null)
  const prevLatestIncomingAtRef = useRef<string | null>(null)
  const notificationPermissionRef = useRef<NotificationPermission>('default')

  // Request browser notification permission on mount
  useEffect(() => {
    if (typeof Notification !== 'undefined') {
      notificationPermissionRef.current = Notification.permission
      if (Notification.permission === 'default') {
        Notification.requestPermission().then((perm) => {
          notificationPermissionRef.current = perm
        })
      }
    }
  }, [])

  const loadChats = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError('') }
    try {
      const params: { status?: string; accountId?: string } = {}
      if (statusFilter !== 'all') params.status = statusFilter
      if (selectedAccountId) params.accountId = selectedAccountId
      const [chatRes, friendRes] = await Promise.allSettled([
        api.chats.list(params),
        api.friends.list({ accountId: selectedAccountId || undefined, limit: '100' }),
      ])
      if (chatRes.status === 'fulfilled' && chatRes.value.success) {
        const newChats = chatRes.value.data as unknown as Chat[]
        setChats(newChats)

        const latestIncomingChat = newChats
          .filter((c) => c.lastMessageDirection === 'incoming' && c.lastMessageAt)
          .sort((a, b) => {
            const left = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
            const right = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
            return right - left
          })[0]
        const latestIncomingSignature = latestIncomingChat
          ? `${latestIncomingChat.id}:${latestIncomingChat.lastMessageId || ''}:${latestIncomingChat.lastMessageAt || ''}`
          : null

        const unreadCount = newChats.filter((c) => c.status === 'unread').length
        if (
          silent &&
          latestIncomingChat &&
          prevLatestIncomingSignatureRef.current &&
          latestIncomingSignature !== prevLatestIncomingSignatureRef.current &&
          latestIncomingChat.lastMessageAt &&
          new Date(latestIncomingChat.lastMessageAt).getTime() >
            new Date(prevLatestIncomingAtRef.current || 0).getTime()
        ) {
          // Browser notification
          if (notificationPermissionRef.current === 'granted') {
            const latestName = latestIncomingChat.friendName || '顧客'
            new Notification('LINE Harness: 新着メッセージ', {
              body: `${latestName}さんからメッセージが届きました`,
              icon: '/favicon.ico',
              tag: 'lh-unread',
            })
          }
        }
        prevUnreadRef.current = unreadCount
        prevLatestIncomingSignatureRef.current = latestIncomingSignature
        prevLatestIncomingAtRef.current = latestIncomingChat?.lastMessageAt || null

        // Update page title with unread count
        document.title = unreadCount > 0
          ? `(${unreadCount}) オペレーターチャット - LINE Harness`
          : 'オペレーターチャット - LINE Harness'
      }
      if (friendRes.status === 'fulfilled' && friendRes.value.success) {
        setAllFriends((friendRes.value.data as unknown as { items: FriendItem[] }).items)
      }
    } catch {
      if (!silent) setError('チャットの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [statusFilter, selectedAccountId])

  const loadChatDetail = useCallback(async (chatId: string, silent = false) => {
    if (!silent) setDetailLoading(true)
    if (silent) {
      const el = messagesContainerRef.current
      if (el) {
        const nearBottom = isNearScrollBottom(el)
        shouldStickToBottomRef.current = nearBottom
        userReviewingHistoryRef.current = !nearBottom
      }
    }
    try {
      const res = await api.chats.get(chatId)
      if (res.success) {
        const nextDetail = res.data as unknown as ChatDetail
        setChatDetail((current) => {
          if (silent && current?.id === chatId) {
            const currentMessages = current.messages ?? []
            const nextMessages = nextDetail.messages ?? []
            const mergedMessages = mergeChatMessages(currentMessages, nextMessages)
            const currentOldestMessageId = currentMessages[0]?.id ?? current.oldestMessageId ?? null
            const nextOldestMessageId = nextMessages[0]?.id ?? nextDetail.oldestMessageId ?? null
            const hasLoadedOlderMessages =
              Boolean(currentOldestMessageId && nextOldestMessageId && currentOldestMessageId !== nextOldestMessageId)

            return {
              ...nextDetail,
              messages: mergedMessages,
              hasMoreMessages: hasLoadedOlderMessages
                ? current.hasMoreMessages
                : nextDetail.hasMoreMessages,
              oldestMessageId: mergedMessages[0]?.id ?? nextDetail.oldestMessageId ?? null,
            }
          }
          return nextDetail
        })
        if (!silent) setNotes((res.data as unknown as ChatDetail).notes || '')
      }
    } catch {
      if (!silent) setError('チャット詳細の読み込みに失敗しました。')
    } finally {
      if (!silent) setDetailLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    loadChats()
  }, [loadChats])

  useEffect(() => {
    if (selectedChatId) {
      setSettingsOpen(false)
      setEditingSlack(false)
      shouldStickToBottomRef.current = true
      forceScrollToBottomRef.current = true
      userReviewingHistoryRef.current = false
      loadingOlderMessagesRef.current = false
      prependScrollRestoreRef.current = null
      renderedMessagesRef.current = { chatId: null, messageCount: 0, lastMessageId: null }
      setLoadingOlderMessages(false)
      loadChatDetail(selectedChatId)
    } else {
      setChatDetail(null)
      shouldStickToBottomRef.current = true
      forceScrollToBottomRef.current = false
      userReviewingHistoryRef.current = false
      loadingOlderMessagesRef.current = false
      prependScrollRestoreRef.current = null
      renderedMessagesRef.current = { chatId: null, messageCount: 0, lastMessageId: null }
      setLoadingOlderMessages(false)
    }
  }, [selectedChatId, loadChatDetail])

  const loadOlderMessages = useCallback(async () => {
    const currentMessages = chatDetail?.messages ?? []
    const beforeMessageId = currentMessages[0]?.id ?? chatDetail?.oldestMessageId ?? null
    if (
      !selectedChatId ||
      !chatDetail?.hasMoreMessages ||
      !beforeMessageId ||
      loadingOlderMessagesRef.current
    ) {
      return
    }

    const el = messagesContainerRef.current
    if (el) {
      prependScrollRestoreRef.current = {
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
      }
    }

    loadingOlderMessagesRef.current = true
    setLoadingOlderMessages(true)
    shouldStickToBottomRef.current = false
    userReviewingHistoryRef.current = true

    try {
      const res = await api.chats.get(selectedChatId, {
        beforeMessageId,
        limit: MESSAGE_HISTORY_PAGE_SIZE,
      })
      if (!res.success) {
        setError('過去のメッセージの読み込みに失敗しました。')
        prependScrollRestoreRef.current = null
        return
      }

      const olderDetail = res.data as unknown as ChatDetail
      setChatDetail((current) => {
        if (!current || current.id !== selectedChatId) return current
        const mergedMessages = mergeChatMessages(olderDetail.messages, current.messages)
        return {
          ...current,
          messages: mergedMessages,
          hasMoreMessages: olderDetail.hasMoreMessages ?? false,
          oldestMessageId: mergedMessages[0]?.id ?? null,
        }
      })
    } catch {
      setError('過去のメッセージの読み込みに失敗しました。')
      prependScrollRestoreRef.current = null
    } finally {
      loadingOlderMessagesRef.current = false
      setLoadingOlderMessages(false)
    }
  }, [
    selectedChatId,
    chatDetail?.hasMoreMessages,
    chatDetail?.oldestMessageId,
    chatDetail?.messages,
  ])

  const handleMessagesScroll = useCallback(() => {
    const el = messagesContainerRef.current
    if (!el) return
    const nearBottom = isNearScrollBottom(el)
    shouldStickToBottomRef.current = nearBottom
    userReviewingHistoryRef.current = !nearBottom
    if (el.scrollTop <= MESSAGE_SCROLL_TOP_LOAD_THRESHOLD) {
      void loadOlderMessages()
    }
  }, [loadOlderMessages])

  // Keep the chat pinned only while the operator is already reading the latest messages.
  useEffect(() => {
    const messages = chatDetail?.messages ?? []
    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null
    const current = {
      chatId: chatDetail?.id ?? null,
      messageCount: messages.length,
      lastMessageId: lastMessage?.id ?? null,
    }
    const previous = renderedMessagesRef.current
    const switchedChat = current.chatId !== previous.chatId
    const messageListChanged =
      current.messageCount !== previous.messageCount ||
      current.lastMessageId !== previous.lastMessageId
    const shouldScroll =
      !!current.chatId &&
      messages.length > 0 &&
      (
        switchedChat ||
        forceScrollToBottomRef.current ||
        (messageListChanged && shouldStickToBottomRef.current && !userReviewingHistoryRef.current)
      )

    renderedMessagesRef.current = current

    const prependRestore = prependScrollRestoreRef.current
    if (prependRestore) {
      const frame = requestAnimationFrame(() => {
        const el = messagesContainerRef.current
        if (!el) return
        el.scrollTop = el.scrollHeight - prependRestore.scrollHeight + prependRestore.scrollTop
        shouldStickToBottomRef.current = isNearScrollBottom(el)
        userReviewingHistoryRef.current = !shouldStickToBottomRef.current
        forceScrollToBottomRef.current = false
        prependScrollRestoreRef.current = null
      })

      return () => cancelAnimationFrame(frame)
    }

    if (!shouldScroll) {
      forceScrollToBottomRef.current = false
      return
    }

    const frame = requestAnimationFrame(() => {
      const el = messagesContainerRef.current
      if (!el) return
      el.scrollTop = el.scrollHeight
      shouldStickToBottomRef.current = true
      userReviewingHistoryRef.current = false
      forceScrollToBottomRef.current = false
    })

    return () => cancelAnimationFrame(frame)
  }, [chatDetail?.id, chatDetail?.messages])

  // Polling: auto-refresh chat list every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      loadChats(true) // silent refresh
    }, 5000)
    return () => clearInterval(interval)
  }, [loadChats])

  // Polling: auto-refresh chat detail every 5 seconds when a chat is selected
  useEffect(() => {
    if (!selectedChatId) return
    const interval = setInterval(() => {
      loadChatDetail(selectedChatId, true) // silent refresh
    }, 5000)
    return () => clearInterval(interval)
  }, [selectedChatId, loadChatDetail])

  // Cleanup title on unmount
  useEffect(() => {
    return () => { document.title = 'LINE Harness' }
  }, [])

  const handleSelectChat = (chatId: string) => {
    setSelectedChatId(chatId)
  }

  const handleStatusUpdate = async (newStatus: Chat['status']) => {
    if (!selectedChatId) return
    try {
      await api.chats.update(selectedChatId, { status: newStatus })
      loadChatDetail(selectedChatId)
      loadChats()
    } catch {
      setError('ステータスの更新に失敗しました。')
    }
  }

  const handleSaveNotes = async () => {
    if (!selectedChatId) return
    setSavingNotes(true)
    try {
      await api.chats.update(selectedChatId, { notes })
      loadChatDetail(selectedChatId)
    } catch {
      setError('メモの保存に失敗しました。')
    } finally {
      setSavingNotes(false)
    }
  }

  const handleSlackSave = async (friendId: string) => {
    setSavingSlack(true)
    try {
      await api.slack.linkFriend(friendId, slackInput.trim() || null)
      setEditingSlack(false)
      if (selectedChatId) loadChatDetail(selectedChatId)
    } catch {
      setError('Slackチャンネルの設定に失敗しました')
    } finally {
      setSavingSlack(false)
    }
  }

  const handleSlackRemove = async (friendId: string) => {
    try {
      await api.slack.linkFriend(friendId, null)
      if (selectedChatId) loadChatDetail(selectedChatId)
    } catch {
      setError('Slack連携の解除に失敗しました')
    }
  }

  const unreadCount = chats.filter((c) => c.status === 'unread').length

  return (
    <div>
      <Header title={
        <span className="flex items-center gap-2">
          オペレーターチャット
          {unreadCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold text-white animate-pulse" style={{ backgroundColor: '#EF4444' }}>
              {unreadCount}
            </span>
          )}
        </span>
      } />

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-4 h-[calc(100vh-120px)] lg:h-[calc(100vh-180px)]">
        {/* Left Panel: Chat List */}
        <div className={`w-full lg:w-96 lg:flex-shrink-0 bg-white rounded-lg shadow-sm border border-gray-200 flex-col overflow-hidden ${selectedChatId ? 'hidden lg:flex' : 'flex'}`}>
          {/* Status Filter Tabs */}
          <div className="flex border-b border-gray-200">
            {statusFilters.map((filter) => (
              <button
                key={filter.key}
                onClick={() => { setStatusFilter(filter.key); setSelectedChatId(null) }}
                className={`flex-1 px-3 py-2.5 min-h-[44px] text-xs font-medium transition-colors ${
                  statusFilter === filter.key
                    ? 'text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
                style={statusFilter === filter.key ? { backgroundColor: '#06C755' } : undefined}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {/* Chat List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div>
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="px-4 py-3 border-b border-gray-100 animate-pulse">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 space-y-2">
                        <div className="h-3 bg-gray-200 rounded w-32" />
                        <div className="h-2 bg-gray-100 rounded w-20" />
                      </div>
                      <div className="h-5 bg-gray-100 rounded-full w-12" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                {chats.map((chat) => {
                  const statusInfo = statusConfig[chat.status]
                  const isSelected = selectedChatId === chat.id
                  return (
                    <button
                      key={chat.id}
                      onClick={() => { setSelectedFriendId(null); handleSelectChat(chat.id); }}
                      className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors ${
                        isSelected && !selectedFriendId ? 'bg-green-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {chat.friendPictureUrl ? (
                          <img src={chat.friendPictureUrl} alt="" className="w-10 h-10 rounded-full flex-shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                            <span className="text-gray-500 text-sm">{chat.friendName.charAt(0)}</span>
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 truncate">{chat.friendName}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{formatDatetime(chat.lastMessageAt)}</p>
                        </div>
                        <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${statusInfo.className}`}>
                          {statusInfo.label}
                        </span>
                      </div>
                    </button>
                  )
                })}
                {/* Friends without chats — only show on "全て" tab */}
                {statusFilter === 'all' && allFriends
                  .filter((f) => f.isFollowing && !chats.some((c) => c.friendId === f.id))
                  .map((friend) => {
                    const isSelected = selectedFriendId === friend.id
                    return (
                      <button
                        key={friend.id}
                        onClick={() => { setSelectedChatId(null); setChatDetail(null); setSelectedFriendId(friend.id); }}
                        className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors ${
                          isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {friend.pictureUrl ? (
                            <img src={friend.pictureUrl} alt="" className="w-10 h-10 rounded-full flex-shrink-0" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                              <span className="text-gray-500 text-sm">{(friend.displayName || '?').charAt(0)}</span>
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">{friend.displayName}</p>
                            <p className="text-xs text-gray-400 mt-0.5">会話なし</p>
                          </div>
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 bg-gray-100 text-gray-500">
                            新規
                          </span>
                        </div>
                      </button>
                    )
                  })}
              </>
            )}
          </div>
        </div>

        {/* Right Panel: Chat Detail */}
        <div className={`flex-1 bg-white rounded-lg shadow-sm border border-gray-200 flex-col overflow-hidden ${selectedChatId || selectedFriendId ? 'flex' : 'hidden lg:flex'}`}>
          {selectedFriendId && !selectedChatId ? (
            /* Direct message to friend without existing chat */
            <DirectMessagePanel
              friendId={selectedFriendId}
              friend={allFriends.find((f) => f.id === selectedFriendId) || null}
              channelType={selectedAccount?.channelType}
              onBack={() => setSelectedFriendId(null)}
              onSent={() => { void loadChats() }}
              onError={setError}
            />
          ) : !selectedChatId ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-gray-400 text-sm">チャットを選択してください</p>
            </div>
          ) : detailLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-gray-400 text-sm">読み込み中...</p>
            </div>
          ) : chatDetail ? (
            <>
              {/* Chat Header */}
              <div className="px-4 py-4 border-b border-gray-200 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={() => setSelectedChatId(null)}
                    className="lg:hidden flex-shrink-0 p-1 -ml-1 text-gray-500 hover:text-gray-700"
                    aria-label="戻る"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  {chatDetail.friendPictureUrl && (
                    <img src={chatDetail.friendPictureUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {chatDetail.friendName}
                      </p>
                      <button
                        type="button"
                        onClick={() => setSettingsOpen((current) => !current)}
                        className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-200"
                      >
                        設定
                      </button>
                    </div>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium mt-1 ${statusConfig[chatDetail.status].className}`}
                    >
                      {statusConfig[chatDetail.status].label}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {chatDetail.status !== 'unread' && (
                    <button
                      onClick={() => handleStatusUpdate('unread')}
                      className="px-3 py-1 min-h-[44px] lg:min-h-0 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                    >
                      未読に戻す
                    </button>
                  )}
                  {chatDetail.status !== 'in_progress' && (
                    <button
                      onClick={() => handleStatusUpdate('in_progress')}
                      className="px-3 py-1 min-h-[44px] lg:min-h-0 text-xs font-medium text-yellow-700 bg-yellow-50 hover:bg-yellow-100 rounded-md transition-colors"
                    >
                      対応中にする
                    </button>
                  )}
                  {chatDetail.status !== 'resolved' && (
                    <button
                      onClick={() => handleStatusUpdate('resolved')}
                      className="px-3 py-1 min-h-[44px] lg:min-h-0 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-md transition-colors"
                    >
                      解決済にする
                    </button>
                  )}
                </div>
              </div>

              {settingsOpen && (
                <div className="border-b border-gray-100 bg-gray-50/70 px-4 py-3">
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="rounded-2xl border border-gray-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <svg className="h-4 w-4 shrink-0 text-purple-500" viewBox="0 0 24 24" fill="currentColor"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.124 2.521a2.528 2.528 0 0 1 2.52-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.52V8.834zm-1.271 0a2.528 2.528 0 0 1-2.521 2.521 2.528 2.528 0 0 1-2.521-2.521V2.522A2.528 2.528 0 0 1 15.166 0a2.528 2.528 0 0 1 2.521 2.522v6.312zm-2.521 10.124a2.528 2.528 0 0 1 2.521 2.52A2.528 2.528 0 0 1 15.166 24a2.527 2.527 0 0 1-2.521-2.522v-2.52h2.521zm0-1.271a2.527 2.527 0 0 1-2.521-2.521 2.528 2.528 0 0 1 2.521-2.521h6.312A2.528 2.528 0 0 1 24 15.166a2.528 2.528 0 0 1-2.522 2.521h-6.312z"/></svg>
                          <p className="text-sm font-semibold text-gray-900">Slack連携</p>
                        </div>
                        {!editingSlack && chatDetail.slackChannelId ? (
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                              {chatDetail.slackChannelId}
                            </span>
                            <button
                              onClick={() => { setEditingSlack(true); setSlackInput(chatDetail.slackChannelId || '') }}
                              className="text-xs text-gray-400 hover:text-gray-600"
                            >
                              変更
                            </button>
                            <button
                              onClick={() => handleSlackRemove(chatDetail.friendId)}
                              className="text-xs text-red-400 hover:text-red-600"
                            >
                              解除
                            </button>
                          </div>
                        ) : null}
                      </div>

                      <div className="mt-3">
                        {editingSlack ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              value={slackInput}
                              onChange={(e) => setSlackInput(e.target.value)}
                              placeholder="SlackチャンネルID (例: C0123456789)"
                              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500 sm:w-56"
                              onKeyDown={(e) => { if (e.key === 'Enter') handleSlackSave(chatDetail.friendId) }}
                            />
                            <button
                              onClick={() => handleSlackSave(chatDetail.friendId)}
                              disabled={savingSlack}
                              className="rounded-md px-2 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                              style={{ backgroundColor: '#7C3AED' }}
                            >
                              保存
                            </button>
                            <button
                              onClick={() => setEditingSlack(false)}
                              className="rounded-md px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100"
                            >
                              取消
                            </button>
                          </div>
                        ) : !chatDetail.slackChannelId ? (
                          <button
                            onClick={() => { setEditingSlack(true); setSlackInput('') }}
                            className="text-xs font-medium text-purple-600 hover:text-purple-700"
                          >
                            Slackチャンネルを紐付け
                          </button>
                        ) : (
                          <p className="text-xs text-gray-500">通知用チャンネルを紐付け済みです。</p>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-gray-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-900">メモ</p>
                        <button
                          onClick={handleSaveNotes}
                          disabled={savingNotes}
                          className="rounded-md bg-gray-100 px-2 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-200 disabled:opacity-50"
                        >
                          {savingNotes ? '保存中...' : '保存'}
                        </button>
                      </div>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="内部メモ"
                        rows={3}
                        className="mt-3 w-full resize-none rounded-xl border border-gray-300 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Messages — LINE-style chat bubbles */}
              <div
                ref={messagesContainerRef}
                onScroll={handleMessagesScroll}
                className="flex-1 overflow-y-auto p-4 space-y-2"
                style={{ backgroundColor: '#7494C0' }}
              >
                {loadingOlderMessages && (
                  <div className="text-center py-2">
                    <span className="text-xs text-white/70">過去のメッセージを読み込み中...</span>
                  </div>
                )}
                {(!chatDetail.messages || chatDetail.messages.length === 0) ? (
                  <div className="text-center py-8">
                    <p className="text-white/60 text-sm">メッセージはまだありません。</p>
                  </div>
                ) : (
                  (chatDetail.messages ?? []).map((msg) => {
                    const isOutgoing = msg.direction === 'outgoing'

                    return (
                      <div
                        key={msg.id}
                        className={`flex items-end gap-2 ${isOutgoing ? 'justify-end' : 'justify-start'}`}
                      >
                        {/* 相手のアイコン（incoming のみ） */}
                        {!isOutgoing && (
                          chatDetail.friendPictureUrl ? (
                            <img src={chatDetail.friendPictureUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0 mb-1" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gray-300 flex-shrink-0 mb-1" />
                          )
                        )}

                        <div className={`flex flex-col ${isOutgoing ? 'items-end' : 'items-start'}`}>
                          {/* メッセージバブル */}
                          <div
                            className={`max-w-[78%] lg:max-w-[520px] px-3 py-2 text-sm break-words whitespace-pre-wrap ${
                              isOutgoing
                                ? 'rounded-tl-2xl rounded-tr-md rounded-bl-2xl rounded-br-2xl text-white'
                                : 'rounded-tl-md rounded-tr-2xl rounded-bl-2xl rounded-br-2xl bg-white text-gray-900'
                            }`}
                            style={isOutgoing ? { backgroundColor: '#06C755' } : undefined}
                          >
                            <ChatMessageContent messageType={msg.messageType} content={msg.content} />
                          </div>
                          {/* 時刻 */}
                          <span className="text-xs text-white/50 mt-0.5 px-1">
                            {new Date(msg.createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Send Message Form */}
              <div className="px-4 py-3 border-t border-gray-200">
                <ChatComposer
                  friendId={chatDetail.friendId}
                  chatId={selectedChatId}
                  channelType={selectedAccount?.channelType}
                  onSent={() => {
                    if (selectedChatId) {
                      shouldStickToBottomRef.current = true
                      forceScrollToBottomRef.current = true
                      void loadChatDetail(selectedChatId)
                    }
                    void loadChats()
                  }}
                  onError={setError}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
