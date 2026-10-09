import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { seal, unseal } from '../src/services/browser-storage.js';

// The actual SQL is executed against a disposable in-memory SQLite database.
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync('../../packages/db/migrations/030_browser_security_storage.sql', 'utf8'));
sqlite.exec(`CREATE TABLE form_issues (id TEXT, form_id TEXT, is_active INTEGER);
 CREATE TABLE line_accounts (id TEXT, name TEXT, channel_id TEXT, channel_type TEXT, channel_access_token TEXT, channel_secret TEXT, is_active INTEGER, created_at TEXT);
 INSERT INTO line_accounts VALUES ('fixture', 'Fixture', 'id', 'line', 'fixture-channel-token', 'fixture-channel-secret', 1, '2026-01-01');`);
const db = {
  prepare(query: string) {
    let values: any[] = [];
    const statement = {
      bind(...args: any[]) { values = args; return statement; },
      async first() { return sqlite.prepare(query).get(...values) || null; },
      async all() { return { success: true, results: sqlite.prepare(query).all(...values) }; },
      async run() { return { success: true, meta: sqlite.prepare(query).run(...values) }; },
    };
    return statement;
  },
  async batch(statements: Array<{ run(): unknown }>) { return Promise.all(statements.map(item => item.run())); },
};
const env = { DB: db, API_KEY: 'fixture-shared-key', FORMS_APP_URL: 'https://forms.example',
  FORM_RESPONSE_EMAIL_ENCRYPTION_KEY: 'fixture-encryption-key-at-least-24-chars',
  UPLOADS: { async getWithMetadata() { return { value: new TextEncoder().encode('<html>fixture</html>').buffer, metadata: { contentType: 'text/html', access: 'public' } }; } },
} as any;
let externalRequests = 0;
globalThis.fetch = async () => { externalRequests++; throw new Error('External calls forbidden in security test'); };
const request = (path: string, options: RequestInit = {}) => worker.fetch(new Request(`https://worker.example${path}`, options), env, { waitUntil() {}, passThroughOnException() {} } as ExecutionContext);
const origin = { Origin: 'https://forms.example', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' };
const login = await request('/api/forms-studio/session', { method: 'POST', headers: origin, body: JSON.stringify({ apiKey: env.API_KEY, operatorName: 'Fixture operator' }) });
assert.equal(login.status, 200);
assert.ok(login.headers.get('set-cookie')?.includes('HttpOnly; SameSite=Lax'));
assert.ok(login.headers.get('cache-control')?.includes('no-store'));
assert.ok(!(await login.text()).includes(env.API_KEY));
const cookie = login.headers.get('set-cookie')!.split(';')[0];
const headers = { ...origin, Cookie: cookie };
assert.equal((await request('/api/forms-studio/session', { headers })).status, 200);
assert.equal((await request('/api/line-accounts/fixture', { headers })).status, 403);
assert.equal((await request('/api/users', { headers })).status, 403);
assert.equal((await request('/api/forms', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://evil.example' }, body: '{}' })).status, 403);
const selectors = await request('/api/line-accounts', { headers });
assert.equal(selectors.status, 200);
assert.equal(externalRequests, 0, 'Forms selectors must not call messaging providers');
assert.ok(!(await selectors.text()).includes('fixture-channel-token'));
const trustedRead = await request('/api/line-accounts/fixture', { headers: { Authorization: `Bearer ${env.API_KEY}` } });
const account = (await trustedRead.json() as any).data;
assert.equal(account.channelAccessToken, '');
assert.equal(account.channelAccessTokenConfigured, true);
assert.equal(account.channelSecret, '');
const storedSession = sqlite.prepare('SELECT payload FROM forms_browser_sessions').get() as any;
assert.ok(!storedSession.payload.includes('Fixture operator'));
assert.equal((await request('/api/forms-studio/session', { method: 'DELETE', headers })).status, 200);
assert.equal((await request('/api/forms-studio/session', { headers })).status, 401);

const draftPath = '/api/forms-studio/draft?formId=72fa9940-164a-4efb-9ad8-e819bfeb8c91';
const initial = await request(draftPath);
assert.equal(initial.status, 200);
const draftHeaders = { ...origin, Cookie: initial.headers.get('set-cookie')!.split(';')[0], 'If-Match': '' };
const draft = { v: { q1: 'Fictional traveller' }, lang: 'en' };
const saved = await request(draftPath, { method: 'PUT', headers: draftHeaders, body: JSON.stringify(draft) });
assert.equal(saved.status, 200);
const revision = (await saved.json() as any).version;
assert.equal((await request(draftPath, { method: 'PUT', headers: draftHeaders, body: JSON.stringify(draft) })).status, 409);
assert.deepEqual((await (await request(draftPath, { headers: draftHeaders })).json() as any).draft, draft);
assert.equal((await (await request(draftPath)).json() as any).draft, null);
assert.ok(!(sqlite.prepare('SELECT payload FROM forms_browser_drafts').get() as any).payload.includes('Fictional traveller'));
assert.equal((await request(draftPath, { method: 'DELETE', headers: { ...draftHeaders, 'If-Match': revision } })).status, 200);
assert.equal((await (await request(draftPath, { headers: draftHeaders })).json() as any).draft, null);
assert.equal((await request(draftPath, { method: 'PUT', headers: { ...draftHeaders, 'If-Match': revision }, body: JSON.stringify(draft) })).status, 409);
assert.equal((await request('/api/images/fixture.html')).status, 404);
const publicFile = await request('/api/files/fixture.html');
assert.equal(publicFile.headers.get('x-content-type-options'), 'nosniff');
assert.ok(publicFile.headers.get('content-disposition')?.startsWith('attachment'));
const upload = new FormData(); upload.append('file', new File(['fixture'], 'fixture.html', { type: 'text/html' }));
assert.equal((await request('/api/upload', { method: 'POST', body: upload })).status, 401);
const encrypted = await seal({ fixture: true }, env, 'a');
await assert.rejects(unseal(encrypted, env, 'b'));
sqlite.close();
console.log('PASS: opaque/revoked scoped sessions, private versioned drafts, encryption, CSRF, provider-free selectors, secret redaction and upload isolation');
