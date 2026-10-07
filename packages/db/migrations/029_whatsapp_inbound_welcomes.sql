-- One automatic acknowledgement attempt per exact sender/recipient. No backfill.
CREATE TABLE IF NOT EXISTS whatsapp_inbound_welcomes (
  id TEXT PRIMARY KEY,
  friend_id TEXT NOT NULL REFERENCES friends(id),
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  phone_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  incoming_message_id TEXT NOT NULL,
  incoming_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  provider_message_id TEXT,
  message_text TEXT,
  permission_requested INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  sent_at TEXT,
  UNIQUE(line_account_id, recipient)
);
