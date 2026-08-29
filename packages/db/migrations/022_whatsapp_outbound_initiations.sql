ALTER TABLE line_accounts ADD COLUMN whatsapp_business_account_id TEXT;

CREATE TABLE IF NOT EXISTS whatsapp_outbound_initiations (
  id                         TEXT PRIMARY KEY,
  idempotency_key            TEXT NOT NULL UNIQUE,
  line_account_id            TEXT NOT NULL REFERENCES line_accounts(id),
  recipient_phone            TEXT NOT NULL,
  customer_name              TEXT NOT NULL,
  number_provided_confirmed  INTEGER NOT NULL CHECK (number_provided_confirmed = 1),
  opt_in_confirmed           INTEGER NOT NULL CHECK (opt_in_confirmed = 1),
  consent_source             TEXT NOT NULL CHECK (consent_source IN ('web_form', 'email', 'phone', 'in_person', 'other')),
  consent_obtained_at        TEXT NOT NULL,
  template_name              TEXT NOT NULL,
  template_language          TEXT NOT NULL,
  template_parameters        TEXT NOT NULL DEFAULT '{}',
  rendered_preview           TEXT NOT NULL,
  status                     TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'failed', 'unknown')),
  provider_message_id        TEXT,
  friend_id                  TEXT NOT NULL,
  chat_id                    TEXT NOT NULL,
  message_log_id             TEXT NOT NULL,
  error_code                 TEXT,
  error_message              TEXT,
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_outbound_initiations_account_phone
  ON whatsapp_outbound_initiations(line_account_id, recipient_phone, created_at);

CREATE INDEX IF NOT EXISTS idx_whatsapp_outbound_initiations_provider_message
  ON whatsapp_outbound_initiations(provider_message_id);
