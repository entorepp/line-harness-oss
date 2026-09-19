-- Existing conversations only. One durable claim precedes any provider send.
CREATE TABLE IF NOT EXISTS whatsapp_template_sends (
  idempotency_key TEXT PRIMARY KEY,
  friend_id TEXT NOT NULL REFERENCES friends(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  recipient_phone TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  template_name TEXT NOT NULL,
  template_language TEXT NOT NULL,
  preview_json TEXT NOT NULL,
  opt_in_confirmed INTEGER NOT NULL CHECK (opt_in_confirmed = 1),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'failed', 'unknown')),
  message_log_id TEXT NOT NULL UNIQUE,
  provider_message_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_template_sends_friend
  ON whatsapp_template_sends(friend_id, created_at DESC);
