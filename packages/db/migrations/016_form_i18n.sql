ALTER TABLE forms ADD COLUMN locale TEXT;
ALTER TABLE forms ADD COLUMN translation_group_id TEXT;
ALTER TABLE forms ADD COLUMN submit_button_label TEXT;
ALTER TABLE forms ADD COLUMN success_title TEXT;
ALTER TABLE forms ADD COLUMN success_description TEXT;

CREATE INDEX IF NOT EXISTS idx_forms_translation_group
  ON forms (translation_group_id);
CREATE INDEX IF NOT EXISTS idx_forms_locale
  ON forms (locale);
