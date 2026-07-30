'use client'

import { useState, useEffect } from 'react'
import {
  api,
  type KakaoStatus,
  type MetaMessagingStatus,
  type WeChatKfStatus,
  type WeChatQr,
  type WeChatStatus,
  type WhatsAppBusinessProfile,
  type WhatsAppPhoneStatus,
} from '@/lib/api'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'

type ChannelType = 'line' | 'whatsapp' | 'kakao' | 'wechat' | 'facebook' | 'instagram'

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
  if (channelType === 'wechat') return 'WeChat'
  if (channelType === 'facebook') return 'Messenger'
  if (channelType === 'instagram') return 'Instagram DM'
  return 'LINE'
}

function getChannelColor(channelType?: ChannelType): string {
  if (channelType === 'whatsapp') return '#25D366'
  if (channelType === 'kakao') return '#FEE500'
  if (channelType === 'wechat') return '#07C160'
  if (channelType === 'facebook') return '#0866FF'
  if (channelType === 'instagram') return '#C13584'
  return '#06C755'
}

function getChannelTextColor(channelType?: ChannelType): string {
  return channelType === 'kakao' ? '#111827' : '#ffffff'
}

type AccountSettingsForm = {
  locale: 'ja' | 'zh-TW' | 'zh-CN' | 'ko'
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

type WeChatKfForm = {
  corpId: string
  secret: string
  openKfid: string
  callbackToken: string
  encodingAesKey: string
  followUrl: string
}

const emptyWeChatKfForm: WeChatKfForm = {
  corpId: '',
  secret: '',
  openKfid: '',
  callbackToken: '',
  encodingAesKey: '',
  followUrl: '',
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
3. LINE / WhatsApp / Messenger / Instagram DM / Kakao / WeChat 側の設定整合性をチェック
結果をレポートしてください。`,
  },
  {
    title: 'アカウント追加手順',
    prompt: `新しいチャネルアカウントを追加する手順をガイドしてください。
1. LINE / WhatsApp / Messenger / Instagram DM / Kakao / WeChat の各管理画面での作成手順を説明
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
  const [metaStatuses, setMetaStatuses] = useState<Record<string, MetaMessagingStatus>>({})
  const [metaStatusErrors, setMetaStatusErrors] = useState<Record<string, string>>({})
  const [loadingMetaStatusAccountId, setLoadingMetaStatusAccountId] = useState<string | null>(null)
  const [wechatStatuses, setWeChatStatuses] = useState<Record<string, WeChatStatus>>({})
  const [wechatStatusErrors, setWeChatStatusErrors] = useState<Record<string, string>>({})
  const [loadingWeChatStatusAccountId, setLoadingWeChatStatusAccountId] = useState<string | null>(null)
  const [wechatQrs, setWeChatQrs] = useState<Record<string, WeChatQr>>({})
  const [generatingWeChatQrAccountId, setGeneratingWeChatQrAccountId] = useState<string | null>(null)
  const [openWeChatKfAccountId, setOpenWeChatKfAccountId] = useState<string | null>(null)
  const [wechatKfForms, setWeChatKfForms] = useState<Record<string, WeChatKfForm>>({})
  const [wechatKfStatuses, setWeChatKfStatuses] = useState<Record<string, WeChatKfStatus>>({})
  const [wechatKfErrors, setWeChatKfErrors] = useState<Record<string, string>>({})
  const [loadingWeChatKfAccountId, setLoadingWeChatKfAccountId] = useState<string | null>(null)
  const [savingWeChatKfAccountId, setSavingWeChatKfAccountId] = useState<string | null>(null)
  const [generatingWeChatKfLinkAccountId, setGeneratingWeChatKfLinkAccountId] = useState<string | null>(null)
  const [form, setForm] = useState({
    channelType: 'line' as ChannelType,
    channelId: '',
    name: '',
    channelAccessToken: '',
    channelSecret: '',
    wechatEncodingAesKey: '',
    locale: 'ja' as 'ja' | 'zh-TW' | 'zh-CN' | 'ko',
    defaultSlackChannel: '',
  })
  const isWhatsAppForm = form.channelType === 'whatsapp'
  const isKakaoForm = form.channelType === 'kakao'
  const isWeChatForm = form.channelType === 'wechat'
  const isFacebookForm = form.channelType === 'facebook'
  const isInstagramForm = form.channelType === 'instagram'
  const isMetaForm = isFacebookForm || isInstagramForm
  const kakaoWebhookUrl = `${apiBaseUrl}/webhook/kakao`
  const metaWebhookUrl = `${apiBaseUrl}/webhook/meta`

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
                locale: account.locale === 'zh-TW' || account.locale === 'zh-CN' || account.locale === 'ko' ? account.locale : 'ja',
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
    if (
      !form.channelId ||
      !form.name ||
      !form.channelAccessToken ||
      (!isWhatsAppForm && !form.channelSecret) ||
      (isWeChatForm && !form.wechatEncodingAesKey)
    ) return
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
        wechatEncodingAesKey: '',
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

  const loadMetaStatus = async (accountId: string) => {
    setLoadingMetaStatusAccountId(accountId)
    setMetaStatusErrors((prev) => ({ ...prev, [accountId]: '' }))
    try {
      const res = await api.lineAccounts.getMetaStatus(accountId)
      if (!res.success) throw new Error(res.error || 'Meta接続確認に失敗しました')
      setMetaStatuses((prev) => ({ ...prev, [accountId]: res.data }))
    } catch (err) {
      setMetaStatusErrors((prev) => ({
        ...prev,
        [accountId]: err instanceof Error ? err.message : 'Meta接続確認に失敗しました',
      }))
    } finally {
      setLoadingMetaStatusAccountId(null)
    }
  }

  const loadWeChatStatus = async (accountId: string) => {
    setLoadingWeChatStatusAccountId(accountId)
    setWeChatStatusErrors((prev) => ({ ...prev, [accountId]: '' }))
    try {
      const res = await api.lineAccounts.getWeChatStatus(accountId)
      if (res.success) {
        setWeChatStatuses((prev) => ({ ...prev, [accountId]: res.data }))
      } else {
        setWeChatStatusErrors((prev) => ({ ...prev, [accountId]: '接続確認に失敗しました' }))
      }
    } catch (err) {
      setWeChatStatusErrors((prev) => ({
        ...prev,
        [accountId]: err instanceof Error ? err.message : '接続確認に失敗しました',
      }))
    }
    setLoadingWeChatStatusAccountId(null)
  }

  const generateWeChatQr = async (accountId: string) => {
    setGeneratingWeChatQrAccountId(accountId)
    setWeChatStatusErrors((prev) => ({ ...prev, [accountId]: '' }))
    try {
      const res = await api.lineAccounts.generateWeChatQr(accountId)
      if (!res.success) throw new Error(res.error || 'QRコード生成に失敗しました')
      setWeChatQrs((prev) => ({ ...prev, [accountId]: res.data }))
      await loadWeChatStatus(accountId)
    } catch (err) {
      setWeChatStatusErrors((prev) => ({
        ...prev,
        [accountId]: err instanceof Error ? err.message : 'QRコード生成に失敗しました',
      }))
    }
    setGeneratingWeChatQrAccountId(null)
  }

  const updateWeChatKfForm = (accountId: string, patch: Partial<WeChatKfForm>) => {
    setWeChatKfForms((prev) => ({
      ...prev,
      [accountId]: {
        ...emptyWeChatKfForm,
        ...prev[accountId],
        ...patch,
      },
    }))
  }

  const loadWeChatKfStatus = async (accountId: string) => {
    setLoadingWeChatKfAccountId(accountId)
    setWeChatKfErrors((prev) => ({ ...prev, [accountId]: '' }))
    try {
      const res = await api.lineAccounts.getWeChatKfStatus(accountId)
      if (!res.success) throw new Error(res.error || '微信客服の接続確認に失敗しました')
      setWeChatKfStatuses((prev) => ({ ...prev, [accountId]: res.data }))
      if (res.data.openKfid) {
        updateWeChatKfForm(accountId, { openKfid: res.data.openKfid })
      }
    } catch (err) {
      setWeChatKfErrors((prev) => ({
        ...prev,
        [accountId]: err instanceof Error ? err.message : '微信客服の接続確認に失敗しました',
      }))
    } finally {
      setLoadingWeChatKfAccountId(null)
    }
  }

  const openWeChatKfConfig = async (accountId: string) => {
    if (openWeChatKfAccountId === accountId) {
      setOpenWeChatKfAccountId(null)
      return
    }
    setOpenWeChatKfAccountId(accountId)
    setLoadingWeChatKfAccountId(accountId)
    setWeChatKfErrors((prev) => ({ ...prev, [accountId]: '' }))
    try {
      const res = await api.lineAccounts.get(accountId)
      if (!res.success) throw new Error(res.error || '微信客服設定の取得に失敗しました')
      updateWeChatKfForm(accountId, {
        corpId: res.data.wechatKfCorpId || '',
        secret: res.data.wechatKfSecret || '',
        openKfid: res.data.wechatKfOpenKfid || '',
        callbackToken: res.data.wechatKfCallbackToken || '',
        encodingAesKey: res.data.wechatKfEncodingAesKey || '',
        followUrl: res.data.wechatFollowUrl || '',
      })
      await loadWeChatKfStatus(accountId)
    } catch (err) {
      setWeChatKfErrors((prev) => ({
        ...prev,
        [accountId]: err instanceof Error ? err.message : '微信客服設定の取得に失敗しました',
      }))
      setLoadingWeChatKfAccountId(null)
    }
  }

  const saveWeChatKfConfig = async (accountId: string) => {
    const current = wechatKfForms[accountId]
    if (!current) return
    setSavingWeChatKfAccountId(accountId)
    setWeChatKfErrors((prev) => ({ ...prev, [accountId]: '' }))
    try {
      const res = await api.lineAccounts.update(accountId, {
        wechatKfCorpId: current.corpId.trim() || null,
        wechatKfSecret: current.secret.trim() || null,
        wechatKfOpenKfid: current.openKfid.trim() || null,
        wechatKfCallbackToken: current.callbackToken.trim() || null,
        wechatKfEncodingAesKey: current.encodingAesKey.trim() || null,
        wechatFollowUrl: current.followUrl.trim() || null,
      })
      if (!res.success) throw new Error(res.error || '微信客服設定の保存に失敗しました')
      await loadWeChatKfStatus(accountId)
    } catch (err) {
      setWeChatKfErrors((prev) => ({
        ...prev,
        [accountId]: err instanceof Error ? err.message : '微信客服設定の保存に失敗しました',
      }))
    } finally {
      setSavingWeChatKfAccountId(null)
    }
  }

  const generateWeChatKfLink = async (accountId: string) => {
    setGeneratingWeChatKfLinkAccountId(accountId)
    setWeChatKfErrors((prev) => ({ ...prev, [accountId]: '' }))
    try {
      const res = await api.lineAccounts.generateWeChatKfLink(accountId)
      if (!res.success) throw new Error(res.error || '直接相談URLの生成に失敗しました')
      await loadWeChatKfStatus(accountId)
    } catch (err) {
      setWeChatKfErrors((prev) => ({
        ...prev,
        [accountId]: err instanceof Error ? err.message : '直接相談URLの生成に失敗しました',
      }))
    } finally {
      setGeneratingWeChatKfLinkAccountId(null)
    }
  }

  return (
    <div>
      <Header
        title="チャネルアカウント管理"
        description="LINE / WhatsApp / Messenger / Instagram DM / Kakao / WeChat マルチアカウント設定"
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
                <option value="facebook">Facebook Messenger</option>
                <option value="instagram">Instagram DM</option>
                <option value="kakao">Kakao</option>
                <option value="wechat">WeChat</option>
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
                {isWhatsAppForm
                  ? 'Phone Number ID'
                  : isFacebookForm
                    ? 'Facebook Page ID'
                    : isInstagramForm
                      ? 'Instagram Professional Account ID'
                      : isKakaoForm
                        ? 'KakaoTalk Channel profile ID'
                        : isWeChatForm
                          ? 'AppID'
                          : 'Channel ID'}
              </label>
              <input
                value={form.channelId}
                onChange={(e) => setForm({ ...form, channelId: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder={isWhatsAppForm || isMetaForm ? '123456789012345' : isKakaoForm ? '_ZeUTxl' : isWeChatForm ? 'wx1234567890abcdef' : '123456789'}
                required
              />
              <p className="mt-1 text-xs text-gray-400">
                {isWhatsAppForm
                  ? 'Meta / Cloud API の Phone Number ID を入力します'
                  : isFacebookForm
                    ? 'Messengerを有効化するFacebookページのPage IDを入力します'
                    : isInstagramForm
                      ? 'Facebookページに接続したInstagramプロアカウントのIDを入力します'
                  : isKakaoForm
                    ? 'KakaoTalk Channel Manager Center のチャンネルURL末尾を入力します'
                    : isWeChatForm
                      ? 'WeChat Official Account の Developer ID (AppID) を入力します'
                    : 'LINE Developers Console の Channel ID を入力します'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {isWhatsAppForm
                  ? 'Access Token'
                  : isMetaForm
                    ? 'Page Access Token'
                    : isKakaoForm
                      ? 'REST API Key / Admin Key'
                      : isWeChatForm
                        ? 'AppSecret'
                        : 'Channel Access Token'}
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
                {isWhatsAppForm
                  ? 'App Secret（任意）'
                  : isMetaForm
                    ? 'Meta App Secret'
                    : isKakaoForm
                      ? 'Primary Admin Key'
                      : isWeChatForm
                        ? 'Token'
                        : 'Channel Secret'}
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
                  : isMetaForm
                    ? 'X-Hub-Signature-256によるWebhook署名検証に使います'
                  : isKakaoForm
                    ? 'Kakao Channel Webhook の Authorization 検証に使います'
                    : isWeChatForm
                      ? 'WeChatのサーバー設定で指定する3〜32文字のTokenと同じ値です'
                    : 'Messaging API チャネルの secret を入力します'}
              </p>
            </div>
            {isWeChatForm && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">EncodingAESKey</label>
                <input
                  type="password"
                  value={form.wechatEncodingAesKey}
                  onChange={(e) => setForm({ ...form, wechatEncodingAesKey: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  minLength={43}
                  maxLength={43}
                  required
                />
                <p className="mt-1 text-xs text-gray-400">WeChat管理画面で生成した43文字の鍵を入力し、安全モードで接続します</p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">言語</label>
              <select
                value={form.locale}
                      onChange={(e) => setForm({ ...form, locale: e.target.value as 'ja' | 'zh-TW' | 'zh-CN' | 'ko' })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="ja">日本語</option>
                <option value="zh-TW">繁體中文</option>
                <option value="zh-CN">简体中文</option>
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
          <p className="text-xs text-gray-300">LINE / WhatsApp / Messenger / Instagram DM / Kakao / WeChat の接続情報を取得して登録してください</p>
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
                        : account.channelType === 'facebook'
                          ? 'M'
                          : account.channelType === 'instagram'
                            ? 'IG'
                        : account.channelType === 'kakao'
                          ? 'K'
                          : account.channelType === 'wechat'
                            ? '微'
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
                            : account.channelType === 'facebook'
                              ? 'bg-blue-100 text-blue-700'
                              : account.channelType === 'instagram'
                                ? 'bg-pink-100 text-pink-700'
                            : account.channelType === 'kakao'
                              ? 'bg-yellow-100 text-yellow-800'
                              : account.channelType === 'wechat'
                                ? 'bg-green-100 text-green-800'
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
                        : account.channelType === 'facebook'
                          ? 'Page ID'
                          : account.channelType === 'instagram'
                            ? 'Instagram Account ID'
                        : account.channelType === 'kakao'
                          ? 'Profile ID'
                          : account.channelType === 'wechat'
                            ? 'AppID'
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
                            locale: e.target.value as 'ja' | 'zh-TW' | 'zh-CN' | 'ko',
                            defaultSlackChannel: prev[account.id]?.defaultSlackChannel || '',
                          },
                        }))
                      }
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    >
                      <option value="ja">日本語</option>
                      <option value="zh-TW">繁體中文</option>
                      <option value="zh-CN">简体中文</option>
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
              {(account.channelType === 'facebook' || account.channelType === 'instagram') && (
                <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-blue-950">
                        {account.channelType === 'facebook' ? 'Facebook Messenger' : 'Instagram DM'} 接続
                      </p>
                      <p className="mt-1 text-xs text-blue-800">
                        Meta公式Webhookの受信と、24時間返信枠内のテキスト返信をFlat Harnessへ接続します。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadMetaStatus(account.id)}
                      className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-900 hover:bg-blue-50"
                      disabled={loadingMetaStatusAccountId === account.id}
                    >
                      {loadingMetaStatusAccountId === account.id ? '確認中...' : 'API接続確認'}
                    </button>
                  </div>
                  <div className="mt-3 rounded-lg border border-blue-100 bg-white p-3 text-xs">
                    <p className="font-medium text-gray-500">Metaへ登録する共通Webhook URL</p>
                    <p className="mt-1 break-all font-mono text-gray-700">
                      {metaStatuses[account.id]?.webhookUrl || metaWebhookUrl}
                    </p>
                    <p className="mt-2 text-gray-400">
                      Verify TokenはWorker secretの `META_VERIFY_TOKEN` と一致させます。App Secretは受信署名の検証だけに使います。
                    </p>
                  </div>

                  {(metaStatuses[account.id] || metaStatusErrors[account.id]) && (
                    <div className="mt-3 rounded-lg border border-blue-100 bg-white p-3 text-xs">
                      {metaStatusErrors[account.id] ? (
                        <p className="text-red-600">{metaStatusErrors[account.id]}</p>
                      ) : (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <p><span className="font-medium text-gray-500">API:</span> 接続済み</p>
                          <p><span className="font-medium text-gray-500">ID:</span> {metaStatuses[account.id]?.id || account.channelId}</p>
                          <p><span className="font-medium text-gray-500">名前:</span> {metaStatuses[account.id]?.name || '-'}</p>
                          <p><span className="font-medium text-gray-500">ユーザー名:</span> {metaStatuses[account.id]?.username ? `@${metaStatuses[account.id]?.username}` : '-'}</p>
                          <p className="sm:col-span-2"><span className="font-medium text-gray-500">返信ポリシー:</span> お客様の最終受信から{metaStatuses[account.id]?.replyWindowHours || 24}時間以内</p>
                        </div>
                      )}
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
              {account.channelType === 'wechat' && (
                <div className="mb-4 rounded-lg border border-green-200 bg-green-50/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-green-950">WeChat Official Account 接続</p>
                      <p className="mt-1 text-xs text-green-800">
                        安全モードのWebhook受信、API返信、フォロー用QRをFlat Harnessに接続します。
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void loadWeChatStatus(account.id)}
                        className="rounded-lg border border-green-300 bg-white px-3 py-1.5 text-xs font-medium text-green-900 hover:bg-green-50"
                        disabled={loadingWeChatStatusAccountId === account.id}
                      >
                        {loadingWeChatStatusAccountId === account.id ? '確認中...' : 'API接続確認'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void generateWeChatQr(account.id)}
                        className="rounded-lg bg-green-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                        disabled={generatingWeChatQrAccountId === account.id}
                      >
                        {generatingWeChatQrAccountId === account.id ? '生成中...' : 'フォロー用QR生成'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 space-y-3 rounded-lg border border-green-100 bg-white p-3 text-xs">
                    <div>
                      <p className="font-medium text-gray-500">Webhook URL</p>
                      <p className="mt-1 break-all font-mono text-gray-700">
                        {wechatStatuses[account.id]?.webhookUrl || `${apiBaseUrl}/webhook/wechat/${account.id}`}
                      </p>
                    </div>
                    <div>
                      <p className="font-medium text-gray-500">お客様共有URL</p>
                      <a
                        href={wechatQrs[account.id]?.landingUrl || wechatStatuses[account.id]?.landingUrl || `${apiBaseUrl}/wechat/${account.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block break-all font-mono text-green-700 underline"
                      >
                        {wechatQrs[account.id]?.landingUrl || wechatStatuses[account.id]?.landingUrl || `${apiBaseUrl}/wechat/${account.id}`}
                      </a>
                    </div>
                    <p className="text-gray-400">WeChat管理画面では「安全モード」を選び、このWebhook URL、Token、EncodingAESKeyを保存します。</p>
                  </div>

                  {(wechatStatuses[account.id] || wechatStatusErrors[account.id]) && (
                    <div className="mt-3 rounded-lg border border-green-100 bg-white p-3 text-xs">
                      {wechatStatusErrors[account.id] ? (
                        <p className="text-red-600">{wechatStatusErrors[account.id]}</p>
                      ) : (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <p><span className="font-medium text-gray-500">AppID:</span> {wechatStatuses[account.id]?.appId}</p>
                          <p><span className="font-medium text-gray-500">API:</span> 接続済み</p>
                          <p><span className="font-medium text-gray-500">安全モード:</span> {wechatStatuses[account.id]?.encryptedModeReady ? '準備済み' : '鍵未設定'}</p>
                          <p><span className="font-medium text-gray-500">QR:</span> {wechatStatuses[account.id]?.qrReady ? '生成済み' : '未生成'}</p>
                          <p className="sm:col-span-2"><span className="font-medium text-gray-500">Token有効期限:</span> {wechatStatuses[account.id]?.tokenExpiresAt ? new Date(wechatStatuses[account.id].tokenExpiresAt as string).toLocaleString('ja-JP') : '-'}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {(wechatQrs[account.id] || wechatStatuses[account.id]?.qrReady) && (
                    <div className="mt-3 flex flex-col items-center rounded-lg border border-green-100 bg-white p-4">
                      <img
                        src={wechatQrs[account.id]?.imageUrl || `${apiBaseUrl}/wechat/${account.id}/qr.png`}
                        alt={`${account.displayName} WeChat QR`}
                        className="h-52 w-52 rounded-lg border border-gray-100 object-contain"
                      />
                      <a
                        href={wechatQrs[account.id]?.imageUrl || `${apiBaseUrl}/wechat/${account.id}/qr.png`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 text-xs font-medium text-green-700 underline"
                      >
                        QRコードを開く
                      </a>
                    </div>
                  )}

                  <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50/70 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-teal-950">微信客服（QR不要の直接相談）</p>
                        <p className="mt-1 text-xs leading-5 text-teal-800">
                          外部サイトのボタンから微信客服を開き、入室時に公式アカウントのフォロー案内を自動表示します。
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void loadWeChatKfStatus(account.id)}
                          disabled={loadingWeChatKfAccountId === account.id}
                          className="rounded-lg border border-teal-300 bg-white px-3 py-1.5 text-xs font-medium text-teal-900 hover:bg-teal-50 disabled:opacity-50"
                        >
                          {loadingWeChatKfAccountId === account.id ? '確認中...' : '接続確認'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void openWeChatKfConfig(account.id)}
                          disabled={loadingWeChatKfAccountId === account.id}
                          className="rounded-lg bg-teal-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                        >
                          {openWeChatKfAccountId === account.id ? '設定を閉じる' : '微信客服を設定'}
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 space-y-3 rounded-lg border border-teal-100 bg-white p-3 text-xs">
                      <div>
                        <p className="font-medium text-gray-500">企業微信へ登録するコールバックURL</p>
                        <p className="mt-1 break-all font-mono text-gray-700">
                          {wechatKfStatuses[account.id]?.callbackUrl || `${apiBaseUrl}/webhook/wechat-kf/${account.id}`}
                        </p>
                      </div>
                      <div>
                        <p className="font-medium text-gray-500">サイトに設置する直接相談URL</p>
                        <a
                          href={wechatKfStatuses[account.id]?.directUrl || `${apiBaseUrl}/wechat/${account.id}/contact`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 block break-all font-mono text-teal-700 underline"
                        >
                          {wechatKfStatuses[account.id]?.directUrl || `${apiBaseUrl}/wechat/${account.id}/contact`}
                        </a>
                        <p className="mt-1 text-gray-400">
                          流入元を識別する場合は末尾に `?ref=tour-slug` を付けられます。
                        </p>
                      </div>
                    </div>

                    {(wechatKfStatuses[account.id] || wechatKfErrors[account.id]) && (
                      <div className="mt-3 rounded-lg border border-teal-100 bg-white p-3 text-xs">
                        {wechatKfErrors[account.id] ? (
                          <p className="text-red-600">{wechatKfErrors[account.id]}</p>
                        ) : (
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <p>
                              <span className="font-medium text-gray-500">API:</span>{' '}
                              {wechatKfStatuses[account.id]?.connected
                                ? '接続済み'
                                : wechatKfStatuses[account.id]?.configured
                                  ? '確認待ち'
                                  : '未設定'}
                            </p>
                            <p>
                              <span className="font-medium text-gray-500">コールバック:</span>{' '}
                              {wechatKfStatuses[account.id]?.callbackReady ? '準備済み' : 'Token・鍵未設定'}
                            </p>
                            <p>
                              <span className="font-medium text-gray-500">直接相談URL:</span>{' '}
                              {wechatKfStatuses[account.id]?.contactUrlReady ? '生成済み' : '未生成'}
                            </p>
                            <p>
                              <span className="font-medium text-gray-500">フォローボタン:</span>{' '}
                              {wechatKfStatuses[account.id]?.followUrlReady ? '設定済み' : '遷移先未設定'}
                            </p>
                            {wechatKfStatuses[account.id]?.accountName && (
                              <p className="sm:col-span-2">
                                <span className="font-medium text-gray-500">客服アカウント:</span>{' '}
                                {wechatKfStatuses[account.id]?.accountName}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {openWeChatKfAccountId === account.id && (
                      <div className="mt-3 space-y-3 rounded-lg border border-teal-200 bg-white p-4">
                        <div className="rounded-lg bg-teal-50 p-3 text-xs leading-5 text-teal-900">
                          企業微信の「微信客服 → API → 受信イベントサーバー」で、下記と同じ
                          Token・EncodingAESKeyを設定します。CorpID、Secret、open_kfidは微信客服側から取得します。
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs font-medium text-gray-600">CorpID</label>
                            <input
                              value={wechatKfForms[account.id]?.corpId || ''}
                              onChange={(e) => updateWeChatKfForm(account.id, { corpId: e.target.value })}
                              className="w-full rounded-lg border border-teal-200 px-3 py-2 text-sm"
                              placeholder="ww..."
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-gray-600">open_kfid</label>
                            <input
                              value={wechatKfForms[account.id]?.openKfid || ''}
                              onChange={(e) => updateWeChatKfForm(account.id, { openKfid: e.target.value })}
                              className="w-full rounded-lg border border-teal-200 px-3 py-2 text-sm"
                              placeholder="wk..."
                              list={`wechat-kf-accounts-${account.id}`}
                            />
                            <datalist id={`wechat-kf-accounts-${account.id}`}>
                              {(wechatKfStatuses[account.id]?.availableAccounts || []).map((item) => (
                                <option key={item.openKfid} value={item.openKfid}>
                                  {item.name || item.openKfid}
                                </option>
                              ))}
                            </datalist>
                            {(wechatKfStatuses[account.id]?.availableAccounts?.length || 0) > 0 && (
                              <p className="mt-1 text-gray-400">
                                APIで取得した客服アカウントから選択できます。
                              </p>
                            )}
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-gray-600">微信客服 Secret</label>
                          <input
                            type="password"
                            value={wechatKfForms[account.id]?.secret || ''}
                            onChange={(e) => updateWeChatKfForm(account.id, { secret: e.target.value })}
                            className="w-full rounded-lg border border-teal-200 px-3 py-2 text-sm"
                            autoComplete="new-password"
                            placeholder="微信客服 API Secret"
                          />
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs font-medium text-gray-600">コールバック Token</label>
                            <input
                              value={wechatKfForms[account.id]?.callbackToken || ''}
                              onChange={(e) => updateWeChatKfForm(account.id, { callbackToken: e.target.value })}
                              className="w-full rounded-lg border border-teal-200 px-3 py-2 text-sm"
                              placeholder="3〜32文字"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-gray-600">EncodingAESKey</label>
                            <input
                              value={wechatKfForms[account.id]?.encodingAesKey || ''}
                              onChange={(e) => updateWeChatKfForm(account.id, { encodingAesKey: e.target.value })}
                              className="w-full rounded-lg border border-teal-200 px-3 py-2 text-sm"
                              placeholder="43文字"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-gray-600">
                            公式アカウントのプロフィール／記事URL
                          </label>
                          <input
                            type="url"
                            value={wechatKfForms[account.id]?.followUrl || ''}
                            onChange={(e) => updateWeChatKfForm(account.id, { followUrl: e.target.value })}
                            className="w-full rounded-lg border border-teal-200 px-3 py-2 text-sm"
                            placeholder="https://mp.weixin.qq.com/..."
                          />
                          <p className="mt-1 text-gray-400">
                            入室時メニューの「关注官方账号」ボタンで開く、公開済み記事または公式プロフィールのHTTPS URLです。
                          </p>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => void saveWeChatKfConfig(account.id)}
                            disabled={savingWeChatKfAccountId === account.id}
                            className="rounded-lg border border-teal-300 bg-white px-4 py-2 text-xs font-medium text-teal-900 disabled:opacity-50"
                          >
                            {savingWeChatKfAccountId === account.id ? '保存中...' : '設定を保存'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void generateWeChatKfLink(account.id)}
                            disabled={
                              generatingWeChatKfLinkAccountId === account.id
                              || !wechatKfStatuses[account.id]?.connected
                              || !wechatKfStatuses[account.id]?.openKfidReady
                            }
                            className="rounded-lg bg-teal-800 px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
                          >
                            {generatingWeChatKfLinkAccountId === account.id
                              ? '生成中...'
                              : '直接相談URLを生成'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
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
