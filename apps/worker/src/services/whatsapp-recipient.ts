import { WhatsappSendError } from './whatsapp-send-error.js';

export type WhatsappIdentity = { phone?: string; userId?: string; parentUserId?: string; username?: string };
export function whatsappPhone(value: unknown): string | undefined {
  return typeof value === 'string' && /^\+?[1-9]\d{6,14}$/.test(value.trim()) ? value.trim().replace(/^\+/, '') : undefined;
}
export function whatsappUserId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Z]{2}\.(?:ENT\.)?[A-Za-z0-9]{1,128}$/.test(value.trim()) ? value.trim() : undefined;
}
export function whatsappIdentity(value: WhatsappIdentity): WhatsappIdentity {
  return { phone: whatsappPhone(value.phone), userId: whatsappUserId(value.userId),
    parentUserId: whatsappUserId(value.parentUserId),
    username: typeof value.username === 'string' && value.username.length <= 35 ? value.username : undefined };
}
export function whatsappExternalId(identity: WhatsappIdentity): string | undefined {
  return identity.phone || identity.userId || identity.parentUserId;
}
export function parseFriendMetadata(raw: string | null | undefined): Record<string, any> {
  try { const value = JSON.parse(raw || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
}

/** BSUID uses recipient; phone uses to. A display username is never an address.
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/
 */
export function whatsappRecipientFields(friend: { line_user_id: string; line_account_id?: string | null; metadata?: string | null }): { to: string } | { recipient: string } {
  const stored = parseFriendMetadata(friend.metadata).whatsappRecipient;
  if (stored?.accountId && stored.accountId === friend.line_account_id) {
    const userId = whatsappUserId(stored.userId) || whatsappUserId(stored.parentUserId);
    if (userId) return { recipient: userId };
  }
  const userId = whatsappUserId(friend.line_user_id);
  if (userId) return { recipient: userId };
  const phone = whatsappPhone(friend.line_user_id);
  if (phone) return { to: phone };
  throw new WhatsappSendError('この会話のWhatsApp返信用IDが保存されていません。ユーザーネームだけでは送れません。新しい受信で取得したID、または確認済みの電話番号が必要です。', 'WHATSAPP_RECIPIENT_UNAVAILABLE', 409);
}
