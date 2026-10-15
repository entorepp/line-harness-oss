import { Hono } from 'hono';
import type { Env } from '../index.js';
import { createFormFileAccessUrl, verifyFormFileAccess, FORM_PRIVATE_FILE_RETENTION_SECONDS } from '../services/form-file-access.js';
import { getLineContentSigningSecret } from '../services/line-content-proxy.js';
import { detectFormFileType } from '../services/form-file-type.js';

export const MEDIA_FORM_ID = '8dc19365-8dd7-49e7-92fb-fdd697572771';
export const CHUNK_BYTES = 8 * 1024 * 1024;
const TTL = FORM_PRIVATE_FILE_RETENTION_SECONDS;
const PRIVATE = 'form-private';
const ALBUM_PAGE_SIZE = 64;
const COMPLETE_BATCH = 32;
type Bindings = Env['Bindings'];
type Session = { id: string; size: number; count: number; name: string; expires: number; field: string };
type MediaItem = { key: string; fileName: string; fileSize: number; contentType: string };
type Album = { kind: 'album'; items: MediaItem[]; previous: string | null; count: number; expires: number };
type Manifest = { kind: 'media'; session: Session; contentType: string };
const secret = (env: Bindings) => getLineContentSigningSecret(env.API_KEY, env.LINE_CHANNEL_SECRET);
const base = (env: Bindings) => env.WORKER_URL;
const keyFor = (id: string, index: number) => `post-trip-media/${id}/${index}`;
const metadataKey = (id: string) => `post-trip-media/${id}/session`;
const expiresNow = () => Math.floor(Date.now() / 1000) + TTL;
const uuid = (id: string) => /^[a-f0-9-]{36}$/.test(id);
const bytesAt = (s: Session, i: number) => Math.min(CHUNK_BYTES, s.size - i * CHUNK_BYTES);
async function signed(env: Bindings, key: string, expires: number) {
  return createFormFileAccessUrl({ workerUrl: base(env), key, expiresAt: expires, secret: secret(env) });
}
async function signature(env: Bindings, key: string, expires: number) {
  return new URL(await signed(env, key, expires)).searchParams.get('sig')!;
}
async function sessionFor(c: any): Promise<Session | null> {
  const id = c.req.param('id');
  if (!uuid(id)) return null;
  const s = await c.env.UPLOADS.get(metadataKey(id), 'json') as Session | null;
  if (!s) return null;
  return await verifyFormFileAccess({ key: `media-upload:${id}`, expiresAt: s.expires, signature: c.req.header('X-Upload-Token') || '', secret: secret(c.env) }) ? s : null;
}
function mediaType(bytes: Uint8Array): string {
  const image = detectFormFileType(bytes);
  if (image.startsWith('image/')) return image;
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b));
  if (ascii(4, 8) === 'ftyp') return ascii(8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  // Legacy QuickTime files can start directly with their movie/media atom.
  if (['moov', 'mdat', 'wide'].includes(ascii(4, 8))) return 'video/quicktime';
  if ([0x1a, 0x45, 0xdf, 0xa3].every((v, i) => bytes[i] === v) && /webm|matroska/.test(ascii(0, 1024))) return /webm/.test(ascii(0, 1024)) ? 'video/webm' : 'video/x-matroska';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'AVI ') return 'video/x-msvideo';
  return '';
}
const resultItem = (key: string, name: string, size: number, contentType: string, url: string, expires: number) => ({
  key, fileName: name, fileSize: size, contentType, url, access: PRIVATE,
  expiresAt: new Date(expires * 1000).toISOString(), isImage: contentType.startsWith('image/'),
  fileSizeFormatted: `${(size / 1024 / 1024).toFixed(1)} MB`, ext: contentType.startsWith('video/') ? 'video' : 'image', icon: '📎',
});

export const formMedia = new Hono<Env>();
formMedia.post('/api/form-media/start', async c => {
  const body = await c.req.json<{ formId: string; fieldName: string; fileName: string; fileSize: number }>();
  if (body.formId !== MEDIA_FORM_ID || body.fieldName !== 'memory_photos' || !Number.isSafeInteger(body.fileSize) || body.fileSize <= 0 || !body.fileName || body.fileName.length > 500) return c.json({ success: false, error: 'Invalid media upload request.' }, 400);
  const form = await c.env.DB.prepare('SELECT is_active, fields FROM forms WHERE id = ?').bind(MEDIA_FORM_ID).first<{ is_active: number; fields: string }>();
  if (!form?.is_active || !JSON.parse(form.fields).some((f: any) => f.name === body.fieldName && f.type === 'file')) return c.json({ success: false, error: 'The media form is unavailable.' }, 404);
  const id = crypto.randomUUID();
  const s: Session = { id, size: body.fileSize, count: Math.ceil(body.fileSize / CHUNK_BYTES), name: body.fileName, expires: expiresNow(), field: body.fieldName };
  await c.env.UPLOADS.put(metadataKey(id), JSON.stringify(s), { expirationTtl: TTL, metadata: { access: PRIVATE } });
  return c.json({ success: true, data: { id, chunkBytes: CHUNK_BYTES, count: s.count, token: await signature(c.env, `media-upload:${id}`, s.expires) } });
});
formMedia.post('/api/form-media/:id/chunks/:index', async c => {
  const s = await sessionFor(c);
  if (!s) return c.json({ success: false, error: 'Upload session expired. Please retry.' }, 403);
  const index = Number(c.req.param('index'));
  if (!Number.isSafeInteger(index) || index < 0 || index >= s.count) return c.json({ success: false, error: 'Invalid media part.' }, 400);
  const length = Number(c.req.header('Content-Length'));
  if (length && length !== bytesAt(s, index)) return c.json({ success: false, error: 'Incorrect media part size.' }, 400);
  // Read at most one bounded part even when Content-Length is absent or forged.
  const reader = c.req.raw.body?.getReader();
  if (!reader) return c.json({ success: false, error: 'Missing media part.' }, 400);
  const parts: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    received += part.value.byteLength;
    if (received > bytesAt(s, index)) { await reader.cancel(); return c.json({ success: false, error: 'Media part is too large.' }, 413); }
    parts.push(part.value);
  }
  const bytes = new Uint8Array(received);
  let position = 0;
  for (const part of parts) { bytes.set(part, position); position += part.byteLength; }
  if (bytes.byteLength !== bytesAt(s, index)) return c.json({ success: false, error: 'Incorrect media part size.' }, 400);
  const type = index === 0 ? mediaType(bytes.subarray(0, 1024)) : '';
  if (index === 0 && !type) return c.json({ success: false, error: 'Please choose a supported photo or video file.' }, 400);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2, '0')).join('');
  const key = keyFor(s.id, index);
  const existing = await c.env.UPLOADS.getWithMetadata<{ digest: string; size: number }>(key, 'arrayBuffer');
  if (existing.value) {
    if (existing.metadata?.digest !== digest) return c.json({ success: false, error: 'This media part has different content. Please start a new upload.' }, 409);
    return c.json({ success: true, data: { index, received: bytes.length, reused: true } });
  }
  await c.env.UPLOADS.put(key, bytes, { expiration: s.expires, metadata: { access: PRIVATE, digest, size: bytes.length, contentType: type } });
  return c.json({ success: true, data: { index, received: bytes.length } });
});
formMedia.post('/api/form-media/:id/complete', async c => {
  const s = await sessionFor(c);
  if (!s) return c.json({ success: false, error: 'Upload session expired. Please retry.' }, 403);
  const body = await c.req.json<{ offset?: number; proof?: string }>();
  const offset = body.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= s.count || (offset > 0 && !(await verifyFormFileAccess({ key: `media-verified:${s.id}:${offset}`, signature: body.proof || '', expiresAt: s.expires, secret: secret(c.env) })))) return c.json({ success: false, error: 'Invalid upload verification.' }, 400);
  const end = Math.min(s.count, offset + COMPLETE_BATCH);
  for (let i = offset; i < end; i++) {
    const part = await c.env.UPLOADS.getWithMetadata<{ size: number }>(keyFor(s.id, i), 'stream');
    if (part.value) await part.value.cancel();
    if (!part.value || part.metadata?.size !== bytesAt(s, i)) return c.json({ success: false, error: 'A media part has not arrived yet. Please retry.', retryable: true }, 409);
  }
  if (end < s.count) return c.json({ success: true, data: { nextOffset: end, proof: await signature(c.env, `media-verified:${s.id}:${end}`, s.expires) } });
  const first = await c.env.UPLOADS.getWithMetadata<{ contentType: string }>(keyFor(s.id, 0), 'stream');
  if (first.value) await first.value.cancel();
  if (!first.metadata?.contentType) return c.json({ success: false, error: 'Media verification is incomplete. Please retry.' }, 409);
  const key = `${s.id}.media`;
  const existing = await c.env.UPLOADS.get(key);
  if (!existing) await c.env.UPLOADS.put(key, JSON.stringify({ kind: 'media', session: s, contentType: first.metadata.contentType } satisfies Manifest), { expiration: s.expires, metadata: { access: PRIVATE, formId: MEDIA_FORM_ID } });
  return c.json({ success: true, data: { file: resultItem(key, s.name, s.size, first.metadata.contentType, await signed(c.env, key, s.expires), s.expires) } });
});
formMedia.post('/api/form-media/collection', async c => {
  const body = await c.req.json<{ files: { key: string; url: string }[]; previous?: string }>();
  if (!Array.isArray(body.files) || !body.files.length || body.files.length > ALBUM_PAGE_SIZE) return c.json({ success: false, error: 'Invalid media collection page.' }, 400);
  let previous: string | null = null;
  let previousCount = 0;
  let expires = expiresNow();
  const verifyUrl = async (value: string, suffix: string) => {
    const u = new URL(value);
    const key = decodeURIComponent(u.pathname.split('/').at(-1)!);
    if (u.origin !== new URL(base(c.env)).origin || !u.pathname.startsWith('/api/form-files/') || !key.endsWith(suffix) || !(await verifyFormFileAccess({ key, expiresAt: Number(u.searchParams.get('expires')), signature: u.searchParams.get('sig') || '', secret: secret(c.env) }))) throw new Error('Invalid media collection reference.');
    expires = Math.min(expires, Number(u.searchParams.get('expires')));
    return key;
  };
  try {
    if (body.previous) {
      previous = await verifyUrl(body.previous, '.album');
      const album = await c.env.UPLOADS.get<Album>(previous, 'json');
      if (album?.kind !== 'album') throw new Error('Previous media page is unavailable.');
      previousCount = album.count;
    }
    const items: MediaItem[] = [];
    for (const file of body.files) {
      const key = await verifyUrl(file.url, '.media');
      if (file.key !== key) throw new Error('Media reference does not match.');
      const manifest = await c.env.UPLOADS.get<Manifest>(key, 'json');
      if (manifest?.kind !== 'media') throw new Error('A media file is not ready yet. Please retry.');
      items.push({ key, fileName: manifest.session.name, fileSize: manifest.session.size, contentType: manifest.contentType });
    }
    const key = `${crypto.randomUUID()}.album`;
    const album: Album = { kind: 'album', items, previous, count: previousCount + items.length, expires };
    await c.env.UPLOADS.put(key, JSON.stringify(album), { expiration: expires, metadata: { access: PRIVATE, formId: MEDIA_FORM_ID } });
    return c.json({ success: true, data: { ...resultItem(key, `Travel memories (${album.count} photos and videos)`, 0, 'text/html', await signed(c.env, key, expires), expires), count: album.count, ext: 'album', fileSizeFormatted: `${album.count} files` } });
  } catch (error) { return c.json({ success: false, error: error instanceof Error ? error.message : 'Invalid media collection.' }, 400); }
});

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export async function readChunkedMedia(env: Bindings, key: string, request: Request): Promise<Response> {
  const stored = await env.UPLOADS.getWithMetadata<{ access: string }>(key, 'text');
  if (!stored.value || stored.metadata?.access !== PRIVATE) return new Response('Not found', { status: 404 });
  const manifest = JSON.parse(stored.value) as Album | Manifest;
  const headers = new Headers({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
  if (manifest.kind === 'album') {
    const rows = await Promise.all(manifest.items.map(async item => {
      const url = await signed(env, item.key, manifest.expires);
      return `<li><a href="${esc(url)}">${esc(item.fileName)}</a> <small>${(item.fileSize / 1024 / 1024).toFixed(1)} MB</small></li>`;
    }));
    const previous = manifest.previous ? `<p><a href="${esc(await signed(env, manifest.previous, manifest.expires))}">Earlier photos and videos</a></p>` : '';
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox allow-downloads allow-top-navigation-by-user-activation");
    headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    return new Response(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Travel memories</title><style>body{font:17px system-ui;max-width:900px;margin:40px auto;padding:20px}li{padding:12px 0;overflow-wrap:anywhere}a{color:#1d5c47}small{color:#666}</style><h1>Travel memories</h1><p>${manifest.count} photos and videos in this collection. Private links expire. Uploading does not grant marketing permission; check the survey's recorded choices before use.</p>${previous}<ul>${rows.join('')}</ul></html>`, { headers });
  }
  if (manifest.kind !== 'media') return new Response('Not found', { status: 404 });
  const s = manifest.session;
  let start = 0; let end = s.size - 1;
  const range = request.headers.get('Range');
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (!m[1] && !m[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${s.size}` } });
    if (!m[1]) start = Math.max(0, s.size - Number(m[2]));
    else { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= s.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${s.size}` } });
  }
  headers.set('Content-Type', manifest.contentType);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Length', String(end - start + 1));
  const cleanName = s.name.replace(/[\x00-\x1f"\\]/g, '_');
  headers.set('Content-Disposition', `attachment; filename="${cleanName.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(cleanName)}`);
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${s.size}`);
  let index = Math.floor(start / CHUNK_BYTES);
  const last = Math.floor(end / CHUNK_BYTES);
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index > last) { controller.close(); return; }
      const bytes = await env.UPLOADS.get(keyFor(s.id, index), 'arrayBuffer');
      if (!bytes) { controller.error(new Error('A media part is unavailable. Please retry.')); return; }
      const from = index === Math.floor(start / CHUNK_BYTES) ? start % CHUNK_BYTES : 0;
      const to = index === last ? end % CHUNK_BYTES + 1 : bytes.byteLength;
      controller.enqueue(new Uint8Array(bytes).subarray(from, to));
      index++;
    },
  });
  return new Response(stream, { status: range ? 206 : 200, headers });
}
