# exhibition-asset

AI活用型顧客管理システム(kintone版)。既存のSalesforce版アセットをkintone上で
再構築するプロジェクトです。詳細は `kintone_crm_requirements.md` を参照してください。

現在の実装範囲: **Phase 1 — 基盤**(exhibition_取引先 / exhibition_案件 / exhibition_リード
の3アプリ作成と、n8n連携の疎通確認)。

## セットアップ手順

### 1. 環境変数を設定

```bash
cp .env.example .env
```

`.env` に以下を記入してください:

- `KINTONE_SUBDOMAIN` / `KINTONE_ADMIN_USER` / `KINTONE_ADMIN_PASSWORD`
- `N8N_INSTANCE_URL` / `N8N_API_KEY`

### 2. 依存関係をインストール

```bash
npm install
```

### 3. kintoneアプリを作成

```bash
npm run setup:apps
```

以下の3アプリが作成されます(この順序で作成する必要があります。
`exhibition_案件` の `account` フィールドは `exhibition_取引先` の
`company_name`(一意設定済み)を参照するLOOKUPフィールドのため、
`exhibition_取引先` が先にデプロイ済みである必要があります):

| アプリ名 | 用途 |
|---|---|
| exhibition_取引先 | 会社情報マスタ |
| exhibition_リード | 名刺・問い合わせ由来の見込み客 |
| exhibition_案件 | 商談・案件管理(取引先へのLOOKUP付き) |

実行後、3アプリのApp IDが `app-ids.json` と `.env` の `KINTONE_APP_ID_*` に
自動で書き込まれます。

### 4. 各アプリのAPIトークンを発行(手動)

kintone REST APIにはAPIトークンを発行するエンドポイントがないため、
この手順は手動で行う必要があります。

kintone管理画面 → 各アプリの設定 → APIトークン → 追加

必要な権限: `レコードの閲覧` `レコードの追加` `レコードの編集`

発行したトークンを `.env` の `KINTONE_API_TOKEN_*` に設定してください
(Phase 2以降のレコードCRUD実装で使用します)。

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

`types/generated/{account,opportunity,lead}.d.ts` に各アプリのフィールド型が
生成されます(フィールドスキーマを変更したら再実行してください)。

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
│   ├── config/env.ts          # .env読み込み・検証
│   ├── lib/
│   │   ├── kintone-client.ts  # kintone REST APIラッパー(@kintone/rest-api-client)
│   │   └── n8n-client.ts      # n8n REST APIクライアント
│   ├── apps/schema.ts         # 3アプリのフィールド定義
│   └── scripts/
│       ├── setup-kintone-apps.ts
│       ├── check-n8n-connectivity.ts
│       └── generate-types.ts
├── app-ids.json                 # 生成物(gitignore対象)
└── types/generated/             # 生成物(gitignore対象)
```
