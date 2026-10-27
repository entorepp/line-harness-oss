# WhatsApp AI intake operations

The owner approved the reviewed intake/product-guidance design with `go` and
explicitly authorized the designated existing internal test recipient on 2026-10-27/28.
This work supports the overseas lead-engine's standard intake/proposal handoff.
It depends on published products and does not complete hotel evidence, pricing,
capacity, Nika milestones or fully customized itinerary design.

Quality: critical. Advocate: structured questions and one bounded extractor reduce
repetitive staff work and avoid a model call for each decision. Critic: extraction
can be wrong, public hotel descriptions do not prove personal fit, cached product
data can expire, and human replies can race with an automated send. Deterministic
validation, explicit customer summary confirmation, exact public-route checks,
versioned one-attempt outbox and sticky human ownership address those risks.

## Runtime and boundaries

- Owner: existing `line-flattravel-worker`, existing signed WA webhook and D1.
- Source: `production/flat-harness-worker`; deployment only through the registered
  `zsh scripts/deploy-worker-production.sh` guard.
- Config: `WHATSAPP_INTAKE_MODE=off|test|live` (absence means off), exact
  `WHATSAPP_INTAKE_ACCOUNTS`, `WHATSAPP_INTAKE_START_AT`, approved recipient hashes
  in `WHATSAPP_INTAKE_TEST_PHONE_HASHES`, and a pinned `WHATSAPP_INTAKE_MODEL`.
- New server-only Worker secrets: `OPENAI_API_KEY` and
  `WHATSAPP_INTAKE_ENCRYPTION_KEY`. No values belong in source, logs or this file.
- Test mode may enroll only the approved existing test conversation. Live mode
  admits only a fresh, directly signed, new conversation after the configured
  start time; existing histories remain human. Language/phone never establish
  overseas residence: an explicit visitor-type answer is required.
- Completed Accessible Japan questionnaire enquiries, converted Tailor-Made
  enquiries and package applications bypass AI hearing even on their first WA
  contact. FT/FTQ/FTR/FTH markers, explicit submitted-source wording, a dedicated
  case channel or existing exact customer/case identity linkage suppress the AI
  introduction and questions. Qualification lookup failure/ambiguity also stays
  human. Generic interest in a package, without an existing request, remains
  eligible. Existing quote delivery and identity linkage continue normally.
- The existing dedicated-token TravelWorker identity read is used only as an
  exclusion gate on otherwise eligible signed new/active intake events. Returned
  contact/case details are discarded transiently and never enter state or the
  model. Current-message identity linking completes before an AI task can start,
  so a newly resolved registered customer is also excluded without a first prompt.
- On the hashed internal test recipient in test mode only, literal `AI TEST` /
  `AIテスト` or explicit staff test-start simulates an unqualified lead despite
  historical test CRM links. A repeated explicit test command may reset a closed
  test interview, preserving history and model-call budget. Submitted request
  markers always win; live mode ignores this simulation override.
- No new scheduler, autonomous loop, provider, Slack credential or AI gateway.
  Processing is a bounded continuation of one received event. Model calls do not
  occur from cron, boot, health checks, staff status reads or ordinary staff sends.
- No case/profile registration, supplier, ToDo, lifecycle, quote finalization,
  final price, payment or booking writes. Nika is not changed.

## Conversation behaviour

The assistant asks permission to process the enquiry, establishes overseas visitor
scope, then gathers timing, duration, cities, party size, budget/currency/basis/
scope, support categories and package/hotel preference. It skips supplied answers,
accepts undecided timing/budget/duration, preserves days versus nights and
month-only requests, and asks only missing budget units. Partial budget answers
retain already supplied amounts. Add/remove city operations preserve the other
requested cities. A correction invalidates confirmation of the previous summary.

Questions, controlled answers, consent, summary confirmation, thanks, stop and
human requests use local code. Only bounded free text needing interpretation
uses one Responses request. A person can take over at any time. Two unclear
interpretations, specialist care/lifting, sensitive or oversized input, model
failure, budget limit, missing current product data or expired public routes
hand off. Domestic-resident requests close with the scope explanation.

After confirming the current summary, customers receive up to three real public
product links. Names come from the corresponding current localized public page
titles, not the model. A requested quotation/selection transfers to staff. Product
discovery, reference budget comparison, individual accessibility fit, room stock,
final pricing and booking are separate. Discovery-only candidates never prove
the customer's support requirements are met; the reply explicitly requires
individual availability and suitability confirmation.

## Model, privacy and limits

The selected extraction snapshot is `gpt-5.4-nano-2026-03-17`, low reasoning,
strict structured output, `store:false`, no tools, maximum 1,400 output tokens,
one attempt and at most eight seconds. Missing/ambiguous facts are not invented.
The application validates slot shapes, exact source evidence, numeric/currency
grounding and explicit city operations. Language is controlled by script/context
rules so a wrong model language cannot switch a Chinese/Korean conversation to
English. Customer confirmation remains necessary; no numerical model confidence
is presented as calibrated accuracy.

The model receives only the current bounded message and allowlisted trip fields;
when consent follows a substantial first enquiry, that one initial enquiry is
processed once after consent. It never receives a full history, attachment,
profile, contact identifier, public hotel/DIDA payload or supplier record. Known
display names, explicit identity clauses, email, phone/identifier patterns and URLs
are removed; medical/payment/passport narratives hand off locally. Pattern
redaction is a bounded measure, not a guarantee that arbitrary prose contains no
identity. The original private provider-message history is preserved by the
existing messaging system.

Migration 031 adds isolated session, turn and model-budget tables. Structured
requirements and pending reply bodies are AES-GCM encrypted, authenticated to the
session/turn ID, and have a 30-day logical access expiry with event-owned lazy
erasure. No support state is added to friend metadata, arbitrary business fields
or analytics. New Slack handoffs contain bounded non-sensitive trip columns and
a private Harness link; support details stay in encrypted state and the existing
conversation. Handoff notification is claimed once, with no uncertain retry.

Limits: 20 reserved model calls per session, 200 per account/UTC day, at most eight
queued turns and a shared 24-second event processing deadline. Timed-out or
orphaned work hands off. No model/provider retry occurs after failure or an
unknown outcome. Jev is not added in this version: local fixed choices already
avoid the call, and layering a second service before extraction would add work.

## Public catalogue

Read only the existing production `https://flat-travel.com/__journey-data-v1`
projection. Packages use its published Journey IDs, cities, days and supported
party sizes. Hotel-only discovery may read one exact returned Journey detail and
retains only `candidateScope=journey`, `source=sanity-linked` hotel records with
public hotel paths. Hidden/referral candidates, DIDA IDs, raw provider facts and
planning hotel prices never enter customer proposals or the extraction model.

The loader checks the production dataset/source/freshness, caps JSON at 4 MiB and
its reads at four seconds each, and verifies at most three selected public product
pages. The HTML read stops after the localized title (maximum 160 kB), checks
status/type/locale and follows no redirects. There are no visitor query values or
credentials on these reads. Snapshot timestamps identify the public projection;
they are not represented as individual Sanity document revision proof.

## Sending and staff ownership

Each signed provider message ID identifies one turn, even when two real replies
contain the same text in the same second. An atomic per-session lock serializes
work, drains queued answers and suppresses obsolete questions. Phase/version,
exact account/phone/recipient, current follow state and the actual 24-hour service
window are checked before one provider submission. A persistent outbox claims
`sending` before access. API acceptance, delivered/read, failure and unknown
outcomes remain separate. An accepted send with a local history failure can only
recover its receipt, never send again.

Existing chat/friend/scheduled dispatch paths take over an enrolled conversation
before a staff reply. A WhatsApp app echo also takes over unless it matches this
outbox. Takeover invalidates unsent AI work. Once a provider request is already
in flight it cannot be unsent; a concurrent staff submission is held with a clear
error until the outcome is available. Quote-reference delivery has precedence.
The old first-contact welcome is suppressed when the assistant owns the enquiry.

Protected staff APIs (existing Harness API-key authentication):

- `GET /api/whatsapp/intake/:friendId` returns session/known fields, current reply
  window and bounded receipt/usage metadata; it may recover local accepted receipts.
- `POST /api/whatsapp/intake/:friendId/takeover` saves human ownership.
- `POST /api/whatsapp/intake/:friendId/test-start` is test-mode/hash-only and needs
  `confirmed:true` plus UUID `requestId`. Reset additionally requires `reset:true`
  and exact `expectedVersion`; history and model budget remain intact. This is an
  explicit staff test event, never a fabricated incoming message or service-window
  opener. An expired window returns 409 and requires an actual customer message.

## Verification and activation

The offline baseline's 71 cases and the new real-SQL/signed-webhook suite cover
consent, multi-field extraction, corrections, summary confirmation, provider-ID
deduplication, queued turns, old/unsigned/bridge/wrong-recipient exclusion, existing
customer preservation, staff races, opt-out, failures, local receipt recovery,
model budgets, encrypted state, public catalogue failures, hotel-only discovery,
domestic scope and TC/SC/KR language controls. Existing Worker contract suites,
typecheck, release contract and dry build must remain passing.

The signed-webhook suite currently passes 48/48, including first-contact AJ form,
Tailor-Made and package references, existing registered cases without a reference,
same-message linkage, mid-conversation conversion, qualification ambiguity and
the test-only simulation boundary. These tests require zero AI questions/model
calls on the qualified paths.

Actual customer-data-free model evaluation used 48 bounded extraction requests
plus one model-list read. Early Nano checks exposed conservative withholding and
timing/language normalization issues; Mini processed 15/16, with one eight-second
human-request timeout now covered by local routing. After application grounding,
locale and clarification fixes, four additional unseen EN/TC/SC/KR complete-trip
messages passed 4/4 on the selected Nano snapshot. Their model-only p50 was
3,427 ms and p95 was 5,753 ms, with 4,732 input and 1,262 output tokens total.
This small synthetic set is not production accuracy or WA latency evidence.
Using the official standard $0.20/$1.25 per million input/output token rates,
that sample estimates $0.000631 per extraction; actual billing, caching, tax and
WhatsApp charges are separate. Standard controlled turns make no model call.

Activation starts with the approved hashed test recipient only. Verify the
guarded release, exact bundle/source, binding names, migration and protected
routes. Obtain a fresh real test-account message if the service window is closed;
then verify signed receipt, persisted state, one reply and provider delivery
status. Review that evidence before broadening to new live customer enquiries.
The owner's `go` approves implementation and this pilot, not a fabricated test
result. Browser visual QA is omitted under the owner's preference.

Rollback: set `WHATSAPP_INTAKE_MODE=off` through the registered production release
path; existing messaging continues. Staff takeover remains immediate. Never erase
history or rotate a secret in response to DNS/network/provider-transient errors.

References: https://developers.openai.com/api/docs/models/gpt-5.4-nano,
https://developers.openai.com/api/docs/guides/structured-outputs,
https://developers.openai.com/api/docs/pricing.
