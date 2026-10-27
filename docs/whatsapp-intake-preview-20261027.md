# WhatsApp intake and product guidance proposal (historical review baseline)

Owner approved this design with `go` on 2026-10-27/28 and authorized the internal
test recipient. The text below retains the reviewed offline baseline. Current
implementation, controls and activation evidence are maintained in
`docs/whatsapp-ai-intake-20261028.md`; this historical review request is satisfied.

## Problem and project alignment

SEO/advertising leads enter WhatsApp, then require staff to establish timing,
budget, travel support, cities and duration before selecting a package or hotel.
The proposed assistant handles standard discovery and product guidance, leaving
exceptions to staff with the already-collected facts. This directly supports the
lead-engine milestone for standard overseas-lead intake and low-effort proposals.
It depends on the package-tour milestone's real products, main/backup hotels and
accessibility evidence. It cannot replace that supply work or make the overdue
milestones complete. No Nika project, deadline, WBS or capacity is changed.

Quality: critical because the eventual feature communicates with customers and
processes accessibility requirements. This patch is isolated and reversible.

Advocate: known questions, structured answers and catalogue matching avoid an LLM
call for every operational decision. Multiple answers in one message can fill
several fields. Staff should receive exceptions rather than repeat the interview.

Critic: an incomplete catalogue can create excessive handoffs; self-reported model
confidence is not calibrated accuracy; generic public accessibility facts do not
prove individual fit; a language model can misread dates and budget scope. A
successful send also does not prove delivery. Automation must preserve those
distinctions and be evaluated on actual multi-language conversation behaviour.

Decision for review: pilot new incoming overseas travel enquiries first. Keep
existing arrangement/travel conversations human. Gather the five requested fields
plus party size and package/hotel preference; collect currency and budget basis
with the budget. Accept month-only or undecided answers without invented dates.
Use fixed localized replies for standard questions and handoffs.

## What is implemented

`apps/worker/src/services/whatsapp-intake-preview.ts` contains pure, in-memory
functions, with no provider, database, credential, browser or runtime dependency.
It is deliberately absent from the Worker import graph and webhook. Every plan
returns `previewOnly: true`. There is no activation setting or live sender.

The prototype supports English, Traditional Chinese, Simplified Chinese and
Korean. It asks permission for AI processing before collecting answers, lets the
customer request staff or stop, skips known answers, accepts corrections, and
requires confirmation of the latest summary before selecting candidates. Invalid
or uncertain interpretations never partially replace valid facts. Two consecutive
unclear turns hand off. Hoist/personal-care requests, emergency interpretations,
existing-booking interpretations and staff takeover hand off immediately.

Selections bypass model interpretation. Free-text interpretation is represented
by a typed contract: `intent`, `confidence`, and per-field proposed value plus an
exact quote from the triggering text. The prototype validates shape, allowed
fields, size and quote existence. **It does not yet run an extraction model or
prove that a quoted passage semantically supports a proposed value.** Customer
summary confirmation and future extraction evaluation remain necessary. The 0.9
threshold is provisional, not a measured probability of correctness.

Catalogue selection is deterministic: package/hotel preference, requested city
set, package duration, locale, publication marker, source revision, freshness,
allowlisted public URL and per-capability public evidence. At most three unique
options are returned. When either product type is acceptable, both are included
if eligible. Multi-city hotel-only enquiries require a staff review until
per-city stays are collected. Missing current catalogue matches hand off.

Reference prices are compared only for matching currency, basis, scope and party;
no inferred FX, guest multiplication or per-night conversion. Incomparable or
expired price evidence remains unverified. Candidate output always says that
availability and personal fit are unverified and nothing has been booked.

The caller must supply a trusted catalogue projected from the actual published
Sanity release. A string revision and an allowlisted URL are validation checks,
not independent CMS publication or physical-fit verification. No production
loader exists in this patch. Tests use clearly named synthetic products and
prices; they must never be used as customer inventory.

## Proposed model split

| Work | Proposed implementation | External call |
| --- | --- | --- |
| Question order, known answers, confirmations, stops | Local state machine | None |
| Buttons / exact controlled selections | Local validation | None |
| Free-text dates, amounts and several supplied facts | One bounded structured extraction by a small GPT candidate | Only when needed; not implemented |
| General explanation / difficult wording | Bounded GPT, grounded in published facts | Optional; not implemented |
| Fixed-label intent / limited preference ranking | Jev only if evaluation improves the baseline | Optional; not implemented |
| Eligibility, budget arithmetic, publication and URLs | Deterministic catalogue logic | No model judgment |

Jev's official System One interface returns typed decisions (choice, score,
yes/no), so it is appropriate for fixed alternatives, not free-form response
generation or arbitrary date/amount extraction. Adding Jev before every GPT call
could increase latency and cost. Start with buttons/rules plus one extractor;
compare a Jev shortcut only where its result can finish the turn without GPT.
Do not claim a speed or cost advantage until measured on these conversations.

OpenAI Structured Outputs can constrain the extraction schema; application-side
validation and semantic evaluation are still required. Model choice is pending
quality/cost/latency evaluation. No current API price or performance is assumed.

Primary references read for this proposal:

- https://docs.typesafe.ai/api/system-one
- https://developers.openai.com/api/docs/guides/structured-outputs#structured-outputs-vs-json-mode

## Integration proposal requiring review

The current `line-flattravel-worker` registry entry forbids direct OpenAI calls.
The separately owned website concierge already has a bounded Responses path, but
its current contract does not authorize WhatsApp transcript processing. Neither
boundary is changed or bypassed by this offline patch. Before any external-model
test or runtime wiring, declare the chosen owner, permitted data and API, and
update the relevant registry/ops record. Avoid a second unowned AI gateway.

Proposed next sequence after owner review:

1. Connect a trusted public Sanity catalogue projection and an extraction adapter
   in an isolated synthetic test path. Redact identity/contact/payment data, send
   only the current bounded message plus allowlisted structured fields, require
   processing consent, and use `store: false` for OpenAI. No full chat history,
   attachments, medical records or customer identity should enter the model.
2. Evaluate unseen synthetic EN/TC/SC/KR conversations: multiple answers, changes,
   currencies/budget bases, ambiguous months, negation, adversarial text,
   unsupported cities, missing evidence, handoff requests and errors. Measure
   extraction accuracy, unsafe claims, handoff precision/recall, model call count,
   tokens/cost and p50/p95 latency. Choose GPT/Jev only from that evidence.
3. Wire persistence and the signed WA ingress with account/phone/start-time/new-
   conversation gates. Use provider message IDs for idempotency and versioned
   per-conversation serialization. Human takeover must win races with AI work.
   Establish overseas-resident enquiry scope from trusted existing intake context
   or an explicit answer; do not infer residence from language or phone prefix.
   Suppress the old first-enquiry welcome when the new assistant owns the reply;
   preserve quote-reference delivery precedence and existing Slack notifications.
4. Use the existing guarded send path: correct conversation, current opt-out and
   24-hour reply window checked immediately before sending; durable one-attempt
   claim; no automatic retry on unknown provider outcome; persist accepted,
   delivered, read and failed receipts separately. Persist handoff state and its
   known/missing facts, then notify the owning staff queue once. The prototype's
   returned handoff plan is not itself a delivered staff notification.
5. Verify on an explicitly approved internal test recipient before enabling new
   real-customer conversations. Record model-quality evidence and owner review.
   Release the Worker only from `production/flat-harness-worker` via the registered
   guard. Keep an off switch and human takeover available. Existing customers
   remain human under the initial proposed pilot scope.

Case/customer registration and quotation drafts may use only separately declared
existing FlatWorker/TravelWorker paths. This patch does not write cases, ToDos,
suppliers, statuses, prices, bookings, payments or Nika. Product guidance is
separate from confirmed prices, accessible-room suitability and reservations.

## Reviewable example

Synthetic customer: “November 2027, seven days, Tokyo and Kyoto, two adults,
JPY 600,000 for the whole trip, no support needed; a package.”

Expected: record all supplied fields, preserve month-only timing, show a summary
for confirmation, then return only matching catalogue candidates with public
links and reference/unverified status. Do not ask the seven fields again. If the
customer corrects the budget, invalidate confirmation and review again. If they
ask for a person, return the known requirements and missing fields to staff.

## Verification and remaining review

Run `pnpm --filter worker test:whatsapp-intake-preview` for the offline behavioural
suite. It is included in required Worker CI and the production release preflight.
Run Worker typecheck and the existing release contracts before a source review.

The suite tests conversation control and matching with simulated model results.
It is not evidence of model extraction quality, real CMS linkage, signed-webhook
processing, durable staff escalation, WhatsApp delivery, latency or real spend.
Those integration acceptance criteria remain open above. Routine browser visual
QA is omitted under the owner's preference; no browser gate is introduced.

Local verification on 2026-10-27: 71/71 intake cases passed; shared/SDK builds,
Worker typecheck, existing WA inbound-welcome/send/reply-window suites and the
release-guard regression suite passed. Wrangler dry-run built the Worker without
deploying. The emitted bundle passed the existing messaging contract and contains
none of the new intake engine's markers, confirming this patch does not activate
that engine. Final source self-review approves the isolated prototype only;
integration and live activation remain pending the review below.

Review request: approve or amend the new-lead pilot scope, rule/structured-AI split
and human escalation behaviour before connecting the model/catalogue/WA runtime.
No project-plan update or production activation is represented as approved here.
