ALTER TABLE line_accounts ADD COLUMN locale TEXT NOT NULL DEFAULT 'ja';
ALTER TABLE line_accounts ADD COLUMN default_slack_channel TEXT;
