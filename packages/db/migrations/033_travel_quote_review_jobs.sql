-- Opaque saved-case references only. Customer/profile/quote payloads stay in TravelWorker.
CREATE TABLE IF NOT EXISTS travel_quote_review_jobs (
  id TEXT PRIMARY KEY,
  quote_reference TEXT NOT NULL,
  case_id TEXT NOT NULL,
  case_version TEXT NOT NULL,
  notification_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  lease_until TEXT,
  lease_token TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS travel_quote_review_jobs_due ON travel_quote_review_jobs(status, next_attempt_at);
