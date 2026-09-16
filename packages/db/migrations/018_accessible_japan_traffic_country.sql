ALTER TABLE accessible_japan_form_traffic
  ADD COLUMN country_code TEXT;

ALTER TABLE accessible_japan_form_traffic
  ADD COLUMN attribution_method TEXT NOT NULL DEFAULT 'legacy';

CREATE INDEX IF NOT EXISTS idx_accessible_japan_form_traffic_country
  ON accessible_japan_form_traffic (form_id, is_test, country_code, occurred_at);
