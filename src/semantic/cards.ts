/**
 * RELVA BI 追加要件定義書 §2 — 「カード = テンプレインスタンス」という統一モデル。
 * ダッシュボードの常設カードも、会話で出るグラフも、同じ CardSpec(テンプレ+パラメータ)。
 * 別システムを2つ作らない——集計は必ず semantic/aggregate.ts の同一関数を通す。
 *
 * 自己完結ファイル(src/semantic/aggregate.ts と同じ設計原則): 型のみの import に留め、
 * n8n Code node にも埋め込める(refine()はルーターのop:'refine'処理で使う)。
 */

import type { DimensionCode } from './dimensions';
import type { MetricCode } from './metrics';
import type { TemplateId } from './templates';

export type PeriodPreset = 'current_fiscal_year' | 'current_month' | 'last_month' | 'all';
export type PeriodSpec = { preset: PeriodPreset } | { from: string; to: string };

export type FilterOp = '=' | '!=' | 'in' | 'not_in';
export interface CardFilter {
  field: string;
  op: FilterOp;
  value: string | string[];
}

export type SortSpec = 'value_desc' | 'value_asc' | 'label';

/** テンプレに渡すパラメータ。有効なキーはテンプレごとに固定(ALLOWED_PARAM_KEYS参照)。 */
export interface TemplateParams {
  metric?: MetricCode;
  dimension?: DimensionCode;
  dimensionB?: DimensionCode;
  filters?: CardFilter[];
  period?: PeriodSpec;
  topN?: number;
  sort?: SortSpec;
  /** T2/T5はdimensionのtargetAppから対象(案件/リード)を自動判定できるが、T1/T8はdimensionを
   * 持たないため、リード側を対象にしたい場合(例:「対応待ちリード件数」)はここで明示する。
   * 省略時は案件が対象。 */
  entity?: 'opportunity' | 'lead';
  /** T2のみ有効。指定するとdimensionによるカテゴリ別集計ではなく、close_dateを月単位で
   * バケット化した「月別推移」になる(aggregate.tsのaggregateByMonth)。dimensionと
   * 同時に指定しない想定(chart-builder.tsが排他的に選ばせる)——現時点ではチャット/
   * チップからは設定されず、グラフビルダー経由でのみ使われる。 */
  timeGranularity?: 'month';
  /** グラフビルダー(src/customize/chart-builder.ts)で選んだ「見た目」(BuilderVisual)。
   * 同じT2/T5の集計結果でも複数の描画方法があり得るため(横棒/縦棒/ドーナツ、
   * ヒートマップ/集合棒/積み上げ棒等)、ピン留め後もユーザーが選んだ見た目のまま
   * 再描画できるよう保存しておく。cards.ts自体はフロントエンドの描画コンポーネントに
   * 依存しない(自己完結ファイル)ため、型は緩い string のままにしている——実際の値の
   * 妥当性はchart-builder.ts側が保証する。 */
  visual?: string;
}

/** カード = ピン留めしたテンプレインスタンス。 */
export interface CardSpec {
  id: string;
  template: TemplateId;
  params: TemplateParams;
  title?: string;
  pinned: boolean;
}

export interface DashboardSpec {
  cards: CardSpec[];
}

/**
 * チャット側が保持する「直前に表示したカード」の状態(§4 の currentCard / cardSpec)。
 * n8n の Format BI Response が返す cardSpec とフロントエンドが次のリクエストに載せて送り返す
 * currentCard は、常にこの同じ形で往復する——id/pinned が無い点だけが永続化済み CardSpec と違う
 * (ピン留めされて初めて id を採番し CardSpec になる。詳細は dashboard-default.ts / §7)。
 */
export interface ChatCardState {
  template: TemplateId;
  params: TemplateParams;
  title?: string;
  interpretation?: string;
  filtersApplied?: Array<{ label: string; value: string }>;
  data?: unknown;
}

/** リファイン = 既存paramsへの差分パッチ。意味レイヤー内のキーのみ許可(§6 ガードレール)。 */
export type ParamPatch = Partial<TemplateParams>;

// §3-1: テンプレ別の操作可能パラメータ。ここに無いキーはrefine()が黙って無視する——
// 「新しい軸が欲しい=設定(意味レイヤーへの定義追加)であって実行時の自由化ではない」という
// 要件定義書 §6 の歯止めそのもの。period はどのテンプレでも横断的に許可する(既定=今期)。
const ALLOWED_PARAM_KEYS: Record<TemplateId, ReadonlyArray<keyof TemplateParams>> = {
  T1: ['metric', 'period', 'entity', 'filters'],
  T2: ['metric', 'dimension', 'filters', 'topN', 'sort', 'period', 'timeGranularity', 'visual'],
  T4: ['metric', 'filters', 'period'],
  T5: ['metric', 'dimension', 'dimensionB', 'filters', 'period', 'visual'],
  T8: ['filters', 'topN', 'sort', 'period', 'entity'],
};

export function allowedParamKeys(template: TemplateId): ReadonlyArray<keyof TemplateParams> {
  return ALLOWED_PARAM_KEYS[template];
}

/**
 * ワンクリックのチップ操作も自然言語リファインも、最終的にはこの1関数を通るだけ
 * (要件定義書 §3 「入口が2つ、処理は1本」)。範囲外キーは黙って無視し、許可されたキーだけ
 * 現在のparamsへマージする。破壊的変更はしない(新しいオブジェクトを返す)。
 */
export function refine(template: TemplateId, current: TemplateParams, patch: ParamPatch): TemplateParams {
  const allowed = allowedParamKeys(template);
  const next: TemplateParams = { ...current };
  for (const key of allowed) {
    if (key in patch) {
      // TemplateParams の各フィールドは patch 側でも同じ型なので、この代入は安全。
      (next as Record<string, unknown>)[key] = (patch as Record<string, unknown>)[key];
    }
  }
  return next;
}

let cardIdCounter = 0;
/** ブラウザ(crypto.randomUUID等)にもn8nのCode nodeサンドボックスにも依存しない、
 * 自己完結ファイルとして安全なID生成(record-to-text.tsと同じ自己完結方針)。 */
export function generateCardId(): string {
  cardIdCounter += 1;
  return `card_${Date.now().toString(36)}_${cardIdCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createCard(template: TemplateId, params: TemplateParams, opts: { title?: string; pinned?: boolean } = {}): CardSpec {
  return {
    id: generateCardId(),
    template,
    params,
    title: opts.title,
    pinned: opts.pinned ?? false,
  };
}

/**
 * `aggregateEmbeddable()`(src/semantic/aggregate.ts)と同じ手法: n8n の Parse BI Plan Code node
 * がルーターの op:'refine' を処理する際に `refine()` をそのまま使えるよう、関数の `.toString()`
 * を連結した文字列を返す。ALLOWED_PARAM_KEYS は const なので JSON.stringify で再構築する。
 */
export function cardsEmbeddable(): string {
  const shim = 'function __name(fn) { return fn; }';
  const consts = [`const ALLOWED_PARAM_KEYS = ${JSON.stringify(ALLOWED_PARAM_KEYS)};`];
  const fns = [allowedParamKeys, refine].map((fn) => fn.toString());
  return [shim, ...consts, ...fns].join('\n');
}
