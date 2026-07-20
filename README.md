# exhibition-asset

AI活用型顧客管理システム(kintone版)。既存のSalesforce版アセットをkintone上で
再構築するプロジェクトです。詳細は `kintone_crm_requirements.md` を参照してください。

現在の実装範囲:
- **Phase 1 — 基盤**: exhibition_取引先 / exhibition_案件 / exhibition_リードの3アプリ作成と、
  n8n連携の疎通確認
- **Phase 2 — 秘書AIエージェント(MVP)**: exhibition_秘書AI会話ログアプリ、n8n上のAIエージェント
  ワークフロー、kintoneチャットUI(取引先・案件の検索/登録/編集フォーム)
- **Phase 3 — 名刺画像登録・問い合わせフォームCRM取込**: チャットUIへの📷名刺アップロード・
  リード登録フォーム追加、GPT-4o Visionによる名刺解析+重複チェックのn8nワークフロー、
  外部フォーム想定の問い合わせ受信n8nワークフロー(+動作確認用テストHTMLフォーム)

## セットアップ手順

### 1. 環境変数を設定

```bash
cp .env.example .env
```

`.env` に以下を記入してください:

- `KINTONE_SUBDOMAIN` / `KINTONE_ADMIN_USER` / `KINTONE_ADMIN_PASSWORD`
- `N8N_INSTANCE_URL` / `N8N_API_KEY`
- `OPENAI_API_KEY`(Phase 2の秘書AIエージェントで使用)

### 2. 依存関係をインストール

```bash
npm install
```

### 3. kintoneアプリを作成

```bash
npm run setup:apps
```

以下の4アプリが作成されます(この順序で作成する必要があります。
`exhibition_案件` の `account` フィールドは `exhibition_取引先` の
`company_name`(一意設定済み)を参照するLOOKUPフィールドのため、
`exhibition_取引先` が先にデプロイ済みである必要があります):

| アプリ名 | 用途 |
|---|---|
| exhibition_取引先 | 会社情報マスタ |
| exhibition_リード | 名刺・問い合わせ由来の見込み客 |
| exhibition_案件 | 商談・案件管理(取引先へのLOOKUP付き) |
| exhibition_秘書AI会話ログ | 秘書AIエージェントの対話履歴(監査・履歴用、UIはポーリングしない) |

実行後、4アプリのApp IDが `app-ids.json` と `.env` の `KINTONE_APP_ID_*` に
自動で書き込まれます。

### 4. 各アプリのAPIトークンを発行(手動)

kintone REST APIにはAPIトークンを発行するエンドポイントがないため、
この手順は手動で行う必要があります。

kintone管理画面 → 各アプリの設定 → APIトークン → 追加(4アプリすべてで実行)

必要な権限: `レコードの閲覧` `レコードの追加` `レコードの編集`

発行したトークンを `.env` の `KINTONE_API_TOKEN_*` に設定してください。

### 5. n8n連携の疎通確認

```bash
npm run check:n8n
```

`[kintone] 疎通確認` という名前のワークフローをn8nに作成・有効化し、
そのWebhookにテストリクエストを送って応答内容(nonce)が一致することを
確認します。`OK: n8n round-trip confirmed (nonce matched).` と表示されれば成功です。

### 6. kintoneフィールド型定義を生成

```bash
npm run gen:types
```

`types/generated/{account,opportunity,lead,conversation-log}.d.ts` に各アプリの
フィールド型が生成されます(フィールドスキーマを変更したら再実行してください)。

### 7. 秘書AIエージェントのn8nワークフローをデプロイ

```bash
npm run setup:agent
```

`[kintone] 秘書AIエージェント` ワークフローを作成・有効化します。`N8N_WEBHOOK_SECRET`
(未設定なら自動生成)と `N8N_KINTONE_AGENT_WEBHOOK_URL` が `.env` に書き込まれます。

n8n側の処理: Webhookシークレット検証 → GPT-4o-miniで検索キーワード抽出 →
取引先/案件/リードの3アプリをkintone REST APIで検索 → GPT-4oで回答生成(検索/新規登録/
既存編集フォームの判定を含む)→ exhibition_秘書AI会話ログに記録 → 応答。

### 8. チャットUIをビルド・デプロイ

```bash
npm run deploy:customize
```

`src/customize/chat.ts` をViteでビルドし、取引先・案件・リードの3アプリの
JavaScriptカスタマイズとして自動デプロイします(`npm run build:customize` だけを
単独実行してビルドのみ行うことも可能)。

### 9. 名刺解析・問い合わせ受信のn8nワークフローをデプロイ

```bash
npm run setup:meishi
npm run setup:contact-form
```

- `[kintone] 名刺解析`: 名刺画像(base64)を受け取り、GPT-4o Visionで
  氏名/会社名/電話番号/メールアドレス/メモを抽出。exhibition_リードに会社名+氏名の
  完全一致で重複チェックしたうえで結果を返す(秘書AIエージェントと同じ`N8N_WEBHOOK_SECRET`で認証)。
- `[kintone] 問い合わせ受信`: 外部の非kintoneシステムからの問い合わせをリードとして
  登録するWebhook。専用の`N8N_CONTACT_FORM_SECRET`(未設定なら自動生成)で認証し、
  `lead_name`必須チェック・重複チェックのうえでexhibition_リードに直接レコードを作成する
  (n8n側からの書き込み — ブラウザセッションがない外部フローのため)。
  重複が見つかっても登録はブロックせず、応答に`isDuplicate`/`duplicateRecordId`を含める。

`npm run setup:apps`実行時に自動生成される`app-ids.json`同様、Webhook URL・シークレットは
`.env`の`N8N_MEISHI_WEBHOOK_URL` / `N8N_CONTACT_FORM_SECRET` / `N8N_CONTACT_FORM_WEBHOOK_URL`
に自動で書き込まれます。

### 10. チャットUIをビルド・デプロイ(再実行)

`N8N_MEISHI_WEBHOOK_URL`が設定された状態で、手順8のビルド・デプロイを再実行してください:

```bash
npm run deploy:customize
```

### 11. 動作確認用の問い合わせフォームを生成

```bash
npm run gen:test-form
```

`dist/test-contact-form.html`(gitignore対象、シークレットが埋め込まれるためコミットしない)
が生成されます。ブラウザで直接開いて送信すると、`[kintone] 問い合わせ受信`経由で
exhibition_リードにレコードが作成されます。**本番の外部フォームではなく、開発用の
動作確認ページです。**

### 12. 動作確認

kintoneの取引先・案件・リードいずれかの画面を開くと右下に💬ボタンが表示されます。

- 「テック商事の案件を教えて」のように質問 → kintoneを検索して回答
- 「📋 取引先登録」「💼 案件登録」「🧑 リード登録」チップをクリック → 直接登録フォームが開く
  (業種・ステータス・フェーズ・流入経路はプルダウン選択)
- チャットで「新しい取引先を登録したい。会社名は...」のように依頼 → AIが内容を聞き取って
  同じフォームを表示
- 既存レコードを検索してヒットした後に「〜を編集して」と依頼 → 既存値がプリフィルされた
  編集フォームが表示
- footerの📷ボタンから名刺画像をアップロード → 解析結果がプリフィルされたリード登録フォームが
  表示(会社名+氏名が一致する既存リードがあれば警告バブルも表示)
- `dist/test-contact-form.html`から送信 → exhibition_リードにレコードが作成される

## その他のコマンド

```bash
npm run typecheck   # tsc --noEmit
npm run test        # vitest
npm run lint        # eslint
```

## ディレクトリ構成

```
exhibition-asset/
├── src/
│   ├── config/env.ts           # .env読み込み・検証
│   ├── lib/
│   │   ├── kintone-client.ts   # kintone REST APIラッパー(@kintone/rest-api-client)
│   │   └── n8n-client.ts       # n8n REST APIクライアント
│   ├── apps/schema.ts          # 4アプリのフィールド定義(ドロップダウン選択肢もここが正)
│   ├── workflows/
│   │   ├── agent-workflow.ts       # 秘書AIエージェントのn8nノード/コネクション定義
│   │   ├── meishi-workflow.ts       # 名刺解析(GPT-4o Vision+重複チェック)
│   │   └── contact-form-workflow.ts # 問い合わせ受信(外部システム想定)
│   ├── customize/
│   │   ├── chat.ts             # kintoneチャットUI(ブラウザ側、Viteでビルド)
│   │   └── image-utils.ts      # 画像リサイズの純粋関数(vitestで単体テスト)
│   └── scripts/
│       ├── setup-kintone-apps.ts
│       ├── check-n8n-connectivity.ts
│       ├── generate-types.ts
│       ├── deploy-agent-workflow.ts
│       ├── deploy-meishi-workflow.ts
│       ├── deploy-contact-form-workflow.ts
│       ├── generate-test-contact-form.ts
│       └── deploy-customize.ts
├── vite.config.ts               # chat.tsのビルド設定(webhook URL等をビルド時に注入)
├── app-ids.json                 # 生成物(gitignore対象)
├── dist/customize/               # 生成物(gitignore対象)
├── dist/test-contact-form.html  # 生成物(gitignore対象、開発用テストフォーム)
└── types/generated/              # 生成物(gitignore対象)
```
