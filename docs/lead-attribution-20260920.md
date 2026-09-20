# Website attribution receipt

The existing quote-intent route accepts a bounded `attribution` object, sanitizes it, forwards it through the existing authenticated TravelWorker integration and persists it in the existing D1 notification metadata. Duplicate notifications retain their first stored attribution. No migration, new external API, secret, job or customer send is introduced.

Missing/invalid data remains unavailable. Only campaign tokens, external referrer origin and 30 query-free page paths are retained. Existing customer profile redaction and Slack notification contracts remain intact. Tests exercise actual Hono intake/forwarding/receipt and duplicate handling with mocked external services.

Rollout order: TravelWorker API/UI, this Worker via the registered production guard, website release v84.259.94-lead-attribution. Live browser-to-case verification remains pending; no real enquiry was submitted.
