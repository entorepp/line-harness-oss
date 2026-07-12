import { Hono } from 'hono';
import {
  getForms,
  getFormById,
  getFormsByTranslationGroup,
  createForm,
  updateForm,
  deleteForm,
  getFormSubmissions,
  createFormSubmission,
  updateFormSubmission,
  getFormIssuesByFormId,
  getFormIssueById,
  createFormIssue,
  updateFormIssue,
  getLineAccountById,
  jstNow,
} from '@line-crm/db';
import { getFriendByLineUserId, getFriendById } from '@line-crm/db';
import { addTagToFriend, enrollFriendInScenario } from '@line-crm/db';
import { getVisibleFormFields } from '@line-crm/shared';
import type { FormField as SharedFormField } from '@line-crm/shared';
import type {
  Form as DbForm,
  FormIssue as DbFormIssue,
  FormSubmission as DbFormSubmission,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { fireEvent } from '../services/event-bus.js';

const forms = new Hono<Env>();

type FormField = SharedFormField;

type LocalizedFormDefaults = {
  submitButtonLabel: string;
  successTitle: string;
  successDescription: string;
};

const FORM_LOCALE_DEFAULTS: Record<string, LocalizedFormDefaults> = {
  ja: {
    submitButtonLabel: '送信',
    successTitle: '送信が完了しました',
    successDescription: 'ご回答ありがとうございます。内容を確認してご連絡します。',
  },
  en: {
    submitButtonLabel: 'Submit',
    successTitle: 'Your response has been submitted',
    successDescription: 'Thank you for your response. We will review it and get back to you.',
  },
  nl: {
    submitButtonLabel: 'Verzenden',
    successTitle: 'Uw antwoord is verzonden',
    successDescription: 'Dank u voor uw antwoord. We bekijken de informatie en nemen contact met u op.',
  },
  ko: {
    submitButtonLabel: '제출',
    successTitle: '제출이 완료되었습니다',
    successDescription: '응답해 주셔서 감사합니다. 내용을 확인한 뒤 연락드리겠습니다.',
  },
  'zh-TW': {
    submitButtonLabel: '送出',
    successTitle: '表單已送出',
    successDescription: '感謝您的填寫，我們會確認內容後再與您聯繫。',
  },
};

function normalizeLocale(value?: string | null): string | null {
  const locale = value?.trim();
  if (!locale) return null;

  const lowered = locale.toLowerCase();
  if (lowered === 'zh_tw' || lowered === 'zh-tw') return 'zh-TW';
  if (lowered === 'ja-jp' || lowered === 'ja') return 'ja';
  if (lowered === 'en-us' || lowered === 'en-gb' || lowered === 'en') return 'en';
  if (lowered === 'nl-nl' || lowered === 'nl') return 'nl';
  if (lowered === 'ko-kr' || lowered === 'ko') return 'ko';
  return locale;
}

function getLocalizedFormDefaults(locale?: string | null): LocalizedFormDefaults {
  const normalized = normalizeLocale(locale) || 'ja';
  return FORM_LOCALE_DEFAULTS[normalized] || FORM_LOCALE_DEFAULTS.ja;
}

function getLocaleLabel(locale?: string | null): string {
  switch (normalizeLocale(locale)) {
    case 'en':
      return 'English';
    case 'nl':
      return 'Nederlands';
    case 'ko':
      return '한국어';
    case 'zh-TW':
      return '繁體中文';
    case 'ja':
      return '日本語';
    default:
      return locale?.trim() || '既定';
  }
}

type FormAnswerEntry = {
  name: string;
  label: string;
  value: string;
};

function isUploadedFormFile(value: unknown): value is {
  url: string;
  fileName?: string;
  fileSizeFormatted?: string;
  icon?: string;
} {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as { url?: unknown }).url === 'string',
  );
}

function formatSubmissionValue(value: unknown): string {
  if (Array.isArray(value)) {
    const separator = value.some(isUploadedFormFile) ? '\n' : ', ';
    return value
      .map((item) => formatSubmissionValue(item))
      .filter(Boolean)
      .join(separator);
  }
  if (value === undefined || value === null) return '';
  if (isUploadedFormFile(value)) {
    const icon = value.icon || '添付';
    const name = value.fileName || value.url;
    const size = value.fileSizeFormatted ? ` (${value.fileSizeFormatted})` : '';
    return `${icon} ${name}${size}\n${value.url}`;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).trim();
}

function buildAnswerEntries(
  fields: FormField[],
  submissionData: Record<string, unknown>,
  allFields: FormField[] = fields,
): FormAnswerEntry[] {
  const knownFieldNames = new Set(allFields.map((field) => field.name));

  const orderedEntries = fields
    .map((field) => ({
      name: field.name,
      label: field.label || field.name,
      value: formatSubmissionValue(submissionData[field.name]),
    }))
    .filter((entry) => entry.value);

  const extraEntries = Object.entries(submissionData)
    .filter(([key]) => !knownFieldNames.has(key))
    .map(([key, value]) => ({
      name: key,
      label: key,
      value: formatSubmissionValue(value),
    }))
    .filter((entry) => entry.value);

  return [...orderedEntries, ...extraEntries];
}

function filterVisibleSubmissionData(
  fields: FormField[],
  visibleFields: FormField[],
  submissionData: Record<string, unknown>,
): Record<string, unknown> {
  const knownFieldNames = new Set(fields.map((field) => field.name));
  const visibleFieldNames = new Set(visibleFields.map((field) => field.name));

  return Object.fromEntries(
    Object.entries(submissionData).filter(([key]) => (
      visibleFieldNames.has(key) || !knownFieldNames.has(key)
    )),
  );
}

const RESPONDENT_NAME_PATTERNS = [
  /(^|[_\s-])(full_?)?name($|[_\s-])/i,
  /display[_\s-]?name/i,
  /representative/i,
  /contact/i,
  /traveler/i,
  /guest/i,
  /customer/i,
  /氏名/,
  /名前/,
  /お名前/,
  /代表者/,
  /担当者/,
  /ご担当者/,
  /姓名/,
  /聯絡人/,
  /联系人/,
  /성함/,
  /이름/,
];

const PRIMARY_RESPONDENT_NAME_PATTERNS = [
  /client.*name/i,
  /customer.*name/i,
  /お客様.*(氏名|名前|お名前)/,
  /客戶.*姓名/,
  /고객.*(성명|성함|이름)/,
];

function resolveRespondentName(
  fields: FormField[],
  submissionData: Record<string, unknown>,
): string | null {
  const orderedEntries = buildAnswerEntries(fields, submissionData);

  const findEntryByPatterns = (patterns: RegExp[]) => orderedEntries.find((entry) => {
    const haystack = `${entry.name} ${entry.label}`;
    return patterns.some((pattern) => pattern.test(haystack));
  });

  const matchedEntry = findEntryByPatterns(PRIMARY_RESPONDENT_NAME_PATTERNS)
    || findEntryByPatterns(RESPONDENT_NAME_PATTERNS);
  if (matchedEntry?.value) {
    return matchedEntry.value;
  }

  const emailEntry = orderedEntries.find((entry) => {
    const haystack = `${entry.name} ${entry.label}`;
    return /email|mail|メール|電子郵件|이메일/i.test(haystack);
  });
  if (emailEntry?.value) {
    return emailEntry.value;
  }

  const firstShortEntry = orderedEntries.find((entry) => entry.value.length <= 120);
  return firstShortEntry?.value || null;
}


function serializeForm(row: DbForm) {
  const defaults = getLocalizedFormDefaults(row.locale);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    fields: JSON.parse(row.fields || '[]') as unknown[],
    locale: normalizeLocale(row.locale),
    translationGroupId: row.translation_group_id,
    submitButtonLabel: row.submit_button_label || defaults.submitButtonLabel,
    successTitle: row.success_title || defaults.successTitle,
    successDescription: row.success_description || defaults.successDescription,
    onSubmitTagId: row.on_submit_tag_id,
    onSubmitScenarioId: row.on_submit_scenario_id,
    saveToMetadata: Boolean(row.save_to_metadata),
    isActive: Boolean(row.is_active),
    submitCount: row.submit_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeSubmission(row: DbFormSubmission) {
  return {
    id: row.id,
    formId: row.form_id,
    formIssueId: row.form_issue_id,
    friendId: row.friend_id,
    slackChannelId: row.slack_channel_id,
    data: JSON.parse(row.data || '{}') as Record<string, unknown>,
    createdAt: row.created_at,
  };
}

async function serializeSubmissionWithRouting(
  db: D1Database,
  row: DbFormSubmission,
) {
  let slackChannelId = row.slack_channel_id;

  if (!slackChannelId && row.form_issue_id) {
    const issue = await getFormIssueById(db, row.form_issue_id);
    slackChannelId = issue?.slack_channel_id || null;
  }

  if (!slackChannelId && row.friend_id) {
    const friend = await getFriendById(db, row.friend_id);
    slackChannelId = friend?.slack_channel_id || null;
  }

  return {
    ...serializeSubmission(row),
    slackChannelId,
  };
}

type FormRoutingOptions = {
  lineAccountId?: string | null;
  sharedByFriendId?: string | null;
  slackChannelId?: string | null;
};

async function resolveLiffBaseUrl(
  env: Env['Bindings'],
  db: D1Database,
  lineAccountId?: string | null,
): Promise<string | null> {
  if (lineAccountId?.trim()) {
    const account = await getLineAccountById(db, lineAccountId.trim());
    if (account?.liff_id) {
      return `https://liff.line.me/${account.liff_id}`;
    }
  }
  return env.LIFF_URL || null;
}

function buildPublicFormUrl(env: Env['Bindings'], params: Record<string, string>): string {
  const origin = env.FORMS_APP_URL || env.WEB_APP_URL || 'http://localhost:3000';
  const url = new URL('/public-form', origin);
  for (const [key, value] of Object.entries(params)) {
    if (value.trim()) {
      url.searchParams.set(key, value.trim());
    }
  }
  return url.toString();
}

async function buildLiffShareUrl(
  env: Env['Bindings'],
  db: D1Database,
  formId: string,
  options: FormRoutingOptions,
): Promise<string | null> {
  const liffBaseUrl = await resolveLiffBaseUrl(env, db, options.lineAccountId);
  if (!liffBaseUrl) return null;

  const shareUrl = new URL(liffBaseUrl);
  shareUrl.searchParams.set('page', 'form');
  shareUrl.searchParams.set('id', formId);
  if (options.sharedByFriendId?.trim()) {
    shareUrl.searchParams.set('sharedBy', options.sharedByFriendId.trim());
  }
  if (options.slackChannelId?.trim()) {
    shareUrl.searchParams.set('slackChannelId', options.slackChannelId.trim());
  }
  return shareUrl.toString();
}

async function serializeFormIssue(
  env: Env['Bindings'],
  db: D1Database,
  row: DbFormIssue,
) {
  const publicUrl = buildPublicFormUrl(env, { issue: row.id });
  const liffUrl = await buildLiffShareUrl(env, db, row.form_id, {
    lineAccountId: row.line_account_id,
    sharedByFriendId: row.shared_by_friend_id,
    slackChannelId: row.slack_channel_id,
  });

  return {
    id: row.id,
    formId: row.form_id,
    name: row.name,
    lineAccountId: row.line_account_id,
    slackChannelId: row.slack_channel_id,
    sharedByFriendId: row.shared_by_friend_id,
    locale: row.locale,
    isActive: Boolean(row.is_active),
    publicUrl,
    liffUrl,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/forms — list all forms
forms.get('/api/forms', async (c) => {
  try {
    const items = await getForms(c.env.DB);
    return c.json({ success: true, data: items.map(serializeForm) });
  } catch (err) {
    console.error('GET /api/forms error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/forms/:id — get form
forms.get('/api/forms/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const form = await getFormById(c.env.DB, id);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    return c.json({ success: true, data: serializeForm(form) });
  } catch (err) {
    console.error('GET /api/forms/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/forms — create form
forms.post('/api/forms', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      description?: string | null;
      fields?: unknown[];
      locale?: string | null;
      translationGroupId?: string | null;
      submitButtonLabel?: string | null;
      successTitle?: string | null;
      successDescription?: string | null;
      onSubmitTagId?: string | null;
      onSubmitScenarioId?: string | null;
      saveToMetadata?: boolean;
    }>();

    if (!body.name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }

    const form = await createForm(c.env.DB, {
      name: body.name,
      description: body.description ?? null,
      fields: JSON.stringify(body.fields ?? []),
      locale: normalizeLocale(body.locale),
      translationGroupId: body.translationGroupId?.trim() || null,
      submitButtonLabel: body.submitButtonLabel?.trim() || null,
      successTitle: body.successTitle?.trim() || null,
      successDescription: body.successDescription?.trim() || null,
      onSubmitTagId: body.onSubmitTagId ?? null,
      onSubmitScenarioId: body.onSubmitScenarioId ?? null,
      saveToMetadata: body.saveToMetadata,
    });

    return c.json({ success: true, data: serializeForm(form) }, 201);
  } catch (err) {
    console.error('POST /api/forms error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/forms/:id — update form
forms.put('/api/forms/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      description?: string | null;
      fields?: unknown[];
      locale?: string | null;
      translationGroupId?: string | null;
      submitButtonLabel?: string | null;
      successTitle?: string | null;
      successDescription?: string | null;
      onSubmitTagId?: string | null;
      onSubmitScenarioId?: string | null;
      saveToMetadata?: boolean;
      isActive?: boolean;
    }>();

    const updated = await updateForm(c.env.DB, id, {
      name: body.name,
      description: body.description,
      fields: body.fields !== undefined ? JSON.stringify(body.fields) : undefined,
      locale: 'locale' in body ? normalizeLocale(body.locale) : undefined,
      translationGroupId: 'translationGroupId' in body ? (body.translationGroupId?.trim() || null) : undefined,
      submitButtonLabel: 'submitButtonLabel' in body ? (body.submitButtonLabel?.trim() || null) : undefined,
      successTitle: 'successTitle' in body ? (body.successTitle?.trim() || null) : undefined,
      successDescription: 'successDescription' in body ? (body.successDescription?.trim() || null) : undefined,
      onSubmitTagId: body.onSubmitTagId,
      onSubmitScenarioId: body.onSubmitScenarioId,
      saveToMetadata: body.saveToMetadata,
      isActive: body.isActive,
    });

    if (!updated) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }

    return c.json({ success: true, data: serializeForm(updated) });
  } catch (err) {
    console.error('PUT /api/forms/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/forms/:id
forms.delete('/api/forms/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const form = await getFormById(c.env.DB, id);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    await deleteForm(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/forms/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/forms/:id/submissions — list submissions
forms.get('/api/forms/:id/submissions', async (c) => {
  try {
    const id = c.req.param('id');
    const form = await getFormById(c.env.DB, id);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    const submissions = await getFormSubmissions(c.env.DB, id);
    const serialized = await Promise.all(
      submissions.map((submission) => serializeSubmissionWithRouting(c.env.DB, submission)),
    );
    return c.json({ success: true, data: serialized });
  } catch (err) {
    console.error('GET /api/forms/:id/submissions error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/form-submissions/:submissionId — update submission routing metadata
forms.patch('/api/form-submissions/:submissionId', async (c) => {
  try {
    const submissionId = c.req.param('submissionId');
    const body = await c.req.json<{
      slackChannelId?: string | null;
    }>();

    const updated = await updateFormSubmission(c.env.DB, submissionId, {
      slackChannelId: body.slackChannelId?.trim() || null,
    });

    if (!updated) {
      return c.json({ success: false, error: 'Submission not found' }, 404);
    }

    return c.json({ success: true, data: await serializeSubmissionWithRouting(c.env.DB, updated) });
  } catch (err) {
    console.error('PATCH /api/form-submissions/:submissionId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/forms/:id/issues — list saved channel-bound form links
forms.get('/api/forms/:id/issues', async (c) => {
  try {
    const formId = c.req.param('id');
    const form = await getFormById(c.env.DB, formId);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }

    const issues = await getFormIssuesByFormId(c.env.DB, formId);
    const serialized = await Promise.all(issues.map((issue) => serializeFormIssue(c.env, c.env.DB, issue)));
    return c.json({ success: true, data: serialized });
  } catch (err) {
    console.error('GET /api/forms/:id/issues error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/forms/:id/issues — create a saved channel-bound form link
forms.post('/api/forms/:id/issues', async (c) => {
  try {
    const formId = c.req.param('id');
    const form = await getFormById(c.env.DB, formId);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }

    const body = await c.req.json<{
      name?: string;
      lineAccountId?: string | null;
      slackChannelId?: string | null;
      sharedByFriendId?: string | null;
      locale?: string | null;
    }>();

    const issue = await createFormIssue(c.env.DB, {
      formId,
      name: body.name?.trim() || `${form.name} / ${body.slackChannelId?.trim() || 'C0AL6RG7V9Q'}`,
      lineAccountId: body.lineAccountId?.trim() || null,
      slackChannelId: body.slackChannelId?.trim() || null,
      sharedByFriendId: body.sharedByFriendId?.trim() || null,
      locale: body.locale?.trim() || null,
    });

    return c.json({ success: true, data: await serializeFormIssue(c.env, c.env.DB, issue) }, 201);
  } catch (err) {
    console.error('POST /api/forms/:id/issues error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/form-issues/:issueId — update saved issued form link
forms.patch('/api/form-issues/:issueId', async (c) => {
  try {
    const issueId = c.req.param('issueId');
    const body = await c.req.json<{
      name?: string;
      lineAccountId?: string | null;
      slackChannelId?: string | null;
      sharedByFriendId?: string | null;
      locale?: string | null;
      isActive?: boolean;
    }>();

    const updated = await updateFormIssue(c.env.DB, issueId, {
      name: body.name,
      lineAccountId: body.lineAccountId,
      slackChannelId: body.slackChannelId,
      sharedByFriendId: body.sharedByFriendId,
      locale: body.locale,
      isActive: body.isActive,
    });

    if (!updated) {
      return c.json({ success: false, error: 'Issued form not found' }, 404);
    }

    return c.json({ success: true, data: await serializeFormIssue(c.env, c.env.DB, updated) });
  } catch (err) {
    console.error('PATCH /api/form-issues/:issueId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/form-issues/:issueId — public lookup for issued forms
forms.get('/api/form-issues/:issueId', async (c) => {
  try {
    const issueId = c.req.param('issueId');
    const issue = await getFormIssueById(c.env.DB, issueId);
    if (!issue || !issue.is_active) {
      return c.json({ success: false, error: 'Issued form not found' }, 404);
    }

    const form = await getFormById(c.env.DB, issue.form_id);
    if (!form || !form.is_active) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }

    return c.json({
      success: true,
      data: {
        issue: await serializeFormIssue(c.env, c.env.DB, issue),
        form: serializeForm(form),
      },
    });
  } catch (err) {
    console.error('GET /api/form-issues/:issueId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/forms/:id/share-url — build a public URL for the form
forms.get('/api/forms/:id/share-url', async (c) => {
  try {
    const id = c.req.param('id');
    const slackChannelId = c.req.query('slackChannelId');
    const form = await getFormById(c.env.DB, id);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }

    const shareUrl = buildPublicFormUrl(c.env, {
      id,
      slackChannelId: slackChannelId ?? '',
    });

    return c.json({
      success: true,
      data: {
        shareUrl,
      },
    });
  } catch (err) {
    console.error('GET /api/forms/:id/share-url error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/forms/:id/submit — submit form (public, used by LIFF)
forms.post('/api/forms/:id/submit', async (c) => {
  try {
    const formId = c.req.param('id');
    const form = await getFormById(c.env.DB, formId);
    if (!form) {
      return c.json({ success: false, error: 'Form not found' }, 404);
    }
    if (!form.is_active) {
      return c.json({ success: false, error: 'This form is no longer accepting responses' }, 400);
    }

    const body = await c.req.json<{
      lineUserId?: string;
      friendId?: string;
      issueId?: string;
      sharedByFriendId?: string;
      slackChannelId?: string;
      responderDisplayName?: string;
      responderPictureUrl?: string | null;
      data?: Record<string, unknown>;
    }>();

    const rawSubmissionData = body.data ?? {};
    const issueId = body.issueId?.trim() || null;
    const issue = issueId ? await getFormIssueById(c.env.DB, issueId) : null;
    if (issueId && (!issue || !issue.is_active || issue.form_id !== formId)) {
      return c.json({ success: false, error: 'Issued form not found' }, 404);
    }

    const db = c.env.DB;
    const enableLineFollowup = c.env.FORMS_ENABLE_LINE_FOLLOWUP === 'true';
    const sharedByFriendId = enableLineFollowup
      ? body.sharedByFriendId?.trim() || issue?.shared_by_friend_id || null
      : null;
    const slackChannelId = body.slackChannelId?.trim() || issue?.slack_channel_id || null;
    const responderDisplayName = body.responderDisplayName?.trim() || null;
    const responderPictureUrl = body.responderPictureUrl?.trim() || null;

    // Validate required fields
    const fields = JSON.parse(form.fields || '[]') as FormField[];
    const visibleFields = getVisibleFormFields(fields, rawSubmissionData);
    const submissionData = filterVisibleSubmissionData(fields, visibleFields, rawSubmissionData);

    for (const field of visibleFields) {
      if (field.required) {
        const val = submissionData[field.name];
        if (
          val === undefined ||
          val === null ||
          val === '' ||
          (Array.isArray(val) && val.length === 0)
        ) {
          return c.json(
            { success: false, error: `${field.label} は必須項目です` },
            400,
          );
        }
      }
    }

    const answerEntries = buildAnswerEntries(visibleFields, submissionData, fields);

    // URL-shared forms are the default. LINE/friend resolution is only used when explicitly enabled.
    let friendId: string | null = enableLineFollowup ? body.friendId ?? null : null;
    if (enableLineFollowup && !friendId && body.lineUserId) {
      const friend = await getFriendByLineUserId(c.env.DB, body.lineUserId);
      if (friend) {
        friendId = friend.id;
      }
    }

    const friend = enableLineFollowup && friendId ? await getFriendById(db, friendId) : null;
    const resolvedSubmissionSlackChannelId = slackChannelId || friend?.slack_channel_id || null;

    // Save submission (friendId null if not resolved — avoids FK constraint)
    const submission = await createFormSubmission(c.env.DB, {
      formId,
      formIssueId: issue?.id || null,
      friendId: enableLineFollowup ? friendId || null : null,
      slackChannelId: resolvedSubmissionSlackChannelId,
      data: JSON.stringify(submissionData),
    });

    const now = jstNow();
    const notificationFriendId = sharedByFriendId || friendId || null;
    const lineAccessToken = enableLineFollowup && friend?.line_account_id
      ? (await getLineAccountById(db, friend.line_account_id))?.channel_access_token || c.env.LINE_CHANNEL_ACCESS_TOKEN
      : undefined;
    const eventData = {
      formId: form.id,
      formIssueId: issue?.id || undefined,
      formIssueName: issue?.name || undefined,
      formName: form.name,
      submissionId: submission.id,
      submittedAt: submission.created_at,
      answers: answerEntries,
      respondentName: responderDisplayName
        || friend?.display_name
        || resolveRespondentName(fields, submissionData)
        || issue?.name
        || form.name,
      respondentPictureUrl: responderPictureUrl || friend?.picture_url || undefined,
      notificationSlackChannelId: resolvedSubmissionSlackChannelId || undefined,
      slackChannelId: resolvedSubmissionSlackChannelId || undefined,
      submissionData,
      formFields: visibleFields,
      form: serializeForm(form),
      submission: {
        id: submission.id,
        formId: submission.form_id,
        formIssueId: submission.form_issue_id,
        slackChannelId: resolvedSubmissionSlackChannelId || undefined,
        data: submissionData,
        createdAt: submission.created_at,
      },
      issue: issue ? await serializeFormIssue(c.env, db, issue) : undefined,
    };

    // Side effects (best-effort, don't fail the request)
    const sideEffects: Promise<unknown>[] = [];

    if (enableLineFollowup && friendId) {
      // Save response data to friend's metadata
      if (form.save_to_metadata && friend) {
        sideEffects.push(
          (async () => {
            const existing = JSON.parse(friend.metadata || '{}') as Record<string, unknown>;
            const merged = { ...existing, ...submissionData };
            await db
              .prepare(`UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?`)
              .bind(JSON.stringify(merged), now, friendId)
              .run();
          })(),
        );
      }

      // Add tag
      if (form.on_submit_tag_id) {
        sideEffects.push(addTagToFriend(db, friendId, form.on_submit_tag_id));
      }

      // Enroll in scenario
      if (enableLineFollowup && form.on_submit_scenario_id) {
        sideEffects.push(enrollFriendInScenario(db, friendId, form.on_submit_scenario_id));
      }
    }

    sideEffects.push(
      fireEvent(
        db,
        'form_submit',
        {
          friendId: enableLineFollowup ? friendId || undefined : undefined,
          notificationFriendId: enableLineFollowup ? notificationFriendId || undefined : undefined,
          notificationSlackChannelId: resolvedSubmissionSlackChannelId || undefined,
          suppressLineActions: !enableLineFollowup,
          eventData,
        },
        lineAccessToken,
        enableLineFollowup ? friend?.line_account_id : undefined,
        {
          token: c.env.SLACK_BOT_TOKEN,
          googleTranslateApiKey: c.env.GOOGLE_TRANSLATE_API_KEY,
        },
      ),
    );

    if (sideEffects.length > 0) {
      c.executionCtx.waitUntil((async () => {
        const results = await Promise.allSettled(sideEffects);
        for (const r of results) {
          if (r.status === 'rejected') console.error('Form side-effect failed:', r.reason);
        }
      })());
    }

    return c.json({ success: true, data: serializeSubmission(submission) }, 201);
  } catch (err) {
    console.error('POST /api/forms/:id/submit error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { forms };
