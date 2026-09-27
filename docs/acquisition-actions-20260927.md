# Anonymous post-click diagnostics

Search forms were previously counted as inquiry starts and deduplicated events could not identify a last control or explain result/price context. Release v84.259.137 adds a chronological diagnostic ledger while retaining the server-saved conversion definition.

## Recorded contract

- Search: selected public area IDs, exact/flexible/any mode, travel **month**, party bucket. Never exact dates or arbitrary query text.
- Rendered result set: catalogue/search/home context, count including zero, revision, product ID and position, displayed JPY per-person starting amount. The whole result set being rendered does not prove every card was viewed.
- Detail price: loading/date-required/request/unavailable/priced state; only a displayed verified total has a JPY value. A starting price is explicitly distinct from a dated party total.
- Trusted clicks: fixed control ID (Search, Explore Journey, calendar controls, next step, review, contact, navigation), optional public Journey ID. Unmapped controls remain `other_control`; no button text, DOM dump, arbitrary URL or answer value is saved.
- Anonymous page UUID, per-page sequence and elapsed milliseconds preserve repeated actions. Page hidden is observable visibility/navigation, **not proof of exit or its reason**. Browser/network loss can still truncate a trace.
- No name, email, phone, free text, exact travel date, support/medical/accessibility answer, customer ID, IP or user agent. Sensitive choice buttons have only a generic action, never the choice value. Server independently projects the same allowlisted data.
- Existing 30-minute first-party visit, UTM attribution and inherited QA flag remain. New action writes require the page's matching HttpOnly visit cookie and same Origin, 24-hour page age, max 20 actions/16KB request, 500 sequences/page. ID and page-sequence uniqueness make retries idempotent.
- Search input/submit/invalid events do not become inquiry `form_start`/`submit_attempt`. Server backend-save gating of `submit_success` is unchanged.

## Ownership and rollout

Canonical source and additive migration 021 live in line-harness-oss `packages/acquisition-funnel/core.js` and `packages/db/migrations/021_acquisition_actions.sql`. The frozen website copy must be byte-identical excluding its TypeScript directive. Forms Studio's generated source is synchronized but this site-only change requires no Forms deployment. No new API provider, credential, schedule, public reporting endpoint, or customer-message path.

1. Merge shared source/migration and website source; apply exact migration 021 to the existing line-crm D1 database.
2. Freeze the new website release; retain publication baseline, existing bindings, GTM, and acquisition guards.
3. Run `node scripts/deploy-production.mjs --check`, then the guarded production deploy.
4. Open a site URL with `af_test=1&utm_source=tracking_qa`, search, inspect results, click Explore Journey. Verify the exact visit in D1 with `is_test=1`, action order, conditions, count, price and button. Do not create a fake inquiry.

## Reading the data

`node scripts/acquisition-actions-report.mjs --start 2026-09-27T00:00:00Z --end 2026-09-28T00:00:00Z` returns action stages, control clicks, result counts and each visit's last non-lifecycle action. Dates are UTC; range is bounded to 31 days and QA is excluded by default. Add `--visit UUID` for a chronological page/action trace, or `--include-test` for QA only. The operator uses existing Cloudflare authorization. The new table is not accessible through a public read endpoint.

Historical actions remain unchanged and cannot be reconstructed. Compare only visits after rollout when using these new dimensions. Last recorded action locates the observed stopping point, not the visitor's motivation. Search result count and prices are client observations, not booking or provider-availability evidence.

## Acceptance

SQLite/API and real DOM tests cover ownership, retry dedupe, chronology, zero results, displayed price, repeated clicks, query/date/PII exclusion, QA inheritance and search/inquiry separation. Existing acquisition, analytics, hotel publication and seven-day discovery checks are retained in the production guard. Runtime browser-to-D1 verification is recorded in the deployment evidence after release.
