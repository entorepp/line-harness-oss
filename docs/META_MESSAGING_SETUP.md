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

As of 2026-07-30, the source implementation, local validation, production D1 migration `019_meta_messaging.sql`, signed `/webhook/meta` Worker route, encrypted `META_VERIFY_TOKEN`, and Pages UI are deployed. The intended Pages build is production deployment `bb372ea4`; it was restored after a later GitHub Actions deployment from `main` temporarily replaced the production alias. The live Accounts screen exposes Messenger and Instagram DM without removing the existing WeChat Customer Service controls.

The exposed `WA-CONFIG` App Secret was rotated through the authenticated Meta console. The existing WhatsApp row and the new `fb-flat-travel-001` / `ig-flat-travel-001` rows were updated to the same new 32-character secret, and D1 confirmed all three exact matches without returning the value. The Messenger and Instagram Page tokens are installed in their protected D1 rows, both accounts are active, and live Harness profile reads resolve Page `100550119618069` and Instagram account `17841478927573279` (`@flattravel_japan`). The existing WhatsApp Graph profile read also succeeds after rotation. All three temporary Meta credential files were then deleted and their in-session values cleared.

Meta accepted the shared callback `https://line-flattravel.flat-travel.workers.dev/webhook/meta` for both the Page and Instagram objects. `messages` and `messaging_postbacks` show `Subscribed` for both objects. This proves callback challenge verification and configuration, but not a real customer round trip; a post-rotation signed WhatsApp delivery also remains to be observed before the credential incident can be closed.

The integration is not customer-live. `WA-CONFIG` remains unpublished/Development mode, and Meta explicitly reports that production webhook data will not be delivered until the app is published. A confirmed app icon, Meta-specific data-deletion instructions, accurate review declarations/evidence, submission of the existing five-permission App Review draft, Advanced Access, post-rotation signed WhatsApp webhook evidence, and real non-role-user Messenger/Instagram receive-and-reply round trips remain pending.
