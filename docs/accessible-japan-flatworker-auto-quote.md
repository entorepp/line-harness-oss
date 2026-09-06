# Accessible Japan to FlatWorker auto quote

Only form `9ab583b2-e42e-4ca2-bcb9-13a3c59f5477` creates this job.
The public submit response is not delayed by hotel search: the saved submission
ID is queued and the work runs through `waitUntil`, then resumes from the
existing one-minute Worker cron.

## Data and retry boundary

- D1 table `accessible_japan_quote_jobs` stores submission ID, state, attempts,
  next attempt, lease, case ID, and a short error code. It does not duplicate
  answers, names, or email addresses.
- The worker rereads the existing submission only while processing its job.
- `ACCESSIBLE_JAPAN_QUOTE_INTAKE_URL` must point exactly to
  `/api/integrations/accessible-japan-quote-intents` over HTTPS.
- `ACCESSIBLE_JAPAN_QUOTE_INTAKE_TOKEN` is a Worker secret. Never put it in
  `wrangler.toml`, Pages variables, logs, or documentation.
- A lease prevents two cron passes from processing the same job. Retry uses
  bounded exponential backoff and stops after 260 Worker calls (12 form city
  periods x 20 TravelWorker passes plus a transient-failure allowance).
  TravelWorker HTTP 202 means the next city/search cursor is still pending;
  `ready` or `needs_review` completes the D1 job.
- Logs and `last_error_code` never include the response body or customer data.

## Release order

1. Apply `packages/db/migrations/017_accessible_japan_quote_jobs.sql` remotely.
2. Configure the dedicated secret in both Worker and TravelWorker.
3. Deploy TravelWorker before the Worker.
4. Verify an authorized synthetic submission, including same-submission retry,
   case readback, queue completion, and `customerSent=false`,
   `priceConfirmed=false`, `booked=false`.

This trigger cannot call OpenAI, Slack refresh, customer send, booking, payment,
or supplier inquiry paths.
