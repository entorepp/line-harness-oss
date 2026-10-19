# WhatsApp first-contact UI restoration, 2026-10-19

Problem: the actual-live Web branch lost the August first-contact UI although the registered Worker still exposes its authenticated initiation API. This change restores only the client integration on the current actual-live source, preserving calling, PDF templates, reply-window and scheduling features.

Operator flow: open Chats, choose Telephone number new contact, supply an E.164 number and customer name, separately confirm customer-provided number and explicit WhatsApp opt-in, enter actual consent source/time, select a current approved supported template, inspect its rendered text, and explicitly send. Server release mode remains authoritative. No default consent timestamp. Inputs freeze during provider access; unknown outcomes stop resends within the dialog. API acceptance is not delivery or a reopened 24-hour window.

Existing release boundary: system-registry/systems.yaml, line-flattravel-worker external_apis.allowed requires an approved test-recipient round trip before live initial-contact activation. Current production settings readback is `WHATSAPP_INITIAL_CONTACT_MODE` unset (off). This change must not activate it, send a customer message, change phone registration, or modify commercial/Nika state.

Groups: the UI explains that case-group creation is not enabled and links to Meta's official eligibility documentation. No group creation or invitation endpoint is implemented or called. OBA/number eligibility, exact current official API contract, supported webhooks, group history/routing and participant privacy require verification before implementing the operational group feature. Meta documentation returned HTTP429 twice during this task; stop retries rather than deriving a provider contract from third-party summaries. Do not treat this conditions panel as delivered Groups API support.

Readback before release: canonical Pages deployment 624c14b6-d952-4fa6-8ac5-93c35bd53139, source 6872c528bf1363a8cabf53cb4d8cf02477c3e402. Change base 7b7dc52 includes that source and its PR merge. Auth-free initiation catalogue returns HTTP401.

Validation: new React interaction tests cover off mode, actual consent timestamp, independent consent facts, frozen in-flight payload, accepted request fields, and unknown-outcome resend lock. Existing Web contract suites, TypeScript and production build are required. Browser visual QA omitted under the user's preference. Review is the delegated Codex diff review plus required PR CI; no real recipient delivery is implied.
