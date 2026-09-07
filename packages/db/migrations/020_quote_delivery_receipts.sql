CREATE TABLE IF NOT EXISTS quote_delivery_receipts (
  channel TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  quote_reference TEXT NOT NULL,
  quote_revision TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (channel, provider_message_id)
);

CREATE INDEX IF NOT EXISTS idx_quote_delivery_receipts_reference
  ON quote_delivery_receipts(quote_reference, updated_at);
