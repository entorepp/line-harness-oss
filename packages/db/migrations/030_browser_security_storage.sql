-- Opaque browser capabilities only; no business-record migration.
CREATE TABLE IF NOT EXISTS forms_browser_sessions (
  token_hash TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forms_browser_session_expiry ON forms_browser_sessions(expires_at);
CREATE TABLE IF NOT EXISTS forms_browser_drafts (
  draft_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  version TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_forms_browser_draft_expiry ON forms_browser_drafts(expires_at);
CREATE TABLE IF NOT EXISTS forms_browser_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
