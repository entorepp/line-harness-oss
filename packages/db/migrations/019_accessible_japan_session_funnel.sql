CREATE TABLE IF NOT EXISTS accessible_japan_form_sessions (
  session_id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('accessible_japan', 'direct', 'other')),
  medium TEXT NOT NULL CHECK (medium IN ('cpc', 'cta', 'referral', 'direct', 'other')),
  campaign TEXT NOT NULL CHECK (campaign IN ('hotel_detail', 'accessible_japan_forms', 'agent_listing', 'unknown', 'other')),
  source_page_key TEXT,
  country_code TEXT,
  attribution_method TEXT NOT NULL,
  is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1)),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_accessible_japan_form_sessions_report
  ON accessible_japan_form_sessions (form_id, is_test, source, started_at);

CREATE INDEX IF NOT EXISTS idx_accessible_japan_form_sessions_source_page
  ON accessible_japan_form_sessions (form_id, is_test, source_page_key, started_at);

CREATE TABLE IF NOT EXISTS accessible_japan_form_session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  form_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('form_arrival', 'form_start', 'form_progress', 'form_submit')),
  field_key TEXT,
  field_index INTEGER,
  is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1)),
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES accessible_japan_form_sessions(session_id) ON DELETE CASCADE,
  UNIQUE (session_id, event_type, field_key)
);

CREATE INDEX IF NOT EXISTS idx_accessible_japan_form_session_events_report
  ON accessible_japan_form_session_events (form_id, is_test, event_type, occurred_at);

CREATE INDEX IF NOT EXISTS idx_accessible_japan_form_session_events_session
  ON accessible_japan_form_session_events (session_id, occurred_at);
