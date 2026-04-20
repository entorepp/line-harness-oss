-- Migration 012: Add scheduled operator messages
-- Run: wrangler d1 execute line-crm --file=packages/db/migrations/012_scheduled_messages.sql --remote

CREATE TABLE IF NOT EXISTS scheduled_messages (
  id            TEXT PRIMARY KEY,
  friend_id     TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  chat_id       TEXT REFERENCES chats (id) ON DELETE SET NULL,
  message_type  TEXT NOT NULL,
  content       TEXT NOT NULL,
  metadata      TEXT,
  scheduled_at  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  sent_at       TEXT,
  last_error    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_friend ON scheduled_messages (friend_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_chat ON scheduled_messages (chat_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_status_time ON scheduled_messages (status, scheduled_at);
