CREATE TABLE IF NOT EXISTS fw_whatsapp_sends (
 id TEXT PRIMARY KEY, friend_id TEXT NOT NULL, request_hash TEXT NOT NULL,
 status TEXT NOT NULL, message_log_id TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
