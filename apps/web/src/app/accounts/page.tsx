'use client'

import { useState, useEffect } from 'react'
import { api, type KakaoStatus, type WhatsAppBusinessProfile, type WhatsAppPhoneStatus } from '@/lib/api'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'

type ChannelType = 'line' | 'whatsapp' | 'kakao'

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

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787').replace(/\/+$/, '')

function getChannelLabel(channelType?: ChannelType): string {
  if (channelType === 'whatsapp') return 'WhatsApp'
  if (channelType === 'kakao') return 'Kakao'
  return 'LINE'
}

function getChannelColor(channelType?: ChannelType): string {
  if (channelType === 'whatsapp') return '#25D366'
  if (channelType === 'kakao') return '#FEE500'
  return '#06C755'
}

function getChannelTextColor(channelType?: ChannelType): string {
  return channelType === 'kakao' ? '#111827' : '#ffffff'
}

type AccountSettingsForm = {
  locale: 'ja' | 'zh-TW' | 'ko'
  defaultSlackChannel: string
}

type WhatsAppProfileForm = {
  about: string
  address: string
  description: string
  email: string
  profilePictureUrl: string
  websites: string
  vertical: string
}

const emptyWhatsAppProfileForm: WhatsAppProfileForm = {
  about: '',
  address: '',
  description: '',
  email: '',
  profilePictureUrl: '',
  websites: '',
  vertical: 'TRAVEL',
}

const ccPrompts = [
  {
    title: 'チャネル設定確認',
    prompt: `現在登録されているチャネルアカウントの設定を確認してください。
1. 各アカウントのChannel ID・名前・有効/無効ステータスを一覧表示
2. Provider token/key と webhook secret が正しく設定されているか検証
3. LINE / WhatsApp / Kakao 側の設定整合性をチェック
結果をレポートしてください。`,
  },
  {
    title: 'アカウント追加手順',
    prompt: `新しいチャネルアカウントを追加する手順をガイドしてください。
1. LINE / WhatsApp / Kakao の各管理画面での作成手順を説明
2. Channel ID、Access Token/API Key、Webhook Secretの取得方法
3. CRMへの登録手順と初期設定のベストプラクティス
手順を示してください。`,
  },
]

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<LineAccountListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [savingAccountId, setSavingAccountId] = useState<string | null>(null)
  const [settings, setSettings] = useState<Record<string, AccountSettingsForm>>({})
  const [openProfileAccountId, setOpenProfileAccountId] = useState<string | null>(null)
  const [profileForms, setProfileForms] = useState<Record<string, WhatsAppProfileForm>>({})
  const [loadingProfileAccountId, setLoadingProfileAccountId] = useState<string | null>(null)
  const [savingProfileAccountId, setSavingProfileAccountId] = useState<string | null>(null)
  const [phoneStatuses, setPhoneStatuses] = useState<Record<string, WhatsAppPhoneStatus>>({})
  const [statusErrors, setStatusErrors] = useState<Record<string, string>>({})
  const [loadingStatusAccountId, setLoadingStatusAccountId] = useState<string | null>(null)
  const [kakaoStatuses, setKakaoStatuses] = useState<Record<string, KakaoStatus>>({})
  const [kakaoStatusErrors, setKakaoStatusErrors] = useState<Record<string, string>>({})
  const [loadingKakaoStatusAccountId, setLoadingKakaoStatusAccountId] = useState<string | null>(null)
  const [form, setForm] = useState({
    channelType: 'line' as ChannelType,
    channelId: '',
    name: '',
    channelAccessToken: '',
    channelSecret: '',
    locale: 'ja' as 'ja' | 'zh-TW' | 'ko',
    defaultSlackChannel: '',
  })
  const isWhatsAppForm = form.channelType === 'whatsapp'
  const isKakaoForm = form.channelType === 'kakao'
  const kakaoWebhookUrl = `${apiBaseUrl}/webhook/kakao`

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
                locale: account.locale === 'zh-TW' || account.locale === 'ko' ? account.locale : 'ja',
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
        channelSecret: isWhatsAppForm ? form.channelSecret.trim() || '' : form.channelSecret.trim(),
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
    if (!confirm('このチャネルアカウントを削除しますか？')) return
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

  const toProfileForm = (profile: WhatsAppBusinessProfile): WhatsAppProfileForm => ({
    about: profile.about || '',
    address: profile.address || '',
    description: profile.description || '',
    email: profile.email || '',
    profilePictureUrl: profile.profile_picture_url || '',
    websites: Array.isArray(profile.websites) ? profile.websites.join('\n') : '',
    vertical: profile.vertical || 'TRAVEL',
  })

  const loadWhatsAppProfile = async (accountId: string) => {
    setOpenProfileAccountId(accountId)
    setLoadingProfileAccountId(accountId)
    setError('')
    try {
      const res = await api.lineAccounts.getWhatsAppProfile(accountId)
      if (!res.success) throw new Error(res.error || 'プロフィールの取得に失敗しました')
      setProfileForms((prev) => ({ ...prev, [accountId]: toProfileForm(res.data || {}) }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'プロフィールの取得に失敗しました')
    } finally {
      setLoadingProfileAccountId(null)
    }
  }

  const updateProfileForm = (accountId: string, patch: Partial<WhatsAppProfileForm>) => {
    setProfileForms((prev) => ({
      ...prev,
      [accountId]: {
        ...emptyWhatsAppProfileForm,
        ...prev[accountId],
        ...patch,
      },
    }))
  }

  const handleSaveWhatsAppProfile = async (accountId: string) => {
    const form = profileForms[accountId]
    if (!form) return

    setSavingProfileAccountId(accountId)
    setError('')
    try {
      const payload: WhatsAppBusinessProfile = {
        about: form.about.trim(),
        address: form.address.trim(),
        description: form.description.trim(),
        email: form.email.trim(),
        profile_picture_url: form.profilePictureUrl.trim(),
        websites: form.websites
          .split(/\n/)
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 2),
        vertical: form.vertical.trim() || 'TRAVEL',
      }
      const res = await api.lineAccounts.updateWhatsAppProfile(accountId, payload)
      if (!res.success) throw new Error(res.error || 'プロフィールの保存に失敗しました')
      setProfileForms((prev) => ({ ...prev, [accountId]: toProfileForm(res.data || payload) }))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'プロフィールの保存に失敗しました')
    } finally {
      setSavingProfileAccountId(null)
    }
  }

  const loadWhatsAppStatus = async (accountId: string) => {
    setLoadingStatusAccountId(accountId)
    setStatusErrors((prev) => ({ ...prev, [accountId]: '' }))
    try {
      const res = await api.lineAccounts.getWhatsAppStatus(accountId)
      if (res.success) {
        setPhoneStatuses((prev) => ({ ...prev, [accountId]: res.data }))
      } else {
        setStatusErrors((prev) => ({ ...prev, [accountId]: 'ステータス取得に失敗しました' }))
      }
    } catch (err) {
      setStatusErrors((prev) => ({
        ...prev,
        [accountId]: err instanceof Error ? err.message : 'ステータス取得に失敗しました',
      }))
    }
    setLoadingStatusAccountId(null)
  }

  const loadKakaoStatus = async (accountId: string) => {
    setLoadingKakaoStatusAccountId(accountId)
    setKakaoStatusErrors((prev) => ({ ...prev, [accountId]: '' }))
    try {
      const res = await api.lineAccounts.getKakaoStatus(accountId)
      if (res.success) {
        setKakaoStatuses((prev) => ({ ...prev, [accountId]: res.data }))
      } else {
        setKakaoStatusErrors((prev) => ({ ...prev, [accountId]: '接続確認に失敗しました' }))
      }
    } catch (err) {
      setKakaoStatusErrors((prev) => ({
        ...prev,
        [accountId]: err instanceof Error ? err.message : '接続確認に失敗しました',
      }))
    }
    setLoadingKakaoStatusAccountId(null)
  }

  return (
    <div>
      <Header
        title="チャネルアカウント管理"
        description="LINE / WhatsApp / Kakao マルチアカウント設定"
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
                <option value="kakao">Kakao</option>
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
                {isWhatsAppForm ? 'Phone Number ID' : isKakaoForm ? 'KakaoTalk Channel profile ID' : 'Channel ID'}
              </label>
              <input
                value={form.channelId}
                onChange={(e) => setForm({ ...form, channelId: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder={isWhatsAppForm ? '123456789012345' : isKakaoForm ? '_ZeUTxl' : '123456789'}
                required
              />
              <p className="mt-1 text-xs text-gray-400">
                {isWhatsAppForm
                  ? 'Meta / Cloud API の Phone Number ID を入力します'
                  : isKakaoForm
                    ? 'KakaoTalk Channel Manager Center のチャンネルURL末尾を入力します'
                    : 'LINE Developers Console の Channel ID を入力します'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {isWhatsAppForm ? 'Access Token' : isKakaoForm ? 'REST API Key / Admin Key' : 'Channel Access Token'}
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
                {isWhatsAppForm ? 'App Secret（任意）' : isKakaoForm ? 'Primary Admin Key' : 'Channel Secret'}
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
                    ? 'Kakao Channel Webhook の Authorization 検証に使います'
                    : 'Messaging API チャネルの secret を入力します'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">言語</label>
              <select
                value={form.locale}
                      onChange={(e) => setForm({ ...form, locale: e.target.value as 'ja' | 'zh-TW' | 'ko' })}
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
          <p className="text-xs text-gray-300">LINE / WhatsApp / Kakao の接続情報を取得して登録してください</p>
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
                        backgroundColor: account.isActive ? getChannelColor(account.channelType) : '#9CA3AF',
                        color: account.isActive ? getChannelTextColor(account.channelType) : '#ffffff',
                      }}
                    >
                      {account.channelType === 'whatsapp'
                        ? 'W'
                        : account.channelType === 'kakao'
                          ? 'K'
                          : account.displayName?.charAt(0) || 'L'}
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-gray-900">{account.displayName}</h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          account.channelType === 'whatsapp'
                            ? 'bg-emerald-100 text-emerald-700'
                            : account.channelType === 'kakao'
                              ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {getChannelLabel(account.channelType)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 font-mono">
                      {account.basicId ? `${account.basicId} · ` : ''}
                      {account.channelType === 'whatsapp'
                        ? 'Phone Number ID'
                        : account.channelType === 'kakao'
                          ? 'Profile ID'
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
                            locale: e.target.value as 'ja' | 'zh-TW' | 'ko',
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
              {account.channelType === 'whatsapp' && (
                <div className="mb-4 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-emerald-900">WhatsApp プロフィール</p>
                      <p className="mt-1 text-xs text-emerald-700">
                        About、説明、連絡先、プロフィール画像URLを Meta Cloud API に保存します。
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void loadWhatsAppStatus(account.id)}
                        className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                        disabled={loadingStatusAccountId === account.id}
                      >
                        {loadingStatusAccountId === account.id ? '確認中...' : '接続確認'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          openProfileAccountId === account.id
                            ? setOpenProfileAccountId(null)
                            : void loadWhatsAppProfile(account.id)
                        }
                        className="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                        disabled={loadingProfileAccountId === account.id}
                      >
                        {loadingProfileAccountId === account.id
                          ? '取得中...'
                          : openProfileAccountId === account.id
                            ? '閉じる'
                            : 'プロフィール編集'}
                      </button>
                    </div>
                  </div>

                  {(phoneStatuses[account.id] || statusErrors[account.id]) && (
                    <div className="mt-3 rounded-lg border border-emerald-100 bg-white p-3 text-xs">
                      {statusErrors[account.id] ? (
                        <p className="text-red-600">{statusErrors[account.id]}</p>
                      ) : (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <p><span className="font-medium text-gray-500">番号:</span> {phoneStatuses[account.id]?.display_phone_number || account.channelId}</p>
                          <p><span className="font-medium text-gray-500">表示名:</span> {phoneStatuses[account.id]?.verified_name || '-'}</p>
                          <p><span className="font-medium text-gray-500">表示名審査:</span> {phoneStatuses[account.id]?.name_status || '-'}</p>
                          <p><span className="font-medium text-gray-500">番号認証:</span> {phoneStatuses[account.id]?.code_verification_status || '-'}</p>
                          <p><span className="font-medium text-gray-500">品質:</span> {phoneStatuses[account.id]?.quality_rating || '-'}</p>
                          <p><span className="font-medium text-gray-500">送信上限:</span> {phoneStatuses[account.id]?.messaging_limit_tier || '-'}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {openProfileAccountId === account.id && (
                    <div className="mt-3 grid grid-cols-1 gap-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">About</label>
                          <input
                            value={profileForms[account.id]?.about || ''}
                            onChange={(e) => updateProfileForm(account.id, { about: e.target.value })}
                            maxLength={139}
                            className="w-full border border-emerald-200 rounded-lg px-3 py-2 text-sm"
                            placeholder="営業時間 10:00-18:00"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">業種</label>
                          <select
                            value={profileForms[account.id]?.vertical || 'TRAVEL'}
                            onChange={(e) => updateProfileForm(account.id, { vertical: e.target.value })}
                            className="w-full border border-emerald-200 rounded-lg px-3 py-2 text-sm"
                          >
                            <option value="TRAVEL">Travel</option>
                            <option value="HOTEL">Hotel</option>
                            <option value="PROF_SERVICES">Professional Services</option>
                            <option value="HEALTH">Health</option>
                            <option value="OTHER">Other</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">説明</label>
                        <textarea
                          value={profileForms[account.id]?.description || ''}
                          onChange={(e) => updateProfileForm(account.id, { description: e.target.value })}
                          maxLength={512}
                          rows={3}
                          className="w-full border border-emerald-200 rounded-lg px-3 py-2 text-sm"
                          placeholder="Accessible travel support"
                        />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">メール</label>
                          <input
                            value={profileForms[account.id]?.email || ''}
                            onChange={(e) => updateProfileForm(account.id, { email: e.target.value })}
                            className="w-full border border-emerald-200 rounded-lg px-3 py-2 text-sm"
                            placeholder="hello@example.com"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">プロフィール画像URL</label>
                          <input
                            value={profileForms[account.id]?.profilePictureUrl || ''}
                            onChange={(e) => updateProfileForm(account.id, { profilePictureUrl: e.target.value })}
                            className="w-full border border-emerald-200 rounded-lg px-3 py-2 text-sm"
                            placeholder="https://..."
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">住所</label>
                        <input
                          value={profileForms[account.id]?.address || ''}
                          onChange={(e) => updateProfileForm(account.id, { address: e.target.value })}
                          className="w-full border border-emerald-200 rounded-lg px-3 py-2 text-sm"
                          placeholder="Tokyo, Japan"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Webサイト（最大2件、改行区切り）</label>
                        <textarea
                          value={profileForms[account.id]?.websites || ''}
                          onChange={(e) => updateProfileForm(account.id, { websites: e.target.value })}
                          rows={2}
                          className="w-full border border-emerald-200 rounded-lg px-3 py-2 text-sm"
                          placeholder="https://example.com"
                        />
                      </div>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => void handleSaveWhatsAppProfile(account.id)}
                          disabled={savingProfileAccountId === account.id}
                          className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
                        >
                          {savingProfileAccountId === account.id ? '保存中...' : 'プロフィールを保存'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {account.channelType === 'kakao' && (
                <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-yellow-950">Kakao Channel 接続</p>
                      <p className="mt-1 text-xs text-yellow-800">
                        Kakao Developers のチャンネルWebhook URLに登録します。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadKakaoStatus(account.id)}
                      className="rounded-lg border border-yellow-300 bg-white px-3 py-1.5 text-xs font-medium text-yellow-900 hover:bg-yellow-50"
                      disabled={loadingKakaoStatusAccountId === account.id}
                    >
                      {loadingKakaoStatusAccountId === account.id ? '確認中...' : '接続確認'}
                    </button>
                  </div>
                  <div className="mt-3 rounded-lg border border-yellow-100 bg-white p-3 text-xs">
                    <p className="font-medium text-gray-500">Webhook URL</p>
                    <p className="mt-1 break-all font-mono text-gray-700">{kakaoWebhookUrl}</p>
                    <p className="mt-2 text-gray-400">
                      Authorization は `KakaoAK {'{'}Primary Admin Key{'}'}` で検証します。
                    </p>
                  </div>

                  {(kakaoStatuses[account.id] || kakaoStatusErrors[account.id]) && (
                    <div className="mt-3 rounded-lg border border-yellow-100 bg-white p-3 text-xs">
                      {kakaoStatusErrors[account.id] ? (
                        <p className="text-red-600">{kakaoStatusErrors[account.id]}</p>
                      ) : (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <p><span className="font-medium text-gray-500">プロフィールID:</span> {kakaoStatuses[account.id]?.channelPublicId || account.channelId}</p>
                          <p><span className="font-medium text-gray-500">顧客ファイル:</span> {kakaoStatuses[account.id]?.files?.length ?? 0}件</p>
                          <p><span className="font-medium text-gray-500">使用中slot:</span> {kakaoStatuses[account.id]?.usingSlot ?? '-'}</p>
                          <p><span className="font-medium text-gray-500">空きslot:</span> {kakaoStatuses[account.id]?.emptySlot ?? '-'}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
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
