import { Hono } from 'hono';
import type { Env } from '../index.js';

export const metaDataDeletion = new Hono<Env>();

const DATA_DELETION_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <link rel="canonical" href="https://line-flattravel.flat-travel.workers.dev/meta-data-deletion">
    <title>Meta Data Deletion Instructions | Flat Travel</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #173b35;
        background: #f1f8f5;
      }
      * { box-sizing: border-box; }
      body { margin: 0; }
      main {
        width: min(760px, calc(100% - 32px));
        margin: 48px auto;
        padding: clamp(28px, 6vw, 56px);
        background: #fff;
        border: 1px solid #d7e9e2;
        border-radius: 24px;
        box-shadow: 0 18px 50px rgba(23, 59, 53, 0.08);
      }
      .brand { color: #0d9488; font-size: 0.875rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; }
      h1 { margin: 12px 0 16px; color: #102f2a; font-size: clamp(2rem, 5vw, 3rem); line-height: 1.08; }
      h2 { margin: 32px 0 10px; color: #102f2a; font-size: 1.25rem; }
      p, li { font-size: 1rem; line-height: 1.7; }
      ol, ul { padding-left: 1.4rem; }
      .notice { padding: 18px 20px; border-radius: 14px; background: #e8f7f2; }
      code { padding: 0.15em 0.35em; border-radius: 6px; background: #edf3f1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      a { color: #08796f; font-weight: 650; }
      footer { margin-top: 36px; padding-top: 24px; border-top: 1px solid #d7e9e2; color: #517069; font-size: 0.9rem; }
    </style>
  </head>
  <body>
    <main>
      <div class="brand">Flat Travel · Flat Harness</div>
      <h1>Meta Data Deletion Instructions</h1>
      <p>Flat Travel, operated by Flatcare Inc., uses Flat Harness to receive and respond to customer-initiated conversations on Facebook Messenger and Instagram Direct.</p>

      <h2>How to request deletion</h2>
      <ol>
        <li>Email <a href="mailto:contact@gotcha.tokyo?subject=Meta%20Data%20Deletion%20Request">contact@gotcha.tokyo</a> with the subject <code>Meta Data Deletion Request</code>.</li>
        <li>State whether your request concerns Facebook Messenger, Instagram Direct, or both.</li>
        <li>Provide enough information to locate the conversation, such as your profile name or username, profile URL, and the approximate date and time of the conversation.</li>
      </ol>
      <p class="notice"><strong>Do not send a password, payment-card number, passport image, or other sensitive identification.</strong> We may ask for a limited verification step through the same Meta account before acting on the request.</p>

      <h2>Data covered by the request</h2>
      <p>Depending on what was available in the conversation, Flat Harness may hold a platform-specific sender ID, public profile name or username, message text, attachment metadata, timestamps, account-routing metadata, and staff replies or related operational records. Flat Harness does not receive your Facebook or Instagram password.</p>

      <h2>What happens next</h2>
      <p>After verifying the request, we will delete or irreversibly anonymize the corresponding Flat Harness conversation data without undue delay and notify you of the outcome. If a record must be retained for a legal, security, fraud-prevention, or dispute-resolution obligation, we will restrict its use and explain the applicable retention requirement.</p>

      <h2>Related policies</h2>
      <ul>
        <li><a href="https://flat-travel.com/en/PrivacyPolicy">Privacy Policy</a></li>
        <li><a href="https://www.gotcha.tokyo/kaigai/rule/">Travel Agency Terms &amp; Conditions</a></li>
      </ul>

      <footer>Last updated: July 31, 2026 · Contact: <a href="mailto:contact@gotcha.tokyo">contact@gotcha.tokyo</a></footer>
    </main>
  </body>
</html>`;

metaDataDeletion.get('/meta-data-deletion', (c) => c.html(DATA_DELETION_HTML, 200, {
  'Cache-Control': 'public, max-age=300',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}));

metaDataDeletion.get('/meta-data-deletion/', (c) => c.redirect('/meta-data-deletion', 308));
