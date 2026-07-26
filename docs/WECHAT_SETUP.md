# WeChat Official Account 連携

Flat Harness は WeChat Official Account の受信 Webhook、友だち登録、1対1チャット、テキスト返信、フォロー用 QR コードに対応します。

加えて、企業微信の「微信客服」を同じアカウントへ接続すると、外部サイトから QR
コードを使わずに相談画面を開けます。相談開始時には、公式アカウントを案内する
メニューボタンを自動送信できます。

## 対応範囲

- 安全モード（AES）での Webhook 検証とメッセージ受信
- テキスト、画像、音声、動画、位置情報、リンク、フォローイベントの取り込み
- Flat Harness の「友だち」「1対1チャット」への反映
- カスタマーサービスメッセージ API によるテキスト返信
- パラメータ付き恒久 QR コードと、顧客へ共有できる公開ページ
- access token の自動取得、D1 キャッシュ、期限切れ時の再取得
- 微信客服のイベント受信、メッセージ同期、Flat Harness からのテキスト返信
- 微信客服の直接相談 URL と、入室時の公式アカウント案内メニュー
- 公式アカウントのフォロー完了時の自動返信

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

## 4. QR を使わない「微信客服」の設定

微信客服は Official Account とは別の会話窓口です。外部サイトから微信客服へ直接
移動し、入室時メニューから Official Account のプロフィールまたは公開記事へ案内する
構成にします。任意の外部 Web ページから Official Account のフォロー確認画面を直接
開く公式 URL はないため、この二段階導線を使用します。

### 4-1. 企業微信側で取得する値

企業微信管理画面で「微信客服」を有効にし、客服アカウントを1つ作成します。その後、
Flat Harness の WeChat アカウントカードで「微信客服を設定」を開き、次を入力します。

| Flat Harness の項目 | 企業微信の項目 |
|---|---|
| CorpID | 企業情報の企業 ID |
| 微信客服 Secret | 微信客服 API の Secret |
| open_kfid | 作成した客服アカウントの ID |
| コールバック Token | 受信イベントサーバーに設定する 3〜32 文字の任意文字列 |
| EncodingAESKey | 受信イベントサーバーで生成する 43 文字の鍵 |
| 公式アカウントのプロフィール／記事 URL | `https://mp.weixin.qq.com/...` の公開 URL |

Secret、Token、EncodingAESKey はチャットやドキュメントへ転記せず、Flat Harness
管理画面へ直接入力してください。

### 4-2. 受信イベントサーバー

企業微信の「微信客服 → API → 受信イベントサーバー」に、アカウントカードに表示される
値を設定します。

```text
URL:
https://line-flattravel.flat-travel.workers.dev/webhook/wechat-kf/<Flat HarnessアカウントID>

Token:
Flat Harness に保存したコールバック Token

EncodingAESKey:
Flat Harness に保存した微信客服用 EncodingAESKey
```

保存後に Flat Harness の「接続確認」を押し、API とコールバックが準備済みになることを
確認します。続いて「直接相談 URL を生成」を押します。

### 4-3. 外部サイトへ設置する URL

サイトの「WeChat で相談」ボタンには次の URL を設定します。

```text
https://line-flattravel.flat-travel.workers.dev/wechat/<Flat HarnessアカウントID>/contact
```

流入元を区別する場合は `ref` を付けます。

```text
https://line-flattravel.flat-travel.workers.dev/wechat/<Flat HarnessアカウントID>/contact?ref=tour-osaka
```

この URL は Flat Harness 側で管理するため、企業微信が発行する URL が更新されても、
Web サイト側のリンクを差し替えずに運用できます。

## 微信客服の運用上の制限

- 微信客服と Official Account は別の会話 ID です。初期版では Flat Harness 上でも
  別の顧客行として表示されます。
- 微信客服からの返信は、顧客の最新メッセージから 48 時間以内、かつ同期間内の送信数
  制限に従います。顧客から新しいメッセージが届くと返信枠が更新されます。
- Official Account をフォローしない顧客とも微信客服内で相談できますが、返信可能期間
  終了後にこちらから再開することはできません。
- 入室時の「关注官方账号」は案内ボタンです。顧客本人によるフォロー操作は必要です。
- サポート提供自体をフォローの有無で制限せず、行程・見積り・重要変更を継続受信する
  理由を明示してフォローを案内します。

## 権限・ネットワークに関する注意

- 恒久 QR の作成可否は Official Account の種別と付与済み API 権限に依存します。権限がない場合は WeChat のエラーコードを管理画面に表示します。
- カスタマーサービスメッセージには WeChat 側の返信可能期間、アカウント種別、認証状態などの制限が適用されます。
- WeChat 側で API caller IP の許可リストが必須になり、Cloudflare Workers の送信元が許可できない場合は、固定送信元 IP を持つ中継を `WECHAT_API_BASE_URL` に設定します。実際の接続確認で IP エラーが出た場合だけ追加します。
- 企業微信側で固定送信元 IP が必要になった場合は、同様に固定 IP 中継を
  `WECOM_API_BASE_URL` に設定します。
