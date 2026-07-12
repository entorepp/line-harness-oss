const SIGNING_PREFIX = 'line-content-proxy-v1';

function base64UrlEncode(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function buildSigningPayload(params: {
  accountId: string;
  messageId: string;
  fileName: string;
  contentType: string;
}): string {
  return [
    SIGNING_PREFIX,
    params.accountId,
    params.messageId,
    params.fileName,
    params.contentType,
  ].join('\n');
}

async function signPayload(secret: string, payload: string): Promise<string> {
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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let index = 0; index < a.length; index += 1) {
    result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return result === 0;
}

export function getLineContentSigningSecret(apiKey?: string, fallbackSecret?: string): string {
  const secret = apiKey || fallbackSecret;
  if (!secret) {
    throw new Error('Line content proxy signing secret is not configured');
  }
  return secret;
}

export function normalizeLineContentFileName(fileName?: string | null): string {
  return fileName?.trim() || 'file';
}

export function normalizeLineContentType(contentType?: string | null): string {
  return contentType?.trim() || 'application/octet-stream';
}

export async function createLineContentProxySignature(params: {
  secret: string;
  accountId: string;
  messageId: string;
  fileName: string;
  contentType: string;
}): Promise<string> {
  return signPayload(params.secret, buildSigningPayload(params));
}

export async function verifyLineContentProxySignature(params: {
  secret: string;
  accountId: string;
  messageId: string;
  fileName: string;
  contentType: string;
  signature: string;
}): Promise<boolean> {
  const expected = await createLineContentProxySignature(params);
  return timingSafeEqual(expected, params.signature);
}

export async function buildLineContentProxyUrl(params: {
  workerUrl: string;
  accountId: string | null;
  messageId: string;
  fileName?: string | null;
  contentType?: string | null;
  signingSecret: string;
}): Promise<string> {
  const accountId = params.accountId || 'default';
  const fileName = normalizeLineContentFileName(params.fileName);
  const contentType = normalizeLineContentType(params.contentType);
  const signature = await createLineContentProxySignature({
    secret: params.signingSecret,
    accountId,
    messageId: params.messageId,
    fileName,
    contentType,
  });

  const base = params.workerUrl.replace(/\/+$/, '');
  const url = new URL(
    `/api/files/line/${encodeURIComponent(accountId)}/${encodeURIComponent(params.messageId)}`,
    `${base}/`,
  );
  url.searchParams.set('name', fileName);
  url.searchParams.set('type', contentType);
  url.searchParams.set('sig', signature);
  return url.toString();
}
