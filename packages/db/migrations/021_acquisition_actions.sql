-- Bounded anonymous chronological diagnostics. No historical reconstruction.
CREATE TABLE IF NOT EXISTS acquisition_actions (
 id TEXT PRIMARY KEY,
 page_id TEXT NOT NULL REFERENCES acquisition_pages(id),
 sequence INTEGER NOT NULL CHECK(sequence BETWEEN 1 AND 500),
 elapsed_ms INTEGER NOT NULL CHECK(elapsed_ms BETWEEN 0 AND 86400000),
 event TEXT NOT NULL,
 data_json TEXT NOT NULL,
 received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(page_id,sequence)
);
CREATE INDEX IF NOT EXISTS acquisition_actions_page ON acquisition_actions(page_id,sequence);
