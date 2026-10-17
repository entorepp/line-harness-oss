-- Keep Flat Harness chat polling inside D1 row-read limits.
-- Safe and idempotent: adds indexes only; no customer or message rows change.

CREATE INDEX IF NOT EXISTS idx_messages_log_friend_created_id
  ON messages_log (friend_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_chats_last_message_at
  ON chats (last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_chats_status_last_message
  ON chats (status, last_message_at DESC);
