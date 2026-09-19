import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getLineAccountById, jstNow } from '@line-crm/db';
import type { Env } from '../index.js';
import { normalizeE164Phone } from '../services/whatsapp-initiation.js';
import { listOperationalTemplates, prepareOperationalMessage, operationalPayload } from '../services/whatsapp-operational-templates.js';
import { recordWhatsappDelivery } from '../services/whatsapp-delivery.js';

const whatsappTemplates = new Hono<Env>();
const GRAPH = 'https://graph.facebook.com/v25.0';
const ACCESS = 'whatsapp-template-private';
const MAX_FILE = 10 * 1024 * 1024;
const RETENTION = 180 * 24 * 60 * 60;
type DocumentMetadata = { access: string; friendId: string; accountId: string; name: string; size: number; sha256: string; expiresAt: number };
type SendInput = { templateName: string; templateLanguage: string; values: Record<string, string>; buttonValues?: Record<string, string>; documentKey?: string | null; previewToken?: string; previewExpiresAt?: number; idempotencyKey?: string; optInConfirmed?: boolean; contentConfirmed?: boolean };
type SendRow = { idempotency_key: string; friend_id: string; line_account_id: string; recipient_phone: string; request_hash: string; template_name: string; template_language: string; preview_json: string; status: 'pending' | 'accepted' | 'failed' | 'unknown'; message_log_id: string; provider_message_id: string | null; error_code: string | null; created_at: string; updated_at: string };
class InputError extends Error {}
const failure = (error: unknown) => error instanceof InputError ? error.message : '処理を完了できませんでした。入力と接続状況を確認してください';
const hash = async (value: string | ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value))].map((x) => x.toString(16).padStart(2, '0')).join('');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
function mode(env: Env['Bindings']) {
  return ['test','live'].includes(env.WHATSAPP_OPERATIONAL_TEMPLATES_MODE || '') ? env.WHATSAPP_OPERATIONAL_TEMPLATES_MODE! : 'off';
}
async function allowed(env: Env['Bindings'], phone: string) {
  return mode(env) === 'live' || (mode(env) === 'test' && (env.WHATSAPP_INITIAL_CONTACT_TEST_PHONE_HASHES || '').split(',').map((s) => s.trim().toLowerCase()).includes(await hash(phone)));
}
async function context(db: D1Database, id: string) {
  const friend = await db.prepare('SELECT id, line_user_id, display_name, line_account_id, is_following FROM friends WHERE id = ?').bind(id)
    .first<{ id: string; line_user_id: string; display_name: string; line_account_id: string; is_following: number }>();
  if (!friend?.line_account_id || !friend.is_following) throw new InputError('有効なお客様が見つかりません');
  const account = await getLineAccountById(db, friend.line_account_id);
  if (!account?.is_active || account.channel_type !== 'whatsapp' || !account.whatsapp_business_account_id) throw new InputError('有効なWhatsAppアカウントではありません');
  const inbound = await db.prepare("SELECT id FROM messages_log WHERE friend_id = ? AND direction = 'incoming' LIMIT 1").bind(friend.id).first();
  if (!inbound) throw new InputError('この機能はお客様から受信済みのチャットで使用できます');
  let phone: string;
  try { phone = normalizeE164Phone(friend.line_user_id.startsWith('+') ? friend.line_user_id : `+${friend.line_user_id}`); }
  catch { throw new InputError('登録済み電話番号を確認してください'); }
  return { friend, account, phone };
}
async function documentFor(env: Env['Bindings'], ctx: Awaited<ReturnType<typeof context>>, key: string) {
  if (!/^wa-template-[a-f0-9-]{36}\.pdf$/.test(key)) throw new InputError('PDFを選び直してください');
  const file = await env.UPLOADS.getWithMetadata<DocumentMetadata>(key, 'arrayBuffer');
  if (!file.value || !file.metadata || file.metadata.access !== ACCESS || file.metadata.friendId !== ctx.friend.id || file.metadata.accountId !== ctx.account.id || file.metadata.expiresAt <= Date.now()) throw new InputError('このお客様用のPDFが見つからないか、有効期限が切れています');
  return { bytes: file.value as ArrayBuffer, key, ...file.metadata };
}
async function prepare(env: Env['Bindings'], id: string, body: SendInput) {
  const ctx = await context(env.DB, id);
  const template = (await listOperationalTemplates(ctx.account)).find((item) => item.name === body.templateName && item.language === body.templateLanguage);
  if (!template) throw new InputError('指定したテンプレートが見つかりません');
  let message: ReturnType<typeof prepareOperationalMessage>;
  try { message = prepareOperationalMessage(template, body.values, body.buttonValues || {}); }
  catch (error) { throw new InputError(error instanceof Error ? error.message : '入力を確認してください'); }
  if (template.documentRequired !== Boolean(body.documentKey)) throw new InputError(template.documentRequired ? 'PDFを添付してください' : 'この文面にはPDFを添付できません');
  const document = body.documentKey ? await documentFor(env, ctx, body.documentKey) : null;
  const preview = { friendId: ctx.friend.id, recipientName: ctx.friend.display_name, recipientPhone: `+${ctx.phone}`, accountName: ctx.account.name,
    templateName: template.name, templateLanguage: template.language, category: template.category, text: message.text, links: message.links,
    document: document ? { key: document.key, name: document.name, size: document.size, sha256: document.sha256 } : null };
  return { ctx, template, message, document, preview };
}
async function previewToken(env: Env['Bindings'], prepared: Awaited<ReturnType<typeof prepare>>, expiresAt: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.API_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical({ account: prepared.ctx.account.id, sender: prepared.ctx.account.channel_id, template: prepared.template, preview: prepared.preview, expiresAt })));
  return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function rowByKey(db: D1Database, key: string) { return db.prepare('SELECT * FROM whatsapp_template_sends WHERE idempotency_key = ?').bind(key).first<SendRow>(); }
async function receipt(db: D1Database, row: SendRow) {
  // Idempotent local recovery never calls Meta and never changes friend/customer data.
  if (row.status === 'accepted' && row.provider_message_id) {
    await db.prepare("INSERT OR IGNORE INTO messages_log (id, friend_id, direction, message_type, content, created_at) VALUES (?, ?, 'outgoing', 'whatsapp_template', ?, ?)")
      .bind(row.message_log_id, row.friend_id, row.preview_json, row.created_at).run();
    await recordWhatsappDelivery({ db, lineAccountId: row.line_account_id, providerMessageId: row.provider_message_id, messageLogId: row.message_log_id, status: 'accepted', providerStatusAt: row.updated_at });
    await db.prepare('UPDATE chats SET last_message_at = MAX(COALESCE(last_message_at, ?), ?), updated_at = MAX(updated_at, ?) WHERE friend_id = ?')
      .bind(row.created_at, row.created_at, row.created_at, row.friend_id).run();
  }
  return { status: row.status, messageId: row.message_log_id, providerMessageId: row.provider_message_id, errorCode: row.error_code };
}

whatsappTemplates.use('/api/whatsapp/friends/*', bodyLimit({ maxSize: MAX_FILE + 8192, onError: (c) => c.json({ success: false, error: 'PDFは10MBまでです', outcome: 'not_started' }, 413) }));
whatsappTemplates.get('/api/whatsapp/friends/:id/templates', async (c) => {
  try {
    const ctx = await context(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: { friendId: ctx.friend.id, recipientName: ctx.friend.display_name, recipientPhone: `+${ctx.phone}`, releaseMode: mode(c.env), canSend: await allowed(c.env, ctx.phone), templates: await listOperationalTemplates(ctx.account) } });
  } catch (error) { return c.json({ success: false, error: failure(error) }, error instanceof InputError ? 400 : 502); }
});
whatsappTemplates.post('/api/whatsapp/friends/:id/documents', async (c) => {
  try {
    const ctx = await context(c.env.DB, c.req.param('id'));
    const file = (await c.req.formData()).get('file') as File | string | null;
    if (!file || typeof file === 'string' || file.type !== 'application/pdf' || !/\.pdf$/i.test(file.name) || !file.size || file.size > MAX_FILE) throw new InputError('10MB以下のPDFを選択してください');
    const bytes = await file.arrayBuffer();
    if (new TextDecoder().decode(bytes.slice(0,5)) !== '%PDF-') throw new InputError('PDFファイルの内容を確認してください');
    const name = file.name.replace(/[\x00-\x1f/\\]/g, '_').slice(0,160);
    const key = `wa-template-${crypto.randomUUID()}.pdf`;
    const metadata: DocumentMetadata = { access: ACCESS, friendId: ctx.friend.id, accountId: ctx.account.id, name, size: file.size, sha256: await hash(bytes), expiresAt: Date.now() + RETENTION * 1000 };
    await c.env.UPLOADS.put(key, bytes, { metadata, expirationTtl: RETENTION });
    return c.json({ success: true, data: { key, name, size: file.size } }, 201);
  } catch (error) { return c.json({ success: false, error: failure(error) }, error instanceof InputError ? 400 : 502); }
});
whatsappTemplates.get('/api/whatsapp/friends/:id/documents/:key', async (c) => {
  try {
    const ctx = await context(c.env.DB, c.req.param('id'));
    const file = await documentFor(c.env, ctx, c.req.param('key'));
    return new Response(file.bytes, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Referrer-Policy': 'no-referrer', 'Content-Disposition': `attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(file.name)}` } });
  } catch { return c.json({ success: false, error: 'PDFが見つかりません' }, 404); }
});
whatsappTemplates.post('/api/whatsapp/friends/:id/template-preview', async (c) => {
  try {
    const prepared = await prepare(c.env, c.req.param('id'), await c.req.json<SendInput>());
    const expiresAt = Date.now() + 15 * 60_000;
    return c.json({ success: true, data: { ...prepared.preview, previewExpiresAt: expiresAt, previewToken: await previewToken(c.env, prepared, expiresAt), canSend: await allowed(c.env, prepared.ctx.phone) } });
  } catch (error) { return c.json({ success: false, error: failure(error), outcome: 'not_started' }, error instanceof InputError ? 400 : 502); }
});
whatsappTemplates.get('/api/whatsapp/friends/:id/template-messages/:key', async (c) => {
  const row = await rowByKey(c.env.DB, c.req.param('key'));
  if (!row || row.friend_id !== c.req.param('id')) return c.json({ success: false, error: '送信記録はまだ見つかりません。処理中の可能性があるため再送せず、もう一度結果を確認してください' }, 404);
  return c.json({ success: true, data: await receipt(c.env.DB, row) });
});
whatsappTemplates.post('/api/whatsapp/friends/:id/template-messages', async (c) => {
  let claimed: SendRow | null = null;
  let messageStarted = false;
  try {
    const body = await c.req.json<SendInput>();
    if (!/^[A-Za-z0-9-]{16,100}$/.test(body.idempotencyKey || '')) throw new InputError('送信IDが無効です');
    if (body.optInConfirmed !== true || body.contentConfirmed !== true) throw new InputError('WhatsApp連絡への同意と宛先・文面・添付の確認が必要です');
    const requestHash = await hash(canonical(body));
    const existing = await rowByKey(c.env.DB, body.idempotencyKey!);
    if (existing) {
      if (existing.friend_id !== c.req.param('id') || existing.request_hash !== requestHash) return c.json({ success: false, error: '送信IDは別の内容で使用済みです', outcome: 'conflict' }, 409);
      return c.json({ success: true, data: { ...await receipt(c.env.DB, existing), duplicate: true } });
    }
    const prepared = await prepare(c.env, c.req.param('id'), body);
    if (!await allowed(c.env, prepared.ctx.phone)) throw new InputError('本番送信は受信テストの確認待ちです。現在は送信できません');
    if (!Number.isFinite(body.previewExpiresAt) || body.previewExpiresAt! < Date.now() || body.previewExpiresAt! > Date.now() + 16 * 60_000 || body.previewToken !== await previewToken(c.env, prepared, body.previewExpiresAt!)) throw new InputError('宛先・文面・添付またはMeta承認が変わりました。もう一度プレビューを確認してください');
    const now = jstNow();
    const messageId = crypto.randomUUID();
    const inserted = await c.env.DB.prepare(`INSERT OR IGNORE INTO whatsapp_template_sends
      (idempotency_key, friend_id, line_account_id, recipient_phone, request_hash, template_name, template_language, preview_json, opt_in_confirmed, status, message_log_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending', ?, ?, ?)`).bind(body.idempotencyKey!, prepared.ctx.friend.id, prepared.ctx.account.id, prepared.ctx.phone, requestHash, prepared.template.name, prepared.template.language, JSON.stringify(prepared.preview), messageId, now, now).run();
    if (inserted.meta.changes !== 1) return c.json({ success: false, error: '同じ送信処理が進行中です。結果を確認してください', outcome: 'pending' }, 409);
    claimed = (await rowByKey(c.env.DB, body.idempotencyKey!))!;
    let media: { id: string; filename: string } | undefined;
    const headers = { Authorization: `Bearer ${prepared.ctx.account.channel_access_token}` };
    if (prepared.document) {
      const form = new FormData();
      form.set('messaging_product', 'whatsapp');
      form.set('type', 'application/pdf');
      form.set('file', new Blob([prepared.document.bytes], { type: 'application/pdf' }), prepared.document.name);
      const response = await fetch(`${GRAPH}/${prepared.ctx.account.channel_id}/media`, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(30_000) });
      const result = await response.json() as { id?: string };
      if (!response.ok || !result.id || !/^\d+$/.test(result.id)) throw new Error('MEDIA_UPLOAD_FAILED');
      media = { id: result.id, filename: prepared.document.name };
    }
    const latest = await context(c.env.DB, prepared.ctx.friend.id);
    if (latest.phone !== prepared.ctx.phone || latest.account.id !== prepared.ctx.account.id || latest.account.channel_id !== prepared.ctx.account.channel_id) throw new InputError('送信直前に宛先か送信元が変わりました');
    const payload = operationalPayload(prepared.ctx.phone, prepared.template, prepared.message, media);
    messageStarted = true;
    const response = await fetch(`${GRAPH}/${prepared.ctx.account.channel_id}/messages`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000) });
    const data = await response.json().catch(() => null) as { messages?: { id?: string }[]; error?: { code?: number } } | null;
    const providerId = data?.messages?.[0]?.id;
    if (!response.ok && response.status >= 400 && response.status < 500 && data?.error?.code) {
      await c.env.DB.prepare("UPDATE whatsapp_template_sends SET status = 'failed', error_code = ?, updated_at = ? WHERE idempotency_key = ?").bind(String(data.error.code), jstNow(), claimed.idempotency_key).run();
      return c.json({ success: true, data: await receipt(c.env.DB, (await rowByKey(c.env.DB, claimed.idempotency_key))!) });
    }
    if (!response.ok || !providerId) throw new Error('UNKNOWN_OUTCOME');
    await c.env.DB.prepare("UPDATE whatsapp_template_sends SET status = 'accepted', provider_message_id = ?, updated_at = ? WHERE idempotency_key = ?").bind(providerId, jstNow(), claimed.idempotency_key).run();
    return c.json({ success: true, data: await receipt(c.env.DB, (await rowByKey(c.env.DB, claimed.idempotency_key))!) }, 201);
  } catch (error) {
    if (claimed) {
      // Never downgrade a persisted acceptance if local history/receipt recovery fails.
      await c.env.DB.prepare("UPDATE whatsapp_template_sends SET status = ?, error_code = ?, updated_at = ? WHERE idempotency_key = ? AND status = 'pending'")
        .bind(messageStarted ? 'unknown' : 'failed', messageStarted ? 'UNKNOWN_OUTCOME' : 'MEDIA_UPLOAD_FAILED', jstNow(), claimed.idempotency_key).run();
      return c.json({ success: false, error: '送信結果の確認が必要です。自動再送はしません。「送信結果を確認」を押してください', outcome: 'check_receipt' }, 502);
    }
    return c.json({ success: false, error: failure(error), outcome: 'not_started' }, error instanceof InputError ? 400 : 502);
  }
});
export { whatsappTemplates };
