# Accessible Japan ホテル流入計測 — 1回差し替え手順

## 結論

Accessible Japan 側のホテルごとの設定、ホテル一覧の登録、新しい JavaScript は不要です。

現在の「Check Accessible Room Rates」リンクは、ホテルページごとに次のようなURLを自動生成しています。

```text
https://airtable.com/...?...prefill_Hotel+Name=Hilton+Tokyo
```

この既存のホテル名差し込みをそのまま使い、共通CTAテンプレートのリンク先だけを一度変更します。

## Accessible Japan 側の作業

ホテル詳細ページ共通の「Check Accessible Room Rates」CTAで、Airtableのリンク先を次のフォームへ変更します。

```text
https://liffform-studio.pages.dev/public-form?id=9ab583b2-e42e-4ca2-bcb9-13a3c59f5477&prefill_Hotel+Name={{現在使っているホテル名の動的値}}
```

重要なのは、現在の `prefill_Hotel+Name=` より後ろにあるホテル名の動的値を残すことです。テンプレートの構文はAccessible Japanの現在の設定をそのまま使います。

実際に生成されるURLは次の形になります。

```text
https://liffform-studio.pages.dev/public-form?id=9ab583b2-e42e-4ca2-bcb9-13a3c59f5477&prefill_Hotel+Name=Hilton+Tokyo
```

これで全ホテルページが自動的に各ホテル名を渡します。ホテルごとの作業はありません。

## 保存される情報

- 流入元ホテル名
- 判定方法と確度
- そのホテルの何に惹かれたか
- 同じホテル、同エリアの類似ホテル、別エリアの類似ホテルのどこまで提案可能か
- 旅行時期、都市、人数、ホテルグレードなど既存の回答

ホテル名が渡らないページでは推測せず「特定できませんでした」と保存します。

## 本番反映後の受入確認

1. Hilton Tokyo のCTAを押すとフォームに `Hilton Tokyo` が表示される。
2. Park Hotel Tokyo のCTAを押すと `Park Hotel Tokyo` に切り替わる。
3. パラメータなしで開くとホテルは不明のままで、フォーム回答は続けられる。
4. テスト回答の共有レポートとSlack通知に同じホテル名が表示される。

## 完了条件

- Accessible Japan 側の変更は共通CTAテンプレート1か所のみ。
- ホテル個別設定、ホテルマスタ、追加スクリプトは不要。
- 上記3ページの表示確認と、承認済みテスト回答1件の保存・通知確認が完了している。

本番フォームの更新とテスト送信は、オーナー承認後に行います。
