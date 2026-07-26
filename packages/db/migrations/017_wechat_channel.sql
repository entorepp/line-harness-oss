-- Migration 017: Add WeChat Official Account credentials and cached API state
-- Run: wrangler d1 execute line-crm --file=packages/db/migrations/017_wechat_channel.sql --remote

ALTER TABLE line_accounts ADD COLUMN wechat_encoding_aes_key TEXT;
ALTER TABLE line_accounts ADD COLUMN wechat_access_token TEXT;
ALTER TABLE line_accounts ADD COLUMN wechat_qr_ticket TEXT;
ALTER TABLE line_accounts ADD COLUMN wechat_qr_url TEXT;
