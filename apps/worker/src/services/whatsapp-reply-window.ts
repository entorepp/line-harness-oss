const WINDOW_MS = 24 * 60 * 60 * 1000;

export type WhatsappReplyWindow = {
  friendId: string;
  lastIncomingAt: string | null;
  expiresAt: string | null;
  canSend: boolean;
};

export class WhatsappReplyWindowError extends Error {
  readonly code = 'WHATSAPP_REPLY_WINDOW_CLOSED';
  constructor(readonly replyWindow: WhatsappReplyWindow) {
    super('WhatsAppの24時間返信枠外です。通常の文章・添付は送れません。メール等で連絡し、お客様のWhatsAppから返信が届いてから送ってください。');
    this.name = 'WhatsappReplyWindowError';
  }
}

export async function getWhatsappReplyWindow(db: D1Database, friendId: string, now = Date.now()): Promise<WhatsappReplyWindow> {
  // Legacy database timestamps without an offset are JST. Compare actual
  // instants so an older UTC/JST string cannot hide the latest customer reply.
  const row = await db.prepare(`
    SELECT created_at FROM messages_log
    WHERE friend_id = ? AND direction = 'incoming'
    ORDER BY julianday(CASE
      WHEN substr(created_at, -1) IN ('Z', 'z') OR substr(created_at, -6, 1) IN ('+', '-') THEN created_at
      ELSE created_at || '+09:00' END) DESC, id DESC
    LIMIT 1
  `).bind(friendId).first<{ created_at: string }>();
  const raw = row?.created_at?.trim().replace(' ', 'T');
  const timestamp = raw ? Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) ? raw : `${raw}+09:00`) : NaN;
  const valid = Number.isFinite(timestamp) && timestamp <= now;
  return {
    friendId,
    lastIncomingAt: valid ? new Date(timestamp).toISOString() : null,
    expiresAt: valid ? new Date(timestamp + WINDOW_MS).toISOString() : null,
    canSend: valid && now < timestamp + WINDOW_MS,
  };
}

export async function assertWhatsappReplyWindow(db: D1Database, friendId: string, scheduledAt?: string): Promise<void> {
  const window = await getWhatsappReplyWindow(db, friendId);
  const sendAt = scheduledAt ? Date.parse(scheduledAt) : Date.now();
  if (!window.canSend || !window.expiresAt || !Number.isFinite(sendAt) || sendAt >= Date.parse(window.expiresAt)) {
    throw new WhatsappReplyWindowError(window);
  }
}
