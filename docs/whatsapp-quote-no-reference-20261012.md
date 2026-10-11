# Quotation notices without a manually entered reference

The owner requested removal of the quotation composer’s enquiry/quotation number field on 2026-10-12. This reduces manual enquiry follow-up work within the lead-operations milestone; no Nika plan or schedule changes.

Advocate: name and the recipient-bound quotation PDF are sufficient for this requested notice. Remove the reference from both the customer text and the actual provider parameters.

Critic: the existing approved v1 definition requires two body parameters. Hiding its second input would break sending or require an invented reference. Register a separate one-parameter v2 and verify APPROVED UTILITY before switching the Web purpose. Retain v1 for existing drafts/history and leave the other notice purposes unchanged.

The v2 body is:

> Hello {{1}}, the quotation you requested from Flat Travel is attached. Please review the itinerary, price and conditions in the document. Reply to this message with any questions about your quotation.

Existing Harness Worker, D1/KV, Pages and Meta template APIs own this change. Registration uses only a fictional review PDF and fictional name. No new provider, credential, job, customer send, booking/payment mutation or automatic retry. Existing approval/category, private-PDF binding, signed preview, opt-in, content confirmation, idempotency and delivery receipts remain required.

Acceptance: a fresh catalogue lists only the name as a v2 parameter; name plus PDF produces a signed preview without any reference; mocked provider sends contain one body parameter; missing PDF, pending/reclassified templates and extra reference fields are rejected; Web shows no legacy quotation input even when both versions are returned. Existing uncertain-send controls and required Worker/Web CI pass. Guarded deployments, exact live bundles/assets, authenticated API preview and browser display must be verified before completion. Actual customer delivery is outside this verification.

Local Worker real-SQL route and Web React regressions plus type checks passed. Final diff self-review approved for this narrow change; required CI, current Meta approval and guarded release/readback remain deployment gates.
