import assert from 'node:assert/strict';
import {
  createFormFileAccessUrl,
  formFileExpiresAt,
  verifyFormFileAccess,
} from '../src/services/form-file-access.js';

const nowMs = Date.UTC(2026, 7, 31, 0, 0, 0);
const expiresAt = formFileExpiresAt(nowMs);
const secret = 'test-form-file-secret';
const key = 'test-private-passport.pdf';
const url = new URL(await createFormFileAccessUrl({
  workerUrl: 'https://line-flattravel.example.test',
  key,
  expiresAt,
  secret,
}));

assert.equal(url.pathname, `/api/form-files/${key}`);
assert.equal(url.searchParams.get('expires'), String(expiresAt));
const signature = url.searchParams.get('sig') || '';
assert.ok(signature.length >= 40);
assert.equal(await verifyFormFileAccess({
  key,
  expiresAt,
  signature,
  secret,
  nowMs,
}), true);
assert.equal(await verifyFormFileAccess({
  key: 'different.pdf',
  expiresAt,
  signature,
  secret,
  nowMs,
}), false);
assert.equal(await verifyFormFileAccess({
  key,
  expiresAt,
  signature,
  secret,
  nowMs: (expiresAt + 1) * 1000,
}), false);

for (const suffix of ['', '_']) {
  assert.equal(await verifyFormFileAccess({ key, expiresAt, signature: signature + suffix, secret, nowMs }), true);
  assert.equal(await verifyFormFileAccess({ key: 'different.pdf', expiresAt, signature: signature + suffix, secret, nowMs }), false);
  assert.equal(await verifyFormFileAccess({ key, expiresAt, signature: signature + suffix, secret: 'wrong-secret', nowMs }), false);
  assert.equal(await verifyFormFileAccess({ key, expiresAt, signature: signature + suffix, secret, nowMs: (expiresAt + 1) * 1000 }), false);
}
for (const invalid of [
  `${signature}__`, `${signature}a`, signature.slice(1), `${signature.slice(1)}_`,
  `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}_`, '', '_',
]) {
  assert.equal(await verifyFormFileAccess({ key, expiresAt, signature: invalid, secret, nowMs }), false);
}

console.log('FORM_FILE_ACCESS_TEST_OK');
