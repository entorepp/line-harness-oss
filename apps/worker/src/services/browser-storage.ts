import type { Context } from 'hono';
import type { Env } from '../index.js';
import { sha256Hex } from './form-response-email.js';

export const SESSION_COOKIE = '__Host-forms-studio';
export const DRAFT_COOKIE = '__Host-forms-draft';
export const SESSION_SECONDS = 14 * 86400;
export const DRAFT_SECONDS = 7 * 86400;
export type BrowserSession = { operator: string; operatorKey: string; keyVersion: string };

export function browserCookie(c: Context<Env>, name: string): string {
  const value = (c.req.header('Cookie') || '').split(';').map(s => s.trim())
    .find(s => s.startsWith(`${name}=`))?.slice(name.length + 1) || '';
  return /^[a-f0-9]{64}$/.test(value) ? value : '';
}
export function newCapability(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export function setBrowserCookie(c: Context<Env>, name: string, value: string, age: number): void {
  c.header('Set-Cookie', `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`);
}
export function sameOrigin(c: Context<Env>): boolean {
  const allowed = [c.env.FORMS_APP_URL || 'https://liffform-studio.pages.dev', new URL(c.req.url).origin].map(value => new URL(value).origin);
  return allowed.includes(c.req.header('Origin') || '') && c.req.header('Sec-Fetch-Site') !== 'cross-site';
}
export function formsRouteAllowed(path: string, method: string): boolean {
  return (method === 'GET' && ['/api/line-accounts', '/api/tags', '/api/scenarios'].includes(path))
    || /^\/api\/forms(?:\/[^/]+(?:\/(?:submissions|issues|share-url))?)?$/.test(path)
    || /^\/api\/form-issues\/[^/]+$/.test(path)
    || /^\/api\/form-submissions\/[^/]+(?:\/(?:response-copy(?:\/(?:preview|send))?|email-recipients(?:\/[^/]+)?))?$/.test(path)
    || path === '/api/form-response-email/session';
}
async function cipherKey(env: Env['Bindings']): Promise<CryptoKey> {
  const secret = env.FORM_RESPONSE_EMAIL_ENCRYPTION_KEY || '';
  if (secret.length < 24) throw new Error('Browser storage encryption is not configured');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`forms-browser-storage-v1:${secret}`));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(value: unknown, env: Env['Bindings'], context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) }, await cipherKey(env), new TextEncoder().encode(JSON.stringify(value)));
  const encode = (data: Uint8Array) => btoa(Array.from(data, n => String.fromCharCode(n)).join(''));
  return `${encode(iv)}.${encode(new Uint8Array(bytes))}`;
}
export async function unseal<T>(value: string, env: Env['Bindings'], context: string): Promise<T> {
  const [iv, bytes] = value.split('.').map(part => Uint8Array.from(atob(part), ch => ch.charCodeAt(0)));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) }, await cipherKey(env), bytes);
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}
export async function readBrowserSession(c: Context<Env>): Promise<BrowserSession | null> {
  const capability = browserCookie(c, SESSION_COOKIE);
  if (!capability) return null;
  const hash = await sha256Hex(capability);
  const row = await c.env.DB.prepare('SELECT payload FROM forms_browser_sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(hash, Math.floor(Date.now() / 1000)).first<{ payload: string }>();
  if (!row) return null;
  const session = await unseal<BrowserSession>(row.payload, c.env, hash);
  return session.keyVersion === await sha256Hex(c.env.API_KEY) ? session : null;
}
export async function limitBrowserRequest(c: Context<Env>, bucket: string, limit: number): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const key = await sha256Hex(`${bucket}:${c.req.header('CF-Connecting-IP') || 'unknown'}:${Math.floor(now / 60)}`);
  const row = await c.env.DB.prepare('INSERT INTO forms_browser_limits (key, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1 RETURNING attempts')
    .bind(key, now + 120).first<{ attempts: number }>();
  return !!row && row.attempts <= limit;
}
export async function cleanBrowserStorage(c: Context<Env>): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM forms_browser_sessions WHERE token_hash IN (SELECT token_hash FROM forms_browser_sessions WHERE expires_at <= ? LIMIT 100)').bind(now),
    c.env.DB.prepare('DELETE FROM forms_browser_drafts WHERE draft_key IN (SELECT draft_key FROM forms_browser_drafts WHERE expires_at <= ? LIMIT 100)').bind(now),
    c.env.DB.prepare('DELETE FROM forms_browser_limits WHERE key IN (SELECT key FROM forms_browser_limits WHERE expires_at <= ? LIMIT 100)').bind(now),
  ]);
}
