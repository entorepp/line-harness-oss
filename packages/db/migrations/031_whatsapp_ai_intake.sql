-- Isolated event-owned intake state. Private requirements/outbox are AES-GCM encrypted.
CREATE TABLE IF NOT EXISTS whatsapp_intake_sessions (
  id TEXT PRIMARY KEY,
  friend_id TEXT NOT NULL UNIQUE REFERENCES friends(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  phone_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  state_ciphertext TEXT,
  initial_message_log_id TEXT,
  initial_consumed INTEGER NOT NULL DEFAULT 0,
  test_unqualified_override INTEGER NOT NULL DEFAULT 0,
  lock_token TEXT,
  lock_started_at INTEGER,
  model_calls INTEGER NOT NULL DEFAULT 0,
  handoff_notification TEXT NOT NULL DEFAULT 'none',
  last_incoming_at INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(line_account_id, recipient)
);
CREATE TABLE IF NOT EXISTS whatsapp_intake_turns (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES whatsapp_intake_sessions(id),
  trigger_key TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  message_log_id TEXT,
  incoming_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reply_ciphertext TEXT,
  provider_message_id TEXT,
  sent_at TEXT,
  error_code TEXT,
  model_called INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  elapsed_ms INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, trigger_key)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_intake_pending ON whatsapp_intake_turns(session_id,status,seq);
CREATE INDEX IF NOT EXISTS idx_whatsapp_intake_usage ON whatsapp_intake_turns(created_at,model_called,session_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_intake_provider ON whatsapp_intake_turns(provider_message_id);
CREATE TABLE IF NOT EXISTS whatsapp_intake_model_budget (
  line_account_id TEXT NOT NULL,
  utc_day TEXT NOT NULL,
  calls INTEGER NOT NULL,
  PRIMARY KEY(line_account_id,utc_day)
);
