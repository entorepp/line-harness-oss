CREATE TABLE IF NOT EXISTS form_submission_email_recipients (
  id                TEXT PRIMARY KEY,
  submission_id     TEXT NOT NULL REFERENCES form_submissions (id) ON DELETE CASCADE,
  recipient_role    TEXT NOT NULL CHECK (recipient_role IN ('respondent', 'agency_contact')),
  company_name      TEXT,
  contact_name      TEXT NOT NULL,
  email_ciphertext  TEXT NOT NULL,
  email_hash        TEXT NOT NULL,
  source            TEXT NOT NULL CHECK (source IN ('staff_registered', 'staff_corrected')),
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_by        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  removed_by        TEXT,
  removed_at        TEXT
);

DROP INDEX IF EXISTS idx_form_email_recipients_active_address;

CREATE UNIQUE INDEX IF NOT EXISTS idx_form_email_recipients_active_role_address
  ON form_submission_email_recipients (submission_id, recipient_role, email_hash)
  WHERE removed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_form_email_recipients_active_respondent
  ON form_submission_email_recipients (submission_id)
  WHERE recipient_role = 'respondent' AND removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_form_email_recipients_submission
  ON form_submission_email_recipients (submission_id, removed_at, created_at);

CREATE TABLE IF NOT EXISTS form_submission_email_deliveries (
  id                         TEXT PRIMARY KEY,
  batch_id                   TEXT NOT NULL,
  submission_id              TEXT NOT NULL REFERENCES form_submissions (id) ON DELETE CASCADE,
  recipient_id               TEXT NOT NULL REFERENCES form_submission_email_recipients (id) ON DELETE RESTRICT,
  idempotency_key            TEXT NOT NULL,
  policy_version             TEXT NOT NULL,
  included_field_names_json  TEXT NOT NULL,
  field_label_snapshot_json  TEXT NOT NULL,
  submission_data_sha256     TEXT NOT NULL,
  subject_snapshot           TEXT NOT NULL,
  body_sha256                TEXT NOT NULL,
  status                     TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'failed', 'unknown')),
  provider                   TEXT NOT NULL DEFAULT 'gmail_api',
  provider_message_id        TEXT,
  error_code                 TEXT,
  requested_by               TEXT NOT NULL,
  requested_at               TEXT NOT NULL,
  accepted_at                TEXT,
  updated_at                 TEXT NOT NULL,
  retry_of_delivery_id       TEXT REFERENCES form_submission_email_deliveries (id) ON DELETE SET NULL,
  UNIQUE (submission_id, recipient_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_form_email_deliveries_submission
  ON form_submission_email_deliveries (submission_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_form_email_deliveries_recipient
  ON form_submission_email_deliveries (recipient_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS form_submission_email_audit (
  id             TEXT PRIMARY KEY,
  submission_id  TEXT NOT NULL REFERENCES form_submissions (id) ON DELETE CASCADE,
  recipient_id   TEXT REFERENCES form_submission_email_recipients (id) ON DELETE SET NULL,
  delivery_id    TEXT REFERENCES form_submission_email_deliveries (id) ON DELETE SET NULL,
  action         TEXT NOT NULL CHECK (action IN ('recipient_added', 'recipient_updated', 'recipient_removed', 'previewed', 'send_requested', 'send_accepted', 'send_failed', 'send_unknown')),
  actor          TEXT NOT NULL,
  metadata_json  TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_form_email_audit_submission
  ON form_submission_email_audit (submission_id, created_at DESC);
