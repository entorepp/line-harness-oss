import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { uploads } from '../src/routes/uploads.js';

type StoredValue = {
  value: ArrayBuffer;
  metadata: Record<string, unknown>;
  expirationTtl?: number;
};

const stored = new Map<string, StoredValue>();
const uploadsKv = {
  async put(key: string, value: ArrayBuffer, options?: {
    metadata?: Record<string, unknown>;
    expirationTtl?: number;
  }) {
    stored.set(key, {
      value,
      metadata: options?.metadata || {},
      expirationTtl: options?.expirationTtl,
    });
  },
  async getWithMetadata(key: string) {
    const item = stored.get(key);
    return item || { value: null, metadata: null };
  },
};

const db = {
  prepare() {
    return {
      bind(formId: string) {
        return {
          async first() {
            return formId === 'post-order-form'
              ? {
                id: formId,
                is_active: 1,
                fields: JSON.stringify([
                  {
                    name: 'q13',
                    type: 'file',
                    accept: 'image/jpeg,image/png,image/heic,image/heif,application/pdf',
                  },
                  { name: 'q1', type: 'textarea' },
                ]),
              }
              : null;
          },
        };
      },
    };
  },
};

const env = {
  DB: db,
  UPLOADS: uploadsKv,
  API_KEY: 'test-api-key',
  LINE_CHANNEL_SECRET: 'test-line-secret',
  WORKER_URL: 'https://line-flattravel.example.test',
} as never;

const executionCtx = {
  waitUntil() {},
  passThroughOnException() {},
} as ExecutionContext;

const fullWorkerPrivateRead = await worker.fetch(
  new Request(
    'https://line-flattravel.example.test/api/form-files/not-real.jpg?expires=1&sig=invalid',
  ),
  env,
  executionCtx,
);
assert.equal(fullWorkerPrivateRead.status, 403);

const privatePayload = new FormData();
privatePayload.append('file', new File([new Uint8Array([1, 2, 3])], 'passport.jpg', {
  type: 'image/jpeg',
}));
privatePayload.append('access', 'form-private');
privatePayload.append('formId', 'post-order-form');
privatePayload.append('fieldName', 'q13');

const privateUpload = await uploads.request(
  'https://line-flattravel.example.test/api/upload',
  { method: 'POST', body: privatePayload },
  env,
);
assert.equal(privateUpload.status, 200);
const privateJson = await privateUpload.json() as {
  success: boolean;
  data: { key: string; url: string; access: string; expiresAt: string };
};
assert.equal(privateJson.success, true);
assert.equal(privateJson.data.access, 'form-private');
assert.ok(privateJson.data.expiresAt);
assert.equal(stored.get(privateJson.data.key)?.expirationTtl, 180 * 24 * 60 * 60);

const invalidFieldPayload = new FormData();
invalidFieldPayload.append('file', new File([new Uint8Array([1])], 'passport.jpg', {
  type: 'image/jpeg',
}));
invalidFieldPayload.append('access', 'form-private');
invalidFieldPayload.append('formId', 'post-order-form');
invalidFieldPayload.append('fieldName', 'q1');
const invalidFieldUpload = await uploads.request(
  'https://line-flattravel.example.test/api/upload',
  { method: 'POST', body: invalidFieldPayload },
  env,
);
assert.equal(invalidFieldUpload.status, 404);

const invalidTypePayload = new FormData();
invalidTypePayload.append('file', new File([new Uint8Array([1])], 'passport.txt', {
  type: 'text/plain',
}));
invalidTypePayload.append('access', 'form-private');
invalidTypePayload.append('formId', 'post-order-form');
invalidTypePayload.append('fieldName', 'q13');
const invalidTypeUpload = await uploads.request(
  'https://line-flattravel.example.test/api/upload',
  { method: 'POST', body: invalidTypePayload },
  env,
);
assert.equal(invalidTypeUpload.status, 400);

const privateUrl = new URL(privateJson.data.url);
assert.equal(privateUrl.pathname, `/api/form-files/${privateJson.data.key}`);
assert.ok(privateUrl.searchParams.get('sig'));

const directPrivateRead = await uploads.request(
  `https://line-flattravel.example.test/api/files/${privateJson.data.key}`,
  undefined,
  env,
);
assert.equal(directPrivateRead.status, 404);

const signedPrivateRead = await uploads.request(privateUrl.toString(), undefined, env);
assert.equal(signedPrivateRead.status, 200);
assert.equal(signedPrivateRead.headers.get('cache-control'), 'private, no-store, max-age=0');
assert.deepEqual(
  Array.from(new Uint8Array(await signedPrivateRead.arrayBuffer())),
  [1, 2, 3],
);

privateUrl.searchParams.set('sig', `${privateUrl.searchParams.get('sig')}tampered`);
const tamperedPrivateRead = await uploads.request(privateUrl.toString(), undefined, env);
assert.equal(tamperedPrivateRead.status, 403);

const publicPayload = new FormData();
publicPayload.append('file', new File([new Uint8Array([4, 5])], 'ordinary.jpg', {
  type: 'image/jpeg',
}));
const publicUpload = await uploads.request(
  'https://line-flattravel.example.test/api/upload',
  { method: 'POST', body: publicPayload },
  env,
);
assert.equal(publicUpload.status, 200);
const publicJson = await publicUpload.json() as {
  success: boolean;
  data: { key: string; url: string; access: string };
};
assert.equal(publicJson.data.access, 'public');
assert.equal(stored.get(publicJson.data.key)?.expirationTtl, undefined);
assert.equal(
  publicJson.data.url,
  `https://line-flattravel.example.test/api/files/${publicJson.data.key}`,
);
const publicRead = await uploads.request(publicJson.data.url, undefined, env);
assert.equal(publicRead.status, 200);

console.log('FORM_FILE_UPLOAD_TEST_OK');
