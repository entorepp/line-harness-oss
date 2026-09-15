import { jstNow } from '@line-crm/db';

export type WhatsappDeliveryStatus = 'accepted' | 'sent' | 'delivered' | 'read' | 'failed';

export type WhatsappDeliveryReceipt = {
  provider_message_id: string;
  line_account_id: string;
  message_log_id: string | null;
  scheduled_message_id: string | null;
  status: WhatsappDeliveryStatus;
  provider_status_at: string;
  error_code: string | null;
  error_subcode: string | null;
  created_at: string;
  updated_at: string;
};

function boundedProviderCode(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, 80) : null;
}

export function normalizeWhatsappDeliveryStatus(value: unknown): WhatsappDeliveryStatus | null {
  return value === 'sent' || value === 'delivered' || value === 'read' || value === 'failed'
    ? value
    : null;
}

export async function recordWhatsappDelivery(opts: {
  db: D1Database;
  lineAccountId: string;
  providerMessageId: string;
  status: WhatsappDeliveryStatus;
  providerStatusAt?: string | null;
  messageLogId?: string | null;
  scheduledMessageId?: string | null;
  errorCode?: unknown;
  errorSubcode?: unknown;
}): Promise<WhatsappDeliveryReceipt> {
  const providerMessageId = opts.providerMessageId.trim();
  if (!providerMessageId) throw new Error('WhatsApp provider message ID is required');

  const now = jstNow();
  const providerStatusAt = opts.providerStatusAt?.trim() || now;
  const errorCode = opts.status === 'failed' ? boundedProviderCode(opts.errorCode) : null;
  const errorSubcode = opts.status === 'failed' ? boundedProviderCode(opts.errorSubcode) : null;

  await opts.db.prepare(
    `INSERT INTO whatsapp_delivery_receipts
       (provider_message_id, line_account_id, message_log_id, scheduled_message_id,
        status, provider_status_at, error_code, error_subcode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider_message_id) DO UPDATE SET
       message_log_id = COALESCE(whatsapp_delivery_receipts.message_log_id, excluded.message_log_id),
       scheduled_message_id = COALESCE(whatsapp_delivery_receipts.scheduled_message_id, excluded.scheduled_message_id),
       status = CASE
         WHEN whatsapp_delivery_receipts.status IN ('read', 'failed') THEN whatsapp_delivery_receipts.status
         WHEN whatsapp_delivery_receipts.status = 'delivered'
              AND excluded.status IN ('accepted', 'sent', 'failed') THEN whatsapp_delivery_receipts.status
         WHEN whatsapp_delivery_receipts.status = 'sent'
              AND excluded.status = 'accepted' THEN whatsapp_delivery_receipts.status
         ELSE excluded.status
       END,
       provider_status_at = CASE
         WHEN whatsapp_delivery_receipts.status IN ('read', 'failed') THEN whatsapp_delivery_receipts.provider_status_at
         WHEN whatsapp_delivery_receipts.status = 'delivered'
              AND excluded.status IN ('accepted', 'sent', 'failed') THEN whatsapp_delivery_receipts.provider_status_at
         WHEN whatsapp_delivery_receipts.status = 'sent'
              AND excluded.status = 'accepted' THEN whatsapp_delivery_receipts.provider_status_at
         ELSE excluded.provider_status_at
       END,
       error_code = CASE
         WHEN excluded.status = 'failed'
              AND whatsapp_delivery_receipts.status NOT IN ('delivered', 'read', 'failed') THEN excluded.error_code
         ELSE whatsapp_delivery_receipts.error_code
       END,
       error_subcode = CASE
         WHEN excluded.status = 'failed'
              AND whatsapp_delivery_receipts.status NOT IN ('delivered', 'read', 'failed') THEN excluded.error_subcode
         ELSE whatsapp_delivery_receipts.error_subcode
       END,
       updated_at = excluded.updated_at
     WHERE whatsapp_delivery_receipts.line_account_id = excluded.line_account_id`,
  ).bind(
    providerMessageId,
    opts.lineAccountId,
    opts.messageLogId ?? null,
    opts.scheduledMessageId ?? null,
    opts.status,
    providerStatusAt,
    errorCode,
    errorSubcode,
    now,
    now,
  ).run();

  const receipt = await opts.db.prepare(
    `SELECT * FROM whatsapp_delivery_receipts WHERE provider_message_id = ?`,
  ).bind(providerMessageId).first<WhatsappDeliveryReceipt>();

  if (!receipt || receipt.line_account_id !== opts.lineAccountId) {
    throw new Error('WhatsApp delivery receipt account mismatch');
  }
  return receipt;
}
