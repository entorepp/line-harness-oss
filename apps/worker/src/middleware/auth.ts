import type { Context, Next } from 'hono';
import type { Env } from '../index.js';

export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  // Skip auth for the LINE webhook endpoint — it uses signature verification instead
  // Skip auth for OpenAPI docs — public documentation
  const path = new URL(c.req.url).pathname;
  const method = c.req.method.toUpperCase();
  if (
    path === '/webhook' ||
    path === '/webhook/whatsapp' ||
    path === '/webhook/kakao' ||
    path === '/webhook/kakao/messages' ||
    path === '/docs' ||
    path === '/openapi.json' ||
    path === '/api/affiliates/click' ||
    path.startsWith('/t/') ||
    path.startsWith('/r/') ||
    path.startsWith('/api/liff/') ||
    path.startsWith('/auth/') ||
    path === '/api/integrations/stripe/webhook' ||
    path.match(/^\/api\/webhooks\/incoming\/[^/]+\/receive$/) ||
    (method === 'POST' && path.match(/^\/api\/forms\/[^/]+\/submit$/)) ||
    (method === 'GET' && path.match(/^\/api\/forms\/[^/]+$/)) || // GET form definition (public for LIFF)
    (method === 'GET' && path.match(/^\/api\/form-issues\/[^/]+$/)) ||
    path.startsWith('/api/images/') || // Public image serving for LINE (legacy)
    path.startsWith('/api/files/') // Public file serving
  ) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice('Bearer '.length);
  if (token !== c.env.API_KEY) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  return next();
}
