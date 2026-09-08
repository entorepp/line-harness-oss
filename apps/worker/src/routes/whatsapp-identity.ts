import { Hono } from 'hono';
import type { Env } from '../index.js';
import { readWhatsappIdentity, reconcileWhatsappIdentity } from '../services/whatsapp-identity.js';

const whatsappIdentity = new Hono<Env>();
whatsappIdentity.get('/api/friends/:id/whatsapp-identity', async c => {
  c.header('Cache-Control', 'private, no-store');
  return c.json({ success: true, data: await readWhatsappIdentity(c.env, c.req.param('id')) });
});
whatsappIdentity.post('/api/friends/:id/whatsapp-identity/reconcile', async c => {
  c.header('Cache-Control', 'private, no-store');
  return c.json({ success: true, data: await reconcileWhatsappIdentity(c.env, c.req.param('id')) });
});
export { whatsappIdentity };
