INSERT OR REPLACE INTO forms (
  id, name, description, fields, locale, translation_group_id,
  submit_button_label, success_title, success_description,
  on_submit_tag_id, on_submit_scenario_id, save_to_metadata,
  is_active, submit_count, created_at, updated_at
) VALUES (
  'form-response-email-ui-test',
  'ご旅行アンケート（ローカル画面確認）',
  '回答コピー機能の非顧客ローカル確認用',
  '[{"name":"traveller_name","label":"お名前","type":"text","required":true},{"name":"trip_plan","label":"ご旅行内容","type":"textarea","required":false},{"name":"support_note","label":"必要なサポート","type":"textarea","required":false},{"name":"passport_file","label":"パスポート画像","type":"file","required":false}]',
  'ja', NULL, '送信', '完了', 'ありがとうございました',
  NULL, NULL, 0, 1, 1,
  '2026-09-07T09:00:00+09:00', '2026-09-07T09:00:00+09:00'
);

INSERT OR REPLACE INTO form_submissions (
  id, form_id, form_issue_id, friend_id, slack_channel_id, data, created_at
) VALUES (
  'submission-response-email-ui-test',
  'form-response-email-ui-test',
  NULL, NULL, NULL,
  '{"traveller_name":"山田 太郎","trip_plan":"2027年4月 東京・京都 7日間","support_note":"移動時に車椅子サポートを希望","passport_file":"https://example.invalid/api/form-files/signed-private-test"}',
  '2026-09-07T09:30:00+09:00'
);

DELETE FROM form_submission_email_audit
WHERE submission_id = 'submission-response-email-ui-test';
DELETE FROM form_submission_email_deliveries
WHERE submission_id = 'submission-response-email-ui-test';
DELETE FROM form_submission_email_recipients
WHERE submission_id = 'submission-response-email-ui-test';
