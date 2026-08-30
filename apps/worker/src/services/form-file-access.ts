const FORM_FILE_SIGNATURE_PREFIX = 'flat-harness-form-file-v1';
const FORM_FILE_ACCESS_DAYS = 180;

export const FORM_PRIVATE_UPLOAD_ACCESS = 'form-private';
export const FORM_PRIVATE_FILE_RETENTION_SECONDS = FORM_FILE_ACCESS_DAYS * 24 * 60 * 60;

function base64UrlEncode(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

function signingPayload(key: string, expiresAt: number): string {
  return [FORM_FILE_SIGNATURE_PREFIX, key, String(expiresAt)].join('\n');
}

async function sign(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return base64UrlEncode(signature);
}

export function formFileExpiresAt(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000) + FORM_PRIVATE_FILE_RETENTION_SECONDS;
}

export async function createFormFileAccessUrl(params: {
  workerUrl: string;
  key: string;
  expiresAt: number;
  secret: string;
}): Promise<string> {
  const signature = await sign(params.secret, signingPayload(params.key, params.expiresAt));
  const base = params.workerUrl.replace(/\/+$/, '');
  const url = new URL(`/api/form-files/${encodeURIComponent(params.key)}`, `${base}/`);
  url.searchParams.set('expires', String(params.expiresAt));
  url.searchParams.set('sig', signature);
  return url.toString();
}

export async function verifyFormFileAccess(params: {
  key: string;
  expiresAt: number;
  signature: string;
  secret: string;
  nowMs?: number;
}): Promise<boolean> {
  if (!Number.isSafeInteger(params.expiresAt) || params.expiresAt <= 0) return false;
  const nowSeconds = Math.floor((params.nowMs ?? Date.now()) / 1000);
  if (params.expiresAt < nowSeconds) return false;

  const expected = await sign(
    params.secret,
    signingPayload(params.key, params.expiresAt),
  );
  return timingSafeEqual(expected, params.signature);
}
