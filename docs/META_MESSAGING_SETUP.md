# Meta Messenger / Instagram DM setup

## Scope

Flat Harness uses one Meta app and the Facebook Page-connected route for both channels:

- Facebook Page Messenger
- Instagram Professional account connected to that Facebook Page

Inbound messages arrive at one signed webhook, are saved in D1, create or update a Harness chat, and use the existing `message_received` Slack notification path. Operators can send text replies from the Harness chat only while the latest customer-initiated message is inside Meta's standard 24-hour window.

This integration does not enable broadcasts, scenarios, proactive outreach, explicit scheduled sends, marketing sends, the Human Agent tag, or media replies. The existing 30-second undo hold is allowed for a manual operator reply; the reply window is checked again when that hold is released.

## Meta prerequisites

Use a Meta business portfolio that owns or manages all three assets:

1. A Facebook Page for Flat Travel US inquiries.
2. An Instagram Professional account connected to that Page.
3. A Meta developer app owned by the same business.

The app should use Facebook Login and the Page-connected Instagram messaging route so one app can service both inboxes.

### Selected Meta assets (2026-07-30)

- Business portfolio: `Flat Travel` (`3043410255677567`, verified)
- Meta app: `WA-CONFIG` (`2926742637531727`, Business type, Development mode)
- Facebook Page: `Flat Travel` (`100550119618069`)
- Instagram Professional account: `flattravel_japan` (`17841478927573279`)

Only these Flat Travel assets were selected in the authorization flow. Other Pages and Instagram accounts visible to the administrator were not granted to the app.

### Required access

Facebook Messenger requires a Page access token issued to a person with the Page `MESSAGE` or `MODERATE` task and these permissions:

- `pages_manage_metadata`
- `pages_read_engagement`
- `pages_messaging`

Instagram messaging through the connected Page requires a Page access token issued to a person with the Page `MESSAGE` task and these permissions:

- `instagram_basic`
- `instagram_manage_messages`
- `pages_manage_metadata`

Development-mode tests are limited to people assigned an app role or test role. Production conversations with ordinary customers normally require the app to belong to a verified business and the relevant permissions to have Advanced Access after App Review.

The current App Review draft contains only these five permissions:

- `pages_show_list`
- `pages_manage_metadata`
- `pages_messaging`
- `pages_read_engagement`
- `instagram_manage_messages`

`business_management` and `pages_utility_messaging` were explicitly removed from the Messenger request because the current Harness feature does not use them. The draft has not been submitted. Submission still requires accurate app settings, allowed-usage and data-handling certifications, reviewer instructions, a working review build, and the requested review evidence; do not invent or pre-certify those answers.

The app now uses the published Flat Travel English Privacy Policy (`https://flat-travel.com/en/PrivacyPolicy`), the published gotcha travel terms (`https://www.gotcha.tokyo/kaigai/rule/`), and the Meta app category `Messaging`. A Meta-specific data-deletion instruction URL and a confirmed 1024 x 1024 app icon still need to be supplied before review; the old Facebook placeholder deletion URL must not be treated as final.

## Webhook configuration

Configure this callback for both the Page and Instagram webhook objects:

```text
https://line-flattravel.flat-travel.workers.dev/webhook/meta
```

Use the same random verify token stored as the Worker secret `META_VERIFY_TOKEN`. Never use the Meta App Secret as the verify token.

Subscribe the minimum fields required for the current feature:

- `messages`
- `messaging_postbacks`

Flat Harness verifies every POST with `X-Hub-Signature-256` and the Meta App Secret stored on the matching account. Unsigned, incorrectly signed, malformed, and unregistered-channel deliveries are rejected or ignored.

## Flat Harness account registration

Create two accounts from the Accounts screen after Meta issues the credentials.

### Facebook Messenger

- Channel: `Facebook Messenger`
- Channel ID: Facebook Page ID
- Access token: Page access token
- Secret: Meta App Secret
- Locale: `en`
- Slack: the approved US lead intake channel

### Instagram DM

- Channel: `Instagram DM`
- Channel ID: connected Instagram Professional Account ID
- Access token: Page access token that is authorized for the connected account
- Secret: the same Meta App Secret
- Locale: `en`
- Slack: the approved US lead intake channel

The Accounts screen performs a scoped profile read and shows the resolved Page or Instagram identity, webhook URL, and 24-hour reply-window policy. Credentials are accepted only by the authenticated Worker API and are omitted from account-list responses.

## Deployment order

1. Confirm Meta business, Page, and Instagram ownership and linkage.
2. Create or select the Meta app and request only the permissions above.
3. Generate a unique random `META_VERIFY_TOKEN` and store it with `wrangler secret put`.
4. Apply `packages/db/migrations/019_meta_messaging.sql` to the production D1 database.
5. Deploy the Worker and web UI from the reviewed integration branch.
6. Register the two channel accounts in Flat Harness.
7. Configure and verify the callback, then subscribe Page and Instagram `messages` and `messaging_postbacks`.
8. Complete App Review / Advanced Access before US customers outside app roles use the integration.

Do not commit access tokens, the App Secret, or the webhook verify token. Do not paste them into issues, pull requests, screenshots, Slack, or system-registry text.

## Release verification

The release is not complete until all of these pass in the live runtime:

- Correct webhook verify-token challenge returns the challenge; a wrong token returns 403.
- A correctly signed Page delivery returns 200; a bad signature returns 401.
- A correctly signed Instagram delivery returns 200; a bad signature returns 401.
- Re-delivering the same provider message ID creates only one D1 message.
- A real non-admin US test account starts a Messenger conversation, which appears once in Harness and the selected Slack channel.
- The operator sends one text reply from Harness within 24 hours and the customer receives it.
- A real non-admin US test account starts an Instagram DM, which appears once in Harness and the selected Slack channel.
- The operator sends one text reply from Harness within 24 hours and the customer receives it.
- An attempted reply after the 24-hour window is blocked before any Meta API call.
- Broadcast, scenario, explicit scheduled, media, and Human Agent sends remain unavailable for both Meta channels; only the 30-second manual-reply undo hold is accepted.

## Current boundary

As of 2026-07-30, the source implementation and local build are ready in the isolated worktree. On Meta, the existing verified-business app `WA-CONFIG` now has the Messenger product, the `Flat Travel` Page is connected for Messenger, and the same Page plus `flattravel_japan` are authorized for Instagram messaging. Separate Page access tokens were generated for the Messenger and Instagram setup screens and remain in mode-`0600` local temporary files; they are not committed to this repository. The Meta App Secret appeared in the authenticated browser automation trace and must therefore be rotated before production use. Its temporary local copy was deleted. Because `WA-CONFIG` also owns the existing live WhatsApp integration, rotate the App Secret only as a coordinated change that updates and verifies the existing WhatsApp signature configuration and the new Messenger/Instagram account secrets together.

Production D1 migration `019_meta_messaging.sql` is applied and re-read successfully. The signed `/webhook/meta` Worker code is deployed, and `META_VERIFY_TOKEN` is installed as an encrypted Worker secret. Messenger and Instagram account rows do not yet exist, so the new POST path cannot accept customer traffic. The Pages UI deployment is still pending because the authenticated dashboard accepted the build but the Chrome automation boundary rejected local folder/file selection.

The integration is not customer-live. Coordinated Meta App Secret rotation, simultaneous update of the existing WhatsApp secret and the new Messenger/Instagram rows, verified callback, Page/Instagram webhook subscriptions, Pages deployment, app icon and Meta-specific data-deletion instructions, accurate review declarations/evidence, submission of the five-permission App Review draft, Advanced Access, and real non-role-user round trips remain pending. The app stays in Development mode, so current Meta access is limited to app-role/test users. See the credential incident record for the completed Cloudflare-token revocations and the remaining Meta rotation boundary.
