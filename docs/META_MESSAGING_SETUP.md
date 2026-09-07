# Meta Messenger / Instagram DM setup

## Scope

Flat Harness exposes one signed webhook while keeping channel-specific Meta credentials and Graph hosts separate:

- Facebook Page Messenger through the Facebook Graph API and a protected Page access token
- Instagram Professional messaging through Instagram Login, `graph.instagram.com`, and a protected Instagram User access token

Inbound messages arrive at one signed webhook, are saved in D1, create or update a Harness chat, and use the existing `message_received` Slack notification path. Operators can send text replies from the Harness chat only while the latest customer-initiated message is inside Meta's standard 24-hour window.

This integration does not enable broadcasts, scenarios, proactive outreach, explicit scheduled sends, marketing sends, the Human Agent tag, or media replies. The existing 30-second undo hold is allowed for a manual operator reply; the reply window is checked again when that hold is released.

## Meta prerequisites

Use a Meta business portfolio that owns or manages all three assets:

1. A Facebook Page for Flat Travel US inquiries.
2. An Instagram Professional account connected to that Page.
3. A Meta developer app owned by the same business.

Messenger uses the `WA-CONFIG` Meta app. Instagram uses the separate `WA-CONFIG-IG` app with Instagram Login. Flat Harness joins both providers only at the signed webhook, D1/chat, operator UI, and Slack-notification layers.

### Selected Meta assets (2026-07-30)

- Business portfolio: `Flat Travel` (`3043410255677567`, verified)
- Meta app: `WA-CONFIG` (`2926742637531727`, Business type, Development mode)
- Instagram app: `WA-CONFIG-IG` (`1990327948295186`)
- Facebook Page: `Flat Travel` (`100550119618069`)
- Instagram Professional account: `flattravel_japan` (`17841478927573279`)

Only these Flat Travel assets were selected in the authorization flow. Other Pages and Instagram accounts visible to the administrator were not granted to the app.

### Required access

Facebook Messenger requires a Page access token issued to a person with the Page `MESSAGE` or `MODERATE` task and these permissions:

- `pages_manage_metadata`
- `pages_read_engagement`
- `pages_messaging`

Instagram messaging through Instagram Login requires an Instagram User access token and these scopes:

- `instagram_business_basic`
- `instagram_business_manage_messages`

Development-mode tests are limited to people assigned an app role or test role. Production conversations with ordinary customers normally require the app to belong to a verified business and the relevant permissions to have Advanced Access after App Review.

The current Messenger App Review draft contains only these four permissions:

- `pages_show_list`
- `pages_manage_metadata`
- `pages_messaging`
- `pages_read_engagement`

`business_management` and `pages_utility_messaging` were explicitly removed from the Messenger request because the current Harness feature does not use them. The draft has not been submitted. Submission still requires accurate app settings, allowed-usage and data-handling certifications, reviewer instructions, a working review build, and the requested review evidence; do not invent or pre-certify those answers.

The app now uses the published Flat Travel English Privacy Policy (`https://flat-travel.com/en/PrivacyPolicy`), the published gotcha travel terms (`https://www.gotcha.tokyo/kaigai/rule/`), the Meta app category `Messaging`, and the published Meta-specific data-deletion instructions at `https://line-flattravel.flat-travel.workers.dev/meta-data-deletion`. A confirmed 1024 x 1024 app icon and accurate review evidence still need to be supplied before review.

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
- Channel ID: Instagram Professional Account ID selected by the Instagram Login flow
- Access token: Instagram User access token issued by the Instagram app
- Secret: Instagram app secret for signed webhook verification
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

As of 2026-08-02, consolidated Worker version `a3bd48eb-be49-4217-a652-363f09a53861` is live. The deployed artifact contains the signed `/webhook/meta` route, `/meta-data-deletion`, the origin-restricted `/api/travel/quote-intents` route, existing WeChat/Kakao/WhatsApp routes, and persistent invocation logs. Cache-busted public checks returned 200 for the deletion page, 403 for a wrong Meta Verify Token, and 403 for a wrong quote-intent Origin.

The authenticated Harness Accounts screen reports `API: 接続済み` for Messenger Page `100550119618069` and Instagram `@flattravel_japan`; the Instagram profile read resolves API ID `37803254675955399`. Instagram calls use `graph.instagram.com` v26.0, while Messenger continues to use the Facebook Graph host. No credential value is recorded in this document.

The website quote-intent notification path was live-tested with the clearly labelled non-customer reference `FTQ-20260802-CHECK001`. The API returned 202 with `slackNotified: true`; D1 and the Harness notification table both read back `channel=slack` and `status=sent`. This test did not send a Messenger or Instagram message.

Provider-side customer readiness is still a separate gate. A fresh real incoming Instagram DM must confirm signed webhook intake and Slack routing after the consolidated deploy. Messenger use by ordinary non-role customers still depends on the correct App Review, publication, and Advanced Access state. Real non-role-user Messenger/Instagram receive-and-reply round trips remain required before calling both channels customer-live.
