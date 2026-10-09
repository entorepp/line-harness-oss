import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../apps/forms-studio/public/server-draft.js', import.meta.url), 'utf8');
let removed = false, writes = 0, remote = null, revision = '', counter = 0;
const listeners = new Map();
const status = { textContent: '', hidden: true, setAttribute() {} };
const context = vm.createContext({
  location: { search: '' }, URLSearchParams, AbortSignal, structuredClone,
  setTimeout: () => 1, clearTimeout() {},
  localStorage: { getItem: () => JSON.stringify({ v: { q1: 'Fixture old draft' } }), removeItem() { removed = true; }, setItem() { throw new Error('Browser persistence forbidden'); } },
  document: { documentElement: { lang: 'en' }, getElementById: () => status, createElement: () => status },
  window: { addEventListener: (name, fn) => listeners.set(name, fn) },
  async fetch(_url, options = {}) {
    if (!options.method) return Response.json({ draft: remote, version: revision });
    if (options.headers['If-Match'] !== revision) return Response.json({ error: 'conflict' }, { status: 409 });
    revision = `v${++counter}`;
    remote = options.method === 'DELETE' ? null : JSON.parse(options.body);
    if (options.method === 'PUT') writes++;
    return Response.json({ success: true, version: revision });
  },
});
vm.runInContext(source, context);
const draft = context.window.FlatFormDraft;
await draft.ready;
assert.equal(removed, true);
assert.equal(draft.read().v.q1, 'Fixture old draft');
for (let index = 0; index < 30; index++) draft.write({ v: { q1: `Fixture ${index}` } });
assert.equal(writes, 0, 'Typing must not block on a request per keystroke');
let protectedUnload = false;
listeners.get('beforeunload')({ preventDefault() { protectedUnload = true; } });
assert.equal(protectedUnload, true);
await draft.flush();
assert.equal(writes, 1);
assert.equal(remote.v.q1, 'Fixture 29');
await draft.clear();
draft.write({ v: { q1: 'Must not resurrect after submission' } });
await draft.flush();
assert.equal(remote, null);
assert.equal(writes, 1);
let recover, recoverEvent;
remote = null; revision = '';
const issued = vm.createContext({ ...context, location: { search: '?issue=fictional' }, Event,
  document: { ...context.document,
    getElementById: () => ({ ...status, before() {} }),
    createElement: () => ({ ...status, remove() {}, addEventListener(_event, fn) { recover = fn; } }),
  },
  window: { addEventListener() {}, confirm: () => true, dispatchEvent(event) { recoverEvent = event.type; } },
});
vm.runInContext(source, issued);
await issued.window.FlatFormDraft.ready;
assert.equal(issued.window.FlatFormDraft.read(), null, 'Unbound old data must not automatically attach to an issued case');
assert.equal(writes, 1);
recover();
assert.equal(recoverEvent, 'flat-form-draft-recovered');
await issued.window.FlatFormDraft.flush();
assert.equal(remote.v.q1, 'Fixture old draft');
issued.window.FlatFormDraft.write({ v: { q1: 'Keep pending edit on conflict' } });
revision = 'updated-in-another-tab';
await assert.rejects(issued.window.FlatFormDraft.flush(), /draft_conflict/);
assert.equal(issued.window.FlatFormDraft.read().v.q1, 'Keep pending edit on conflict');
assert.equal(remote.v.q1, 'Fixture old draft');
console.log('PASS: legacy purge, RAM edits, 30 edits coalesced to one write, unload/cleanup protection, explicit legacy issue recovery and conflict preservation');
