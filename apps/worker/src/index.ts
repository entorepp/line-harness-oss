import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { LineClient } from '@line-crm/line-sdk';
import { getLineAccounts } from '@line-crm/db';
import { processStepDeliveries } from './services/step-delivery.js';
import { processScheduledBroadcasts } from './services/broadcast.js';
import { processReminderDeliveries } from './services/reminder-delivery.js';
import { processScheduledMessages } from './services/scheduled-messages.js';
import { checkAccountHealth } from './services/ban-monitor.js';
import { authMiddleware } from './middleware/auth.js';
import { webhook } from './routes/webhook.js';
import { friends } from './routes/friends.js';
import { tags } from './routes/tags.js';
import { scenarios } from './routes/scenarios.js';
import { broadcasts } from './routes/broadcasts.js';
import { users } from './routes/users.js';
import { lineAccounts } from './routes/line-accounts.js';
import { conversions } from './routes/conversions.js';
import { affiliates } from './routes/affiliates.js';
import { openapi } from './routes/openapi.js';
import { liffRoutes } from './routes/liff.js';
// Round 3 ルート
import { webhooks } from './routes/webhooks.js';
import { calendar } from './routes/calendar.js';
import { reminders } from './routes/reminders.js';
import { scoring } from './routes/scoring.js';
import { templates } from './routes/templates.js';
import { chats } from './routes/chats.js';
import { notifications } from './routes/notifications.js';
import { stripe } from './routes/stripe.js';
import { health } from './routes/health.js';
import { automations } from './routes/automations.js';
import { richMenus } from './routes/rich-menus.js';
import { trackedLinks } from './routes/tracked-links.js';
import { forms } from './routes/forms.js';
import { entryRoutes } from './routes/entry-routes.js';
import { uploads } from './routes/uploads.js';
import { waWebhook } from './routes/wa-webhook.js';
import { kakaoWebhook } from './routes/kakao-webhook.js';

export type Env = {
  Bindings: {
    DB: D1Database;
    LINE_CHANNEL_SECRET: string;
    LINE_CHANNEL_ACCESS_TOKEN: string;
    API_KEY: string;
    LIFF_URL: string;
    LINE_CHANNEL_ID: string;
    LINE_LOGIN_CHANNEL_ID: string;
    LINE_LOGIN_CHANNEL_SECRET: string;
    WORKER_URL: string;
    WEB_APP_URL?: string;
    FORMS_APP_URL?: string;
    SLACK_BOT_TOKEN: string;
    GOOGLE_TRANSLATE_API_KEY: string;
    FORMS_ENABLE_LINE_FOLLOWUP?: string;
    GA4_MEASUREMENT_ID: string;
    UPLOADS: KVNamespace;
    WA_BRIDGE_SECRET: string;
    KAKAO_BIZMESSAGE_ENDPOINT?: string;
    KAKAO_BIZMESSAGE_API_KEY?: string;
    KAKAO_MESSAGE_WEBHOOK_SECRET?: string;
  };
};

const app = new Hono<Env>();
const DEFAULT_WEB_APP_URL = 'https://line-crm-web-2ob.pages.dev';

function buildWebAppRedirectUrl(requestUrl: string, webAppUrl: string | undefined, path: string): string {
  const source = new URL(requestUrl);
  const base = (webAppUrl || DEFAULT_WEB_APP_URL).replace(/\/+$/, '');
  const target = new URL(path, `${base}/`);

  for (const [key, value] of source.searchParams.entries()) {
    target.searchParams.append(key, value);
  }

  return target.toString();
}

// CORS — allow all origins for MVP
app.use('*', cors({ origin: '*' }));

// Human-friendly redirects for the Worker domain.
app.get('/', (c) => c.redirect(buildWebAppRedirectUrl(c.req.url, c.env.WEB_APP_URL, '/'), 302));
app.get('/forms', (c) => c.redirect(buildWebAppRedirectUrl(c.req.url, c.env.FORMS_APP_URL || c.env.WEB_APP_URL, '/forms'), 302));
app.get('/forms/new', (c) => c.redirect(buildWebAppRedirectUrl(c.req.url, c.env.FORMS_APP_URL || c.env.WEB_APP_URL, '/forms/new'), 302));
app.get('/forms/edit', (c) => c.redirect(buildWebAppRedirectUrl(c.req.url, c.env.FORMS_APP_URL || c.env.WEB_APP_URL, '/forms/edit'), 302));
app.get('/public-form', (c) => c.redirect(buildWebAppRedirectUrl(c.req.url, c.env.FORMS_APP_URL || c.env.WEB_APP_URL, '/public-form'), 302));

// Auth middleware — skips /webhook and /docs automatically
app.use('*', authMiddleware);

// Mount route groups — MVP & Round 2
app.route('/', webhook);
app.route('/', friends);
app.route('/', tags);
app.route('/', scenarios);
app.route('/', broadcasts);
app.route('/', users);
app.route('/', lineAccounts);
app.route('/', conversions);
app.route('/', affiliates);
app.route('/', openapi);
app.route('/', liffRoutes);

// Mount route groups — Round 3
app.route('/', webhooks);
app.route('/', calendar);
app.route('/', reminders);
app.route('/', scoring);
app.route('/', templates);
app.route('/', chats);
app.route('/', notifications);
app.route('/', stripe);
app.route('/', health);
app.route('/', automations);
app.route('/', richMenus);
app.route('/', trackedLinks);
app.route('/', forms);
app.route('/', entryRoutes);
app.route('/', uploads);
app.route('/', waWebhook);
app.route('/', kakaoWebhook);

// Short link: /r/:ref → record click with referrer → redirect to LINE add-friend URL
// Also supports /r/ (no ref) as a universal tracking redirect
app.get('/r/:ref?', async (c) => {
  const ref = c.req.param('ref') || '_default';
  const db = c.env.DB;

  // Capture where the user came from
  const referrer = c.req.header('Referer') || '';
  const utmSource = c.req.query('utm_source') || '';
  const utmMedium = c.req.query('utm_medium') || '';
  const utmCampaign = c.req.query('utm_campaign') || '';
  const utmContent = c.req.query('utm_content') || '';

  // Look up the entry route to find associated LINE account
  let addFriendUrl = '';
  try {
    const route = await db.prepare(
      'SELECT er.name, er.line_account_id, la.add_friend_url, la.basic_id FROM entry_routes er LEFT JOIN line_accounts la ON la.id = er.line_account_id WHERE er.ref_code = ? AND er.is_active = 1'
    ).bind(ref).first<{ name: string; line_account_id: string | null; add_friend_url: string | null; basic_id: string | null }>();
    if (route) {
      addFriendUrl = route.add_friend_url || (route.basic_id ? `https://line.me/R/ti/p/${route.basic_id}` : '');
    }
  } catch { /* fallback */ }

  // Fallback: first active account
  if (!addFriendUrl) {
    try {
      const account = await db.prepare('SELECT add_friend_url, basic_id FROM line_accounts WHERE is_active = 1 LIMIT 1')
        .first<{ add_friend_url: string | null; basic_id: string | null }>();
      addFriendUrl = account?.add_friend_url || (account?.basic_id ? `https://line.me/R/ti/p/${account.basic_id}` : '');
    } catch { /* fallback */ }
  }

  if (!addFriendUrl) {
    addFriendUrl = c.env.LIFF_URL || 'https://liff.line.me/2009554425-4IMBmLQ9';
  }

  // Record click with referrer & UTM (non-blocking)
  c.executionCtx.waitUntil((async () => {
    try {
      const trackId = crypto.randomUUID();
      await db.prepare(
        `INSERT INTO ref_tracking (id, ref_code, event_type, source_url, utm_source, utm_medium, utm_campaign, utm_content, user_agent, created_at) VALUES (?, ?, 'click', ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(trackId, ref, referrer, utmSource, utmMedium, utmCampaign, utmContent, c.req.header('User-Agent') || '').run();
    } catch (err) {
      console.error('ref_tracking insert error:', err);
    }
  })());

  // GA4 Measurement Protocol: server-side event (non-blocking)
  const ga4Id = c.env.GA4_MEASUREMENT_ID || '';
  if (ga4Id) {
    c.executionCtx.waitUntil((async () => {
      try {
        // Use GA4 Measurement Protocol to send event server-side
        const clientId = crypto.randomUUID();
        await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${ga4Id}&api_secret=`, {
          method: 'POST',
          body: JSON.stringify({
            client_id: clientId,
            events: [{
              name: 'line_friend_click',
              params: {
                ref_code: ref,
                referrer: referrer,
                utm_source: utmSource,
                utm_medium: utmMedium,
                utm_campaign: utmCampaign,
              },
            }],
          }),
        });
      } catch { /* non-blocking */ }
    })());
  }

  // 302 redirect to LINE add-friend URL
  return c.redirect(addFriendUrl, 302);
});

// 404 fallback
app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));

// Scheduled handler for cron triggers — runs per LINE account while leaving
// WhatsApp delivery to the channel-aware scheduled message worker.
async function scheduled(
  _event: ScheduledEvent,
  env: Env['Bindings'],
  _ctx: ExecutionContext,
): Promise<void> {
  const dbAccounts = await getLineAccounts(env.DB);
  const jobs: Promise<unknown>[] = [];

  if (env.LINE_CHANNEL_ACCESS_TOKEN) {
    const defaultLineClient = new LineClient(env.LINE_CHANNEL_ACCESS_TOKEN);
    jobs.push(
      processStepDeliveries(env.DB, defaultLineClient, env.WORKER_URL, null),
      processScheduledBroadcasts(env.DB, defaultLineClient, null),
      processReminderDeliveries(env.DB, defaultLineClient, null),
    );
  }

  for (const account of dbAccounts) {
    if (!account.is_active || account.channel_type !== 'line') {
      continue;
    }

    const lineClient = new LineClient(account.channel_access_token);
    jobs.push(
      processStepDeliveries(env.DB, lineClient, env.WORKER_URL, account.id),
      processScheduledBroadcasts(env.DB, lineClient, account.id),
      processReminderDeliveries(env.DB, lineClient, account.id),
    );
  }
  jobs.push(processScheduledMessages(env));
  jobs.push(checkAccountHealth(env.DB));

  await Promise.allSettled(jobs);
}

export default {
  fetch: app.fetch,
  scheduled,
};
