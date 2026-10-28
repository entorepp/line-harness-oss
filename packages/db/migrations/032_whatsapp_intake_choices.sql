-- Signed native choice IDs only, never customer/support values. Session owns lifecycle.
CREATE TABLE IF NOT EXISTS whatsapp_intake_choices (
  turn_id TEXT PRIMARY KEY REFERENCES whatsapp_intake_turns(id) ON DELETE CASCADE,
  choice_id TEXT NOT NULL CHECK(length(choice_id) <= 64)
);
