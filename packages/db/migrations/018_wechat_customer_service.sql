-- Migration 018: Add WeChat Customer Service (微信客服) configuration
-- Run: wrangler d1 execute line-crm --file=packages/db/migrations/018_wechat_customer_service.sql --remote

ALTER TABLE line_accounts ADD COLUMN wechat_kf_corp_id TEXT;
ALTER TABLE line_accounts ADD COLUMN wechat_kf_secret TEXT;
ALTER TABLE line_accounts ADD COLUMN wechat_kf_open_kfid TEXT;
ALTER TABLE line_accounts ADD COLUMN wechat_kf_callback_token TEXT;
ALTER TABLE line_accounts ADD COLUMN wechat_kf_encoding_aes_key TEXT;
ALTER TABLE line_accounts ADD COLUMN wechat_kf_access_token TEXT;
ALTER TABLE line_accounts ADD COLUMN wechat_kf_token_expires_at TEXT;
ALTER TABLE line_accounts ADD COLUMN wechat_kf_contact_url TEXT;
ALTER TABLE line_accounts ADD COLUMN wechat_kf_sync_cursor TEXT;
ALTER TABLE line_accounts ADD COLUMN wechat_follow_url TEXT;

CREATE TABLE IF NOT EXISTS wechat_kf_message_receipts (
  line_account_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  PRIMARY KEY (line_account_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_wechat_kf_receipts_created
  ON wechat_kf_message_receipts(created_at);
