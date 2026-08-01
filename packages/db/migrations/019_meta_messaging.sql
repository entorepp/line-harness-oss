-- Migration 019: Add idempotent receipts for Facebook Messenger and Instagram DM webhooks
-- Run: wrangler d1 execute line-crm --file=packages/db/migrations/019_meta_messaging.sql --remote

CREATE TABLE IF NOT EXISTS meta_message_receipts (
  line_account_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  PRIMARY KEY (line_account_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_message_receipts_created
  ON meta_message_receipts(created_at);
