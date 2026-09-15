-- Migration 025: Persist WhatsApp provider acceptance and delivery callbacks.
-- Run only through the guarded Flat Harness production release procedure.

CREATE TABLE IF NOT EXISTS whatsapp_delivery_receipts (
  provider_message_id  TEXT PRIMARY KEY,
  line_account_id      TEXT NOT NULL REFERENCES line_accounts (id) ON DELETE CASCADE,
  message_log_id       TEXT,
  scheduled_message_id TEXT,
  status                TEXT NOT NULL CHECK (status IN ('accepted', 'sent', 'delivered', 'read', 'failed')),
  provider_status_at    TEXT NOT NULL,
  error_code            TEXT,
  error_subcode         TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_delivery_message_log
  ON whatsapp_delivery_receipts (message_log_id)
  WHERE message_log_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_delivery_scheduled_message
  ON whatsapp_delivery_receipts (scheduled_message_id)
  WHERE scheduled_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_delivery_status_time
  ON whatsapp_delivery_receipts (status, provider_status_at DESC);
