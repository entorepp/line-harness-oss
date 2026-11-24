# 見積ページのチャット（'web' チャネル）

FlatWorker（FW）の見積ページでお客様が書いた質問を、WhatsApp と同じ受信箱・同じ Slack の通知で受け、担当者が Harness の受信箱から答える。

- お客様のブラウザは FW とだけやり取りする。Harness に公開の入口は作らない
- FW → Harness：`POST /api/integrations/fw-web-chat/messages`（`Authorization: Bearer <FLATWORKER_TRAVEL_QUOTE_TOKEN>`）
  - body：`{ref, caseId, displayName, quotePageUrl, staffName, text, clientMessageId, sentAt}`（text は 2000 字まで、quotePageUrl は https）
  - `ref` 1つ＝友だち1人（`line_user_id` は `web:<ref>`、`metadata` に caseId・quotePageUrl・staffName）
  - 同じ `ref` と `clientMessageId` の再送は1回として扱い、Slack にも1回だけ知らせる（`duplicate: true` を返す）
  - 返り：`{ok: true, friendId, messageId}`。web のアカウントがないと 503
- Harness → FW（担当者の返信）：`dispatchOutboundMessage` の `channel_type === 'web'` で `POST {FLATWORKER_API_BASE_URL}/api/integrations/web-chat/staff-reply`（ヘッダー `X-Flat-Travel-Quote-Token`）
  - body：`{ref, text, harnessMessageId, sentAt, staffName}`（harnessMessageId は messages_log の id）
  - FW が `{ok: true, messageId}` を返したときだけ成功。それ以外・通信の失敗は送信失敗
  - 文字だけ。画像・ファイル・テンプレートは送らない
- お客様への知らせ（メール）は FW が送る。Harness はメールを送らない

## 本番に入れる手順

1. Worker：このブランチを `production/flat-harness-worker` にマージしてから `zsh scripts/deploy-worker-production.sh`（直接の `wrangler deploy` はしない）
2. 管理画面：`scripts/deploy-web-production.sh`（「見積ページ」の表示）
3. 受信箱の行を足す（1回だけ・手で）：`scripts/sql/add-web-chat-account.sql` を本番 D1 で実行し、最後の SELECT で `default_slack_channel` が wa-english-001 と同じことを確かめる
4. FW 側の PR（見積ページのチャット窓と staff-reply の受け口）を本番に入れる。順番は 1〜3 が先。FW が呼ぶまで、この経路は何も起こさない
