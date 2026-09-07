import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activeVersion, assertAncestor, assertMessagingContract, assertNoRemovedRoutes,
  assertVersionUnchanged, readWorkerModule,
} from './worker-release-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const floor = JSON.parse(readFileSync(resolve(root, 'config/worker-production-contract.json'))).minimumSourceCommit;
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assertAncestor(root, floor, head);
const regressedCommit = execFileSync('git', ['rev-parse', floor + '^'], { cwd: root, encoding: 'utf8' }).trim();
assert.throws(() => assertAncestor(root, floor, regressedCommit), /stale or divergent/);
assert.throws(() => assertAncestor(root, undefined, head));
assert.equal(activeVersion({ deployments: [{ versions: [{ version_id: 'live', percentage: 100 }] }] }), 'live');
assert.throws(() => activeVersion({ deployments: [{ versions: [{ version_id: 'partial', percentage: 50 }] }] }));
assertVersionUnchanged('live', 'live');
assert.throws(() => assertVersionUnchanged('old', 'new'), /Production changed/);
const live = 'chats.post("/api/scheduled-messages/:id/send-now", handler); app.route("/", chats);';
assertNoRemovedRoutes(live, live);
assert.throws(() => assertNoRemovedRoutes(live, 'app.route("/", chats);'), /HTTP route/);
assert.throws(() => assertNoRemovedRoutes(live, 'chats.post("/api/scheduled-messages/:id/send-now", handler);'), /mounted router/);
const oldSource = execFileSync('git', ['show', `${regressedCommit}:apps/worker/src/routes/chats.ts`], { cwd: root, encoding: 'utf8' });
assert.throws(() => assertMessagingContract(oldSource), /Missing compiled release contract/);
const multipart = new Response('--boundary\r\nContent-Disposition: form-data; name="index.js"\r\n\r\nexport default {};\n\r\n--boundary--\r\n', { headers: { 'content-type': 'multipart/form-data; boundary=boundary' } });
assert.equal((await readWorkerModule(multipart)).toString(), 'export default {};\n');
console.log('PASS: release guard rejects stale source, unrecorded source, partial rollout, changed production, removed routes and missing router mounts');
