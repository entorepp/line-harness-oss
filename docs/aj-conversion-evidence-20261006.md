# AJ form measurement

The KPI requested by the owner is saved answers / form clicks. Raw redirect receipts, visible visits and saved answers remain independent counts. The report now groups by campaign, public editorial page slug, CTA placement, creative and form version. Backend-issued IDs are hashed before entering the existing D1 ledger; repeated receipt IDs cannot increase saved-answer counts. No form answers or contact values are stored in analytics.

The exact AJ form emits fixed field IDs for one-second visibility, local completion, interaction and submit validation errors. Conditional fields absent from the page are not treated as abandoned fields. Completion includes valid prefill and does not mean the user typed. Existing product form requirements remain unchanged in this release.

Apply migration 022 before publishing either runtime. Mirror packages/acquisition-funnel/core.js into the managed Flat Travel release and regenerate the Forms Studio worker with scripts/build-acquisition-funnel.mjs. The protected acquisition-report.html uses the existing report token. Dedicated links /go/aj-form preserve the existing Hotel Name prefill and accept aj_page, aj_placement, aj_variant. AJ must install these links before there is a click denominator. Direct legacy links are arrivals only. Never claim server redirect receipts equal AJ billable clicks.

Validation: real SQLite funnel and backend receipt tests; isolated DOM field diagnostics; cookieless/PII projection; existing post-order/upload/issued-route tests; full Next build. QA readback uses af_test=1 and does not submit a production inquiry. A 30-minute inactive cookie expiry, cross-device visit, blockers or a different tagged entry can prevent attribution; historic unmatched inquiries remain unmatched.
