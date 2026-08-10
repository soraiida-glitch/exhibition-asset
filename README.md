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
- **Phase 6 — 営業担当者評価・提案資料自動作成**: exhibition_商談ログ/exhibition_担当者/
  exhibition_営業評価アプリ、案件詳細画面の🎙️商談録音分析ボタン(Whisper文字起こし+
  GPT-4o要約/センチメント分析)、デイリーアドバイスの完了チェックボックス機能、
  担当者一覧画面の🏆全員スコアリング実行ボタン(実行率はロジックで決定的に算出、
  行動/成果スコアはGPT-4oで算出)、案件詳細画面の📊提案資料生成ボタン
  (GPT-4oが案件内容に応じてPPTXプレースホルダーを動的生成→Box.comへアップロード→
  URLを案件へ書き戻し)
- **Phase 7 — RAG拡張・ダッシュボード・秘書AIエージェント強化**: 秘書AI会話ログアプリを廃止し
  会話ログ・フィードバック学習をSupabaseへ移行(Relavaと同じSupabaseプロジェクトを
  `tenant_id`で分離して再利用)、Tavily Web検索の統合(kintoneに無いリアルタイム情報が
  必要な質問を自動判定)、社内マニュアル(経費規程・営業マニュアル・自社サービス説明資料等)を
  Pineconeの専用namespaceに取り込むRAG基盤、案件一覧/リード一覧のグラフ付きダッシュボードと
  スペースポータルの統合KPI・ランキングカード、案件詳細画面のレコードサマリーカード、
  営業評価のランキング表示化(メダル表示+自動読み込み)、秘書AIチャットから直接
  提案資料生成を実行できる`generate_proposal`アクション、デイリーアドバイス未生成時に
  本人の未クローズ案件からその場で提案するフォールバック(チャット・ホームカード双方)

## セットアップ手順

### 1. 環境変数を設定

```bash
cp .env.example .env
```

`.env` に以下を記入してください:

- `KINTONE_SUBDOMAIN` / `KINTONE_ADMIN_USER` / `KINTONE_ADMIN_PASSWORD`
- `N8N_INSTANCE_URL` / `N8N_API_KEY`
- `OPENAI_API_KEY`(Phase 2の秘書AIエージェントで使用)
- `PINECONE_API_KEY` / `PINECONE_INDEX_NAME` / `PINECONE_HOST`(Phase 4のRAG基盤で使用。
  Phase 7の社内マニュアルRAGも同じPineconeインデックスの別namespace
  `exhibition-manuals`を使うため追加設定は不要)
- `BOX_CLIENT_ID` / `BOX_CLIENT_SECRET` / `BOX_ENTERPRISE_ID` / `BOX_FOLDER_ID`
  (Phase 6の提案資料自動作成で使用。既存のBoxアプリを他プロジェクトと共用している場合、
  `BOX_FOLDER_ID`だけこのプロジェクト専用のフォルダIDにしてください)
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`(Phase 7の会話ログ・フィードバック学習で使用。
  Relavaと同じSupabaseプロジェクトを再利用する想定)
- `TAVILY_API_KEY`(Phase 7のWeb検索で使用。Relavaと同じキーを再利用する想定)

### 2. 依存関係をインストール

```bash
npm install
```

### 3. kintoneアプリを作成

```bash
npm run setup:apps
```

以下の8アプリが作成されます(この順序で作成する必要があります。
`exhibition_案件` の `account` フィールドは `exhibition_取引先` の
`company_name`(一意設定済み)を参照するLOOKUPフィールドのため、
`exhibition_取引先` が先にデプロイ済みである必要があります。既存の`exhibition_案件`に
`closing_advice`/`customer_issue`/`meeting_notes`/`proposal_url`/`proposal_status`/
`proposal_generated_at`フィールドが無ければ追加するマイグレーションも自動実行されます):

| アプリ名 | 用途 |
|---|---|
| exhibition_取引先 | 会社情報マスタ |
| exhibition_リード | 名刺・問い合わせ由来の見込み客 |
| exhibition_案件 | 商談・案件管理(取引先へのLOOKUP付き、提案書URL等のフィールドあり) |
| exhibition_デイリーアドバイス | 日次生成される担当者別アドバイス(advice_date+assignee_codeで1日1件) |
| exhibition_ロールプレイセッション | ロールプレイ練習の結果(ペルソナ・会話ログ・スコア・フィードバック) |
| exhibition_商談ログ | 商談録音の文字起こし・要約・センチメント分析結果 |
| exhibition_担当者 | 営業評価のスコアリング対象となる担当者マスタ(手動でレコード登録) |
| exhibition_営業評価 | 担当者ごとの実行率・行動スコア・成果スコア・AIコメント |

> Phase 7でexhibition_秘書AI会話ログアプリは削除しました(kintone REST APIにアプリ削除
> エンドポイントが無いため手動削除)。会話ログ・フィードバック学習はSupabaseへ移行しています。

実行後、8アプリのApp IDが `app-ids.json` と `.env` の `KINTONE_APP_ID_*` に
自動で書き込まれます。

### 4. 各アプリのAPIトークンを発行(手動)

kintone REST APIにはAPIトークンを発行するエンドポイントがないため、
この手順は手動で行う必要があります。

kintone管理画面 → 各アプリの設定 → APIトークン → 追加(8アプリすべてで実行)

`exhibition_担当者`には、スコアリング対象にしたい担当者(担当者コード・担当者名)を
手動でレコード登録してください(専用の登録フォームはありません)。

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

`types/generated/{account,opportunity,lead}.d.ts` に各アプリの
フィールド型が生成されます(フィールドスキーマを変更したら再実行してください)。

### 7. 秘書AIエージェントのn8nワークフローをデプロイ

```bash
npm run setup:agent
```

`[kintone] 秘書AIエージェント` ワークフローを作成・有効化します。`N8N_WEBHOOK_SECRET`
(未設定なら自動生成)と `N8N_KINTONE_AGENT_WEBHOOK_URL` が `.env` に書き込まれます。

n8n側の処理: Webhookシークレット検証 → GPT-4o-miniで検索キーワード(複数可)抽出+
Web検索要否判定 → 取引先/案件/リード/デイリーアドバイス/営業評価の5アプリをkintone REST
APIで検索(担当者別の案件件数・フェーズ別件数も集計) → 過去の訂正フィードバック
(Supabase)・社内マニュアル(Pinecone、`exhibition-manuals`namespace)・必要な場合はTavily
Web検索の結果を収集 → GPT-4oで回答生成(検索/新規登録/既存編集フォーム/提案資料生成の
判定を含む)→ Supabaseに会話ログを記録 → 応答。会話ログ・フィードバック学習の詳細は
「12. RAG基盤」の後にあるPhase 7の節を参照。

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

### 16. 商談ログ・営業評価・提案資料生成のn8nワークフローをデプロイ

```bash
npm run setup:meeting-log
npm run setup:sales-scoring
npm run setup:proposal
```

- `[kintone] 商談ログ分析`: 案件詳細画面から録音ファイルをkintoneのファイルアップロードAPIへ
  直接アップロード→exhibition_商談ログにstatus処理中でレコード作成→この
  Webhookを呼び出す(軽量ペイロード。Webhookは即座に`{started:true}`を返し、
  実際の処理はバックグラウンドで継続する設計)。ファイルは一度レコードに添付されると
  アップロード時のfileKeyが失効するため、レコードを再取得して新しいfileKeyで
  ダウンロードする(kintoneの既知の挙動)。Whisperで文字起こし→GPT-4oで要約/
  ネクストアクション/センチメント/キーワード/トピックを抽出→レコード更新。
- `[kintone] 営業評価`: `exhibition_担当者`(status=有効)を全件取得し、n8nの
  アイテム単位実行で担当者ごとに並行処理(Salesforce版の「@futureコールアウト50件上限」
  のような制約はなく、1回の実行で全員をスコアリングできる)。実行率は
  デイリーアドバイスの`executed`フラグと経過日数から決定的に算出、行動/成果スコアと
  コメントはGPT-4oで生成。`assignee_code`+`period_start`+`period_end`で
  upsert。こちらもWebhookは即座に応答し、バックグラウンドで処理を継続する。
- `[kintone] 提案資料生成`: 案件情報(顧客の課題・商談メモ・関連する商談ログ含む)をもとに、
  GPT-4oがPPTXテンプレート(`templates/proposal_template.pptx`、9スライド)の
  プレースホルダーを案件ごとに動的生成(見積り金額の内訳・スケジュール日程などの
  機械的な値のみCode nodeで決定的に計算し、AIには各フィールドの文字数上限を守らせつつ
  課題・機能・KPIなど文章面のみ生成させる)。`src/lib/pptx-template.ts`がテンプレートのZIPを
  解析し、純JS ZIP/CRC32ロジックを含むn8n Code node用ソースをデプロイ時に自動生成する。
  生成後Box.comへアップロードし、共有リンクを`exhibition_案件.proposal_url`へ書き戻す。
  ファイル名には生成時刻(秒単位)を含めており、同一顧客・同日に複数回生成してもBox上で
  ファイル名が衝突しない(Phase 7で修正。以前は同名衝突時に古いファイルのリンクを
  返し続けるバグがあった)。テンプレート自体もPhase 7でブランドカラー(#0098BB)+グレーのみに
  統一し、黒系のハード枠線・装飾用の図形を排除、表紙にNovagridロゴを実データとして
  埋め込んでいる。

### 17. チャットUIをビルド・デプロイ(再実行)

```bash
npm run deploy:customize
```

`exhibition_取引先`/`exhibition_案件`/`exhibition_リード`/`exhibition_担当者`の
4アプリに反映されます。

### 18. RAG拡張・ダッシュボード・秘書AIエージェント強化(Phase 7)をデプロイ

`.env`に`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`TAVILY_API_KEY`を設定したうえで、
秘書AIエージェントを再デプロイしてください:

```bash
npm run setup:agent
```

会話ログ・フィードバック学習用のSupabaseテーブル(`answer_log`/`feedback_embeddings`)は
Relavaプロジェクトと共有しているため、この段階で新規に作成する必要はありません
(`tenant_id = 'exhibition-asset'`で他プロジェクトのデータと分離されます)。

社内マニュアル(経費精算規程・出張旅費規程・自社サービス説明資料など)をRAGとして取り込む場合は、
まず対象文書のテキストファイルを`scripts/_manuals/*.txt`に用意し(このディレクトリは
gitignore対象。1ファイル=1文書)、以下を実行してください:

```bash
npm run sync:manuals
```

Pineconeの`exhibition-manuals`namespace(既存の`exhibition-kintone`とは分離)に
チャンク分割してembedding・upsertされます。ドキュメントを更新したら再実行してください。

案件一覧・リード一覧のグラフ付きダッシュボード、案件詳細画面のレコードサマリーカード、
スペースポータルの統合KPI・ランキングカードは、いずれも`src/customize/`内の追加モジュール
(`pipeline-dashboard.ts`/`lead-insights.ts`/`record-summary.ts`/`space-dashboard.ts`/
`viz.ts`)として`chat.ts`にまとめてビルドされるため、追加のデプロイ手順は不要です
(手順17で反映済み)。営業評価のランキング表示化(`sales-scoring.ts`)も同様です。

### 19. デイリーアドバイスカードをスペースに表示する(手動設定)

kintoneの「ポータル」「スペース」向けJavaScriptカスタマイズには**個別アプリ向けとは別の
専用REST APIが存在せず、手動設定のみ**です(kintone管理画面 → kintoneシステム管理 →
「JavaScript / CSSでカスタマイズ」→「kintone全体のカスタマイズ」— この1つの設定が
ポータル・スペース双方に適用されます)。

1. `dist/customize/chat.js`(手順17でビルド済み)をデスクトップ用・モバイル用の
   JavaScriptファイルとして追加(既存の他のカスタマイズJSがあれば、削除せずそのまま
   追加してください。複数ファイルが共存できます)
2. 保存

`chat.ts`内の`space.portal.show`/`mobile.space.portal.show`イベントハンドラは、
`EXHIBITION_SPACE_ID`定数(現在`'2'`)に一致するスペースでのみ「📌 本日のアドバイス」
カードとダッシュボード(手順18)を表示します(kintoneには「このスペースだけにJSを適用する」
機能が無いため、JS側でスペースIDを判定する疑似的な限定表示)。別のスペースに変更したい場合は
`src/customize/chat.ts`の`EXHIBITION_SPACE_ID`を書き換えて再デプロイしてください。

### 20. 動作確認

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
- 対象スペース(手順19の`EXHIBITION_SPACE_ID`)を開く → 「📌 本日のアドバイス」カードと
  ダッシュボード(パイプライン金額・営業ランキングTOP3等)が表示される。デイリーアドバイス
  Cronが未実行(その日まだ生成されていない)場合でも、ログインユーザー本人の未クローズ案件
  からその場で提案するフォールバックが表示される(正式なアドバイスとは明示される)。
  各アクションのチェックボックスをクリック → 取り消し線表示になり`advice_json`の
  `executed`が更新される
- チャットで「今日やることを教えて」と質問 → デイリーアドバイスの内容(未生成の場合は
  同じフォールバック)が回答に反映される
- チャットで「一番評価の高い社員は?」「担当者ごとの案件配分は?」のように質問 →
  営業評価・案件データを集計して回答(サンプル件数ではなく実際の合計件数・集計を使用)
- チャットで「経費申請の流れは?」「自社のAI CRM Agentについて教えて」のように質問 →
  Pineconeに取り込んだ社内マニュアルを根拠(資料名付き)に回答
- チャットで「今日のドル円レートは?」のようにkintoneに無い情報を質問 → Tavily経由の
  Web検索結果を踏まえて回答
- チャットで「(取引先名)の(案件名)のスライドを作成して」と依頼 → 対象案件を1件だけ
  確信を持って特定できた場合、ボタンを押さずに提案資料生成が実行される
  (`generate_proposal`アクション。複数件ヒットする場合は確認の質問が返る)
- 案件一覧・リード一覧を開く → 画面上部にフェーズ別/流入経路別のグラフが表示される
- 案件詳細画面を開く → レコードサマリーカード(取引先・金額・フェーズ・クロージング予定・
  担当者)が表示される
- 案件詳細画面の「🎭 AIロールプレイ開始」ボタン → モーダルが開き、顧客ペルソナと冒頭発言が
  表示される → テキスト or 🎤音声入力で数ターン会話 → 🔊ONでAIの発言が1.3倍速で音声再生される
  → 「終了してフィードバックをもらう」でスコア・良かった点/改善点が表示され、
  exhibition_ロールプレイセッションにレコードが作成される
- 案件詳細画面の「🎙️ 商談録音を分析」ボタン → 音声ファイルをアップロード → 文字起こし・
  要約・ネクストアクション・センチメント・キーワードが表示され、exhibition_商談ログに
  レコードが作成される
- exhibition_担当者アプリの一覧画面の「🏆 全員スコアリング実行」ボタン → 期間を指定して
  実行 → exhibition_営業評価に担当者ごとのランク・スコア・AIコメントが作成される
- 案件詳細画面の「📊 提案資料を生成」ボタン → 案件情報(顧客の課題・商談メモ含む)に
  即した内容でPPTXが生成され、「Boxで開く」リンクが表示される。
  `exhibition_案件.proposal_url`にも同じURLが書き込まれる

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
│   │   ├── record-to-text.ts   # kintoneレコード→embedding用テキスト変換(唯一の実装、
│   │   │                       #   n8n Code nodeにはrecordToTextEmbeddable()で安全に埋め込む)
│   │   └── pptx-template.ts    # .pptxテンプレートのZIP解析→n8n Code node用ソース生成
│   ├── apps/schema.ts          # 8アプリのフィールド定義(ドロップダウン選択肢もここが正)
│   ├── workflows/
│   │   ├── agent-workflow.ts             # 秘書AIエージェント(デイリーアドバイス検索含む)
│   │   ├── meishi-workflow.ts             # 名刺解析(GPT-4o Vision+重複チェック)
│   │   ├── contact-form-workflow.ts       # 問い合わせ受信(外部システム想定)
│   │   ├── sync-workflow.ts               # kintone→Pinecone即時Webhook同期
│   │   ├── scheduled-sync-workflow.ts     # kintone→Pinecone 5分毎Cron同期(取りこぼし対策)
│   │   ├── closing-advice-workflow.ts     # クロージングアドバイス(Pinecone類似検索+GPT-4o)
│   │   ├── daily-advice-workflow.ts       # デイリーアドバイス日次生成Cron
│   │   ├── roleplay-workflow.ts           # ロールプレイ 開始/会話/フィードバック(3 Webhook)
│   │   ├── audio-workflow.ts              # 音声認識(Whisper)/音声合成(TTS)(2 Webhook)
│   │   ├── meeting-log-workflow.ts        # 商談ログ分析(Whisper+GPT-4o、非同期応答)
│   │   ├── sales-scoring-workflow.ts      # 営業評価(実行率は決定的算出+GPT-4oスコア)
│   │   └── proposal-workflow.ts           # 提案資料生成(GPT-4o+PPTX構築+Boxアップロード)
│   ├── customize/
│   │   ├── chat.ts             # kintoneチャットUI(ブラウザ側、Viteでビルド)
│   │   ├── roleplay.ts         # ロールプレイのモーダルUI・音声入出力(chat.tsからimport)
│   │   ├── meeting-log.ts      # 商談録音アップロード・分析結果表示(chat.tsからimport)
│   │   ├── sales-scoring.ts    # 営業評価ランキング表示・全員スコアリング実行ボタン
│   │   ├── proposal.ts         # 提案資料生成ボタン(chat.tsからimport)
│   │   ├── record-summary.ts   # 案件詳細画面のレコードサマリーカード(chat.tsからimport)
│   │   ├── pipeline-dashboard.ts  # 案件一覧のパイプライン可視化(chat.tsからimport)
│   │   ├── lead-insights.ts       # リード一覧のファネル・流入経路可視化(chat.tsからimport)
│   │   ├── space-dashboard.ts     # スペースポータルの統合KPI・ランキングカード
│   │   ├── viz.ts              # KPIカード・横棒/ドーナツ/ファネル等の共通描画ヘルパー
│   │   ├── theme.ts            # ブランドカラー等の共通THEMEトークン
│   │   ├── kintone-theme.css   # kintone一覧/詳細画面の見た目調整(per-appカスタマイズCSS)
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
│       ├── deploy-meeting-log-workflow.ts
│       ├── deploy-sales-scoring-workflow.ts
│       ├── deploy-proposal-workflow.ts
│       ├── bulk-sync-pinecone.ts          # 既存レコードのPinecone一括バックフィル
│       ├── sync-manuals-pinecone.ts       # 社内マニュアル(scripts/_manuals/*.txt)のRAG取り込み
│       ├── generate-test-contact-form.ts
│       └── deploy-customize.ts
├── templates/proposal_template.pptx  # 提案資料の元テンプレート(9スライド、{{TOKEN}}形式、
│                                      #   ブランドカラー統一・ロゴ埋め込み済み)
├── vite.config.ts               # chat.tsのビルド設定(webhook URL等をビルド時に注入)
├── app-ids.json                 # 生成物(gitignore対象)
├── dist/customize/               # 生成物(gitignore対象)
├── dist/test-contact-form.html  # 生成物(gitignore対象、開発用テストフォーム)
└── types/generated/              # 生成物(gitignore対象)
```
