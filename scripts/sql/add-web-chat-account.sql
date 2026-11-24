-- One-time, by hand, after the Worker release that contains routes/fw-web-chat.ts.
-- Adds the inbox for questions asked on FlatWorker quotation pages ('web' channel).
-- Slack channel and locale are copied from the WhatsApp account, so questions are announced
-- exactly where WhatsApp messages are. No provider credentials: the 'web' channel uses FW's token.
-- Safe to run twice (INSERT OR IGNORE on the fixed id / channel_id).
INSERT OR IGNORE INTO line_accounts
  (id, channel_id, name, channel_access_token, channel_secret, channel_type, locale, default_slack_channel, is_active)
SELECT 'web-quote-page-001', 'flatworker-quote-page', 'Flat Travel 見積ページ', 'not-used', 'not-used', 'web',
       locale, default_slack_channel, 1
FROM line_accounts
WHERE id = 'wa-english-001' AND channel_type = 'whatsapp';

-- Check: one row, same Slack channel as wa-english-001.
SELECT id, channel_type, locale, default_slack_channel, is_active
FROM line_accounts WHERE id IN ('wa-english-001', 'web-quote-page-001');
