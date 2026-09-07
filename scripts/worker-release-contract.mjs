import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function assertAncestor(root, ancestor, head) {
  assert.match(ancestor || '', /^[a-f0-9]{40}$/, 'Production source commit must be recorded');
  assert.match(head || '', /^[a-f0-9]{40}$/);
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, head], { cwd: root, stdio: 'pipe' });
  } catch {
    throw new Error(`Refusing stale or divergent source: ${head} does not include ${ancestor}`);
  }
}

export function activeVersion(data) {
  const versions = data.deployments?.[0]?.versions;
  assert.equal(versions?.length, 1, 'Expected one active production version');
  assert.equal(versions[0].percentage, 100, 'Partial rollouts require separate review');
  return versions[0].version_id;
}

export function assertVersionUnchanged(expected, actual) {
  assert.equal(actual, expected, 'Production changed during checks; rebase and validate again');
}

function routes(code) {
  return new Set([...code.matchAll(/\b\w+\.(get|post|put|patch|delete|options|all)\(\s*["']([^"']+)["']/g)]
    .map((match) => `${match[1].toUpperCase()} ${match[2]}`));
}

function mounts(code) {
  return new Set([...code.matchAll(/\bapp\.route\(\s*["']([^"']+)["']\s*,\s*(\w+)\s*\)/g)]
    .map((match) => `${match[1]} ${match[2]}`));
}

export function assertNoRemovedRoutes(live, candidate) {
  for (const [label, before, after] of [
    ['HTTP route', routes(live), routes(candidate)],
    ['mounted router', mounts(live), mounts(candidate)],
  ]) {
    const missing = [...before].filter((value) => !after.has(value));
    assert.deepEqual(missing, [], `Production ${label} would disappear`);
  }
}

export function assertMessagingContract(code) {
  for (const marker of [
    '/api/scheduled-messages/:id/send-now', 'processScheduledMessageById',
    'claimScheduledMessage', 'buildWhatsAppMessagePayload',
    'deliveryMode: body.deliveryMode', 'undoGroupId: body.undoGroupId',
    'processScheduledMessages(env)', 'processAccessibleJapanQuoteJobs',
    '/webhook/meta', '/webhook/wechat', '/webhook/wechat-kf',
    '/api/form-files/', '/meta-data-deletion',
  ]) assert.ok(code.includes(marker), `Missing compiled release contract: ${marker}`);
  assert.ok(!code.includes('WhatsApp account currently supports only text'), 'WhatsApp media support regressed');
}

export async function readWorkerModule(response) {
  const type = response.headers.get('content-type') || '';
  if (!type.includes('multipart/')) return Buffer.from(await response.arrayBuffer());
  const data = await response.formData();
  const part = data.get('index.js');
  assert.ok(part, 'Cloudflare response is missing index.js');
  return typeof part === 'string' ? Buffer.from(part) : Buffer.from(await part.arrayBuffer());
}
