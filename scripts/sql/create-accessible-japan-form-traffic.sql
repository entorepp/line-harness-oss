CREATE TABLE IF NOT EXISTS accessible_japan_form_traffic (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('form_arrival', 'tracked_click')),
  source TEXT NOT NULL CHECK (source IN ('accessible_japan', 'direct', 'other')),
  medium TEXT NOT NULL CHECK (medium IN ('cpc', 'referral', 'direct', 'other')),
  country_code TEXT,
  attribution_method TEXT NOT NULL DEFAULT 'legacy',
  is_test INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1)),
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_accessible_japan_form_traffic_form_time
  ON accessible_japan_form_traffic (form_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_accessible_japan_form_traffic_report
  ON accessible_japan_form_traffic (form_id, is_test, event_type, source, occurred_at);

CREATE INDEX IF NOT EXISTS idx_accessible_japan_form_traffic_country
  ON accessible_japan_form_traffic (form_id, is_test, country_code, occurred_at);
