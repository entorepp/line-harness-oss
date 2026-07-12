# Kakao Business / KakaoTalk Channel Setup

## What LINE Harness Supports

- Register a KakaoTalk Channel as a `kakao` channel account.
- Receive KakaoTalk Channel add/block webhooks at `/webhook/kakao`.
- Receive normalized Kakao provider/Consult Talk inbound text webhooks at `/webhook/kakao/messages`.
- Reflect Kakao add/block state in `friends`.
- Check KakaoTalk Channel customer-file API connectivity from the Accounts page.
- Relay outbound text only when a Kakao Bizmessage provider endpoint is configured.

Kakao Developers' KakaoTalk Channel API is not the same surface as LINE Messaging API. It mainly covers channel relationship checks, add/block webhooks, and customer-file management. Push-style business messaging requires Kakao Business/Bizmessage access or a provider contract.

For actual chat operations inside LINE Harness, KakaoTalk Channel creation alone is not enough. You need a Consult Talk/Bizmessage provider or approved Kakao-side messaging API that can forward inbound customer text to LINE Harness and accept outbound operator replies.

## Kakao-Side Prerequisites

1. Create or log in to Kakao Business.
2. Create a KakaoTalk Channel in KakaoTalk Channel Manager Center.
3. Convert the channel to a Business Channel.
   - Business review normally requires registered business information.
   - Kakao's public guide says Business Channel review takes about 3-5 business days.
4. Create a Kakao Developers app.
5. Convert the app to a Biz app using the same business information as the channel.
6. Connect the KakaoTalk Channel to the app from the app's additional-feature request area.
7. Enable KakaoTalk Channel webhook on the Kakao Developers app.

## Values To Register In LINE Harness

Open `Accounts` and choose `Kakao`.

| LINE Harness field | Kakao value |
| --- | --- |
| KakaoTalk Channel profile ID | Channel URL suffix, for example `_ZeUTxl` from `https://pf.kakao.com/_ZeUTxl` |
| Account name | Internal display name |
| REST API Key / Admin Key | REST API key or service app admin key used for `KakaoAK` API calls |
| Primary Admin Key | Representative admin key sent in Kakao Channel webhook `Authorization` |
| Slack notification channel | Optional default Slack channel |

## Webhook

Register this URL in Kakao Developers:

```text
{WORKER_URL}/webhook/kakao
```

Production default:

```text
https://line-flattravel.flat-travel.workers.dev/webhook/kakao
```

The worker validates:

```text
Authorization: KakaoAK {Primary Admin Key}
```

Supported webhook events:

- `added`: creates or reactivates a friend.
- `blocked`: marks the friend as not following.

## Customer-File API Check

After registering the account, click `接続確認` on the Kakao account card. LINE Harness calls:

```text
GET https://kapi.kakao.com/v1/talkchannel/target_user_file?channel_public_id={PROFILE_ID}
Authorization: KakaoAK {REST API Key / Admin Key}
```

This confirms that the key can access KakaoTalk Channel customer management.

## Outbound Sending

Kakao outbound text relay is disabled until these Worker secrets are set:

```text
KAKAO_BIZMESSAGE_ENDPOINT
KAKAO_BIZMESSAGE_API_KEY
KAKAO_MESSAGE_WEBHOOK_SECRET
```

The built-in relay sends a generic JSON payload:

```json
{
  "channelPublicId": "_ZeUTxl",
  "accountId": "LINE_HARNESS_ACCOUNT_ID",
  "to": "KAKAO_RECIPIENT_ID",
  "type": "text",
  "text": "message"
}
```

Adjust `apps/worker/src/services/kakao.ts` if the approved Kakao Bizmessage provider requires a different payload.

## Inbound Provider Webhook

Once the Kakao provider can send incoming customer messages, register this LINE Harness endpoint with the provider:

```text
{WORKER_URL}/webhook/kakao/messages
```

Production default:

```text
https://line-flattravel.flat-travel.workers.dev/webhook/kakao/messages
```

The provider must include:

```text
Authorization: Bearer {KAKAO_MESSAGE_WEBHOOK_SECRET}
Content-Type: application/json
```

Normalized text payload:

```json
{
  "channelPublicId": "_ZeUTxl",
  "senderId": "KAKAO_PROVIDER_USER_ID",
  "senderName": "Customer name if available",
  "messageId": "PROVIDER_MESSAGE_ID",
  "messageType": "text",
  "text": "Customer message",
  "updated_at": "2026-07-05T07:00:00Z"
}
```

LINE Harness will:

- Find the registered `kakao` account by `channelPublicId`.
- Create or update a Kakao friend.
- Create or update a chat.
- Save the inbound text to `messages_log`.
- Notify Slack through the account/friend Slack routing.
