-- Additive and repeatable: no changes to customers or existing call history.
CREATE TABLE IF NOT EXISTS whatsapp_call_details (
  call_id TEXT PRIMARY KEY REFERENCES whatsapp_calls(id),
  caller_name TEXT,
  slack_status TEXT NOT NULL DEFAULT 'not_requested',
  slack_ts TEXT,
  error_code TEXT,
  updated_at INTEGER NOT NULL
);
