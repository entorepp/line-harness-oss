CREATE TABLE IF NOT EXISTS form_issues (
  id                  TEXT PRIMARY KEY,
  form_id             TEXT NOT NULL REFERENCES forms (id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  line_account_id     TEXT REFERENCES line_accounts (id) ON DELETE SET NULL,
  slack_channel_id    TEXT,
  shared_by_friend_id TEXT REFERENCES friends (id) ON DELETE SET NULL,
  locale              TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_form_issues_form ON form_issues (form_id);
CREATE INDEX IF NOT EXISTS idx_form_issues_channel ON form_issues (slack_channel_id);
CREATE INDEX IF NOT EXISTS idx_form_issues_shared_by ON form_issues (shared_by_friend_id);

ALTER TABLE form_submissions ADD COLUMN form_issue_id TEXT REFERENCES form_issues (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_form_submissions_issue ON form_submissions (form_issue_id);
