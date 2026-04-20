-- Migration 010: Add postback trigger type for rich menu support
-- Run: wrangler d1 execute line-crm --file=packages/db/migrations/010_postback_trigger.sql --remote

-- Recreate scenarios table with updated CHECK constraint and trigger_data column
CREATE TABLE IF NOT EXISTS scenarios_new (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN ('friend_add', 'tag_added', 'manual', 'postback')),
  trigger_tag_id  TEXT REFERENCES tags (id) ON DELETE SET NULL,
  trigger_data    TEXT,
  line_account_id TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

INSERT INTO scenarios_new (id, name, description, trigger_type, trigger_tag_id, trigger_data, line_account_id, is_active, created_at, updated_at)
  SELECT id, name, description, trigger_type, trigger_tag_id, NULL, line_account_id, is_active, created_at, updated_at FROM scenarios;

DROP TABLE scenarios;
ALTER TABLE scenarios_new RENAME TO scenarios;
