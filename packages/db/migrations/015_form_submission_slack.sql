ALTER TABLE form_submissions ADD COLUMN slack_channel_id TEXT;

CREATE INDEX IF NOT EXISTS idx_form_submissions_slack_channel
  ON form_submissions (slack_channel_id);
