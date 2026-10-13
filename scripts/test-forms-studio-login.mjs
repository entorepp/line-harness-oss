import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const requests = [], removed = [], navigations = [];
let status = 200;
const storage = {
  getItem: () => null,
  removeItem: key => removed.push(key),
  setItem: () => { throw new Error('Credentials must not enter browser storage'); },
};
function load(relative, require) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, require, process: { env: { NODE_ENV: 'production' } },
    localStorage: storage, sessionStorage: storage,
    window: { location: { pathname: '/login', assign: path => navigations.push(path) } },
    fetch: async (url, options = {}) => {
      requests.push({ url, ...options });
      return Response.json(status === 200 ? { success: true } : { error: 'Unauthorized' }, { status });
    },
  });
  return exports;
}
const api = load('../apps/forms-studio/src/lib/api.ts', () => { throw new Error('Unexpected import'); });
const state = [];
let cursor = 0;
const jsx = (type, props) => ({ type, props });
const page = load('../apps/forms-studio/src/app/login/page.tsx', name => {
  if (name === '@/lib/api') return api;
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
  if (name === 'next/navigation') return { useRouter: () => ({ replace: path => navigations.push(path) }) };
  if (name === 'react') return { useState: initial => {
    const index = cursor++;
    if (!(index in state)) state[index] = initial;
    return [state[index], value => { state[index] = value; }];
  } };
  throw new Error(`Unexpected import: ${name}`);
}).default;
function render() { cursor = 0; return page(); }
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const one = predicate => {
  const matches = nodes(render(), predicate);
  assert.equal(matches.length, 1);
  return matches[0];
};
const input = id => one(node => node.type === 'input' && node.props.id === id);
const submit = () => one(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
const toggle = () => one(node => node.type === 'button' && node.props.type === 'button').props.onClick();

assert.equal(nodes(render(), node => node.type === 'input').length, 1, 'Default login must have exactly one input');
assert.equal(input('studio-password').props.type, 'password');
assert.equal(one(node => node.type === 'button' && node.props.type === 'submit').props.disabled, true);
input('studio-password').props.onChange({ target: { value: 'Bearer fixture-password' } });
assert.equal(one(node => node.type === 'button' && node.props.type === 'submit').props.disabled, false);
status = 401;
await submit();
assert.equal(navigations.length, 0, 'Rejected credentials must stay on login');
assert.equal(one(node => node.props?.role === 'alert').props.children, 'パスワードが正しくありません');
status = 200;
await submit();
assert.equal(navigations.at(-1), '/');
assert.deepEqual(JSON.parse(requests.at(-1).body), {
  apiKey: 'fixture-password', operatorName: '共有管理者', operatorKey: '',
});
assert.equal(requests.at(-1).url, '/api/forms-studio/session');
assert.equal(requests.at(-1).method, 'POST');
assert.equal(requests.at(-1).cache, 'no-store');
assert.equal(input('studio-password').props.value, '', 'Clear password after success');
assert.ok(removed.includes('forms_studio_api_key'));
assert.ok(removed.includes('forms_studio_operator_personal_key'));
await api.endStudioSession();
assert.equal(requests.at(-1).method, 'DELETE');
await api.ensureStudioSession();
assert.equal(requests.at(-1).body, undefined, 'Session restoration must not resend credentials');

toggle();
input('studio-password').props.onChange({ target: { value: 'fixture-password' } });
input('operator-name').props.onChange({ target: { value: 'Fixture Operator' } });
input('operator-key').props.onChange({ target: { value: 'short' } });
const before = requests.length;
await submit();
assert.equal(requests.length, before, 'Reject incomplete personal authorization locally');
input('operator-key').props.onChange({ target: { value: 'fixture-personal-key-123456789' } });
await submit();
assert.deepEqual(JSON.parse(requests.at(-1).body), {
  apiKey: 'fixture-password', operatorName: 'Fixture Operator', operatorKey: 'fixture-personal-key-123456789',
});
toggle();
assert.equal(nodes(render(), node => node.type === 'input').length, 1);
input('studio-password').props.onChange({ target: { value: 'fixture-password' } });
await submit();
assert.equal(JSON.parse(requests.at(-1).body).operatorKey, '', 'Shared login must not inherit personal send rights');
console.log('PASS: one-field login, rejected password, authenticated session, logout, no credential persistence, optional personal authorization and no stale send rights');
