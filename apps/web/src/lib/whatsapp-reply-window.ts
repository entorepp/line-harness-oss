export type WhatsappReplyWindow = {
  friendId: string
  lastIncomingAt: string | null
  expiresAt: string | null
  canSend: boolean
}

export function whatsappReplyBlock(
  window: WhatsappReplyWindow | null | undefined,
  friendId: string,
  now = Date.now(),
  scheduledAt?: string,
): string | null {
  if (!window || window.friendId !== friendId) {
    return 'WhatsAppの送信期限を確認中です。表示が変わらない場合は画面を再読み込みしてください。'
  }
  const expiresAt = window.expiresAt ? Date.parse(window.expiresAt) : NaN
  if (!window.canSend || !Number.isFinite(expiresAt) || now >= expiresAt) {
    return '通常の文章・添付は、お客様の最後の返信から24時間以内に送れます。時間外は下の「見積書・決済リンク・予約確定書」から承認済みの案内を利用してください。メールなどで連絡してWhatsAppに返信いただくと、通常の送信も再開できます。下書きは編集できます。'
  }
  if (scheduledAt && (!Number.isFinite(Date.parse(scheduledAt)) || Date.parse(scheduledAt) >= expiresAt)) {
    return '予約時刻がWhatsAppの送信期限を超えています。期限より前の時刻を選んでください。'
  }
  return null
}
