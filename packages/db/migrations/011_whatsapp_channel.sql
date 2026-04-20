-- Migration 011: Add WhatsApp channel type support
-- Run: wrangler d1 execute line-crm --file=packages/db/migrations/011_whatsapp_channel.sql --remote

-- Add channel_type to line_accounts (default 'line' for backward compat)
ALTER TABLE line_accounts ADD COLUMN channel_type TEXT NOT NULL DEFAULT 'line';
