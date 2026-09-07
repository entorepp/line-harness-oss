import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activeVersion, assertAncestor, assertMessagingContract, assertNoRemovedRoutes,
  assertVersionUnchanged, readWorkerModule, sha256,
} from './worker-release-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(readFileSync(resolve(root, 'config/worker-production-contract.json'), 'utf8'));
const mode = process.argv[2];
assert.ok(['--check', '--deploy'].includes(mode), 'Use --check or --deploy');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: 'inherit', env: process.env });
const head = git('rev-parse', 'HEAD');
const branch = git('branch', '--show-current') || process.env.GITHUB_REF_NAME;
assert.equal(branch, contract.branch, `Deploy only from ${contract.branch}`);
assert.equal(git('status', '--porcelain'), '', 'Commit or isolate all changes before production checks');
assertAncestor(root, contract.minimumSourceCommit, head);
assert.ok(process.env.CLOUDFLARE_API_TOKEN, 'Cloudflare account token is required; OAuth fallback is disabled');
if (process.env.CLOUDFLARE_ACCOUNT_ID) assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID, contract.accountId);
process.env.CLOUDFLARE_ACCOUNT_ID = contract.accountId;

const base = `https://api.cloudflare.com/client/v4/accounts/${contract.accountId}/workers/scripts/${contract.worker}`;
async function cloudflare(path) {
  const response = await fetch(base + path, {
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
    signal: AbortSignal.timeout(25_000),
  });
  assert.ok(response.ok, `Cloudflare read failed: ${response.status} ${path || '/script'}`);
  return response;
}
async function result(path) {
  const data = await (await cloudflare(path)).json();
  assert.equal(data.success, true, `Cloudflare rejected ${path}`);
  return data.result;
}
const beforeVersion = activeVersion(await result('/deployments'));
const beforeSettings = await result('/settings');
const liveSource = beforeSettings.bindings.find((binding) => binding.name === contract.sourceBinding)?.text;
assertAncestor(root, liveSource, head);
const liveBundle = await readWorkerModule(await cloudflare(''));
console.log(`Production source ${liveSource}; version ${beforeVersion}. Validating ${head}.`);

run('pnpm', ['--filter', '@line-crm/shared', 'build']);
run('pnpm', ['--filter', '@line-crm/line-sdk', 'build']);
run('pnpm', ['--filter', '@line-crm/db', 'typecheck']);
run('pnpm', ['--filter', 'worker', 'typecheck']);
for (const test of [
  'test:whatsapp-send', 'test:accessible-japan-quote-trigger',
  'test:form-response-email', 'test:form-response-email-route', 'test:travel-quote-route',
]) run('pnpm', ['--filter', 'worker', test]);
run('node', ['scripts/test-worker-release-contract.mjs']);

const workerRoot = resolve(root, 'apps/worker');
const wrangler = resolve(workerRoot, 'node_modules/.bin/wrangler');
const buildDir = resolve(workerRoot, '.wrangler/production-release');
const bundlePath = resolve(buildDir, 'index.js');
run(wrangler, ['deploy', '--dry-run', '--outdir', buildDir], workerRoot);
const candidate = readFileSync(bundlePath);
assertMessagingContract(candidate.toString());
assertNoRemovedRoutes(liveBundle.toString(), candidate.toString());
assert.equal(git('rev-parse', 'HEAD'), head, 'Source changed while validating');
assert.equal(git('status', '--porcelain'), '', 'Working tree changed while validating');
assertVersionUnchanged(beforeVersion, activeVersion(await result('/deployments')));
assert.equal(sha256(await readWorkerModule(await cloudflare(''))), sha256(liveBundle), 'Live source changed during checks');
const receipt = {
  sourceCommit: head, previousSourceCommit: liveSource, previousVersion: beforeVersion,
  bundleSha256: sha256(candidate), checkedAt: new Date().toISOString(),
};
mkdirSync(buildDir, { recursive: true });
writeFileSync(resolve(buildDir, 'preflight.json'), JSON.stringify(receipt, null, 2) + '\n');
if (mode === '--check') {
  console.log(`PASS: production preflight; no deploy. Bundle ${receipt.bundleSha256}`);
  process.exit(0);
}

// Publish the checked artifact with no rebundle or automatic retry.
run(wrangler, [
  'deploy', bundlePath, '--no-bundle', '--keep-vars',
  '--var', `${contract.sourceBinding}:${head}`,
], workerRoot);
const afterVersion = activeVersion(await result('/deployments'));
const afterSettings = await result('/settings');
assert.equal(afterSettings.bindings.find((binding) => binding.name === contract.sourceBinding)?.text, head);
const deployed = await readWorkerModule(await cloudflare(''));
assert.equal(sha256(deployed), sha256(candidate), 'Live Worker bytes differ from the verified artifact');
for (const binding of beforeSettings.bindings.filter((binding) => ['d1', 'kv_namespace', 'secret_text'].includes(binding.type))) {
  const actual = afterSettings.bindings.find((item) => item.name === binding.name);
  assert.ok(actual, `Production binding disappeared: ${binding.name}`);
  assert.equal(actual.type, binding.type);
  if (binding.id) assert.equal(actual.id, binding.id);
  if (binding.namespace_id) assert.equal(actual.namespace_id, binding.namespace_id);
}
const publicStatus = execFileSync('curl', ['-sS', '--max-time', '25', '-o', '/dev/null', '-w', '%{http_code}', `${contract.publicUrl}/docs`], { encoding: 'utf8' });
assert.equal(publicStatus, '200', 'Public Worker HTTP verification failed');
writeFileSync(resolve(buildDir, 'release.json'), JSON.stringify({ ...receipt, version: afterVersion, publicHttp: 200, verifiedAt: new Date().toISOString() }, null, 2) + '\n');
console.log(`VERIFIED: Worker ${afterVersion}; source ${head}; sha256 ${receipt.bundleSha256}. Recipient delivery is a separate confirmation.`);
