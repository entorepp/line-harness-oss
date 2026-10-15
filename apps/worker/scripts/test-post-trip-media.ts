import assert from 'node:assert/strict';
import { Hono } from 'hono';
import worker from '../src/index.js';
import { formMedia, MEDIA_FORM_ID, CHUNK_BYTES } from '../src/routes/form-media.js';
import { uploads } from '../src/routes/uploads.js';

const stored = new Map<string, { bytes: Uint8Array; metadata: any; expiration?: number }>();
let puts = 0;
const kv = {
  async put(key: string, value: any, options: any = {}) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
    assert.ok(bytes.length <= 25 * 1024 * 1024, 'No KV object exceeds the provider limit');
    stored.set(key, { bytes, metadata: options.metadata, expiration: options.expiration || options.expirationTtl }); puts++;
  },
  async get(key: string, type = 'text') {
    const v = stored.get(key); if (!v) return null;
    if (type === 'arrayBuffer') return v.bytes.buffer.slice(v.bytes.byteOffset, v.bytes.byteOffset + v.bytes.byteLength);
    if (type === 'json') return JSON.parse(new TextDecoder().decode(v.bytes));
    if (type === 'stream') return new Blob([v.bytes as any]).stream();
    return new TextDecoder().decode(v.bytes);
  },
  async getWithMetadata(key: string, type = 'text') { const v = stored.get(key); return { value: await this.get(key, type), metadata: v?.metadata || null }; },
};
const env: any = { UPLOADS: kv, API_KEY: 'fixture-secret', LINE_CHANNEL_SECRET: 'fixture-line-secret', WORKER_URL: 'https://worker.example', DB: { prepare() { return { bind(id: string) { return { async first() { return id === MEDIA_FORM_ID ? { is_active: 1, fields: JSON.stringify([{ name: 'memory_photos', type: 'file' }]) } : null; } }; } }; } } };
const app = new Hono().route('/', formMedia).route('/', uploads);
const request = (path: string, init: RequestInit = {}) => app.fetch(new Request(`https://worker.example${path}`, init), env);
const post = (path: string, body: unknown, token?: string) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Upload-Token': token } : {}) }, body: JSON.stringify(body) });
const data = async (r: Response) => { const json = await r.json() as any; assert.equal(r.status, 200, JSON.stringify(json)); assert.equal(json.success, true); return json.data; };
const start = (size: number, name = 'holiday.mov') => post('/api/form-media/start', { formId: MEDIA_FORM_ID, fieldName: 'memory_photos', fileName: name, fileSize: size });
assert.equal((await post('/api/form-media/start', { formId: 'other-form', fieldName: 'memory_photos', fileName: 'a', fileSize: 1 })).status, 400);
assert.equal((await start(-1)).status, 400);
const session = await data(await start(27 * 1024 * 1024));
const bytes = new Uint8Array(27 * 1024 * 1024); bytes.set([0,0,0,24,...new TextEncoder().encode('ftypqt  ')]); bytes[bytes.length - 1] = 42;
const chunk = (index: number, buffer: Uint8Array, token = session.token) => request(`/api/form-media/${session.id}/chunks/${index}`, { method: 'POST', headers: { 'X-Upload-Token': token }, body: buffer as any });
assert.equal((await chunk(0, bytes.slice(0, CHUNK_BYTES), 'forged')).status, 403);
assert.equal((await chunk(99, bytes.slice(0, 1))).status, 400);
assert.equal((await chunk(0, bytes.slice(0, 12))).status, 400);
assert.equal((await post(`/api/form-media/${session.id}/complete`, {}, session.token)).status, 409);
assert.equal((await post(`/api/form-media/${session.id}/complete`, { offset: 1, proof: 'forged' }, session.token)).status, 400);
for (let i = 0; i < session.count; i++) await data(await chunk(i, bytes.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)));
const beforeRetry = puts;
assert.equal((await data(await chunk(0, bytes.slice(0, CHUNK_BYTES)))).reused, true); assert.equal(puts, beforeRetry);
const wrong = bytes.slice(0, CHUNK_BYTES); wrong[100] = 9; assert.equal((await chunk(0, wrong)).status, 409);
const file = (await data(await post(`/api/form-media/${session.id}/complete`, {}, session.token))).file;
assert.equal(file.contentType, 'video/quicktime'); assert.equal(file.fileSize, bytes.length);
const dl = await request(new URL(file.url).pathname + new URL(file.url).search); assert.equal(dl.status, 200); assert.deepEqual(new Uint8Array(await dl.arrayBuffer()), bytes);
const range = await request(new URL(file.url).pathname + new URL(file.url).search, { headers: { Range: `bytes=${CHUNK_BYTES - 3}-${CHUNK_BYTES + 4}` } }); assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 8);
assert.equal((await request(new URL(file.url).pathname + new URL(file.url).search, { headers: { Range: 'bytes=999999999-' } })).status, 416);
assert.equal((await request(`/api/form-files/${file.key}?expires=1&sig=bad`)).status, 403);
assert.equal((await request(`/api/files/${file.key}`)).status, 404);
let previous: string | undefined;
for (const count of [64,64,3]) {
  const album = await data(await post('/api/form-media/collection', { files: Array.from({ length: count }, () => ({ key: file.key, url: file.url })), previous })); previous = album.url;
  if (count === 3) assert.equal(album.count, 131);
}
const albumPage = await request(new URL(previous!).pathname + new URL(previous!).search); assert.equal(albumPage.status, 200); const html = await albumPage.text(); assert.match(html, /131 photos and videos/); assert.match(html, /Earlier photos and videos/); assert.ok(albumPage.headers.get('content-security-policy')?.includes("default-src 'none'"));
assert.equal((await post('/api/form-media/collection', { files: [{ key: file.key, url: file.url.replace(/sig=[^&]+/, 'sig=forged') }] })).status, 400);
// Verify continuation proofs across bounded completion requests, without huge allocations.
const many = await data(await start(CHUNK_BYTES * 33));
const partBytes = bytes.subarray(0, CHUNK_BYTES);
for (let i = 0; i < 33; i++) stored.set(`post-trip-media/${many.id}/${i}`, { bytes: partBytes, metadata: { size: CHUNK_BYTES, contentType: i === 0 ? 'video/mp4' : '', access: 'form-private' } });
const batch = await data(await post(`/api/form-media/${many.id}/complete`, {}, many.token)); assert.equal(batch.nextOffset, 32);
assert.ok((await data(await post(`/api/form-media/${many.id}/complete`, { offset: batch.nextOffset, proof: batch.proof }, many.token))).file);
const unsupported = await data(await start(10, 'fake.jpg'));
assert.equal((await request(`/api/form-media/${unsupported.id}/chunks/0`, { method: 'POST', headers: { 'X-Upload-Token': unsupported.token }, body: '<script>x!' })).status, 400);
const ctx = { waitUntil() {}, passThroughOnException() {} } as ExecutionContext;
assert.equal((await worker.fetch(new Request('https://worker.example/api/form-media/start', { method: 'POST', body: JSON.stringify({ formId: 'wrong' }), headers: { 'Content-Type': 'application/json' } }), env, ctx)).status, 400, 'Public upload route reaches exact form validation');
assert.equal((await worker.fetch(new Request('https://worker.example/api/form-media/not-a-route', { method: 'POST' }), env, ctx)).status, 401);
console.log('POST_TRIP_MEDIA_OK 27MiB video, bounded KV parts, byte-exact download, ranges, auth/forgery, idempotency, missing part refusal, 131-file paged album, continuation proofs, MIME spoof refusal');
