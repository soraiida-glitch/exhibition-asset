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
- **Phase 4 — クロージングアドバイス・デイリーアドバイス・RAG基盤**: kintone→Pinecone
  即時/定期同期ワークフロー、案件詳細画面のクロージングアドバイスボタン(類似受注/失注案件の
  ベクトル検索+GPT-4o分析)、デイリーアドバイス日次生成Cron + ポータルカード表示、
  秘書AIエージェントの検索対象拡張
- **Phase 5 — 商談練習(ロールプレイ)**: exhibition_ロールプレイセッションアプリ、
  案件詳細画面の🎭ロールプレイボタン+モーダルUI(顧客ペルソナ生成→会話→フィードバック、
  会話履歴はフロント側で保持し毎ターン全履歴をn8nへ送信するステートレス設計)、
  Whisper音声認識+OpenAI TTS音声合成(1.3倍速再生)によるハンズフリー会話

## セットアップ手順

### 1. 環境変数を設定

```bash
cp .env.example .env
```

`.env` に以下を記入してください:

- `KINTONE_SUBDOMAIN` / `KINTONE_ADMIN_USER` / `KINTONE_ADMIN_PASSWORD`
- `N8N_INSTANCE_URL` / `N8N_API_KEY`
- `OPENAI_API_KEY`(Phase 2の秘書AIエージェントで使用)
- `PINECONE_API_KEY` / `PINECONE_INDEX_NAME` / `PINECONE_HOST`(Phase 4のRAG基盤で使用)

### 2. 依存関係をインストール

```bash
npm install
```

### 3. kintoneアプリを作成

```bash
npm run setup:apps
```

以下の6アプリが作成されます(この順序で作成する必要があります。
`exhibition_案件` の `account` フィールドは `exhibition_取引先` の
`company_name`(一意設定済み)を参照するLOOKUPフィールドのため、
`exhibition_取引先` が先にデプロイ済みである必要があります。既存の`exhibition_案件`に
`closing_advice`/`customer_issue`/`meeting_notes`フィールドが無ければ追加する
マイグレーションも自動実行されます):

| アプリ名 | 用途 |
|---|---|
| exhibition_取引先 | 会社情報マスタ |
| exhibition_リード | 名刺・問い合わせ由来の見込み客 |
| exhibition_案件 | 商談・案件管理(取引先へのLOOKUP付き、closing_advice/customer_issue/meeting_notesフィールドあり) |
| exhibition_秘書AI会話ログ | 秘書AIエージェントの対話履歴(監査・履歴用、UIはポーリングしない) |
| exhibition_デイリーアドバイス | 日次生成される担当者別アドバイス(advice_date+assignee_codeで1日1件) |
| exhibition_ロールプレイセッション | ロールプレイ練習の結果(ペルソナ・会話ログ・スコア・フィードバック) |

実行後、6アプリのApp IDが `app-ids.json` と `.env` の `KINTONE_APP_ID_*` に
自動で書き込まれます。

### 4. 各アプリのAPIトークンを発行(手動)

kintone REST APIにはAPIトークンを発行するエンドポイントがないため、
この手順は手動で行う必要があります。

kintone管理画面 → 各アプリの設定 → APIトークン → 追加(6アプリすべてで実行)

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

### 12. RAG基盤(Pinecone同期)のn8nワークフローをデプロイ

```bash
npm run setup:sync
npm run setup:scheduled-sync
```

- `[kintone] Pineconeシンク`: kintoneのWebhook(レコード追加/更新/削除)を受けて即時に
  OpenAI embeddingsでベクトル化しPineconeへupsert/deleteする。
- `[kintone] Pinecone定期同期`: 5分毎に`updated_time`ベースで取りこぼしを再同期するCron。

続けてkintone側のWebhook設定(**手動、REST APIでは自動化できません**)を確認してください:

```bash
npm run setup:webhooks
```

このコマンドは実際にWebhookを設定するのではなく、必要な設定値(URL・検証トークン)を
表示するだけです(kintoneのWebhook設定REST APIはこの環境では動作が確認できなかったため)。
出力内容をもとに、取引先・案件・リードの3アプリで
kintone管理画面 → 対象アプリの設定 → Webhook → 追加 を行ってください
(イベントは追加・編集・削除すべてにチェック)。

最後に、既存レコードをPineconeへ一括で取り込みます:

```bash
npm run sync:bulk
```

### 13. クロージングアドバイス・デイリーアドバイスのn8nワークフローをデプロイ

```bash
npm run setup:closing-advice
npm run setup:daily-advice
npm run setup:agent
```

- `[kintone] クロージングアドバイス`: 案件詳細画面のボタンから呼び出す。対象案件を
  embedding化し、Pineconeで過去の受注/失注案件(`stage`が成約/失注のみ)を類似検索、
  GPT-4oで受注確度・要因・推奨アクションを生成して`closing_advice`フィールドに書き込む。
- `[kintone] デイリーアドバイス生成`: 毎日7:00(n8nインスタンスのタイムゾーン)に実行される
  Cron。担当中の未成約案件を担当者(`owner`)ごとにグルーピングし、GPT-4o-miniで優先アクションを
  生成、`advice_date + assignee_code`の複合キーで1日1件になるようexhibition_デイリーアドバイスへ
  作成・更新する。
- `npm run setup:agent`の再実行で、秘書AIエージェントの検索対象にexhibition_デイリーアドバイスが
  追加される(「今日やることを教えて」に対応)。

再度チャットUIをビルド・デプロイしてください:

```bash
npm run deploy:customize
```

### 14. ロールプレイ・音声処理のn8nワークフローをデプロイ

```bash
npm run setup:roleplay
npm run setup:audio
```

- `[kintone] ロールプレイ`: 開始/会話/フィードバックの3つのWebhookを1ワークフローに
  まとめて持つ(いずれも`N8N_WEBHOOK_SECRET`で認証)。会話履歴はn8n側で保持せず、
  フロントエンドが毎ターン全履歴を送信するステートレス設計(秘書AIチャットと同じ方式)。
  - 開始: 案件情報(`customer_issue`/`meeting_notes`含む)からGPT-4oで顧客ペルソナと
    冒頭発言を1回のAI呼び出しで同時生成
  - 会話: ペルソナ+全履歴+最新発言からGPT-4o-miniで顧客役としての返答を生成
  - フィードバック: 全履歴をGPT-4oで採点し、exhibition_ロールプレイセッションに保存
- `[kintone] 音声処理`: 音声認識(transcribe)/音声合成(tts)の2つのWebhookを持つ。
  base64音声→n8n Code nodeのバイナリ変換→OpenAI Whisper/TTSへのmultipart送信という、
  本プロジェクトで初めて使うn8nバイナリデータ処理パターン。

### 15. チャットUIをビルド・デプロイ(再実行)

```bash
npm run deploy:customize
```

### 16. 動作確認

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
- 取引先・案件のレコードを作成/更新 → 数秒後にPineconeへ同期されていることを確認
  (`npm run sync:bulk`実行後は既存レコードも検索対象になる)
- 案件詳細画面の「🔍 クロージングアドバイスを生成」ボタン → 受注確度・類似案件を踏まえた
  分析がパネルに表示され、`closing_advice`フィールドにも保存される
- kintoneポータル画面 → 右上に「📌 本日のアドバイス」カードが表示される(デイリーアドバイス
  Cronが実行済みで、ログインユーザーの`assignee_code`に一致するレコードがある場合)
- チャットで「今日やることを教えて」と質問 → デイリーアドバイスの内容が回答に反映される
- 案件詳細画面の「🎭 AIロールプレイ開始」ボタン → モーダルが開き、顧客ペルソナと冒頭発言が
  表示される → テキスト or 🎤音声入力で数ターン会話 → 🔊ONでAIの発言が1.3倍速で音声再生される
  → 「終了してフィードバックをもらう」でスコア・良かった点/改善点が表示され、
  exhibition_ロールプレイセッションにレコードが作成される

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
│   │   ├── n8n-client.ts       # n8n REST APIクライアント
│   │   └── record-to-text.ts   # kintoneレコード→embedding用テキスト変換(唯一の実装、
│   │                           #   n8n Code nodeにはrecordToTextEmbeddable()で安全に埋め込む)
│   ├── apps/schema.ts          # 6アプリのフィールド定義(ドロップダウン選択肢もここが正)
│   ├── workflows/
│   │   ├── agent-workflow.ts             # 秘書AIエージェント(デイリーアドバイス検索含む)
│   │   ├── meishi-workflow.ts             # 名刺解析(GPT-4o Vision+重複チェック)
│   │   ├── contact-form-workflow.ts       # 問い合わせ受信(外部システム想定)
│   │   ├── sync-workflow.ts               # kintone→Pinecone即時Webhook同期
│   │   ├── scheduled-sync-workflow.ts     # kintone→Pinecone 5分毎Cron同期(取りこぼし対策)
│   │   ├── closing-advice-workflow.ts     # クロージングアドバイス(Pinecone類似検索+GPT-4o)
│   │   ├── daily-advice-workflow.ts       # デイリーアドバイス日次生成Cron
│   │   ├── roleplay-workflow.ts           # ロールプレイ 開始/会話/フィードバック(3 Webhook)
│   │   └── audio-workflow.ts              # 音声認識(Whisper)/音声合成(TTS)(2 Webhook)
│   ├── customize/
│   │   ├── chat.ts             # kintoneチャットUI(ブラウザ側、Viteでビルド)
│   │   ├── roleplay.ts         # ロールプレイのモーダルUI・音声入出力(chat.tsからimport)
│   │   └── image-utils.ts      # 画像リサイズの純粋関数(vitestで単体テスト)
│   └── scripts/
│       ├── setup-kintone-apps.ts
│       ├── setup-kintone-webhooks.ts      # Webhook手動設定値の表示(REST APIでは不可)
│       ├── check-n8n-connectivity.ts
│       ├── generate-types.ts
│       ├── deploy-agent-workflow.ts
│       ├── deploy-meishi-workflow.ts
│       ├── deploy-contact-form-workflow.ts
│       ├── deploy-sync-workflow.ts
│       ├── deploy-scheduled-sync-workflow.ts
│       ├── deploy-closing-advice-workflow.ts
│       ├── deploy-daily-advice-workflow.ts
│       ├── deploy-roleplay-workflow.ts
│       ├── deploy-audio-workflow.ts
│       ├── bulk-sync-pinecone.ts          # 既存レコードのPinecone一括バックフィル
│       ├── generate-test-contact-form.ts
│       └── deploy-customize.ts
├── vite.config.ts               # chat.tsのビルド設定(webhook URL等をビルド時に注入)
├── app-ids.json                 # 生成物(gitignore対象)
├── dist/customize/               # 生成物(gitignore対象)
├── dist/test-contact-form.html  # 生成物(gitignore対象、開発用テストフォーム)
└── types/generated/              # 生成物(gitignore対象)
```
