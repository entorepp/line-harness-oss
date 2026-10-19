# Incoming chat Slack long-text repair — 2026-10-20

## Problem and acceptance

A 3,069-character inbound message at 2026-10-19 12:44:01 JST was persisted in
D1, but its Slack notification was rejected at 12:44:04.839 JST with
`invalid_blocks` and `must be less than 3001 characters` for `/blocks/0/text/text`.
The deployed notification implementation put the entire original and Japanese
translation into a single section. Short messages around it were posted.
This is a product payload bug, not a DNS, authentication or WhatsApp receipt
failure. Customer text and identifiers are excluded from this document.

Acceptance: preserve the entire original and available translation, keep each
section and fallback message within Slack limits, and preserve routing, short
text, avatar fallback and media attachments. Keep the existing notification
trigger and external providers. No historical replay, customer send, business
record write, new API/secret/scheduler or Nika project change.

## Decision and review

Advocate: splitting sections fixes the proven rejection without discarding
customer requirements or disabling translation. A normal long message still
uses one Slack post.

Critic: very large texts need multiple posts; partial delivery is possible if
Slack fails after a successful part. Splitting text may also split Slack markup
or a long URL across sections. Prefer existing newline boundaries when nearby,
preserve every character, keep an emoji surrogate pair intact, cap each post
at ten text sections, attach media once at the end, and stop at the first failed
or uncertain part. Do not retry ambiguous outcomes or replay old messages.

Review decision: approved by Codex after inspecting the final diff and the
regression evidence. This uses the owner's standing routine Git merge
authorization. Production release still requires the registered guard and exact
runtime bundle readback; source checks alone do not prove Slack delivery.

## Validation

- Baseline reproduction: a synthetic 3,069-character message produces an
  oversized section and receives the mocked `invalid_blocks` rejection.
- `test:slack-incoming-text`: original text at empty, boundary, 3,069, 40,000
  and 150,000 lengths; expanding Japanese translation; newline and emoji
  preservation; exact short fallback; missing translation; image/file/video/
  audio retention; existing image rejection fallback; no later part or retry
  after explicit rejection or unknown transport outcome.
- Worker typecheck and existing `test:slack-form-files` pass locally.
- New regression test is required by Worker contracts CI and the production
  deployment guard. Full guard/release evidence is written by the registered
  release script under `apps/worker/.wrangler/production-release/`.

## Remaining boundary

Sam's existing missing message is retained in Harness but not replayed.
No production Slack test post or customer message is authorized by this repair.
The next genuine incoming message provides end-to-end provider acceptance
verification. Browser visual QA is omitted under the owner's default.
