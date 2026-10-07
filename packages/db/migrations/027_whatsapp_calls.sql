CREATE TABLE IF NOT EXISTS whatsapp_calls (
  id TEXT PRIMARY KEY,
  friend_id TEXT REFERENCES friends(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  recipient TEXT NOT NULL,
  provider_call_id TEXT,
  state TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'outbound',
  offer_sdp TEXT,
  owner_id TEXT,
  answer_sdp TEXT,
  event_timestamp INTEGER NOT NULL DEFAULT 0,
  duration INTEGER,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(line_account_id, provider_call_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_calls_active
  ON whatsapp_calls(line_account_id, recipient)
  WHERE state NOT IN ('ended', 'failed', 'rejected');
CREATE INDEX IF NOT EXISTS idx_whatsapp_calls_friend ON whatsapp_calls(friend_id, created_at DESC);
CREATE TABLE IF NOT EXISTS whatsapp_call_permission_requests (
  id TEXT PRIMARY KEY,
  friend_id TEXT NOT NULL REFERENCES friends(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  recipient TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_message_id TEXT,
  created_at INTEGER NOT NULL,
  error_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_call_requests_recipient
  ON whatsapp_call_permission_requests(line_account_id, recipient, created_at DESC);
