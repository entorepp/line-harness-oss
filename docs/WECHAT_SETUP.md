# WeChat Official Account 連携

Flat Harness は WeChat Official Account の受信 Webhook、友だち登録、1対1チャット、テキスト返信、フォロー用 QR コードに対応します。

## 対応範囲

- 安全モード（AES）での Webhook 検証とメッセージ受信
- テキスト、画像、音声、動画、位置情報、リンク、フォローイベントの取り込み
- Flat Harness の「友だち」「1対1チャット」への反映
- カスタマーサービスメッセージ API によるテキスト返信
- パラメータ付き恒久 QR コードと、顧客へ共有できる公開ページ
- access token の自動取得、D1 キャッシュ、期限切れ時の再取得

画像・音声・動画は現在、受信した MediaID などのメタデータを保存します。バイナリ本体の恒久保存と、Flat Harness からの添付送信は対象外です。

## 1. Flat Harness にアカウントを登録

管理画面の「アカウント設定」で「アカウントを追加」を開き、チャネル種別に `WeChat` を選びます。

| Flat Harness の項目 | WeChat Official Account の項目 |
|---|---|
| アカウント名 | 管理用の任意名称 |
| AppID | Developer ID (AppID) |
| AppSecret | Developer Password (AppSecret) |
| Token | サーバー設定に入力する 3〜32 文字の任意文字列 |
| EncodingAESKey | サーバー設定で生成した 43 文字の鍵 |

AppSecret、Token、EncodingAESKey はチャットやドキュメントに転記せず、Flat Harness の入力画面へ直接登録してください。

## 2. WeChat のサーバー設定

登録後、アカウントカードに表示される「Webhook URL」を WeChat Official Account 管理画面の Server Configuration に入力します。

```text
https://line-flattravel.flat-travel.workers.dev/webhook/wechat/<Flat HarnessアカウントID>
```

- URL: Flat Harness に表示された Webhook URL
- Token: Flat Harness に登録した Token と同じ値
- EncodingAESKey: Flat Harness に登録した値と同じ鍵
- Message Encryption Method: 安全モード

WeChat 側で保存・有効化すると、Flat Harness が署名を検証し、暗号化された challenge を復号して応答します。

## 3. API と QR の確認

1. Flat Harness のアカウントカードで「API接続確認」を押す
2. `接続済み` と token の有効期限が表示されることを確認する
3. 「フォロー用QR生成」を押す
4. 表示された QR をスマートフォンの WeChat で読み取る
5. Official Account をフォローし、テキストを1件送る
6. Flat Harness の「友だち」と「1対1チャット」に反映されることを確認する
7. Flat Harness からテキストを返信し、WeChat で受信できることを確認する

顧客へは、アカウントカードに表示される公開 URL をそのまま共有できます。

```text
https://line-flattravel.flat-travel.workers.dev/wechat/<Flat HarnessアカウントID>
```

## 権限・ネットワークに関する注意

- 恒久 QR の作成可否は Official Account の種別と付与済み API 権限に依存します。権限がない場合は WeChat のエラーコードを管理画面に表示します。
- カスタマーサービスメッセージには WeChat 側の返信可能期間、アカウント種別、認証状態などの制限が適用されます。
- WeChat 側で API caller IP の許可リストが必須になり、Cloudflare Workers の送信元が許可できない場合は、固定送信元 IP を持つ中継を `WECHAT_API_BASE_URL` に設定します。実際の接続確認で IP エラーが出た場合だけ追加します。
