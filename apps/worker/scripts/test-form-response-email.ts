import assert from 'node:assert/strict';
import {
  buildResponseCopyEmail,
  buildResponseCopyPreviewHash,
  classifyEmailError,
  decryptEmailAddress,
  encryptEmailAddress,
  hashEmailAddress,
  maskEmailAddress,
  normalizeEmailAddress,
} from '../src/services/form-response-email.js';

const secret = 'unit-test-form-email-secret-at-least-24-characters';
const normalized = normalizeEmailAddress('  Example.Person@Example.COM ');
assert.equal(normalized, 'example.person@example.com');
assert.throws(() => normalizeEmailAddress('not-an-email'), /有効なメール/);

const firstCiphertext = await encryptEmailAddress(normalized, secret);
const secondCiphertext = await encryptEmailAddress(normalized, secret);
assert.notEqual(firstCiphertext, secondCiphertext);
assert.equal(await decryptEmailAddress(firstCiphertext, secret), normalized);
assert.equal(
  await hashEmailAddress('Example.Person@example.com', secret),
  await hashEmailAddress(normalized, secret),
);
assert.equal(maskEmailAddress(normalized), 'ex************@example.com');

const fields = [
  { name: 'name', label: 'Name', type: 'text' },
  { name: 'support', label: 'Support <needs>', type: 'textarea' },
  { name: 'passport', label: 'Passport', type: 'file' },
  { name: '_internal', label: 'Internal', type: 'text' },
] as any;
const submissionData = {
  name: 'Alex & Sam',
  support: '<script>alert(1)</script>',
  passport: 'https://line-flattravel.example/api/form-files/private?sig=secret',
  _internal: 'must-not-appear',
};

const respondentCopy = buildResponseCopyEmail({
  formName: 'Before You Travel',
  formLocale: 'en',
  submittedAt: '2026-09-07T09:00:00+09:00',
  contactName: 'Alex',
  recipientRole: 'respondent',
  fields,
  submissionData,
});
assert.match(respondentCopy.subject, /Copy of your responses/);
assert.match(respondentCopy.text, /Alex & Sam/);
assert.match(respondentCopy.text, /File received \(not attached/);
assert.doesNotMatch(respondentCopy.text, /sig=secret/);
assert.doesNotMatch(respondentCopy.text, /must-not-appear/);
assert.doesNotMatch(respondentCopy.html, /<script>/);
assert.match(respondentCopy.html, /&lt;script&gt;/);

const agencyCopy = buildResponseCopyEmail({
  formName: 'Before You Travel',
  formLocale: 'en',
  submittedAt: '2026-09-07T09:00:00+09:00',
  contactName: 'Agency Contact',
  recipientRole: 'agency_contact',
  fields,
  submissionData,
  includedFieldNames: ['name'],
});
assert.deepEqual(agencyCopy.includedFieldNames, ['name']);
assert.match(agencyCopy.text, /Alex & Sam/);
assert.doesNotMatch(agencyCopy.text, /Support/);
assert.doesNotMatch(agencyCopy.text, /Passport/);

const hashA = await buildResponseCopyPreviewHash({
  submissionHash: 'submission-hash',
  recipientIds: ['b', 'a'],
  includedFieldNames: ['field-2', 'field-1'],
  recipientSnapshots: ['b:version-1', 'a:version-1'],
});
const hashB = await buildResponseCopyPreviewHash({
  submissionHash: 'submission-hash',
  recipientIds: ['a', 'b'],
  includedFieldNames: ['field-1', 'field-2'],
  recipientSnapshots: ['a:version-1', 'b:version-1'],
});
assert.equal(hashA, hashB);
const hashAfterRecipientChange = await buildResponseCopyPreviewHash({
  submissionHash: 'submission-hash',
  recipientIds: ['a', 'b'],
  includedFieldNames: ['field-1', 'field-2'],
  recipientSnapshots: ['a:version-2', 'b:version-1'],
});
assert.notEqual(hashA, hashAfterRecipientChange);

assert.deepEqual(classifyEmailError({ code: 'E_RECIPIENT_SUPPRESSED' }), {
  status: 'failed',
  code: 'E_RECIPIENT_SUPPRESSED',
});
assert.deepEqual(classifyEmailError(new Error('timeout')), {
  status: 'unknown',
  code: 'EMAIL_OUTCOME_UNKNOWN',
});

console.log('FORM_RESPONSE_EMAIL_TEST_OK');
