# WhatsApp scheduling near reply-window expiry

The owner reported reservation posting stopped working, specifically in WhatsApp, and requested checking LINE as well. This supports September's lead-to-operations and reduced-manual-work milestone; it does not alter Nika's project plan.

At 2026-09-24T15:01:55Z, production D1 had no scheduled/sending backlog. Eight recent WhatsApp undo holds had reached provider acceptance, while the latest explicit future reservation was created September 16. The registered minute cron is present. These observations do not prove recipient delivery or identify every failed creation attempt. The live Web source is 7e6dc1b and Worker source b12c87f; the Worker is not changed by this UI fix.

An actual React interaction reproduces a defect: with five minutes left in an open WhatsApp reply window, opening reservation settings defaults to ten minutes later and disables submission. The form has no maximum selectable time, and the error replaces the deadline display. The failing test was observed before implementation. It is a confirmed defect, but the owner's exact failed interaction remains unconfirmed.

The form now picks the earlier of ten minutes from now and the last selectable minute strictly before expiry. New and edited reservations expose the maximum Japanese time even when a later time is entered. If no future whole minute remains, the form explains that immediate sending is still possible before expiry. An empty reservation never becomes an immediate send. The provider's 24-hour rule and server dispatch check stay enforced.

## Review and acceptance

For: restores usable defaults for a still-valid reservation and makes the allowed time visible. Against: treating all schedule failures as a UI defect would hide legitimate provider-window restrictions; clamping an operator-entered time could send earlier than intended. Therefore only the initial suggested time is bounded; subsequent entered times are never silently changed.

The completion gate for this bounded fix requires the regression to fail on the prior version and pass on the change, actual WhatsApp/LINE React creation and edit interactions through both chat/direct endpoint contracts, exact JST payloads, minute/second expiry boundaries, stale friend metadata rejection, draft preservation, no immediate-send fallback, existing WhatsApp tests, production build, diff self-review, CI, merge to the actual-live Web branch, and public asset readback. Review approval is conditional on those checks. No provider/customer send, resend, queue mutation, template activation, secret, runtime, API boundary, or scheduler change is included.

Browser-use failed before CDP became available (Chrome process exited). This is a local browser-runtime failure, not evidence of an application failure. Authenticated browser pixels and actual customer receipt remain separate unverified boundaries. All UI sends in regression tests use a closed local network mock.
