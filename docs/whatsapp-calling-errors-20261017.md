# WhatsApp outbound-call diagnosis and UI repair

The owner reports failed callbacks after a real inbound call, and a missing dial
button for the personal account previously used for testing. This is an urgent
overseas lead-operations repair; no Nika plan, milestone or deadline changes.

Production readback at 2026-10-16T15:47Z found calling enabled in Worker and Meta.
All four stored outbound attempts failed with provider code 131044 and no provider
call ID. The latest recipient has temporary permission with start_call=true; two
other recipients have permanent permission with start_call=true. Therefore these
failures are not explained by missing recipient permission. Provider calling
documentation identifies 131044 as a payment-method error. Registration, validity
and account association of the payment method still require WhatsApp Manager
verification; do not infer that no card exists from the code alone.

The October 7 test caller currently has no_permission. An inbound call is not
evidence of permanent permission. Never synthesize permission from call history
or bypass the provider's current permission/action limits.

Advocate: display the actual billing rejection and refresh permission after calls
and when the staff returns to the page. Critic: refreshing must not dial, request
permission, capture audio or allow an older response to overwrite the current
recipient's state. Keep explicit manual dial/request controls and server checks.

The bounded Web-only fix shows billing/permission/other provider error codes,
explains temporary permission, avoids mislabeling permitted-but-blocked calls as
missing permission, and rereads status on open, terminal state and window focus.
Only the latest readiness read may update the UI. No Worker, Meta configuration,
billing method, customer history or commercial-state mutation is included.

Acceptance: rendered React tests cover payment rejection, no automatic redial,
permission refresh and listener cleanup, plus existing incoming/answer/audio/mute
and observer safety. Run existing Web contract suites, typecheck and production
build. Inspect the final diff and required CI before merging into the established
actual-live Web branch, then verify served JavaScript bytes against the build.
Routine browser visual QA is omitted under the user's preference.

External boundaries: card/billing activation is not a software fix. No real
customer call, permission message, charge or synthetic webhook is authorized by
this change. Successful release does not establish outbound-call or audio success.
