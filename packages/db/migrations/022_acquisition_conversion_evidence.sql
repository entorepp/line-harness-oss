-- Additive only. Existing visits, submissions and attribution remain unchanged.
CREATE TABLE IF NOT EXISTS acquisition_visit_context (
 visit_id TEXT PRIMARY KEY REFERENCES acquisition_visits(id),
 entry_page TEXT NOT NULL DEFAULT '',
 placement TEXT NOT NULL DEFAULT '',
 variant TEXT NOT NULL DEFAULT '',
 form_version TEXT NOT NULL DEFAULT '',
 measurement_version TEXT NOT NULL DEFAULT 'aj-funnel-v2'
);
CREATE TABLE IF NOT EXISTS acquisition_conversion_receipts (
 receipt_hash TEXT PRIMARY KEY,
 visit_id TEXT NOT NULL REFERENCES acquisition_visits(id),
 page_id TEXT NOT NULL REFERENCES acquisition_pages(id),
 surface TEXT NOT NULL,
 received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS acquisition_conversion_receipts_visit
 ON acquisition_conversion_receipts(visit_id);
