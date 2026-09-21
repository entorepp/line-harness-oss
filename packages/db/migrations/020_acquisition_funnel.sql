-- Separate from legacy AJ counters. No historic inference or PII.
CREATE TABLE IF NOT EXISTS acquisition_visits (
 id TEXT PRIMARY KEY, surface TEXT NOT NULL, source TEXT NOT NULL, medium TEXT NOT NULL,
 campaign TEXT NOT NULL, content TEXT NOT NULL, is_test INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS acquisition_pages (
 id TEXT PRIMARY KEY, visit_id TEXT NOT NULL REFERENCES acquisition_visits(id),
 path TEXT NOT NULL, kind TEXT NOT NULL, tagged INTEGER NOT NULL DEFAULT 0, response_status INTEGER,
 received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS acquisition_pages_visit ON acquisition_pages(visit_id,received_at);
CREATE INDEX IF NOT EXISTS acquisition_visits_report ON acquisition_visits(is_test,created_at,source,surface);
CREATE TABLE IF NOT EXISTS acquisition_events (
 page_id TEXT NOT NULL REFERENCES acquisition_pages(id), event TEXT NOT NULL, step TEXT NOT NULL DEFAULT '',
 occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(page_id,event,step)
);

CREATE TABLE IF NOT EXISTS acquisition_clicks (
 id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES acquisition_pages(id),
 destination TEXT NOT NULL, occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS acquisition_clicks_page ON acquisition_clicks(page_id);
