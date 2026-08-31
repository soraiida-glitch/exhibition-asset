# Relva BI 要件定義書（Claude Code 開発指示 / SPEC）

- 対象リポジトリ: `soraiida-glitch/exhibition-asset`
- スタック: バニラ TypeScript + Vite + vitest / kintone カスタマイズ（全体カスタマイズJS）/ n8n / Supabase / OpenAI(現行 GPT-4o)
- 本書のスコープ: **全体アーキテクチャを定義し、v1 を実装詳細まで確定する**
- 大原則（最重要）: 本書と実装がズレたら方向性全体がズレる。曖昧な箇所は実装前に必ず「未決事項」節で確認すること。推測でフィールドや指標を新設しない。

---

## 0. 北極星（この機能が実現する体験）

「見るBI」ではなく **「聞く・気づくBI」**。ユーザーが自然言語で問うと、**結論の一文＋最小限のグラフ＋次アクション**が返る。グラフは主役ではなく答えの根拠。競合（GENIEE＝ダッシュボードを"作る" / Translead＝レコードを"見る"）が到達していない相互作用を、kintone の価格帯で提供する。

### Non-Goals（v1でやらないこと）
- 自由な text-to-SQL（未定義の指標をAIが勝手に生成すること）は行わない。**必ず定義済みテンプレートへの写像に限定**。
- フェーズ間の通過率（遷移履歴が存在しないため）。
- リード↔案件を跨いだクロス分析（現状リードは案件に紐づかない）。
- 着地予測（v2）。

---

## 1. 全体アーキテクチャ

4層に分離する。**層をまたいだ責務の混在を禁止**する。

| 層 | 役割 | 実装場所 |
|---|---|---|
| データ / ホスト | 記録の源泉。カスタマイズJSの実行ホスト | kintone（案件/取引先/リード ほか） |
| 意味レイヤー / 集計 | 指標・切り口・絞り込みの定義と集計実行 | v1: n8n + kintone REST / v1.5以降: Supabase |
| LLM（写像 + ナラティブ） | NL→テンプレ写像、解釈文・Navi示唆・次アクション生成 | n8n（agent-workflow） |
| 描画 / UI | 構造化データを受け取りグラフ描画 | フロント（ECharts コンポーネント） |

### 絶対ルール（データフローの不変条件）
1. **LLM は数値を計算しない。** 集計は意味レイヤー（n8n/Supabase）が行い、確定値を返す。LLM が生成してよいのは「解釈文・ナラティブ・次アクション候補」のみ。
2. **LLM/n8n が返すのは「テンプレID + パラメータ + 構造化データ（系列）」。** HTML や画像を LLM に生成させない。描画はフロントの ECharts コンポーネントが担う。
3. **グラフ種別はテンプレートごとに固定**（データ形状で機械的に決まる）。AI にグラフ種別を選ばせない。
4. LLM プロバイダは抽象化し差し替え可能にする。v1 の既定は現行 GPT-4o。（OpenAI/Anthropic のバイクオフは別途、本実装をブロックしない）

### データフロー（会話型）
```
ユーザーの問い（チャット）
  → ルーター(LLM): {template_id, metric, dimension(s), filters} を出力（写像のみ）
  → 集計層: 意味レイヤー定義に従い kintone REST を集計 → 確定系列を生成
  → 構造化コントラクト(JSON)を組み立て（解釈文・narrative・actions を付与）
  → フロント: template_id に対応する ECharts コンポーネントで描画 + Navi文 + ドリル
  → answer_log(Supabase) に記録
```

---

## 2. データモデルと**スキーマ変更**（v1で実施）

既存フィールド（`src/apps/schema.ts` 実物より）。

- **案件(exhibition_案件)**: `deal_name` / `account`(取引先LOOKUP) / `amount`(金額,NUMBER) / `stage`(フェーズ DROP_DOWN: 初期接触・ヒアリング・提案中・見積提出・交渉中・成約・失注) / `close_date`(DATE) / `owner`(担当者) / `description` ほか
- **取引先(exhibition_取引先)**: `company_name`(unique) / `industry`(業種 DROP_DOWN: IT・ソフトウェア/製造/小売・流通/金融・保険/医療・ヘルスケア/建設・不動産/サービス/その他) / `status`(見込み/取引中/休眠) ほか
- **リード(exhibition_リード)**: `source`(流入経路: 名刺/問い合わせフォーム/紹介/その他) / `status`(未対応/対応中/変換済み/対象外) ほか

### 変更①: 案件に「失注理由」フィールドを追加（必須・v1）
- code: `loss_reason` / label: `失注理由` / type: `DROP_DOWN`
- options（**要確認**、暫定）: `価格` / `競合` / `タイミング` / `予算凍結` / `ニーズ不一致` / `その他`
- 運用: `stage = 失注` のときのみ意味を持つ。集計時は `stage=失注` で絞ってから `loss_reason` で集計する。

### 変更②: 案件に「業種」をコピー（必須・v1）
- 目的: 業種別集計を**アプリ間結合なしの単一アプリ集計**で可能にする。
- 実装: 既存の `account`(LOOKUP) に **fieldMappings** を追加し、取引先の `industry` を案件側フィールドへコピーする。
  - 追加フィールド: code `industry` / label `業種` / type `SINGLE_LINE_TEXT`
  - LOOKUP設定: `fieldMappings: [{ field: 'industry', relatedField: 'industry' }]`
- **既存レコードの backfill が必要**（LOOKUP は取得時にコピーするため、既存案件には値が入らない）。backfill スクリプトを `src/scripts/` に追加すること。

> `src/apps/schema.ts` を上記に合わせて更新し、`setup:apps` / `gen:types` を通す。DROP_DOWN の値は `schema.ts` の options 定数を単一の真実源とし、ルーターのプロンプトからも同じ定数を参照する（値ズレ = kintone拒否 を防ぐ）。

---

## 3. 意味レイヤー（v1）

すべての指標・切り口は**案件アプリ単体**（またはリード単体）で解決できるよう、上記スキーマ変更で担保する。

### 指標（metric）
| code | ラベル | 定義 | 単位 |
|---|---|---|---|
| `count` | 件数 | レコード件数 | 件 |
| `amount_sum` | 金額合計 | Σ `amount` | 円 |
| `amount_avg` | 平均金額 | avg `amount` | 円 |
| `won_amount` | 受注額 | Σ `amount` where `stage=成約` | 円 |
| `won_count` | 受注件数 | count where `stage=成約` | 件 |
| `lost_count` | 失注件数 | count where `stage=失注` | 件 |
| `win_rate` | 受注率 | `won_count / (won_count + lost_count)` | % |

> 「活動量」は現状クリーンなデータ源が無いため v1 は対象外（未決事項）。

### 切り口（dimension）
| code | ラベル | 参照フィールド | 対象アプリ |
|---|---|---|---|
| `owner` | 担当者 | `owner` | 案件 |
| `stage` | フェーズ | `stage` | 案件 |
| `industry` | 業種 | `industry`(コピー) | 案件 |
| `loss_reason` | 失注理由 | `loss_reason` | 案件（`stage=失注`前提） |
| `account` | 取引先 | `account`/`company_name` | 案件 |
| `lead_source` | 流入経路 | `source` | リード |
| `lead_status` | リードステータス | `status` | リード |

### 絞り込み（filter）
`期間`(基準=`close_date`) / `stage` / `industry` / `owner` / `loss_reason` / `account.status`

### 定義の確定事項
- **「受注」= `stage=成約`**。**「受注月」= `close_date` の月**。`close_date` が空のレコードは期間ベース集計から除外する。
- `win_rate` の分母は「クローズ済み（成約 + 失注）」。進行中案件は分母に含めない。
- 期間の既定は「今期」。会計期の定義は環境変数化（**未決事項**: 会計期の開始月）。

---

## 4. テンプレート定義（v1）

v1 実装対象: **T1・T2・T4・T5・T8**。各テンプレのグラフ種別は固定。ルーターは問いをこのいずれかに写像する。

| ID | テンプレ | パラメータ | グラフ(固定) | コンポーネント |
|---|---|---|---|---|
| T1 | 単一KPI（+対比） | metric, filter, (対比) | KPIカード(数値) | `KpiCard`(HTML) |
| T2 | カテゴリ別集計【主力】 | metric, dimension, filter | 横棒 / ドーナツ | `BarH` / `Donut`(ECharts) |
| T4 | パイプライン/ファネル | metric(count/amount), filter | ファネル | `Funnel`(ECharts) |
| T5 | クロス集計(2次元)★ | metric, dimensionA, dimensionB, filter | ヒートマップ / クロス表 | `Heatmap`(ECharts) |
| T8 | 条件抽出リスト(ドリル) | 条件, 並び順 | レコード一覧 | `RecordList`(HTML) |

- **T5 の代表ユースケース**: `失注理由 × 業種`（`stage=失注` で絞る）。これが今回の"刺さる"分析。
- T2 は metric を差し替えることで「業種別の受注率」等も表現できる（`metric=win_rate, dimension=industry`）。
- **v2以降**（本書ではアーキのみ言及、実装しない）: T3 時系列(折れ線), T6 期間・セグメント比較, T7 通過率, T9 着地予測。

### 構造化コントラクト（集計層 → フロント）
TypeScript 型で定義し、全テンプレ共通の封筒 + テンプレ別 payload とする。

```ts
interface BiResult<T extends TemplateId> {
  template: T;                 // "T1" | "T2" | "T4" | "T5" | "T8"
  title: string;               // 表示タイトル
  interpretation: string;      // 「〈受注額〉を〈担当者〉別に〈今期〉で集計」= 解釈の明示（必須）
  filtersApplied: FilterView[];// 適用フィルタの可視化用
  data: PayloadFor<T>;         // 下記テンプレ別
  narrative: string;           // Navi の一言（LLM生成・数値は含めない or 集計値を引用のみ）
  actions?: DrillAction[];     // 次アクション（T8ドリル等）: { label, routerQuery }
}

type PayloadFor<T> =
  T extends "T1" ? { value: number; unit: string; delta?: { base: string; diff: number; pct: number } } :
  T extends "T2" ? { metric: MetricView; dimension: DimView; series: { key: string; value: number }[] } :
  T extends "T4" ? { metric: MetricView; steps: { stage: string; value: number }[] } :
  T extends "T5" ? { metric: MetricView; rows: DimView; cols: DimView; matrix: { row: string; col: string; value: number }[] } :
  T extends "T8" ? { columns: string[]; records: Record<string, string>[]; recordUrlField?: string } :
  never;
```

- `series`/`matrix`/`steps` は**集計層が生成**する。LLM は生成しない。
- `narrative` に数値を入れる場合も、`data` 内の確定値のみを引用する（新たな数値を作らない）。

---

## 5. NL→テンプレルーター（agent-workflow 拡張）

- 入力: ユーザーの問い（＋任意の会話文脈）
- 出力（**JSONのみ**）: `{ template, metric?, dimension?, dimensionB?, filters[] , needClarify?: string }`
- 使用語彙は §3 の code と `schema.ts` の options 定数に**限定**。範囲外は生成させない。
- 挙動:
  - 曖昧（例: 「件数か金額か不明」）→ `needClarify` に聞き返し文を入れ、集計しない。
  - 写像できない（v1範囲外）→ 「その分析は現在未対応」と丁寧に返す（ハルシネーションで無理に答えない）。
  - 成功時 → 集計ノードへ `template + params` を渡す。
- 既存の事前集計（`opportunityByOwner`/`opportunityByStage`/各Total）は、この意味レイヤー集計に**発展的に統合**する（重複ロジックを残さない）。

---

## 6. 描画 / UI（ECharts）と**ダッシュボード刷新**

### 6-1. チャートコンポーネント（新規 `src/customize/charts/`）
各コンポーネントは「構造化データ payload を受け取り DOM に描画する純関数的 API」とする。テーマは既存 `theme.ts`/`THEME` とブランド色 `#0098BB` を使用。

- `BarH`(横棒, ECharts) / `Donut`(ドーナツ, ECharts) / `Funnel`(ファネル, ECharts) / `Heatmap`(ヒートマップ, ECharts)
- `KpiCard`(HTML) / `RecordList`(HTML表, ドリル用)
- ECharts は共通初期化ヘルパ（テーマ適用・リサイズ対応・破棄）を一箇所に用意。

### 6-2. 会話内描画（新規 `src/customize/bi-chat.ts`）
`chat.ts` のチャット回答内に、`BiResult` を受けて「解釈文 → チャート → narrative → actionsボタン」を描画するレンダラを追加。ドリル(actions)押下で `sendPrompt` 相当の再問い合わせを行う。

### 6-3. 既存ダッシュボードの ECharts 移行（v1スコープ）
- 対象: `space-dashboard.ts` / `pipeline-dashboard.ts` / `lead-insights.ts`
- 現状 `viz.ts` の手書き HTML/CSS チャートを、6-1 の ECharts コンポーネントへ置換する。
- KPIカード/リストは HTML のまま可（`viz.ts` の該当部分は整理）。
- ダッシュボードも§3の意味レイヤー集計を参照する（会話型と同一の集計を共有し、二重定義しない）。
- **デグレ禁止**: 既存の見え方（案件総額/成約金額/対応待ちリード/フェーズ別ファネル/営業ランキング）は維持または向上。

---

## 7. 開発ワークフロー（ループを2つに割る）

1. **UIループ（速い）**: `dev/playground/` に Vite dev ページを1枚用意し、モックの `BiResult` fixture で各チャートコンポーネントを HMR で描画・調整。**kintone に触らず**見た目を詰める。
2. **データ/ルーターループ（堅い）**: 意味レイヤー集計とルーター写像を vitest で固める（§9）。
3. 統合: `vite build`(`build:customize`) → `deploy:customize` → kintone で確認。

> グラフ調整のたびに build→deploy→再読込を回さないこと。まず playground で確定 → 反映、の順。

---

## 8. CLAUDE.md 追記ルール（ガードレール）

- グラフは **ECharts コンポーネント経由のみ**。kintone 標準グラフ・新規の手書きCSSチャートを作らない。
- 集計は **意味レイヤー（§3）経由のみ**。コンポーネント内やプロンプト内で直接集計しない。
- **LLM/n8n は構造化データを返す**。数値計算・HTML生成・グラフ種別選択を LLM にさせない。
- DROP_DOWN 値・指標・切り口は `schema.ts` / 意味レイヤー定義の**単一真実源**を参照（second copy 禁止）。
- n8n は専用ノードを優先し、HTTP Request は最終手段（既存方針踏襲）。
- 新指標・新切り口・新テンプレの追加は SPEC 更新を伴う（勝手に増やさない）。

---

## 9. 受け入れ基準（精度ゲート = 主観でなく数値で判定）

- **数値精度**: 全集計テンプレが fixture レコードに対し vitest で期待値一致（100%）。`won_amount` `win_rate` 等の定義（§3）通り。
- **写像精度**: 評価セット（`src/**/__tests__/eval/questions.json`, **20問以上**）でルーター正答率が目標以上（**目標値=未決事項、暫定90%**）。正答=`template`+`metric`+`dimension`+主要`filter` が一致。
- **UI**: 各コンポーネントが参照デザインに一致（レビュー）。ダッシュボード移行で既存表示のデグレなし。
- **不変条件遵守**: LLM 出力に新規数値が含まれない（narrative は data 内の値のみ引用）ことをレビューで確認。
- 型チェック(`typecheck`)・lint・test が全て green。

---

## 10. 成果物 / ディレクトリ構成（提案）

```
src/apps/schema.ts               # 変更①②を反映
src/scripts/backfill-industry.ts # 既存案件の業種 backfill
src/semantic/
  metrics.ts                     # 指標定義（§3）
  dimensions.ts                  # 切り口定義（§3）
  templates.ts                   # テンプレ定義 + BiResult 型（§4）
  aggregate.ts                   # kintone REST 集計（意味レイヤー実行）
src/customize/charts/
  echarts-base.ts                # 初期化/テーマ/リサイズ/破棄
  barH.ts donut.ts funnel.ts heatmap.ts
  kpiCard.ts recordList.ts
src/customize/bi-chat.ts         # チャット内 BiResult レンダラ
src/customize/{space-dashboard,pipeline-dashboard,lead-insights}.ts  # ECharts へ移行
src/workflows/agent-workflow.ts  # ルーター + 構造化コントラクト出力
dev/playground/                  # UI高速ループ
src/**/__tests__/                # 集計テスト
  eval/questions.json            # 写像評価セット
```

---

## 11. 実装フェーズ（v1内の順序）

1. スキーマ変更（失注理由・業種コピー）＋ backfill ＋ `gen:types`
2. 意味レイヤー（metrics/dimensions/aggregate）＋ 集計 vitest（数値ゲート）
3. ECharts コンポーネント（playground で作り込み）
4. ルーター（agent-workflow）＋ 写像 eval（写像ゲート）
5. 会話フロー結線（bi-chat）＋ 既存ダッシュボード ECharts 移行
6. answer_log 連携確認 → 受け入れ基準を通す

---

## 12. 未決事項（実装前に要確認）

1. **失注理由の選択肢**（§2 変更①の暫定リストで良いか、実運用の分類に合わせるか）
2. **会計期の開始月**（「今期」の定義。環境変数化する値）
3. **ルーター写像の目標正答率**（暫定90%で良いか）
4. **「活動量」指標の扱い**（v1対象外で良いか。含めるならデータ源の定義が必要）
5. **LLM プロバイダ**（v1既定=GPT-4o で進めて良いか。バイクオフ結果で後日差し替え前提）
6. 評価セット20問の具体（別途、営業/マネージャーの想定問いから作成）
