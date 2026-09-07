import { Hono } from 'hono';
import type { Env } from '../index.js';
import {
  parseTravelQuoteIntent,
  TRAVEL_QUOTE_ALLOWED_ORIGINS,
  TRAVEL_QUOTE_INTENT_MAX_BYTES,
  TRAVEL_QUOTE_INTENT_PATH,
  travelQuoteReceiptMetadata,
  travelQuoteNotificationCopy,
} from '../services/travel-quote-intent.js';
import { postToSlack, resolveSlackChannelId } from '../services/slack.js';
import { syncTravelQuoteToFlatworker } from '../services/flatworker-travel-quote.js';

const travelQuoteIntents = new Hono<Env>();
const recentRequests = new Map<string, number[]>();

function withinPublicRateLimit(ip: string): boolean {
  const now = Date.now();
  const recent = (recentRequests.get(ip) || []).filter((timestamp) => timestamp > now - 60_000);
  if (recent.length >= 10) {
    recentRequests.set(ip, recent);
    return false;
  }
  recent.push(now);
  recentRequests.set(ip, recent);
  return true;
}

travelQuoteIntents.post(TRAVEL_QUOTE_INTENT_PATH, async (c) => {
  const origin = c.req.header('origin') || '';
  if (!TRAVEL_QUOTE_ALLOWED_ORIGINS.has(origin)) return c.json({ success: false, error: 'Origin not allowed' }, 403);
  const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!withinPublicRateLimit(clientIp)) return c.json({ success: false, error: 'Too many requests' }, 429);
  const declaredLength = Number(c.req.header('content-length') || 0);
  if (declaredLength > TRAVEL_QUOTE_INTENT_MAX_BYTES) return c.json({ success: false, error: 'Payload too large' }, 413);
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > TRAVEL_QUOTE_INTENT_MAX_BYTES) {
    return c.json({ success: false, error: 'Payload too large' }, 413);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return c.json({ success: false, error: 'Invalid JSON' }, 400);
  }
  const parsed = parseTravelQuoteIntent(decoded);
  if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);
  const intent = parsed.value;

  const flatworkerDraft = await syncTravelQuoteToFlatworker(intent, c.env);
  const flatworkerReady = new Set(['created', 'updated', 'existing']).has(flatworkerDraft.status)
    && (!intent.profileProvided || flatworkerDraft.profileStored === true);
  const copy = travelQuoteNotificationCopy(intent, flatworkerDraft);
  const metadata = JSON.stringify(travelQuoteReceiptMetadata(intent, flatworkerDraft));
  const notificationId = `${flatworkerReady ? 'travel-quote' : 'travel-quote-intake-failed'}:${intent.quoteReference}:${intent.channel}`;
  const inserted = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO notifications (id, event_type, title, body, channel, status, metadata, created_at)
     VALUES (?, 'travel_quote_intent', ?, ?, 'slack', 'pending', ?, datetime('now', '+9 hours'))`,
  ).bind(notificationId, copy.title, copy.body, metadata).run();

  const duplicate = (inserted.meta.changes || 0) === 0;
  if (duplicate) {
    await c.env.DB.prepare(
      `UPDATE notifications SET title = ?, body = ?, metadata = ? WHERE id = ?`,
    ).bind(copy.title, copy.body, metadata, notificationId).run();
  }
  let slackNotified: boolean | null = null;
  if (!duplicate) {
    slackNotified = Boolean(c.env.SLACK_BOT_TOKEN) && await postToSlack({
      token: c.env.SLACK_BOT_TOKEN,
      channel: resolveSlackChannelId(c.env.TRAVEL_QUOTE_SLACK_CHANNEL_ID),
      text: `${copy.title}\n\n${copy.body}`,
      username: 'Flat Travel website',
    });
    await c.env.DB.prepare(
      `UPDATE notifications SET status = ? WHERE id = ?`,
    ).bind(slackNotified ? 'sent' : 'failed', notificationId).run();
  }
  if (!flatworkerReady) {
    return c.json({ success: false, duplicate, slackNotified, reference: intent.quoteReference, flatworkerDraft, error: 'Secure FlatWorker intake was not completed' }, 503);
  }
  return c.json({ success: true, duplicate, slackNotified, reference: intent.quoteReference, flatworkerDraft }, duplicate ? 200 : 202);
});

export { travelQuoteIntents };
