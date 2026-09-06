import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { formResponseEmails } from '../src/routes/form-response-emails.js';
import { sha256Hex } from '../src/services/form-response-email.js';

type Row = Record<string, any>;

const form = {
  id: 'form-response-copy-test',
  name: 'ご旅行アンケート',
  description: null,
  fields: JSON.stringify([
    { name: 'trip', label: 'ご旅行内容', type: 'text' },
    { name: 'medical', label: '配慮事項', type: 'textarea' },
    { name: 'passport', label: 'パスポート', type: 'file' },
    { name: '_internal', label: 'Internal', type: 'text' },
  ]),
  locale: 'ja',
  translation_group_id: null,
  submit_button_label: null,
  success_title: null,
  success_description: null,
  on_submit_tag_id: null,
  on_submit_scenario_id: null,
  save_to_metadata: 0,
  is_active: 1,
  submit_count: 1,
  created_at: '2026-09-07T09:00:00+09:00',
  updated_at: '2026-09-07T09:00:00+09:00',
};
const submission = {
  id: 'submission-response-copy-test',
  form_id: form.id,
  form_issue_id: null,
  friend_id: null,
  slack_channel_id: null,
  data: JSON.stringify({
    trip: 'Tokyo and Kyoto',
    medical: 'Wheelchair assistance requested',
    passport: 'https://example.invalid/api/form-files/private-signed-token',
    _internal: 'must never be copied',
  }),
  created_at: '2026-09-07T09:30:00+09:00',
};

const recipients: Row[] = [];
const deliveries: Row[] = [];
const audit: Row[] = [];

function normalizedSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function statement(sqlInput: string) {
  const sql = normalizedSql(sqlInput);
  let bindings: any[] = [];
  const stmt = {
    bind(...values: any[]) {
      bindings = values;
      return stmt;
    },
    async first<T>() {
      if (sql === 'SELECT * FROM form_submissions WHERE id = ?') {
        return (bindings[0] === submission.id ? submission : null) as T | null;
      }
      if (sql === 'SELECT * FROM forms WHERE id = ?') {
        return (bindings[0] === form.id ? form : null) as T | null;
      }
      if (sql === 'SELECT * FROM form_submission_email_recipients WHERE id = ?') {
        return (recipients.find((row) => row.id === bindings[0]) || null) as T | null;
      }
      if (sql.startsWith("SELECT * FROM form_submission_email_recipients WHERE submission_id = ? AND recipient_role = 'respondent'")) {
        return (recipients.find((row) => row.submission_id === bindings[0]
          && row.recipient_role === 'respondent' && !row.removed_at) || null) as T | null;
      }
      if (sql.startsWith('SELECT * FROM form_submission_email_deliveries WHERE submission_id = ? AND recipient_id = ? AND idempotency_key = ?')) {
        return (deliveries.find((row) => row.submission_id === bindings[0]
          && row.recipient_id === bindings[1]
          && row.idempotency_key === bindings[2]) || null) as T | null;
      }
      if (sql === 'SELECT * FROM form_submission_email_deliveries WHERE id = ?') {
        return (deliveries.find((row) => row.id === bindings[0]) || null) as T | null;
      }
      throw new Error(`Unexpected first SQL: ${sql}`);
    },
    async all<T>() {
      if (sql.startsWith('SELECT * FROM form_submission_email_recipients WHERE submission_id = ? AND removed_at IS NULL')) {
        return {
          results: recipients.filter((row) => row.submission_id === bindings[0] && !row.removed_at)
            .sort((a, b) => Number(a.recipient_role === 'agency_contact') - Number(b.recipient_role === 'agency_contact')),
        } as { results: T[] };
      }
      if (sql.startsWith('SELECT * FROM form_submission_email_deliveries WHERE submission_id = ?')) {
        return { results: deliveries.filter((row) => row.submission_id === bindings[0]) } as { results: T[] };
      }
      throw new Error(`Unexpected all SQL: ${sql}`);
    },
    async run() {
      if (sql.startsWith('INSERT INTO form_submission_email_recipients')) {
        const [
          id, submissionId, role, companyName, contactName, emailCiphertext,
          emailHash, createdBy, createdAt, updatedBy, updatedAt,
        ] = bindings;
        if (recipients.some((row) => row.submission_id === submissionId && !row.removed_at
          && (row.email_hash === emailHash || (role === 'respondent' && row.recipient_role === 'respondent')))) {
          throw new Error('UNIQUE constraint failed');
        }
        recipients.push({
          id,
          submission_id: submissionId,
          recipient_role: role,
          company_name: companyName,
          contact_name: contactName,
          email_ciphertext: emailCiphertext,
          email_hash: emailHash,
          source: 'staff_registered',
          created_by: createdBy,
          created_at: createdAt,
          updated_by: updatedBy,
          updated_at: updatedAt,
          removed_by: null,
          removed_at: null,
        });
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.startsWith('UPDATE form_submission_email_recipients SET company_name = ?')) {
        const [companyName, contactName, emailCiphertext, emailHash, actor, now, id] = bindings;
        Object.assign(recipients.find((row) => row.id === id)!, {
          company_name: companyName,
          contact_name: contactName,
          email_ciphertext: emailCiphertext,
          email_hash: emailHash,
          source: 'staff_corrected',
          updated_by: actor,
          updated_at: now,
        });
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.startsWith('UPDATE form_submission_email_recipients SET removed_by = ?')) {
        const [removedBy, removedAt, updatedBy, updatedAt, id] = bindings;
        Object.assign(recipients.find((row) => row.id === id)!, {
          removed_by: removedBy, removed_at: removedAt, updated_by: updatedBy, updated_at: updatedAt,
        });
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.startsWith('INSERT INTO form_submission_email_audit')) {
        const [id, submissionId, recipientId, deliveryId, action, actor, metadataJson, createdAt] = bindings;
        audit.push({ id, submission_id: submissionId, recipient_id: recipientId, delivery_id: deliveryId, action, actor, metadata_json: metadataJson, created_at: createdAt });
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.startsWith('INSERT OR IGNORE INTO form_submission_email_deliveries')) {
        const [
          id, batchId, submissionId, recipientId, idempotencyKey, policyVersion,
          includedNames, fieldLabels, submissionHash, subject, bodyHash,
          provider, requestedBy, requestedAt, updatedAt, retryOf,
        ] = bindings;
        if (deliveries.some((row) => row.submission_id === submissionId
          && row.recipient_id === recipientId && row.idempotency_key === idempotencyKey)) {
          return { success: true, meta: { changes: 0 } };
        }
        deliveries.push({
          id,
          batch_id: batchId,
          submission_id: submissionId,
          recipient_id: recipientId,
          idempotency_key: idempotencyKey,
          policy_version: policyVersion,
          included_field_names_json: includedNames,
          field_label_snapshot_json: fieldLabels,
          submission_data_sha256: submissionHash,
          subject_snapshot: subject,
          body_sha256: bodyHash,
          status: 'pending',
          provider,
          provider_message_id: null,
          error_code: null,
          requested_by: requestedBy,
          requested_at: requestedAt,
          accepted_at: null,
          updated_at: updatedAt,
          retry_of_delivery_id: retryOf,
        });
        return { success: true, meta: { changes: 1 } };
      }
      if (sql.startsWith('UPDATE form_submission_email_deliveries SET status = ?')) {
        const [status, providerMessageId, errorCode, acceptedAt, updatedAt, id] = bindings;
        Object.assign(deliveries.find((row) => row.id === id)!, {
          status,
          provider_message_id: providerMessageId,
          error_code: errorCode,
          accepted_at: acceptedAt,
          updated_at: updatedAt,
        });
        return { success: true, meta: { changes: 1 } };
      }
      throw new Error(`Unexpected run SQL: ${sql}`);
    },
  };
  return stmt;
}

const db = { prepare: statement } as any;
const operatorKey = 'test-only-personal-operator-key-0001';
const sentMessages: Row[] = [];
const emailBinding = {
  async send(message: Row) {
    sentMessages.push(message);
    return { messageId: `cf-email-${sentMessages.length}` };
  },
};
const env = {
  DB: db,
  FORM_RESPONSE_EMAIL_ENABLED: 'false',
  FORM_RESPONSE_EMAIL_FROM: 'notifications@flat-travel.com',
  FORM_RESPONSE_EMAIL_ENCRYPTION_KEY: 'test-only-encryption-secret-32-characters',
  FORM_RESPONSE_EMAIL_ALLOWED_OPERATORS: '前田',
  FORM_RESPONSE_EMAIL_OPERATOR_KEY_HASHES: JSON.stringify({
    '前田': await sha256Hex(`form-response-email-operator-v1:${operatorKey}`),
  }),
  FORM_RESPONSE_EMAIL: emailBinding,
} as any;
const app = new Hono();
app.route('/', formResponseEmails);

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  headers.set('X-Forms-Operator', encodeURIComponent('前田'));
  headers.set('X-Forms-Operator-Key', operatorKey);
  return app.fetch(new Request(`https://line-flattravel.example${path}`, { ...init, headers }), env);
}

const invalidSession = await app.fetch(new Request('https://line-flattravel.example/api/form-response-email/session', {
  headers: {
    'X-Forms-Operator': encodeURIComponent('前田'),
    'X-Forms-Operator-Key': 'invalid-personal-operator-key-0000',
  },
}), env);
assert.equal(invalidSession.status, 403);

const session = await request('/api/form-response-email/session');
assert.equal(session.status, 200);
assert.equal((await session.json() as any).data.actor, '前田');

const initial = await request(`/api/form-submissions/${submission.id}/response-copy`);
assert.equal(initial.status, 200);
assert.equal((await initial.json() as any).data.emailEnabled, false);

const submissionHash = await sha256Hex(submission.data);
async function saveRecipient(body: Record<string, unknown>) {
  return request(`/api/form-submissions/${submission.id}/email-recipients`, {
    method: 'POST',
    body: JSON.stringify({ ...body, expectedSubmissionHash: submissionHash }),
  });
}

const respondentResponse = await saveRecipient({
  role: 'respondent', contactName: '山田 太郎', email: 'taro@example.com', emailConfirmation: 'taro@example.com',
});
assert.equal(respondentResponse.status, 201);
const respondent = (await respondentResponse.json() as any).data;
assert.equal(respondent.email, 'taro@example.com');

const agencyResponse = await saveRecipient({
  role: 'agency_contact', companyName: 'Example Agency', contactName: '佐藤 花子',
  email: 'sato@agency.example', emailConfirmation: 'sato@agency.example',
});
assert.equal(agencyResponse.status, 201);
const agency = (await agencyResponse.json() as any).data;

const mismatch = await saveRecipient({
  role: 'agency_contact', companyName: 'Wrong', contactName: 'Wrong',
  email: 'one@example.com', emailConfirmation: 'two@example.com',
});
assert.equal(mismatch.status, 400);

const roleChange = await saveRecipient({
  id: respondent.id, role: 'agency_contact', companyName: 'Wrong', contactName: 'Wrong',
  email: 'taro@example.com', emailConfirmation: 'taro@example.com', correctionReason: '役割変更テスト',
});
assert.equal(roleChange.status, 400);

const missingCorrectionReason = await saveRecipient({
  id: respondent.id, role: 'respondent', contactName: '山田 太郎',
  email: 'taro@example.com', emailConfirmation: 'taro@example.com',
});
assert.equal(missingCorrectionReason.status, 400);

const correctedRespondent = await saveRecipient({
  id: respondent.id, role: 'respondent', contactName: '山田 太郎',
  email: 'taro.updated@example.com', emailConfirmation: 'taro.updated@example.com',
  correctionReason: '回答者本人から訂正依頼',
});
assert.equal(correctedRespondent.status, 200);
const correctionAudit = audit.find((item) => item.action === 'recipient_updated');
assert.ok(correctionAudit);
assert.doesNotMatch(correctionAudit.metadata_json, /taro@example\.com/);
assert.match(correctionAudit.metadata_json, /emailCiphertext|correctionReason/);

const fileShareAttempt = await request(`/api/form-submissions/${submission.id}/response-copy/preview`, {
  method: 'POST',
  body: JSON.stringify({ recipientIds: [agency.id], agencyIncludedFieldNames: ['passport'] }),
});
assert.equal(fileShareAttempt.status, 400);

const emptyAgencyShareAttempt = await request(`/api/form-submissions/${submission.id}/response-copy/preview`, {
  method: 'POST',
  body: JSON.stringify({ recipientIds: [agency.id], agencyIncludedFieldNames: [] }),
});
assert.equal(emptyAgencyShareAttempt.status, 400);

const previewResponse = await request(`/api/form-submissions/${submission.id}/response-copy/preview`, {
  method: 'POST',
  body: JSON.stringify({
    recipientIds: [respondent.id, agency.id],
    agencyIncludedFieldNames: ['trip'],
  }),
});
assert.equal(previewResponse.status, 200);
const preview = (await previewResponse.json() as any).data;
assert.equal(preview.recipients.length, 2);
const respondentPreview = preview.recipients.find((item: Row) => item.role === 'respondent');
const agencyPreview = preview.recipients.find((item: Row) => item.role === 'agency_contact');
assert.match(respondentPreview.text, /Wheelchair assistance requested/);
assert.match(respondentPreview.text, /ファイル受領済み/);
assert.doesNotMatch(respondentPreview.text, /private-signed-token|must never be copied/);
assert.match(agencyPreview.text, /Tokyo and Kyoto/);
assert.doesNotMatch(agencyPreview.text, /Wheelchair assistance requested|private-signed-token|must never be copied/);

const sendBody = {
  recipientIds: [respondent.id, agency.id],
  agencyIncludedFieldNames: ['trip'],
  expectedSubmissionHash: preview.submissionHash,
  expectedPreviewHash: preview.previewHash,
  idempotencyKey: 'response-copy-route-test-001',
  confirmed: true,
  agencySharingConfirmed: true,
};
const gated = await request(`/api/form-submissions/${submission.id}/response-copy/send`, {
  method: 'POST', body: JSON.stringify(sendBody),
});
assert.equal(gated.status, 503);
assert.equal(sentMessages.length, 0);

const recipientChangedAfterPreview = await saveRecipient({
  id: respondent.id, role: 'respondent', contactName: '山田 太郎',
  email: 'taro.final@example.com', emailConfirmation: 'taro.final@example.com',
  correctionReason: 'プレビュー後の変更検証',
});
assert.equal(recipientChangedAfterPreview.status, 200);

env.FORM_RESPONSE_EMAIL_ENABLED = 'true';
const stalePreviewSend = await request(`/api/form-submissions/${submission.id}/response-copy/send`, {
  method: 'POST', body: JSON.stringify(sendBody),
});
assert.equal(stalePreviewSend.status, 409);
assert.equal(sentMessages.length, 0);

const refreshedPreviewResponse = await request(`/api/form-submissions/${submission.id}/response-copy/preview`, {
  method: 'POST',
  body: JSON.stringify({
    recipientIds: [respondent.id, agency.id],
    agencyIncludedFieldNames: ['trip'],
  }),
});
assert.equal(refreshedPreviewResponse.status, 200);
const refreshedPreview = (await refreshedPreviewResponse.json() as any).data;
const refreshedSendBody = {
  ...sendBody,
  expectedSubmissionHash: refreshedPreview.submissionHash,
  expectedPreviewHash: refreshedPreview.previewHash,
};
const sent = await request(`/api/form-submissions/${submission.id}/response-copy/send`, {
  method: 'POST', body: JSON.stringify(refreshedSendBody),
});
assert.equal(sent.status, 200);
assert.equal(sentMessages.length, 2);
assert.deepEqual(sentMessages.map((item) => item.to).sort(), ['sato@agency.example', 'taro.final@example.com']);
assert.ok(sentMessages.every((item) => !('cc' in item) && !('bcc' in item)));
assert.match(sentMessages.find((item) => item.to === 'taro.final@example.com')!.text, /Wheelchair assistance requested/);
assert.doesNotMatch(sentMessages.find((item) => item.to === 'sato@agency.example')!.text, /Wheelchair assistance requested/);
assert.ok(sentMessages.every((item) => !item.text.includes('private-signed-token')));
assert.equal(deliveries.length, 2);
assert.ok(deliveries.every((item) => item.status === 'accepted'));

const replay = await request(`/api/form-submissions/${submission.id}/response-copy/send`, {
  method: 'POST', body: JSON.stringify(refreshedSendBody),
});
assert.equal(replay.status, 200);
assert.equal(sentMessages.length, 2);
assert.ok((await replay.json() as any).data.results.every((item: Row) => item.deduplicated === true));
assert.equal(audit.filter((item) => item.action === 'send_requested').length, 2);
assert.equal(audit.filter((item) => item.action === 'send_accepted').length, 2);

console.log('FORM_RESPONSE_EMAIL_ROUTE_TEST_OK');
