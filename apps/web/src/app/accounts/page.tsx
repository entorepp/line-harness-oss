'use client'

import { useState, useEffect } from 'react'
import { api, type ChannelType } from '@/lib/api'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'

interface LineAccountListItem {
  id: string
  channelId: string
  name: string
  channelType?: ChannelType
  locale?: string
  defaultSlackChannel?: string | null
  displayName: string
  pictureUrl: string | null
  basicId: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  stats: {
    friendCount: number
    activeScenarios: number
    messagesThisMonth: number
  }
}

type AccountLocale = 'ja' | 'zh-TW' | 'ko'

type AccountSettingsForm = {
  locale: AccountLocale
  defaultSlackChannel: string
}

const ccPrompts = [
  {
    title: 'LINEアカウント設定確認',
    prompt: `現在登録されているLINE / WhatsApp / Kakaoアカウントのチャネル設定を確認してください。
1. 各アカウントのChannel ID・名前・有効/無効ステータスを一覧表示
2. APIキーとWebhook認証値が正しく設定されているか検証
3. 各プラットフォーム側との設定整合性をチェック
結果をレポートしてください。`,
  },
  {
    title: 'アカウント追加手順',
    prompt: `新しいチャネルアカウントを追加する手順をガイドしてください。
1. LINE / WhatsApp / Kakao側で必要なチャネル作成手順を説明
2. Channel ID、APIキー、Webhook認証値の取得方法
3. CRMへの登録手順と初期設定のベストプラクティス
手順を示してください。`,
  },
]

function normalizeLocale(value: string | undefined): AccountLocale {
  if (value === 'zh-TW' || value === 'ko') return value
  return 'ja'
}

function channelLabel(channelType: ChannelType | undefined): string {
  if (channelType === 'whatsapp') return 'WhatsApp'
  if (channelType === 'kakao') return 'KakaoTalk'
  return 'LINE'
}

function channelColor(channelType: ChannelType | undefined, isActive: boolean): string {
  if (!isActive) return '#9CA3AF'
  if (channelType === 'whatsapp') return '#25D366'
  if (channelType === 'kakao') return '#FEE500'
  return '#06C755'
}

function channelInitial(channelType: ChannelType | undefined, displayName?: string): string {
  if (channelType === 'whatsapp') return 'W'
  if (channelType === 'kakao') return 'K'
  return displayName?.charAt(0) || 'L'
}

function channelBadgeClass(channelType: ChannelType | undefined): string {
  if (channelType === 'whatsapp') return 'bg-emerald-100 text-emerald-700'
  if (channelType === 'kakao') return 'bg-yellow-100 text-yellow-800'
  return 'bg-green-100 text-green-700'
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<LineAccountListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [savingAccountId, setSavingAccountId] = useState<string | null>(null)
  const [settings, setSettings] = useState<Record<string, AccountSettingsForm>>({})
  const [form, setForm] = useState({
    channelType: 'line' as ChannelType,
    channelId: '',
    name: '',
    channelAccessToken: '',
    channelSecret: '',
    locale: 'ja' as AccountLocale,
    defaultSlackChannel: '',
  })
  const isWhatsAppForm = form.channelType === 'whatsapp'
  const isKakaoForm = form.channelType === 'kakao'

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.lineAccounts.list()
      if (res.success) {
        const items = res.data as unknown as LineAccountListItem[]
        setAccounts(items)
        setSettings(
          Object.fromEntries(
            items.map((account) => [
              account.id,
              {
                locale: normalizeLocale(account.locale),
                defaultSlackChannel: account.defaultSlackChannel || '',
              },
            ]),
          ),
        )
      } else {
        setError('アカウント情報の取得に失敗しました')
      }
    } catch {
      setError('APIに接続できませんでした。サーバーが起動しているか確認してください。')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.channelId || !form.name || !form.channelAccessToken || (!isWhatsAppForm && !form.channelSecret)) return
    try {
      await api.lineAccounts.create({
        ...form,
        channelSecret: isWhatsAppForm ? form.channelSecret.trim() || '' : form.channelSecret,
        defaultSlackChannel: form.defaultSlackChannel.trim() || null,
      })
      setForm({
        channelType: 'line',
        channelId: '',
        name: '',
        channelAccessToken: '',
        channelSecret: '',
        locale: 'ja',
        defaultSlackChannel: '',
      })
      setShowCreate(false)
      load()
    } catch {}
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このLINEアカウントを削除しますか？')) return
    await api.lineAccounts.delete(id)
    load()
  }

  const handleToggle = async (id: string, currentActive: boolean) => {
    await api.lineAccounts.update(id, { isActive: !currentActive })
    load()
  }

  const handleSaveSettings = async (id: string) => {
    const current = settings[id]
    if (!current) return

    setSavingAccountId(id)
    try {
      await api.lineAccounts.update(id, {
        locale: current.locale,
        defaultSlackChannel: current.defaultSlackChannel.trim() || null,
      })
      await load()
    } catch {
      setError('アカウント設定の保存に失敗しました')
    } finally {
      setSavingAccountId(null)
    }
  }

  return (
    <div>
      <Header
        title="チャネルアカウント管理"
        description="LINE / WhatsApp / KakaoTalk マルチアカウント設定"
        action={
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 rounded-lg text-white text-sm font-medium"
            style={{ backgroundColor: '#06C755' }}
          >
            {showCreate ? 'キャンセル' : '+ アカウント追加'}
          </button>
        }
      />

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">チャネル種別</label>
              <select
                value={form.channelType}
                onChange={(e) => setForm({ ...form, channelType: e.target.value as ChannelType })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="line">LINE</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="kakao">KakaoTalk</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">アカウント名</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="メインアカウント"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {isWhatsAppForm ? 'Phone Number ID' : isKakaoForm ? 'KakaoTalk Channel Public ID' : 'Channel ID'}
              </label>
              <input
                value={form.channelId}
                onChange={(e) => setForm({ ...form, channelId: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder={isWhatsAppForm ? '123456789012345' : isKakaoForm ? '_kBxiZX' : '123456789'}
                required
              />
              <p className="mt-1 text-xs text-gray-400">
                {isWhatsAppForm
                  ? 'Meta / Cloud API の Phone Number ID を入力します'
                  : isKakaoForm
                    ? 'KakaoTalk Channel の profile ID / channel_public_id を入力します'
                    : 'LINE Developers Console の Channel ID を入力します'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {isWhatsAppForm ? 'Access Token' : isKakaoForm ? 'REST API Key' : 'Channel Access Token'}
              </label>
              <input
                type="password"
                value={form.channelAccessToken}
                onChange={(e) => setForm({ ...form, channelAccessToken: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {isWhatsAppForm ? 'App Secret（任意）' : isKakaoForm ? 'Admin Key' : 'Channel Secret'}
              </label>
              <input
                type="password"
                value={form.channelSecret}
                onChange={(e) => setForm({ ...form, channelSecret: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                required={!isWhatsAppForm}
              />
              <p className="mt-1 text-xs text-gray-400">
                {isWhatsAppForm
                  ? '未使用なら空欄のままで構いません'
                  : isKakaoForm
                    ? 'サーバー側のKakao API確認とWebhook認証に使います'
                    : 'Messaging API チャネルの secret を入力します'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">言語</label>
              <select
                value={form.locale}
                onChange={(e) => setForm({ ...form, locale: e.target.value as AccountLocale })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="ja">日本語</option>
                <option value="zh-TW">繁體中文</option>
                <option value="ko">한국어</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Slack通知先</label>
              <input
                value={form.defaultSlackChannel}
                onChange={(e) => setForm({ ...form, defaultSlackChannel: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="notification"
              />
              <p className="mt-1 text-xs text-gray-400">未設定時は `notification` に投稿します</p>
            </div>
          </div>
          <button
            type="submit"
            className="mt-4 px-4 py-2 rounded-lg text-white text-sm font-medium"
            style={{ backgroundColor: '#06C755' }}
          >
            登録
          </button>
        </form>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">読み込み中...</div>
      ) : accounts.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          <p className="mb-2">チャネルアカウントが登録されていません</p>
          <p className="text-xs text-gray-300">LINE / WhatsApp / KakaoTalk の接続情報を取得して登録してください</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {accounts.map((account) => (
            <div key={account.id} className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  {account.pictureUrl ? (
                    <img
                      src={account.pictureUrl}
                      alt={account.displayName}
                      className="w-10 h-10 rounded-lg object-cover"
                    />
                  ) : (
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                      style={{
                        backgroundColor: channelColor(account.channelType, account.isActive),
                        color: account.channelType === 'kakao' && account.isActive ? '#111827' : '#ffffff',
                      }}
                    >
                      {channelInitial(account.channelType, account.displayName)}
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-gray-900">{account.displayName}</h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${channelBadgeClass(account.channelType)}`}
                      >
                        {channelLabel(account.channelType)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 font-mono">
                      {account.basicId ? `${account.basicId} · ` : ''}
                      {account.channelType === 'whatsapp'
                        ? 'Phone Number ID'
                        : account.channelType === 'kakao'
                          ? 'Channel Public ID'
                          : 'Channel ID'}: {account.channelId}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleToggle(account.id, account.isActive)}
                  className={`text-xs px-2 py-0.5 rounded-full ${account.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                >
                  {account.isActive ? '有効' : '無効'}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-4 py-3 border-t border-b border-gray-100">
                <div className="text-center">
                  <p className="text-lg font-bold text-gray-900">{account.stats.friendCount}</p>
                  <p className="text-xs text-gray-400">友だち</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-blue-600">{account.stats.activeScenarios}</p>
                  <p className="text-xs text-gray-400">配信中</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-green-600">{account.stats.messagesThisMonth}</p>
                  <p className="text-xs text-gray-400">今月送信</p>
                </div>
              </div>
              <div className="space-y-3 mb-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">言語</label>
                    <select
                      value={settings[account.id]?.locale || 'ja'}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          [account.id]: {
                            locale: e.target.value as AccountLocale,
                            defaultSlackChannel: prev[account.id]?.defaultSlackChannel || '',
                          },
                        }))
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="ja">日本語</option>
                      <option value="zh-TW">繁體中文</option>
                      <option value="ko">한국어</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Slack通知先</label>
                    <input
                      value={settings[account.id]?.defaultSlackChannel || ''}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          [account.id]: {
                            locale: prev[account.id]?.locale || 'ja',
                            defaultSlackChannel: e.target.value,
                          },
                        }))
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      placeholder="notification"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">個別チャンネル未設定時はここに投稿されます。空欄なら `notification`。</p>
                  <button
                    onClick={() => handleSaveSettings(account.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-50"
                    style={{ backgroundColor: '#0f766e' }}
                    disabled={savingAccountId === account.id}
                  >
                    {savingAccountId === account.id ? '保存中...' : '通知設定を保存'}
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400">
                  登録: {new Date(account.createdAt).toLocaleDateString('ja-JP')}
                </p>
                <button
                  onClick={() => handleDelete(account.id)}
                  className="text-red-500 hover:text-red-700 text-xs"
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
