# WhatsApp template composer overflow repair

## Problem and scope

The operator cannot finish a quotation template after attaching its PDF. In the
authenticated production UI at 1200 × 759, the chat panel was 579 px high with
1035 px of overflowing content and `overflow-y: hidden`. Its composer ancestor
was 902.5 px high with `overflow-y: visible`. Focusing controls could also scroll
the hidden panel and move the conversation header out of view.

The reported enquiry/reference field is mandatory on the server, but the form
did not mark it required or identify the missing field before requesting a
preview. The current API correctly rejects a missing reference; this is a Web
presentation and input-feedback repair, not a provider or network incident.

Advocate: keep the current manual send flow and make every input, error, preview,
confirmation and receipt reachable without losing the chat header/history. This
supports the lead-operations milestone; no Nika plan or deadline change.

Critic: nested scrolling must work on narrow/short screens and both chat/direct
message layouts. A visual repair must not weaken recipient review, opt-in,
approval checks, idempotency or the free-text reply window. Preview success does
not prove recipient delivery.

## Change and acceptance

- Both composer containers have bounded height (65% of their panel) and their
  own keyboard-accessible vertical scrolling. Flex children may shrink without
  hiding the remaining content; long filenames cannot expand the fieldset.
- Required variables and dynamic URL suffixes are marked. Missing/blank values
  show a field-specific error and focus the first incomplete input without an
  API request. Existing values and the uploaded PDF stay intact.
- Preview, server errors and receipt results scroll into view. Existing send
  confirmation and uncertain-outcome controls remain unchanged.
- React regression tests cover the uploaded-PDF/empty-reference case, whitespace,
  correction with attachment preservation, preview/error scrolling, dynamic URL
  validation and no unintended sends. Existing messaging/phone/calling/scheduling
  contracts, TypeScript and the production Next.js export must pass.
- Release only Web from the active Pages source ancestry. Required PR CI and
  final diff self-review must pass; use the existing guarded Web deploy entrypoint.
  Verify canonical deployment, served asset bytes and authenticated browser
  scrolling/preview. No customer send, attachment upload to a provider, Worker
  deploy, message replay or commercial-state change is part of verification.

## Review

Self-review approved for the narrow Web change after the local regression suite,
all six Web contract commands, TypeScript and production export passed. Required
PR CI and post-deployment browser/asset evidence remain release gates. Delivery
and read receipts require a separately authorized real send.
