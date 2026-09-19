# Operational WhatsApp templates

Existing customer chats need booking, rail, requested-quotation and payment notices even when the last customer reply is older than 24 hours. Use a Meta-approved UTILITY template with editable named/positional values and, where declared, one PDF document header. The text/file is one template message; it does not open a free-form reply window until the customer replies.

## Operator flow

Open `予約・見積り・支払い案内（PDF対応）` in either chat composer. Choose a purpose, enter the customer-specific fields, attach a PDF if required, and review the server-rendered recipient, account, full text and document. Confirm the customer's WhatsApp opt-in for the related enquiry/booking and confirm the displayed content. Sending never changes booking, price confirmation, payment or other TravelWorker/FlatWorker fields.

The six English definitions live in `apps/worker/src/services/whatsapp-operational-templates.ts`: booking confirmation, booking details, rail document, requested quote, payment with invoice PDF and payment link only. Meta review can change status/category: non-APPROVED or non-UTILITY templates remain visible but unavailable. Do not automatically convert the older marketing-classified enquiry-update template into an operational notice.

## Runtime and data contract

- Existing staff Bearer authentication applies to all `/api/whatsapp/friends/:id/*` routes. Only active WhatsApp accounts, following friends with an exact valid phone number, and conversations containing customer-originated history qualify. This never creates contacts or infers opt-in.
- `WHATSAPP_OPERATIONAL_TEMPLATES_MODE` defaults to `off`. `test` uses the existing `WHATSAPP_INITIAL_CONTACT_TEST_PHONE_HASHES` allowlist (SHA-256 of digits-only E.164). `live` requires a separately authorized test-recipient template round trip. The initial-contact mode is unchanged.
- GET `templates` reads current definitions/status from Meta. POST `documents` accepts real PDF bytes, <=10 MiB, stores an opaque key, SHA-256, recipient/account binding and 180-day expiry in existing KV. Public `/api/files` and `/api/images` reject private objects. GET `documents/:key` requires staff auth plus the same recipient/account and returns private/no-store.
- POST `template-preview` renders fixed text plus validated variables and URL suffixes; its 15-minute HMAC token binds the exact current recipient, sending account/phone ID, template definition/status/category and PDF identity. No provider send occurs.
- POST `template-messages` rereads those inputs, checks opt-in/content confirmation and the release gate, then atomically claims the idempotency key in migration 026. It uploads the confirmed private PDF to Meta's media endpoint and sends its ID as the DOCUMENT template header. There is no publicly accessible customer-document URL, scheduler or automatic retry.
- Browser storage contains only friend ID and the random pending-send key. A refresh or network failure restores a result-check action. GET `template-messages/:key` only recovers local history/receipt; it never resends. Same-key payload changes and cross-recipient queries are rejected. Pending/unknown outcomes remain stopped; investigate provider/recipient evidence before any manual new attempt.
- Provider acceptance is persisted before history/receipt recovery. HTTP 5xx, network loss and missing provider ID are unknown outcomes. Definite Meta 4xx errors are failures. A signed callback updates the existing delivery table, so accepted, delivered, read and failed remain distinct. Local receipt recovery cannot downgrade an acceptance or send twice.

## Review and verification

The mandatory Worker contracts and production release script run real SQLite/mock-Meta tests for auth, release/consent gates, private PDF access, recipient/preview changes, fresh template approval, expired-window template sends, dynamic URLs, atomic concurrent claims, duplicate and unknown outcomes, recovery and signed delivery callbacks. Existing ordinary-send window guards, LINE, queue/cron and form-private files keep their regressions. Web tests exercise actual React actions, confirmation invalidation, persistent result recovery, disabled release mode and both composer entry points; the production Web script runs them before building.

Self-review: approve guarded deployment only after those checks and diff inspection. Do not enable live mode as part of code deployment. Public bundles/authenticated API readbacks, browser pixels and recipient receipt are separate evidence. No customer message is authorized for verification here.

## 24-hour research (19 September 2026)

- [WhatsApp policy](https://whatsappbusiness.com/policy/?lang=en_US): free-form API replies depend on the last customer message; an approved template is required after 24 hours. Paying for templates, moving to another API provider or sending a template does not permanently remove that boundary.
- [Meta document template example](https://www.postman.com/meta/whatsapp-business-platform/request/ep5w4rc/create-template-w-document-header-text-body-a-phone-number-button-and-a-url-button): a DOCUMENT header and variable body let a specific operational notice and attachment be delivered together.
- [8x8 official Coexistence docs](https://developer.8x8.com/connect/docs/whatsapp/whatsapp-business-app-coexistence/): manual Business App messages are not subject to the API window; they do not reopen it. Coexistence can mirror app and API messages.
- [360dialog Coexistence requirements](https://docs.360dialog.com/docs/resources/phone-numbers/coexistence): onboarding begins with an existing active Business App number. An API-only number cannot directly onboard in the reverse direction; new app accounts are not immediately eligible. Current production readback is CLOUD_API, CONNECTED, GREEN, is_on_biz_app=false. A same-number deregistration/re-onboarding is not a verified safe migration; preserve production registration and history until a concrete supported migration is reviewed.
- [Meta pricing](https://whatsappbusiness.com/products/platform-pricing/) and [360dialog 72-hour explanation](https://360dialog.com/blog/72-hour-click-to-whatsapp-ad-window/): qualifying ads/Page entry points can give 72 hours without Meta message charges, but free-form messaging still needs an open 24-hour customer service window. This is not a general extension.
- Unofficial WhatsApp Web/client automation can change the technical path, but provides no verified exemption under the official API contract. Session loss, unsupported synchronization and account restrictions make it unsuitable as the incident recovery path. A separate Business App number or a supported migration is a distinct operational choice; no provider/account migration is performed.
