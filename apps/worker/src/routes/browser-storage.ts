import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../index.js';
import { getActor } from './form-response-emails.js';
import { normalizeOperator, sha256Hex } from '../services/form-response-email.js';
import { browserCookie, cleanBrowserStorage, DRAFT_COOKIE, DRAFT_SECONDS, limitBrowserRequest,
  newCapability, readBrowserSession, sameOrigin, seal, SESSION_COOKIE, SESSION_SECONDS, setBrowserCookie, unseal } from '../services/browser-storage.js';

const browserStorage = new Hono<Env>();
browserStorage.use('/api/forms-studio/*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !sameOrigin(c)) {
    return c.json({ error: 'cross_origin_request_rejected' }, 403);
  }
  await next();
});
async function body(c: Context<Env>, maximum = 64 * 1024): Promise<Record<string, any>> {
  const reader = c.req.raw.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) { await reader.cancel(); throw new Error('body_too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

browserStorage.post('/api/forms-studio/session', async c => {
  if (!await limitBrowserRequest(c, 'login', 20)) return c.json({ error: 'Too many login attempts' }, 429);
  let input;
  try { input = await body(c, 4096); } catch { return c.json({ error: 'Invalid login request' }, 400); }
  const apiKey = String(input.apiKey || '').trim().replace(/^Bearer\s+/i, '');
  if (!apiKey || await sha256Hex(apiKey) !== await sha256Hex(c.env.API_KEY)) return c.json({ error: 'Unauthorized' }, 401);
  let operator: string;
  try { operator = normalizeOperator(String(input.operatorName || '')); } catch { return c.json({ error: '管理者名を確認してください' }, 400); }
  if (!operator) return c.json({ error: '管理者名を入力してください' }, 400);
  const operatorKey = String(input.operatorKey || '').trim();
  if (operatorKey) {
    try { await getActor({ env: c.env, req: { header: name => name === 'X-Forms-Operator' ? encodeURIComponent(operator) : name === 'X-Forms-Operator-Key' ? operatorKey : undefined } }); }
    catch { return c.json({ error: '管理者個別キーを確認してください' }, 403); }
  }
  const capability = newCapability();
  const hash = await sha256Hex(capability);
  const payload = await seal({ operator, operatorKey, keyVersion: await sha256Hex(c.env.API_KEY) }, c.env, hash);
  await c.env.DB.prepare('INSERT INTO forms_browser_sessions (token_hash, payload, expires_at) VALUES (?, ?, ?)')
    .bind(hash, payload, Math.floor(Date.now() / 1000) + SESSION_SECONDS).run();
  const old = browserCookie(c, SESSION_COOKIE);
  if (old) await c.env.DB.prepare('DELETE FROM forms_browser_sessions WHERE token_hash = ?').bind(await sha256Hex(old)).run();
  await cleanBrowserStorage(c);
  setBrowserCookie(c, SESSION_COOKIE, capability, SESSION_SECONDS);
  return c.json({ success: true, operatorName: operator });
});
browserStorage.get('/api/forms-studio/session', async c => {
  const session = await readBrowserSession(c);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  return c.json({ success: true, operatorName: session.operator });
});
browserStorage.delete('/api/forms-studio/session', async c => {
  const capability = browserCookie(c, SESSION_COOKIE);
  if (capability) await c.env.DB.prepare('DELETE FROM forms_browser_sessions WHERE token_hash = ?').bind(await sha256Hex(capability)).run();
  setBrowserCookie(c, SESSION_COOKIE, '', 0);
  return c.json({ success: true });
});

browserStorage.on(['GET', 'PUT', 'DELETE'], '/api/forms-studio/draft', async c => {
  const formId = c.req.query('formId') || '';
  const issue = c.req.query('issue') || '';
  if (formId !== '72fa9940-164a-4efb-9ad8-e819bfeb8c91' || issue.length > 160) return c.json({ error: 'Invalid form scope' }, 400);
  if (issue && !await c.env.DB.prepare('SELECT id FROM form_issues WHERE id = ? AND form_id = ? AND is_active = 1').bind(issue, formId).first()) return c.json({ error: 'Form issue not found' }, 404);
  let capability = browserCookie(c, DRAFT_COOKIE);
  if (!capability) {
    if (c.req.method !== 'GET') return c.json({ error: 'Draft session required' }, 401);
    capability = newCapability();
  }
  const key = await sha256Hex(`draft:${capability}:${formId}:${issue}`);
  const now = Math.floor(Date.now() / 1000);
  setBrowserCookie(c, DRAFT_COOKIE, capability, DRAFT_SECONDS);
  if (c.req.method === 'GET') {
    const row = await c.env.DB.prepare('SELECT payload, version FROM forms_browser_drafts WHERE draft_key = ? AND expires_at > ?')
      .bind(key, now).first<{ payload: string; version: string }>();
    return c.json(row ? { draft: await unseal(row.payload, c.env, key), version: row.version } : { draft: null, version: '' });
  }
  if (!await limitBrowserRequest(c, 'draft', 120)) return c.json({ error: 'Too many draft updates' }, 429);
  let data: Record<string, any> | null = null;
  if (c.req.method === 'PUT') {
    try { data = await body(c); } catch { return c.json({ error: 'Invalid or oversized draft' }, 400); }
    if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.v !== 'object') return c.json({ error: 'Invalid draft' }, 400);
  }
  const version = crypto.randomUUID();
  const payload = await seal(data, c.env, key);
  const saved = await c.env.DB.prepare('INSERT INTO forms_browser_drafts (draft_key, payload, version, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(draft_key) DO UPDATE SET payload=excluded.payload, version=excluded.version, expires_at=excluded.expires_at WHERE forms_browser_drafts.version = ? OR forms_browser_drafts.expires_at <= ? RETURNING version')
    .bind(key, payload, version, now + DRAFT_SECONDS, c.req.header('If-Match') || '', now).first<{ version: string }>();
  if (!saved) return c.json({ error: 'draft_version_conflict' }, 409);
  // A null tombstone also rejects late saves from another tab after submission.
  await cleanBrowserStorage(c);
  return c.json({ success: true, version });
});

export { browserStorage };
