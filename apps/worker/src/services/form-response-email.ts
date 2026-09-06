import type { FormField } from '@line-crm/shared';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MAX_EMAIL_LENGTH = 254;
const MAX_CONTACT_LENGTH = 120;
const MAX_COMPANY_LENGTH = 160;
const MAX_FIELD_TEXT_LENGTH = 4_000;
const MAX_RENDERED_BODY_LENGTH = 80_000;

export const FORM_RESPONSE_EMAIL_POLICY_VERSION = 'form-response-email-v1';

export type ResponseCopyRecipientRole = 'respondent' | 'agency_contact';

export type ResponseCopyEmail = {
  subject: string;
  text: string;
  html: string;
  includedFieldNames: string[];
  fieldLabels: Record<string, string>;
};

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function deriveAesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(`forms-email-encryption-v1:${secret}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function deriveHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    utf8(`forms-email-hash-v1:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

export function normalizeEmailAddress(value: unknown): string {
  const email = String(value || '').trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new Error('有効なメールアドレスを入力してください');
  }
  return email;
}

export function normalizeContactName(value: unknown): string {
  const name = String(value || '').trim();
  if (!name || name.length > MAX_CONTACT_LENGTH) {
    throw new Error('担当者名を120文字以内で入力してください');
  }
  return name;
}

export function normalizeCompanyName(value: unknown): string | null {
  const company = String(value || '').trim();
  if (!company) return null;
  if (company.length > MAX_COMPANY_LENGTH) {
    throw new Error('会社名を160文字以内で入力してください');
  }
  return company;
}

export function normalizeOperator(value: unknown): string {
  const operator = String(value || '').trim();
  if (!operator || operator.length > 80 || /[\r\n]/u.test(operator)) {
    throw new Error('管理者名を入力してください');
  }
  return operator;
}

export async function encryptEmailAddress(email: string, secret: string): Promise<string> {
  if (secret.length < 24) throw new Error('Email encryption is not configured');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(secret);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    utf8(normalizeEmailAddress(email)),
  ));
  const payload = new Uint8Array(iv.length + ciphertext.length);
  payload.set(iv, 0);
  payload.set(ciphertext, iv.length);
  return `v1.${bytesToBase64Url(payload)}`;
}

export async function decryptEmailAddress(ciphertext: string, secret: string): Promise<string> {
  if (!ciphertext.startsWith('v1.') || secret.length < 24) {
    throw new Error('Email encryption is not configured');
  }
  const payload = base64UrlToBytes(ciphertext.slice(3));
  if (payload.length <= 12) throw new Error('Invalid email ciphertext');
  const iv = payload.slice(0, 12);
  const encrypted = payload.slice(12);
  const key = await deriveAesKey(secret);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
  return normalizeEmailAddress(new TextDecoder().decode(plaintext));
}

export async function hashEmailAddress(email: string, secret: string): Promise<string> {
  if (secret.length < 24) throw new Error('Email encryption is not configured');
  const key = await deriveHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, utf8(normalizeEmailAddress(email)));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(value)));
  return Array.from(digest).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function safeValue(value: unknown): string {
  let rendered: string;
  if (Array.isArray(value)) {
    rendered = value.map((item) => safeValue(item)).filter(Boolean).join('\n');
  } else if (typeof value === 'object' && value !== null) {
    rendered = JSON.stringify(value, null, 2);
  } else if (typeof value === 'boolean') {
    rendered = value ? 'Yes' : 'No';
  } else {
    rendered = String(value ?? '').trim();
  }
  return rendered.slice(0, MAX_FIELD_TEXT_LENGTH);
}

function localeIsJapanese(locale: string | null | undefined): boolean {
  return String(locale || '').toLowerCase().startsWith('ja');
}

export function buildResponseCopyEmail(input: {
  formName: string;
  formLocale?: string | null;
  submittedAt: string;
  contactName: string;
  recipientRole: ResponseCopyRecipientRole;
  fields: FormField[];
  submissionData: Record<string, unknown>;
  includedFieldNames?: string[];
}): ResponseCopyEmail {
  const japanese = localeIsJapanese(input.formLocale);
  const allowedNames = input.includedFieldNames
    ? new Set(input.includedFieldNames)
    : null;
  const rows = input.fields.flatMap((field) => {
    if (!field?.name || field.name.startsWith('_')) return [];
    if (allowedNames && !allowedNames.has(field.name)) return [];
    const value = input.submissionData[field.name];
    if (!isPresent(value)) return [];
    const isFile = field.type === 'file';
    return [{
      name: field.name,
      label: String(field.label || field.name).trim().slice(0, 240),
      value: isFile
        ? (japanese ? 'ファイル受領済み（メールには添付されません）' : 'File received (not attached to this email)')
        : safeValue(value),
    }];
  });

  const subject = input.recipientRole === 'agency_contact'
    ? (japanese
      ? `【Flat Travel・代理店共有用】回答内容：${input.formName}`
      : `[Flat Travel · Agency copy] Responses: ${input.formName}`)
    : (japanese
      ? `【Flat Travel・回答者控え】ご回答内容：${input.formName}`
      : `[Flat Travel · Respondent copy] Your responses: ${input.formName}`);
  const greeting = japanese ? `${input.contactName} 様` : `Dear ${input.contactName},`;
  const intro = input.recipientRole === 'agency_contact'
    ? (japanese
      ? '担当案件について共有が承認された回答内容をお送りします。'
      : 'Here is the approved response copy for the case you are handling.')
    : (japanese
      ? '以下はご送信いただいた回答内容の控えです。'
      : 'Below is a copy of the responses that were submitted.');
  const submittedLabel = japanese ? '回答日時' : 'Submitted at';
  const correction = japanese
    ? '内容の修正が必要な場合は、このメールへ返信してご連絡ください。'
    : 'If anything needs to be corrected, please reply to this email.';
  const privacy = japanese
    ? 'このメールには個人情報が含まれる場合があります。必要な関係者以外へ転送しないでください。'
    : 'This email may contain personal information. Please do not forward it beyond the people who need it.';

  const textRows = rows.map((row) => `${row.label}\n${row.value}`).join('\n\n');
  const text = [
    greeting,
    '',
    intro,
    `${submittedLabel}: ${input.submittedAt}`,
    '',
    textRows,
    '',
    correction,
    privacy,
    '',
    'Flat Travel',
  ].join('\n');
  if (text.length > MAX_RENDERED_BODY_LENGTH) {
    throw new Error('回答コピー本文が長すぎます');
  }

  const htmlRows = rows.map((row) => `
    <tr>
      <th style="padding:12px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top;color:#475569;font-size:13px;width:38%">${escapeHtml(row.label)}</th>
      <td style="padding:12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:14px;white-space:pre-wrap">${escapeHtml(row.value)}</td>
    </tr>`).join('');
  const html = `<!doctype html>
<html><body style="margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a">
  <div style="max-width:720px;margin:0 auto;padding:28px 16px">
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden">
      <div style="padding:24px;background:#064e3b;color:#ffffff">
        <div style="font-size:12px;letter-spacing:.08em;opacity:.8">FLAT TRAVEL</div>
        <h1 style="margin:8px 0 0;font-size:22px">${escapeHtml(input.formName)}</h1>
      </div>
      <div style="padding:24px">
        <p style="margin:0 0 16px">${escapeHtml(greeting)}</p>
        <p style="margin:0 0 8px;line-height:1.7">${escapeHtml(intro)}</p>
        <p style="margin:0 0 24px;color:#64748b;font-size:13px">${escapeHtml(submittedLabel)}: ${escapeHtml(input.submittedAt)}</p>
        <table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:12px">${htmlRows}</table>
        <p style="margin:24px 0 0;line-height:1.7">${escapeHtml(correction)}</p>
        <p style="margin:12px 0 0;color:#64748b;font-size:12px;line-height:1.7">${escapeHtml(privacy)}</p>
      </div>
    </div>
  </div>
</body></html>`;
  if (html.length > MAX_RENDERED_BODY_LENGTH) {
    throw new Error('回答コピー本文が長すぎます');
  }

  return {
    subject: subject.replace(/[\r\n]/g, ' ').slice(0, 240),
    text,
    html,
    includedFieldNames: rows.map((row) => row.name),
    fieldLabels: Object.fromEntries(rows.map((row) => [row.name, row.label])),
  };
}

export async function buildResponseCopyPreviewHash(input: {
  submissionHash: string;
  recipientIds: string[];
  includedFieldNames: string[];
  recipientSnapshots: string[];
}): Promise<string> {
  return sha256Hex(JSON.stringify({
    version: FORM_RESPONSE_EMAIL_POLICY_VERSION,
    submissionHash: input.submissionHash,
    recipientIds: [...input.recipientIds].sort(),
    includedFieldNames: [...input.includedFieldNames].sort(),
    recipientSnapshots: [...input.recipientSnapshots].sort(),
  }));
}

export function maskEmailAddress(email: string): string {
  const [local, domain] = normalizeEmailAddress(email).split('@');
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(2, local.length - visible.length))}@${domain}`;
}

export function classifyEmailError(error: unknown): { status: 'failed' | 'unknown'; code: string } {
  const explicitOutcome = typeof error === 'object' && error && 'outcome' in error
    ? String((error as { outcome?: unknown }).outcome || '')
    : '';
  const rawCode = typeof error === 'object' && error && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  const safeCode = /^E_[A-Z0-9_]{1,80}$/u.test(rawCode) ? rawCode : 'EMAIL_OUTCOME_UNKNOWN';
  if (explicitOutcome === 'unknown') return { status: 'unknown', code: safeCode };
  const knownFailure = explicitOutcome === 'failed' || safeCode !== 'EMAIL_OUTCOME_UNKNOWN';
  return { status: knownFailure ? 'failed' : 'unknown', code: safeCode };
}
