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

export type FormSubmissionEmailRecipientRole = 'respondent' | 'agency_contact';

export interface FormSubmissionEmailRecipient {
  id: string;
  submission_id: string;
  recipient_role: FormSubmissionEmailRecipientRole;
  company_name: string | null;
  contact_name: string;
  email_ciphertext: string;
  email_hash: string;
  source: 'staff_registered' | 'staff_corrected';
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  removed_by: string | null;
  removed_at: string | null;
}

export interface FormSubmissionEmailDelivery {
  id: string;
  batch_id: string;
  submission_id: string;
  recipient_id: string;
  idempotency_key: string;
  policy_version: string;
  included_field_names_json: string;
  field_label_snapshot_json: string;
  submission_data_sha256: string;
  subject_snapshot: string;
  body_sha256: string;
  status: 'pending' | 'accepted' | 'failed' | 'unknown';
  provider: string;
  provider_message_id: string | null;
  error_code: string | null;
  requested_by: string;
  requested_at: string;
  accepted_at: string | null;
  updated_at: string;
  retry_of_delivery_id: string | null;
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

export async function getFormSubmissionById(
  db: D1Database,
  id: string,
): Promise<FormSubmission | null> {
  return db.prepare(`SELECT * FROM form_submissions WHERE id = ?`).bind(id).first<FormSubmission>();
}

export async function getFormSubmissionEmailRecipients(
  db: D1Database,
  submissionId: string,
): Promise<FormSubmissionEmailRecipient[]> {
  const result = await db.prepare(
    `SELECT * FROM form_submission_email_recipients
     WHERE submission_id = ? AND removed_at IS NULL
     ORDER BY CASE recipient_role WHEN 'respondent' THEN 0 ELSE 1 END, created_at ASC`,
  ).bind(submissionId).all<FormSubmissionEmailRecipient>();
  return result.results;
}

export async function getFormSubmissionEmailRecipientById(
  db: D1Database,
  id: string,
): Promise<FormSubmissionEmailRecipient | null> {
  return db.prepare(
    `SELECT * FROM form_submission_email_recipients WHERE id = ?`,
  ).bind(id).first<FormSubmissionEmailRecipient>();
}

export async function saveFormSubmissionEmailRecipient(
  db: D1Database,
  input: {
    id?: string;
    submissionId: string;
    recipientRole: FormSubmissionEmailRecipientRole;
    companyName?: string | null;
    contactName: string;
    emailCiphertext: string;
    emailHash: string;
    actor: string;
  },
): Promise<{ recipient: FormSubmissionEmailRecipient; created: boolean }> {
  const now = jstNow();
  let existing: FormSubmissionEmailRecipient | null = null;

  if (input.id) {
    existing = await getFormSubmissionEmailRecipientById(db, input.id);
  } else if (input.recipientRole === 'respondent') {
    existing = await db.prepare(
      `SELECT * FROM form_submission_email_recipients
       WHERE submission_id = ? AND recipient_role = 'respondent' AND removed_at IS NULL`,
    ).bind(input.submissionId).first<FormSubmissionEmailRecipient>();
  }

  if (existing) {
    if (existing.submission_id !== input.submissionId || existing.removed_at) {
      throw new Error('Recipient does not belong to this active submission');
    }
    await db.prepare(
      `UPDATE form_submission_email_recipients
       SET company_name = ?, contact_name = ?, email_ciphertext = ?, email_hash = ?,
           source = 'staff_corrected', updated_by = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(
      input.companyName ?? null,
      input.contactName,
      input.emailCiphertext,
      input.emailHash,
      input.actor,
      now,
      existing.id,
    ).run();
    return { recipient: (await getFormSubmissionEmailRecipientById(db, existing.id))!, created: false };
  }

  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO form_submission_email_recipients
       (id, submission_id, recipient_role, company_name, contact_name, email_ciphertext,
        email_hash, source, created_by, created_at, updated_by, updated_at, removed_by, removed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'staff_registered', ?, ?, ?, ?, NULL, NULL)`,
  ).bind(
    id,
    input.submissionId,
    input.recipientRole,
    input.companyName ?? null,
    input.contactName,
    input.emailCiphertext,
    input.emailHash,
    input.actor,
    now,
    input.actor,
    now,
  ).run();
  return { recipient: (await getFormSubmissionEmailRecipientById(db, id))!, created: true };
}

export async function removeFormSubmissionEmailRecipient(
  db: D1Database,
  id: string,
  actor: string,
): Promise<FormSubmissionEmailRecipient | null> {
  const existing = await getFormSubmissionEmailRecipientById(db, id);
  if (!existing || existing.removed_at) return null;
  const now = jstNow();
  await db.prepare(
    `UPDATE form_submission_email_recipients
     SET removed_by = ?, removed_at = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
  ).bind(actor, now, actor, now, id).run();
  return getFormSubmissionEmailRecipientById(db, id);
}

export async function getFormSubmissionEmailDeliveries(
  db: D1Database,
  submissionId: string,
): Promise<FormSubmissionEmailDelivery[]> {
  const result = await db.prepare(
    `SELECT * FROM form_submission_email_deliveries
     WHERE submission_id = ? ORDER BY requested_at DESC`,
  ).bind(submissionId).all<FormSubmissionEmailDelivery>();
  return result.results;
}

export async function createFormSubmissionEmailDelivery(
  db: D1Database,
  input: Omit<FormSubmissionEmailDelivery, 'status' | 'provider_message_id' | 'error_code' | 'accepted_at'>,
): Promise<{ delivery: FormSubmissionEmailDelivery; created: boolean }> {
  const result = await db.prepare(
    `INSERT OR IGNORE INTO form_submission_email_deliveries
       (id, batch_id, submission_id, recipient_id, idempotency_key, policy_version,
        included_field_names_json, field_label_snapshot_json, submission_data_sha256,
        subject_snapshot, body_sha256, status, provider, provider_message_id, error_code,
        requested_by, requested_at, accepted_at, updated_at, retry_of_delivery_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, ?, ?, NULL, ?, ?)`,
  ).bind(
    input.id,
    input.batch_id,
    input.submission_id,
    input.recipient_id,
    input.idempotency_key,
    input.policy_version,
    input.included_field_names_json,
    input.field_label_snapshot_json,
    input.submission_data_sha256,
    input.subject_snapshot,
    input.body_sha256,
    input.provider,
    input.requested_by,
    input.requested_at,
    input.updated_at,
    input.retry_of_delivery_id,
  ).run();
  const delivery = await db.prepare(
    `SELECT * FROM form_submission_email_deliveries
     WHERE submission_id = ? AND recipient_id = ? AND idempotency_key = ?`,
  ).bind(input.submission_id, input.recipient_id, input.idempotency_key).first<FormSubmissionEmailDelivery>();
  if (!delivery) throw new Error('Failed to create delivery receipt');
  return { delivery, created: Number(result.meta?.changes || 0) > 0 };
}

export async function updateFormSubmissionEmailDelivery(
  db: D1Database,
  id: string,
  input: {
    status: FormSubmissionEmailDelivery['status'];
    providerMessageId?: string | null;
    errorCode?: string | null;
    acceptedAt?: string | null;
  },
): Promise<FormSubmissionEmailDelivery | null> {
  const now = jstNow();
  await db.prepare(
    `UPDATE form_submission_email_deliveries
     SET status = ?, provider_message_id = ?, error_code = ?, accepted_at = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(
    input.status,
    input.providerMessageId ?? null,
    input.errorCode ?? null,
    input.acceptedAt ?? null,
    now,
    id,
  ).run();
  return db.prepare(`SELECT * FROM form_submission_email_deliveries WHERE id = ?`)
    .bind(id).first<FormSubmissionEmailDelivery>();
}

export async function createFormSubmissionEmailAudit(
  db: D1Database,
  input: {
    submissionId: string;
    recipientId?: string | null;
    deliveryId?: string | null;
    action: 'recipient_added' | 'recipient_updated' | 'recipient_removed' | 'previewed' | 'send_requested' | 'send_accepted' | 'send_failed' | 'send_unknown';
    actor: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO form_submission_email_audit
       (id, submission_id, recipient_id, delivery_id, action, actor, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    input.submissionId,
    input.recipientId ?? null,
    input.deliveryId ?? null,
    input.action,
    input.actor,
    JSON.stringify(input.metadata || {}),
    jstNow(),
  ).run();
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
