'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import type { WeChatKfStatus, WeChatQr, WeChatStatus } from '@/lib/api'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'
import TestRecipientsSetting from '@/components/accounts/test-recipients-setting'

interface LineAccountListItem {
  id: string
  channelId: string
  name: string
  displayName: string
  pictureUrl: string | null
  basicId: string | null
  channelType?: 'line' | 'whatsapp' | 'kakao' | 'wechat'
  isActive: boolean
  createdAt: string
  updatedAt: string
  stats: {
    friendCount: number
    activeScenarios: number
    messagesThisMonth: number
  }
}

interface WeChatKfAccountConfig {
  wechatKfCorpId?: string | null
  wechatKfSecret?: string | null
  wechatKfOpenKfid?: string | null
  wechatKfCallbackToken?: string | null
  wechatKfEncodingAesKey?: string | null
  wechatFollowUrl?: string | null
}

interface WeChatKfForm {
  corpId: string
  secret: string
  openKfid: string
  callbackToken: string
  encodingAesKey: string
  followUrl: string
}

const ccPrompts = [
  {
    title: 'LINEアカウント設定確認',
    prompt: `現在登録されているLINEアカウントのチャネル設定を確認してください。
1. 各アカウントのChannel ID・名前・有効/無効ステータスを一覧表示
2. Channel Access TokenとChannel Secretが正しく設定されているか検証
3. LINE Developers Consoleとの設定整合性をチェック
結果をレポートしてください。`,
  },
  {
    title: 'アカウント追加手順',
    prompt: `新しいLINEアカウントを追加する手順をガイドしてください。
1. LINE Developers Consoleでのチャネル作成手順を説明
2. Channel ID、Channel Access Token、Channel Secretの取得方法
3. CRMへの登録手順と初期設定のベストプラクティス
手順を示してください。`,
  },
]

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<LineAccountListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ channelId: '', name: '', channelAccessToken: '', channelSecret: '' })
  const [wechatStatuses, setWeChatStatuses] = useState<Record<string, WeChatStatus>>({})
  const [wechatQrs, setWeChatQrs] = useState<Record<string, WeChatQr>>({})
  const [wechatErrors, setWeChatErrors] = useState<Record<string, string>>({})
  const [checkingWeChatId, setCheckingWeChatId] = useState<string | null>(null)
  const [generatingWeChatQrId, setGeneratingWeChatQrId] = useState<string | null>(null)
  const [openWeChatKfId, setOpenWeChatKfId] = useState<string | null>(null)
  const [wechatKfForms, setWeChatKfForms] = useState<Record<string, WeChatKfForm>>({})
  const [wechatKfStatuses, setWeChatKfStatuses] = useState<Record<string, WeChatKfStatus>>({})
  const [wechatKfErrors, setWeChatKfErrors] = useState<Record<string, string>>({})
  const [loadingWeChatKfId, setLoadingWeChatKfId] = useState<string | null>(null)
  const [savingWeChatKfId, setSavingWeChatKfId] = useState<string | null>(null)
  const [generatingWeChatKfLinkId, setGeneratingWeChatKfLinkId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.lineAccounts.list()
      if (res.success) {
        setAccounts(res.data as unknown as LineAccountListItem[])
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
    if (!form.channelId || !form.name || !form.channelAccessToken || !form.channelSecret) return
    try {
      await api.lineAccounts.create(form)
      setForm({ channelId: '', name: '', channelAccessToken: '', channelSecret: '' })
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

  const loadWeChatStatus = async (id: string) => {
    setCheckingWeChatId(id)
    setWeChatErrors((current) => ({ ...current, [id]: '' }))
    try {
      const res = await api.lineAccounts.getWeChatStatus(id)
      if (!res.success) throw new Error('WeChat APIの接続確認に失敗しました')
      setWeChatStatuses((current) => ({ ...current, [id]: res.data }))
    } catch (err) {
      setWeChatErrors((current) => ({
        ...current,
        [id]: err instanceof Error ? err.message : 'WeChat APIの接続確認に失敗しました',
      }))
    } finally {
      setCheckingWeChatId(null)
    }
  }

  const generateWeChatQr = async (id: string) => {
    setGeneratingWeChatQrId(id)
    setWeChatErrors((current) => ({ ...current, [id]: '' }))
    try {
      const res = await api.lineAccounts.generateWeChatQr(id)
      if (!res.success) throw new Error('WeChatフォロー導線の生成に失敗しました')
      setWeChatQrs((current) => ({ ...current, [id]: res.data }))
      await loadWeChatStatus(id)
    } catch (err) {
      setWeChatErrors((current) => ({
        ...current,
        [id]: err instanceof Error ? err.message : 'WeChatフォロー導線の生成に失敗しました',
      }))
    } finally {
      setGeneratingWeChatQrId(null)
    }
  }

  const updateWeChatKfForm = (id: string, patch: Partial<WeChatKfForm>) => {
    setWeChatKfForms((current) => {
      const existing = current[id] || {
        corpId: '',
        secret: '',
        openKfid: '',
        callbackToken: '',
        encodingAesKey: '',
        followUrl: '',
      }
      return {
        ...current,
        [id]: { ...existing, ...patch },
      }
    })
  }

  const loadWeChatKfStatus = async (id: string) => {
    setLoadingWeChatKfId(id)
    setWeChatKfErrors((current) => ({ ...current, [id]: '' }))
    try {
      const res = await api.lineAccounts.getWeChatKfStatus(id)
      if (!res.success) throw new Error('微信客服の接続確認に失敗しました')
      setWeChatKfStatuses((current) => ({ ...current, [id]: res.data }))
    } catch (err) {
      setWeChatKfErrors((current) => ({
        ...current,
        [id]: err instanceof Error ? err.message : '微信客服の接続確認に失敗しました',
      }))
    } finally {
      setLoadingWeChatKfId(null)
    }
  }

  const openWeChatKfSettings = async (id: string) => {
    if (openWeChatKfId === id) {
      setOpenWeChatKfId(null)
      return
    }
    setOpenWeChatKfId(id)
    setLoadingWeChatKfId(id)
    setWeChatKfErrors((current) => ({ ...current, [id]: '' }))
    try {
      const res = await api.lineAccounts.get(id)
      if (!res.success) throw new Error('微信客服設定の取得に失敗しました')
      const config = res.data as typeof res.data & WeChatKfAccountConfig
      updateWeChatKfForm(id, {
        corpId: config.wechatKfCorpId || '',
        secret: config.wechatKfSecret || '',
        openKfid: config.wechatKfOpenKfid || '',
        callbackToken: config.wechatKfCallbackToken || '',
        encodingAesKey: config.wechatKfEncodingAesKey || '',
        followUrl: config.wechatFollowUrl || '',
      })
      const statusRes = await api.lineAccounts.getWeChatKfStatus(id)
      if (statusRes.success) {
        setWeChatKfStatuses((current) => ({ ...current, [id]: statusRes.data }))
      }
    } catch (err) {
      setWeChatKfErrors((current) => ({
        ...current,
        [id]: err instanceof Error ? err.message : '微信客服設定の取得に失敗しました',
      }))
    } finally {
      setLoadingWeChatKfId(null)
    }
  }

  const saveWeChatKfSettings = async (id: string) => {
    const current = wechatKfForms[id]
    if (!current) return
    setSavingWeChatKfId(id)
    setWeChatKfErrors((errors) => ({ ...errors, [id]: '' }))
    try {
      const res = await api.lineAccounts.update(id, {
        wechatKfCorpId: current.corpId.trim() || null,
        wechatKfSecret: current.secret.trim() || null,
        wechatKfOpenKfid: current.openKfid.trim() || null,
        wechatKfCallbackToken: current.callbackToken.trim() || null,
        wechatKfEncodingAesKey: current.encodingAesKey.trim() || null,
        wechatFollowUrl: current.followUrl.trim() || null,
      })
      if (!res.success) throw new Error('微信客服設定の保存に失敗しました')
      await loadWeChatKfStatus(id)
    } catch (err) {
      setWeChatKfErrors((errors) => ({
        ...errors,
        [id]: err instanceof Error ? err.message : '微信客服設定の保存に失敗しました',
      }))
    } finally {
      setSavingWeChatKfId(null)
    }
  }

  const generateWeChatKfLink = async (id: string) => {
    setGeneratingWeChatKfLinkId(id)
    setWeChatKfErrors((current) => ({ ...current, [id]: '' }))
    try {
      const res = await api.lineAccounts.generateWeChatKfLink(id, 'flat-travel-web')
      if (!res.success) throw new Error('直接チャットURLの生成に失敗しました')
      await loadWeChatKfStatus(id)
    } catch (err) {
      setWeChatKfErrors((current) => ({
        ...current,
        [id]: err instanceof Error ? err.message : '直接チャットURLの生成に失敗しました',
      }))
    } finally {
      setGeneratingWeChatKfLinkId(null)
    }
  }

  return (
    <div>
      <Header
        title="チャネルアカウント管理"
        description="LINE・WhatsApp・Kakao・WeChatの接続設定"
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Channel ID</label>
              <input
                value={form.channelId}
                onChange={(e) => setForm({ ...form, channelId: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="123456789"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Channel Access Token</label>
              <input
                type="password"
                value={form.channelAccessToken}
                onChange={(e) => setForm({ ...form, channelAccessToken: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Channel Secret</label>
              <input
                type="password"
                value={form.channelSecret}
                onChange={(e) => setForm({ ...form, channelSecret: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                required
              />
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
          <p className="mb-2">LINEアカウントが登録されていません</p>
          <p className="text-xs text-gray-300">LINE Developers Console からChannel情報を取得して登録してください</p>
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
                      style={{ backgroundColor: account.isActive ? '#06C755' : '#9CA3AF' }}
                    >
                      {account.channelType === 'wechat' ? '微' : account.displayName?.charAt(0) || 'L'}
                    </div>
                  )}
                  <div>
                    <h3 className="text-sm font-bold text-gray-900">{account.displayName}</h3>
                    <p className="text-xs text-gray-400 font-mono">
                      {account.basicId ? `${account.basicId} · ` : ''}
                      {account.channelType === 'wechat' ? 'AppID' : 'Channel'}: {account.channelId}
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
              <TestRecipientsSetting accountId={account.id} />

              {account.channelType === 'wechat' && (
                <div className="mt-4 rounded-lg border border-green-200 bg-green-50/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-green-950">WeChat Service Account</p>
                      <p className="mt-1 text-xs leading-5 text-green-800">
                        既存のAppIDを使い、フォロー後のメッセージをFlat Harnessで受信・返信します。
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => loadWeChatStatus(account.id)}
                        disabled={checkingWeChatId === account.id}
                        className="rounded-lg border border-green-700 bg-white px-3 py-1.5 text-xs font-medium text-green-800 disabled:opacity-50"
                      >
                        {checkingWeChatId === account.id ? '確認中...' : 'API接続確認'}
                      </button>
                      <button
                        type="button"
                        onClick={() => generateWeChatQr(account.id)}
                        disabled={generatingWeChatQrId === account.id}
                        className="rounded-lg bg-green-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      >
                        {generatingWeChatQrId === account.id ? '生成中...' : 'フォロー用QRを生成'}
                      </button>
                    </div>
                  </div>

                  {wechatErrors[account.id] && (
                    <p className="mt-3 rounded-md border border-red-200 bg-white p-2 text-xs text-red-700">
                      {wechatErrors[account.id]}
                    </p>
                  )}

                  {wechatStatuses[account.id] && (
                    <div className="mt-3 grid grid-cols-1 gap-2 rounded-md border border-green-100 bg-white p-3 text-xs sm:grid-cols-2">
                      <p><span className="font-medium text-gray-500">API:</span> 接続済み</p>
                      <p><span className="font-medium text-gray-500">安全モード:</span> {wechatStatuses[account.id].encryptedModeReady ? '準備済み' : '鍵未設定'}</p>
                      <p><span className="font-medium text-gray-500">フォローQR:</span> {wechatStatuses[account.id].qrReady ? '生成済み' : '未生成'}</p>
                      <p><span className="font-medium text-gray-500">Token有効期限:</span> {wechatStatuses[account.id].tokenExpiresAt ? new Date(wechatStatuses[account.id].tokenExpiresAt as string).toLocaleString('ja-JP') : '-'}</p>
                      <div className="sm:col-span-2">
                        <p className="font-medium text-gray-500">フォローQRページ（PC・印刷向け）</p>
                        <a
                          href={wechatStatuses[account.id].landingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 block break-all font-mono text-green-700 underline"
                        >
                          {wechatStatuses[account.id].landingUrl}
                        </a>
                      </div>
                    </div>
                  )}

                  {wechatQrs[account.id] && (
                    <div className="mt-3 flex flex-col items-center rounded-md border border-green-100 bg-white p-4">
                      <img
                        src={wechatQrs[account.id].imageUrl}
                        alt={`${account.displayName} WeChat follow QR`}
                        className="h-48 w-48 rounded-lg border border-gray-100 object-contain"
                      />
                      <a
                        href={wechatQrs[account.id].landingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 text-xs font-medium text-green-700 underline"
                      >
                        お客様向けページを開く
                      </a>
                    </div>
                  )}

                  <p className="mt-3 text-[11px] leading-5 text-green-900/70">
                    このURLはスマートフォン向けチャット導線ではありません。QRなしで相談を開始する場合は、下の「微信客服」を使用します。
                  </p>
                </div>
              )}

              {account.channelType === 'wechat' && (
                <div className="mt-4 rounded-lg border border-teal-300 bg-teal-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-teal-950">微信客服：QRなしで直接チャット</p>
                        <span className="rounded-full bg-teal-700 px-2 py-0.5 text-[10px] font-semibold text-white">スマホ推奨</span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-teal-900">
                        WebサイトのボタンからWeChatの相談画面へ直接移動します。お客様に共有するのはこちらです。
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void loadWeChatKfStatus(account.id)}
                        disabled={loadingWeChatKfId === account.id}
                        className="rounded-lg border border-teal-700 bg-white px-3 py-1.5 text-xs font-medium text-teal-800 disabled:opacity-50"
                      >
                        {loadingWeChatKfId === account.id ? '確認中...' : '接続状況を確認'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void openWeChatKfSettings(account.id)}
                        className="rounded-lg bg-teal-800 px-3 py-1.5 text-xs font-medium text-white"
                      >
                        {openWeChatKfId === account.id ? '設定を閉じる' : '微信客服を設定'}
                      </button>
                    </div>
                  </div>

                  {wechatKfErrors[account.id] && (
                    <p className="mt-3 rounded-md border border-red-200 bg-white p-2 text-xs text-red-700">
                      {wechatKfErrors[account.id]}
                    </p>
                  )}

                  {wechatKfStatuses[account.id] && (
                    <div className="mt-3 grid grid-cols-1 gap-2 rounded-md border border-teal-200 bg-white p-3 text-xs sm:grid-cols-2">
                      <p>
                        <span className="font-medium text-gray-500">API:</span>{' '}
                        {wechatKfStatuses[account.id].connected
                          ? '接続済み'
                          : wechatKfStatuses[account.id].configured
                            ? '確認待ち'
                            : '未設定'}
                      </p>
                      <p>
                        <span className="font-medium text-gray-500">客服アカウント:</span>{' '}
                        {wechatKfStatuses[account.id].accountName
                          || (wechatKfStatuses[account.id].openKfidReady ? '選択済み' : '未選択')}
                      </p>
                      <p>
                        <span className="font-medium text-gray-500">受信コールバック:</span>{' '}
                        {wechatKfStatuses[account.id].callbackReady ? '準備済み' : 'Token・鍵未設定'}
                      </p>
                      <p>
                        <span className="font-medium text-gray-500">直接チャットURL:</span>{' '}
                        {wechatKfStatuses[account.id].contactUrlReady ? '生成済み' : '未生成'}
                      </p>
                      {wechatKfStatuses[account.id].contactUrlReady && (
                        <div className="sm:col-span-2 rounded-lg bg-teal-50 p-3">
                          <p className="font-semibold text-teal-950">お客様に共有する直接チャットURL</p>
                          <a
                            href={wechatKfStatuses[account.id].directUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 block break-all font-mono text-teal-700 underline"
                          >
                            {wechatKfStatuses[account.id].directUrl}
                          </a>
                        </div>
                      )}
                    </div>
                  )}

                  {wechatKfStatuses[account.id]?.connected
                    && wechatKfStatuses[account.id]?.openKfidReady
                    && !wechatKfStatuses[account.id]?.contactUrlReady && (
                    <button
                      type="button"
                      onClick={() => void generateWeChatKfLink(account.id)}
                      disabled={generatingWeChatKfLinkId === account.id}
                      className="mt-3 w-full rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {generatingWeChatKfLinkId === account.id ? '生成中...' : 'お客様用の直接チャットURLを生成'}
                    </button>
                  )}

                  {openWeChatKfId === account.id && (
                    <div className="mt-3 space-y-3 rounded-lg border border-teal-200 bg-white p-4">
                      <div className="rounded-lg bg-teal-50 p-3 text-xs leading-5 text-teal-950">
                        企業微信の「微信客服」で取得したCorpID・Secretを入力します。接続確認で客服アカウントが1件だけ見つかった場合、open_kfidは自動選択されます。
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="text-xs font-medium text-gray-600">
                          CorpID
                          <input
                            value={wechatKfForms[account.id]?.corpId || ''}
                            onChange={(e) => updateWeChatKfForm(account.id, { corpId: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-teal-200 px-3 py-2 text-sm"
                            placeholder="ww..."
                          />
                        </label>
                        <label className="text-xs font-medium text-gray-600">
                          open_kfid
                          <input
                            value={wechatKfForms[account.id]?.openKfid || ''}
                            onChange={(e) => updateWeChatKfForm(account.id, { openKfid: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-teal-200 px-3 py-2 text-sm"
                            placeholder="wk...（1件なら空欄で自動選択）"
                            list={`wechat-kf-accounts-${account.id}`}
                          />
                          <datalist id={`wechat-kf-accounts-${account.id}`}>
                            {(wechatKfStatuses[account.id]?.availableAccounts || []).map((item) => (
                              <option key={item.openKfid} value={item.openKfid}>{item.name || item.openKfid}</option>
                            ))}
                          </datalist>
                        </label>
                      </div>
                      <label className="block text-xs font-medium text-gray-600">
                        微信客服 Secret
                        <input
                          type="password"
                          value={wechatKfForms[account.id]?.secret || ''}
                          onChange={(e) => updateWeChatKfForm(account.id, { secret: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-teal-200 px-3 py-2 text-sm"
                          autoComplete="new-password"
                        />
                      </label>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="text-xs font-medium text-gray-600">
                          受信コールバック Token
                          <input
                            value={wechatKfForms[account.id]?.callbackToken || ''}
                            onChange={(e) => updateWeChatKfForm(account.id, { callbackToken: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-teal-200 px-3 py-2 text-sm"
                            placeholder="3〜32文字"
                          />
                        </label>
                        <label className="text-xs font-medium text-gray-600">
                          EncodingAESKey
                          <input
                            value={wechatKfForms[account.id]?.encodingAesKey || ''}
                            onChange={(e) => updateWeChatKfForm(account.id, { encodingAesKey: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-teal-200 px-3 py-2 text-sm"
                            placeholder="43文字"
                          />
                        </label>
                      </div>
                      <label className="block text-xs font-medium text-gray-600">
                        公式アカウント案内URL（任意）
                        <input
                          type="url"
                          value={wechatKfForms[account.id]?.followUrl || ''}
                          onChange={(e) => updateWeChatKfForm(account.id, { followUrl: e.target.value })}
                          className="mt-1 w-full rounded-lg border border-teal-200 px-3 py-2 text-sm"
                          placeholder="https://mp.weixin.qq.com/..."
                        />
                      </label>
                      <div className="rounded-lg border border-teal-100 bg-gray-50 p-3 text-xs leading-5 text-gray-700">
                        <p className="font-medium">企業微信へ登録する受信イベントURL</p>
                        <p className="mt-1 break-all font-mono">
                          {wechatKfStatuses[account.id]?.callbackUrl || `https://line-flattravel.flat-travel.workers.dev/webhook/wechat-kf/${account.id}`}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void saveWeChatKfSettings(account.id)}
                        disabled={savingWeChatKfId === account.id}
                        className="w-full rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {savingWeChatKfId === account.id ? '保存・確認中...' : '保存して接続確認'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
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
