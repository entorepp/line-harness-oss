import { Hono } from 'hono';
import {
  createFormSubmissionEmailAudit,
  createFormSubmissionEmailDelivery,
  getFormById,
  getFormSubmissionById,
  getFormSubmissionEmailDeliveries,
  getFormSubmissionEmailRecipientById,
  getFormSubmissionEmailRecipients,
  jstNow,
  removeFormSubmissionEmailRecipient,
  saveFormSubmissionEmailRecipient,
  updateFormSubmissionEmailDelivery,
} from '@line-crm/db';
import type {
  Form as DbForm,
  FormSubmission as DbFormSubmission,
  FormSubmissionEmailRecipient,
} from '@line-crm/db';
import type { FormField } from '@line-crm/shared';
import type { Env } from '../index.js';
import {
  FORM_RESPONSE_EMAIL_POLICY_VERSION,
  buildResponseCopyEmail,
  buildResponseCopyPreviewHash,
  classifyEmailError,
  decryptEmailAddress,
  encryptEmailAddress,
  hashEmailAddress,
  maskEmailAddress,
  normalizeCompanyName,
  normalizeContactName,
  normalizeEmailAddress,
  normalizeOperator,
  sha256Hex,
} from '../services/form-response-email.js';

const formResponseEmails = new Hono<Env>();
const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
};

type SubmissionContext = {
  submission: DbFormSubmission;
  form: DbForm;
  fields: FormField[];
  data: Record<string, unknown>;
  submissionHash: string;
};

type PreparedRecipient = {
  recipient: FormSubmissionEmailRecipient;
  email: string;
  copy: ReturnType<typeof buildResponseCopyEmail>;
};

function jsonPrivate(c: any, body: unknown, status = 200) {
  return c.json(body, status, PRIVATE_HEADERS);
}

function encryptionSecret(env: Env['Bindings']): string {
  const secret = env.FORM_RESPONSE_EMAIL_ENCRYPTION_KEY || '';
  if (secret.length < 24) throw new Error('Email recipient storage is not configured');
  return secret;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function errorStatus(message: string): number {
  if (message.includes('設定されていません') || message.includes('not configured')) return 503;
  if (message.includes('管理者') || message.includes('権限')) return 403;
  return 400;
}

async function getActor(c: { req: { header(name: string): string | undefined }; env: Env['Bindings'] }): Promise<string> {
  const encodedActor = c.req.header('X-Forms-Operator') || '';
  let decodedActor = encodedActor;
  try {
    decodedActor = decodeURIComponent(encodedActor);
  } catch {
    throw new Error('管理者名の形式が正しくありません');
  }
  const actor = normalizeOperator(decodedActor);
  const presentedKey = String(c.req.header('X-Forms-Operator-Key') || '').trim();
  if (!/^[A-Za-z0-9._~+/=-]{24,256}$/u.test(presentedKey)) {
    throw new Error('管理者個別キーが必要です');
  }
  let configuredHashes: Record<string, unknown>;
  try {
    configuredHashes = JSON.parse(c.env.FORM_RESPONSE_EMAIL_OPERATOR_KEY_HASHES || '') as Record<string, unknown>;
  } catch {
    throw new Error('管理者個別認証が設定されていません');
  }
  const expectedHash = String(configuredHashes[actor] || '').toLowerCase();
  const presentedHash = await sha256Hex(`form-response-email-operator-v1:${presentedKey}`);
  if (!/^[a-f0-9]{64}$/u.test(expectedHash) || !constantTimeEqual(expectedHash, presentedHash)) {
    throw new Error('管理者個別キーが正しくありません');
  }
  const allowlist = String(c.env.FORM_RESPONSE_EMAIL_ALLOWED_OPERATORS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (allowlist.length > 0 && !allowlist.includes(actor)) {
    throw new Error('この管理者には回答コピー送信権限がありません');
  }
  return actor;
}

async function getSubmissionContext(db: D1Database, submissionId: string): Promise<SubmissionContext | null> {
  const submission = await getFormSubmissionById(db, submissionId);
  if (!submission) return null;
  const form = await getFormById(db, submission.form_id);
  if (!form) return null;
  const fields = JSON.parse(form.fields || '[]') as FormField[];
  const data = JSON.parse(submission.data || '{}') as Record<string, unknown>;
  return {
    submission,
    form,
    fields,
    data,
    submissionHash: await sha256Hex(submission.data || '{}'),
  };
}

async function serializeRecipient(recipient: FormSubmissionEmailRecipient, secret: string) {
  const email = await decryptEmailAddress(recipient.email_ciphertext, secret);
  return {
    id: recipient.id,
    submissionId: recipient.submission_id,
    role: recipient.recipient_role,
    companyName: recipient.company_name,
    contactName: recipient.contact_name,
    email,
    maskedEmail: maskEmailAddress(email),
    source: recipient.source,
    createdBy: recipient.created_by,
    createdAt: recipient.created_at,
    updatedBy: recipient.updated_by,
    updatedAt: recipient.updated_at,
  };
}

function serializeDelivery(delivery: Awaited<ReturnType<typeof getFormSubmissionEmailDeliveries>>[number]) {
  return {
    id: delivery.id,
    batchId: delivery.batch_id,
    submissionId: delivery.submission_id,
    recipientId: delivery.recipient_id,
    status: delivery.status,
    provider: delivery.provider,
    providerMessageId: delivery.provider_message_id,
    errorCode: delivery.error_code,
    requestedBy: delivery.requested_by,
    requestedAt: delivery.requested_at,
    acceptedAt: delivery.accepted_at,
    updatedAt: delivery.updated_at,
    retryOfDeliveryId: delivery.retry_of_delivery_id,
  };
}

function normalizeRecipientIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('送信先を選択してください');
  const ids = [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > 4) throw new Error('送信先は1〜4件で選択してください');
  return ids;
}

function normalizeIncludedFieldNames(value: unknown, fields: FormField[]): string[] {
  const available = new Set(fields
    .filter((field) => field.type !== 'file')
    .map((field) => field.name)
    .filter((name) => name && !name.startsWith('_')));
  const requested = Array.isArray(value)
    ? [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
    : [];
  if (requested.some((name) => !available.has(name))) {
    throw new Error('共有対象にフォーム外の項目が含まれています');
  }
  return requested;
}

function normalizeCorrectionReason(value: unknown): string {
  const reason = String(value || '').trim();
  if (reason.length < 5 || reason.length > 500) {
    throw new Error('訂正理由を5〜500文字で入力してください');
  }
  return reason;
}

async function prepareRecipients(
  context: SubmissionContext,
  recipients: FormSubmissionEmailRecipient[],
  recipientIds: string[],
  agencyIncludedFieldNames: string[],
  secret: string,
): Promise<PreparedRecipient[]> {
  const byId = new Map(recipients.map((recipient) => [recipient.id, recipient]));
  return Promise.all(recipientIds.map(async (recipientId) => {
    const recipient = byId.get(recipientId);
    if (!recipient) throw new Error('登録済みの送信先を選択してください');
    const email = await decryptEmailAddress(recipient.email_ciphertext, secret);
    const copy = buildResponseCopyEmail({
      formName: context.form.name,
      formLocale: context.form.locale,
      submittedAt: context.submission.created_at,
      contactName: recipient.contact_name,
      recipientRole: recipient.recipient_role,
      fields: context.fields,
      submissionData: context.data,
      includedFieldNames: recipient.recipient_role === 'agency_contact'
        ? agencyIncludedFieldNames
        : undefined,
    });
    return { recipient, email, copy };
  }));
}

async function buildPreview(
  context: SubmissionContext,
  recipients: FormSubmissionEmailRecipient[],
  body: { recipientIds?: unknown; agencyIncludedFieldNames?: unknown },
  secret: string,
) {
  const recipientIds = normalizeRecipientIds(body.recipientIds);
  const agencyIncludedFieldNames = normalizeIncludedFieldNames(body.agencyIncludedFieldNames, context.fields);
  const selectedRecipients = new Map(recipients.map((recipient) => [recipient.id, recipient]));
  const includesAgency = recipientIds.some((recipientId) => (
    selectedRecipients.get(recipientId)?.recipient_role === 'agency_contact'
  ));
  if (includesAgency && agencyIncludedFieldNames.length === 0) {
    throw new Error('代理店へ共有する回答項目を1件以上選択してください');
  }
  const prepared = await prepareRecipients(
    context,
    recipients,
    recipientIds,
    agencyIncludedFieldNames,
    secret,
  );
  const recipientSnapshots = await Promise.all(prepared.map(async ({ recipient, email, copy }) => (
    [
      recipient.id,
      recipient.updated_at,
      recipient.email_hash,
      await sha256Hex(`${email}\n${copy.subject}\n${copy.text}\n${copy.html}`),
    ].join(':')
  )));
  const previewHash = await buildResponseCopyPreviewHash({
    submissionHash: context.submissionHash,
    recipientIds,
    includedFieldNames: [
      ...context.fields.map((field) => `respondent:${field.name}`),
      ...agencyIncludedFieldNames.map((name) => `agency:${name}`),
    ],
    recipientSnapshots,
  });
  return { recipientIds, agencyIncludedFieldNames, prepared, previewHash };
}

formResponseEmails.get('/api/form-response-email/session', async (c) => {
  try {
    const actor = await getActor(c);
    return jsonPrivate(c, { success: true, data: { actor } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return jsonPrivate(c, { success: false, error: message }, errorStatus(message));
  }
});

formResponseEmails.get('/api/form-submissions/:submissionId/response-copy', async (c) => {
  try {
    await getActor(c);
    const context = await getSubmissionContext(c.env.DB, c.req.param('submissionId'));
    if (!context) return jsonPrivate(c, { success: false, error: 'Submission not found' }, 404);
    const secret = encryptionSecret(c.env);
    const [recipients, deliveries] = await Promise.all([
      getFormSubmissionEmailRecipients(c.env.DB, context.submission.id),
      getFormSubmissionEmailDeliveries(c.env.DB, context.submission.id),
    ]);
    return jsonPrivate(c, {
      success: true,
      data: {
        submissionHash: context.submissionHash,
        emailEnabled: c.env.FORM_RESPONSE_EMAIL_ENABLED === 'true',
        providerConfigured: Boolean(c.env.FORM_RESPONSE_EMAIL && c.env.FORM_RESPONSE_EMAIL_FROM),
        recipients: await Promise.all(recipients.map((recipient) => serializeRecipient(recipient, secret))),
        deliveries: deliveries.map(serializeDelivery),
        fields: context.fields
          .filter((field) => field.name && !field.name.startsWith('_'))
          .map((field) => ({
            name: field.name,
            label: field.label || field.name,
            type: field.type,
            answered: context.data[field.name] !== undefined && context.data[field.name] !== null && context.data[field.name] !== '',
            attachmentExcluded: field.type === 'file',
          })),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return jsonPrivate(c, { success: false, error: message }, errorStatus(message));
  }
});

formResponseEmails.post('/api/form-submissions/:submissionId/email-recipients', async (c) => {
  try {
    const actor = await getActor(c);
    const context = await getSubmissionContext(c.env.DB, c.req.param('submissionId'));
    if (!context) return jsonPrivate(c, { success: false, error: 'Submission not found' }, 404);
    const body = await c.req.json<{
      id?: string;
      role?: string;
      companyName?: string | null;
      contactName?: string;
      email?: string;
      emailConfirmation?: string;
      expectedSubmissionHash?: string;
      correctionReason?: string;
    }>();
    if (body.expectedSubmissionHash !== context.submissionHash) {
      return jsonPrivate(c, { success: false, error: '回答が更新されています。再読み込みしてください' }, 409);
    }
    const role = body.role === 'agency_contact' ? 'agency_contact' : body.role === 'respondent' ? 'respondent' : null;
    if (!role) throw new Error('送信先の役割を選択してください');
    const email = normalizeEmailAddress(body.email);
    if (email !== normalizeEmailAddress(body.emailConfirmation)) {
      throw new Error('メールアドレスと確認用メールアドレスが一致しません');
    }
    const contactName = normalizeContactName(body.contactName);
    const companyName = normalizeCompanyName(body.companyName);
    const secret = encryptionSecret(c.env);
    const currentRecipients = await getFormSubmissionEmailRecipients(c.env.DB, context.submission.id);
    let correctionReason: string | null = null;
    let previousRecipient: FormSubmissionEmailRecipient | null = null;
    if (body.id) {
      const existing = currentRecipients.find((item) => item.id === body.id);
      if (!existing) throw new Error('登録済みの送信先を選択してください');
      if (existing.recipient_role !== role) {
        throw new Error('送信先の役割は変更できません。削除して登録し直してください');
      }
      correctionReason = normalizeCorrectionReason(body.correctionReason);
      previousRecipient = existing;
    }
    if (role === 'agency_contact' && !body.id && currentRecipients.filter((item) => item.recipient_role === 'agency_contact').length >= 3) {
      throw new Error('代理店担当者は3名まで登録できます');
    }
    const result = await saveFormSubmissionEmailRecipient(c.env.DB, {
      id: body.id,
      submissionId: context.submission.id,
      recipientRole: role,
      companyName,
      contactName,
      emailCiphertext: await encryptEmailAddress(email, secret),
      emailHash: await hashEmailAddress(email, secret),
      actor,
    });
    await createFormSubmissionEmailAudit(c.env.DB, {
      submissionId: context.submission.id,
      recipientId: result.recipient.id,
      action: result.created ? 'recipient_added' : 'recipient_updated',
      actor,
      metadata: result.created ? { role } : {
        role,
        correctionReason,
        previous: previousRecipient ? {
          companyName: previousRecipient.company_name,
          contactName: previousRecipient.contact_name,
          emailCiphertext: previousRecipient.email_ciphertext,
          emailHash: previousRecipient.email_hash,
        } : null,
      },
    });
    return jsonPrivate(c, {
      success: true,
      data: await serializeRecipient(result.recipient, secret),
    }, result.created ? 201 : 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const duplicate = /UNIQUE constraint/u.test(message);
    return jsonPrivate(c, { success: false, error: duplicate ? '同じメールアドレスは既に登録されています' : message }, duplicate ? 409 : errorStatus(message));
  }
});

formResponseEmails.delete('/api/form-submissions/:submissionId/email-recipients/:recipientId', async (c) => {
  try {
    const actor = await getActor(c);
    const submissionId = c.req.param('submissionId');
    const recipient = await getFormSubmissionEmailRecipientById(c.env.DB, c.req.param('recipientId'));
    if (!recipient || recipient.submission_id !== submissionId || recipient.removed_at) {
      return jsonPrivate(c, { success: false, error: 'Recipient not found' }, 404);
    }
    await removeFormSubmissionEmailRecipient(c.env.DB, recipient.id, actor);
    await createFormSubmissionEmailAudit(c.env.DB, {
      submissionId,
      recipientId: recipient.id,
      action: 'recipient_removed',
      actor,
      metadata: { role: recipient.recipient_role },
    });
    return jsonPrivate(c, { success: true, data: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return jsonPrivate(c, { success: false, error: message }, errorStatus(message));
  }
});

formResponseEmails.post('/api/form-submissions/:submissionId/response-copy/preview', async (c) => {
  try {
    const actor = await getActor(c);
    const context = await getSubmissionContext(c.env.DB, c.req.param('submissionId'));
    if (!context) return jsonPrivate(c, { success: false, error: 'Submission not found' }, 404);
    const recipients = await getFormSubmissionEmailRecipients(c.env.DB, context.submission.id);
    const body = await c.req.json<{ recipientIds?: unknown; agencyIncludedFieldNames?: unknown }>();
    const preview = await buildPreview(context, recipients, body, encryptionSecret(c.env));
    await createFormSubmissionEmailAudit(c.env.DB, {
      submissionId: context.submission.id,
      action: 'previewed',
      actor,
      metadata: {
        recipientCount: preview.prepared.length,
        agencyFieldCount: preview.agencyIncludedFieldNames.length,
      },
    });
    return jsonPrivate(c, {
      success: true,
      data: {
        submissionHash: context.submissionHash,
        previewHash: preview.previewHash,
        policyVersion: FORM_RESPONSE_EMAIL_POLICY_VERSION,
        recipients: preview.prepared.map(({ recipient, email, copy }) => ({
          recipientId: recipient.id,
          role: recipient.recipient_role,
          contactName: recipient.contact_name,
          companyName: recipient.company_name,
          email,
          subject: copy.subject,
          text: copy.text,
          includedFieldNames: copy.includedFieldNames,
        })),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return jsonPrivate(c, { success: false, error: message }, errorStatus(message));
  }
});

formResponseEmails.post('/api/form-submissions/:submissionId/response-copy/send', async (c) => {
  try {
    const actor = await getActor(c);
    if (c.env.FORM_RESPONSE_EMAIL_ENABLED !== 'true') {
      return jsonPrivate(c, { success: false, error: '回答コピーメール送信は現在無効です' }, 503);
    }
    if (!c.env.FORM_RESPONSE_EMAIL || !c.env.FORM_RESPONSE_EMAIL_FROM) {
      return jsonPrivate(c, { success: false, error: 'メール配信事業者が設定されていません' }, 503);
    }
    const sender = normalizeEmailAddress(c.env.FORM_RESPONSE_EMAIL_FROM);
    const replyTo = c.env.FORM_RESPONSE_EMAIL_REPLY_TO
      ? normalizeEmailAddress(c.env.FORM_RESPONSE_EMAIL_REPLY_TO)
      : undefined;
    const context = await getSubmissionContext(c.env.DB, c.req.param('submissionId'));
    if (!context) return jsonPrivate(c, { success: false, error: 'Submission not found' }, 404);
    const body = await c.req.json<{
      recipientIds?: unknown;
      agencyIncludedFieldNames?: unknown;
      expectedSubmissionHash?: string;
      expectedPreviewHash?: string;
      idempotencyKey?: string;
      confirmed?: boolean;
      agencySharingConfirmed?: boolean;
    }>();
    if (!body.confirmed) throw new Error('送信内容の確認が必要です');
    if (body.expectedSubmissionHash !== context.submissionHash) {
      return jsonPrivate(c, { success: false, error: '回答が更新されています。再度プレビューしてください' }, 409);
    }
    const idempotencyKey = String(body.idempotencyKey || '').trim();
    if (!/^[A-Za-z0-9._:-]{12,120}$/u.test(idempotencyKey)) {
      throw new Error('有効な送信キーが必要です');
    }
    const recipients = await getFormSubmissionEmailRecipients(c.env.DB, context.submission.id);
    const preview = await buildPreview(context, recipients, body, encryptionSecret(c.env));
    if (body.expectedPreviewHash !== preview.previewHash) {
      return jsonPrivate(c, { success: false, error: 'プレビュー内容が変更されています。再度確認してください' }, 409);
    }
    if (preview.prepared.some(({ recipient }) => recipient.recipient_role === 'agency_contact') && !body.agencySharingConfirmed) {
      throw new Error('代理店への共有同意を確認してください');
    }

    const batchId = crypto.randomUUID();
    const requestedAt = jstNow();
    const results = [] as Array<Record<string, unknown>>;

    for (const prepared of preview.prepared) {
      const bodyHash = await sha256Hex(`${prepared.copy.subject}\n${prepared.copy.text}\n${prepared.copy.html}`);
      const receiptResult = await createFormSubmissionEmailDelivery(c.env.DB, {
        id: crypto.randomUUID(),
        batch_id: batchId,
        submission_id: context.submission.id,
        recipient_id: prepared.recipient.id,
        idempotency_key: idempotencyKey,
        policy_version: FORM_RESPONSE_EMAIL_POLICY_VERSION,
        included_field_names_json: JSON.stringify(prepared.copy.includedFieldNames),
        field_label_snapshot_json: JSON.stringify(prepared.copy.fieldLabels),
        submission_data_sha256: context.submissionHash,
        subject_snapshot: prepared.copy.subject,
        body_sha256: bodyHash,
        provider: 'cloudflare_email_service',
        requested_by: actor,
        requested_at: requestedAt,
        updated_at: requestedAt,
        retry_of_delivery_id: null,
      });

      if (!receiptResult.created) {
        results.push({
          recipientId: prepared.recipient.id,
          maskedEmail: maskEmailAddress(prepared.email),
          status: receiptResult.delivery.status,
          deduplicated: true,
        });
        continue;
      }

      await createFormSubmissionEmailAudit(c.env.DB, {
        submissionId: context.submission.id,
        recipientId: prepared.recipient.id,
        deliveryId: receiptResult.delivery.id,
        action: 'send_requested',
        actor,
        metadata: { role: prepared.recipient.recipient_role },
      });

      try {
        const providerResult = await c.env.FORM_RESPONSE_EMAIL.send({
          to: prepared.email,
          from: sender,
          replyTo,
          subject: prepared.copy.subject,
          text: prepared.copy.text,
          html: prepared.copy.html,
        });
        const rawProviderId = typeof providerResult === 'object' && providerResult
          ? String((providerResult as Record<string, unknown>).messageId || (providerResult as Record<string, unknown>).id || '')
          : '';
        const providerMessageId = /^[A-Za-z0-9._:@/-]{1,240}$/u.test(rawProviderId) ? rawProviderId : null;
        const acceptedAt = jstNow();
        await updateFormSubmissionEmailDelivery(c.env.DB, receiptResult.delivery.id, {
          status: 'accepted',
          providerMessageId,
          acceptedAt,
        });
        await createFormSubmissionEmailAudit(c.env.DB, {
          submissionId: context.submission.id,
          recipientId: prepared.recipient.id,
          deliveryId: receiptResult.delivery.id,
          action: 'send_accepted',
          actor,
          metadata: { role: prepared.recipient.recipient_role },
        });
        results.push({
          recipientId: prepared.recipient.id,
          maskedEmail: maskEmailAddress(prepared.email),
          status: 'accepted',
          deduplicated: false,
        });
      } catch (error) {
        const classified = classifyEmailError(error);
        await updateFormSubmissionEmailDelivery(c.env.DB, receiptResult.delivery.id, {
          status: classified.status,
          errorCode: classified.code,
        });
        await createFormSubmissionEmailAudit(c.env.DB, {
          submissionId: context.submission.id,
          recipientId: prepared.recipient.id,
          deliveryId: receiptResult.delivery.id,
          action: classified.status === 'failed' ? 'send_failed' : 'send_unknown',
          actor,
          metadata: { role: prepared.recipient.recipient_role, errorCode: classified.code },
        });
        results.push({
          recipientId: prepared.recipient.id,
          maskedEmail: maskEmailAddress(prepared.email),
          status: classified.status,
          errorCode: classified.code,
          deduplicated: false,
        });
      }
    }

    return jsonPrivate(c, { success: true, data: { batchId, results } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return jsonPrivate(c, { success: false, error: message }, errorStatus(message));
  }
});

export { formResponseEmails };
