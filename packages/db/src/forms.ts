import { jstNow } from './utils.js';
// =============================================================================
// Forms — Survey / questionnaire system (L社 回答フォーム equivalent)
// =============================================================================

export interface Form {
  id: string;
  name: string;
  description: string | null;
  fields: string; // JSON string of FormField[]
  locale: string | null;
  translation_group_id: string | null;
  submit_button_label: string | null;
  success_title: string | null;
  success_description: string | null;
  on_submit_tag_id: string | null;
  on_submit_scenario_id: string | null;
  save_to_metadata: number;
  is_active: number;
  submit_count: number;
  created_at: string;
  updated_at: string;
}

export interface FormSubmission {
  id: string;
  form_id: string;
  form_issue_id: string | null;
  friend_id: string | null;
  slack_channel_id: string | null;
  data: string; // JSON string
  created_at: string;
}

export interface FormIssue {
  id: string;
  form_id: string;
  name: string;
  line_account_id: string | null;
  slack_channel_id: string | null;
  shared_by_friend_id: string | null;
  locale: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function getForms(db: D1Database): Promise<Form[]> {
  const result = await db
    .prepare(`SELECT * FROM forms ORDER BY created_at DESC`)
    .all<Form>();
  return result.results;
}

export async function getFormById(db: D1Database, id: string): Promise<Form | null> {
  return db
    .prepare(`SELECT * FROM forms WHERE id = ?`)
    .bind(id)
    .first<Form>();
}

export async function getFormsByTranslationGroup(
  db: D1Database,
  translationGroupId: string,
): Promise<Form[]> {
  const result = await db
    .prepare(`SELECT * FROM forms WHERE translation_group_id = ? OR id = ? ORDER BY created_at ASC`)
    .bind(translationGroupId, translationGroupId)
    .all<Form>();
  return result.results;
}

export interface CreateFormInput {
  name: string;
  description?: string | null;
  fields: string; // JSON string
  locale?: string | null;
  translationGroupId?: string | null;
  submitButtonLabel?: string | null;
  successTitle?: string | null;
  successDescription?: string | null;
  onSubmitTagId?: string | null;
  onSubmitScenarioId?: string | null;
  saveToMetadata?: boolean;
}

export async function createForm(db: D1Database, input: CreateFormInput): Promise<Form> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO forms
         (id, name, description, fields, locale, translation_group_id, submit_button_label, success_title, success_description, on_submit_tag_id, on_submit_scenario_id,
          save_to_metadata, is_active, submit_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.description ?? null,
      input.fields,
      input.locale ?? null,
      input.translationGroupId ?? null,
      input.submitButtonLabel ?? null,
      input.successTitle ?? null,
      input.successDescription ?? null,
      input.onSubmitTagId ?? null,
      input.onSubmitScenarioId ?? null,
      input.saveToMetadata !== false ? 1 : 0,
      now,
      now,
    )
    .run();

  return (await getFormById(db, id))!;
}

export interface UpdateFormInput {
  name?: string;
  description?: string | null;
  fields?: string;
  locale?: string | null;
  translationGroupId?: string | null;
  submitButtonLabel?: string | null;
  successTitle?: string | null;
  successDescription?: string | null;
  onSubmitTagId?: string | null;
  onSubmitScenarioId?: string | null;
  saveToMetadata?: boolean;
  isActive?: boolean;
}

export async function updateForm(
  db: D1Database,
  id: string,
  input: UpdateFormInput,
): Promise<Form | null> {
  const existing = await getFormById(db, id);
  if (!existing) return null;

  const now = jstNow();

  await db
    .prepare(
      `UPDATE forms
       SET name = ?,
           description = ?,
           fields = ?,
           locale = ?,
           translation_group_id = ?,
           submit_button_label = ?,
           success_title = ?,
           success_description = ?,
           on_submit_tag_id = ?,
           on_submit_scenario_id = ?,
           save_to_metadata = ?,
           is_active = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.name ?? existing.name,
      'description' in input ? (input.description ?? null) : existing.description,
      input.fields ?? existing.fields,
      'locale' in input ? (input.locale ?? null) : existing.locale,
      'translationGroupId' in input ? (input.translationGroupId ?? null) : existing.translation_group_id,
      'submitButtonLabel' in input ? (input.submitButtonLabel ?? null) : existing.submit_button_label,
      'successTitle' in input ? (input.successTitle ?? null) : existing.success_title,
      'successDescription' in input ? (input.successDescription ?? null) : existing.success_description,
      'onSubmitTagId' in input ? (input.onSubmitTagId ?? null) : existing.on_submit_tag_id,
      'onSubmitScenarioId' in input
        ? (input.onSubmitScenarioId ?? null)
        : existing.on_submit_scenario_id,
      'saveToMetadata' in input
        ? (input.saveToMetadata !== false ? 1 : 0)
        : existing.save_to_metadata,
      'isActive' in input ? (input.isActive ? 1 : 0) : existing.is_active,
      now,
      id,
    )
    .run();

  return getFormById(db, id);
}

export async function deleteForm(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM forms WHERE id = ?`).bind(id).run();
}

// ── Submissions ───────────────────────────────────────────────────────────────

export async function getFormSubmissions(
  db: D1Database,
  formId: string,
): Promise<FormSubmission[]> {
  const result = await db
    .prepare(
      `SELECT * FROM form_submissions WHERE form_id = ? ORDER BY created_at DESC`,
    )
    .bind(formId)
    .all<FormSubmission>();
  return result.results;
}

export interface CreateFormSubmissionInput {
  formId: string;
  formIssueId?: string | null;
  friendId?: string | null;
  slackChannelId?: string | null;
  data: string; // JSON string
}

export async function createFormSubmission(
  db: D1Database,
  input: CreateFormSubmissionInput,
): Promise<FormSubmission> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO form_submissions (id, form_id, form_issue_id, friend_id, slack_channel_id, data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.formId,
      input.formIssueId ?? null,
      input.friendId ?? null,
      input.slackChannelId ?? null,
      input.data,
      now,
    )
    .run();

  // Increment submit_count
  await db
    .prepare(`UPDATE forms SET submit_count = submit_count + 1, updated_at = ? WHERE id = ?`)
    .bind(now, input.formId)
    .run();

  return (await db
    .prepare(`SELECT * FROM form_submissions WHERE id = ?`)
    .bind(id)
    .first<FormSubmission>())!;
}

export interface UpdateFormSubmissionInput {
  slackChannelId?: string | null;
}

export async function updateFormSubmission(
  db: D1Database,
  id: string,
  input: UpdateFormSubmissionInput,
): Promise<FormSubmission | null> {
  const existing = await db
    .prepare(`SELECT * FROM form_submissions WHERE id = ?`)
    .bind(id)
    .first<FormSubmission>();

  if (!existing) return null;

  await db
    .prepare(`UPDATE form_submissions SET slack_channel_id = ? WHERE id = ?`)
    .bind(
      'slackChannelId' in input ? (input.slackChannelId ?? null) : existing.slack_channel_id,
      id,
    )
    .run();

  return db
    .prepare(`SELECT * FROM form_submissions WHERE id = ?`)
    .bind(id)
    .first<FormSubmission>();
}

export async function getFormIssuesByFormId(
  db: D1Database,
  formId: string,
): Promise<FormIssue[]> {
  const result = await db
    .prepare(`SELECT * FROM form_issues WHERE form_id = ? ORDER BY created_at DESC`)
    .bind(formId)
    .all<FormIssue>();
  return result.results;
}

export async function getFormIssueById(
  db: D1Database,
  id: string,
): Promise<FormIssue | null> {
  return db
    .prepare(`SELECT * FROM form_issues WHERE id = ?`)
    .bind(id)
    .first<FormIssue>();
}

export interface CreateFormIssueInput {
  formId: string;
  name: string;
  lineAccountId?: string | null;
  slackChannelId?: string | null;
  sharedByFriendId?: string | null;
  locale?: string | null;
}

export async function createFormIssue(
  db: D1Database,
  input: CreateFormIssueInput,
): Promise<FormIssue> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO form_issues
         (id, form_id, name, line_account_id, slack_channel_id, shared_by_friend_id, locale, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(
      id,
      input.formId,
      input.name,
      input.lineAccountId ?? null,
      input.slackChannelId ?? null,
      input.sharedByFriendId ?? null,
      input.locale ?? null,
      now,
      now,
    )
    .run();

  return (await getFormIssueById(db, id))!;
}

export interface UpdateFormIssueInput {
  name?: string;
  lineAccountId?: string | null;
  slackChannelId?: string | null;
  sharedByFriendId?: string | null;
  locale?: string | null;
  isActive?: boolean;
}

export async function updateFormIssue(
  db: D1Database,
  id: string,
  input: UpdateFormIssueInput,
): Promise<FormIssue | null> {
  const existing = await getFormIssueById(db, id);
  if (!existing) return null;

  const now = jstNow();

  await db
    .prepare(
      `UPDATE form_issues
       SET name = ?,
           line_account_id = ?,
           slack_channel_id = ?,
           shared_by_friend_id = ?,
           locale = ?,
           is_active = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.name ?? existing.name,
      'lineAccountId' in input ? (input.lineAccountId ?? null) : existing.line_account_id,
      'slackChannelId' in input ? (input.slackChannelId ?? null) : existing.slack_channel_id,
      'sharedByFriendId' in input
        ? (input.sharedByFriendId ?? null)
        : existing.shared_by_friend_id,
      'locale' in input ? (input.locale ?? null) : existing.locale,
      'isActive' in input ? (input.isActive ? 1 : 0) : existing.is_active,
      now,
      id,
    )
    .run();

  return getFormIssueById(db, id);
}
