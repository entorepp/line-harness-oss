-- Audio/transcript bytes live only in encrypted, expiring private KV.
CREATE TABLE IF NOT EXISTS whatsapp_call_recordings (
  call_id TEXT PRIMARY KEY REFERENCES whatsapp_calls(id),
  owner_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  consent_method TEXT NOT NULL,
  notice_version TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'recording',
  part_count INTEGER,
  slack_ts TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS whatsapp_call_recording_parts (
  call_id TEXT NOT NULL REFERENCES whatsapp_call_recordings(call_id),
  part_index INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'uploading',
  slack_file_id TEXT,
  error_code TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (call_id, part_index)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_recordings_jobs ON whatsapp_call_recordings(state, updated_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_recordings_expiry ON whatsapp_call_recordings(expires_at);
