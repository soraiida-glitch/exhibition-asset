/**
 * RELVA BI (要件定義書 §1・§3) — 意味論レイヤーの集計本体。
 *
 * 自己完結を徹底する(src/lib/record-to-text.ts と同じ設計原則): import はすべて型のみ
 * (`import type`、実行時コードには残らない)、モジュール内の関数は互いの呼び出しに閉じ、
 * kintone REST の生レコード配列だけを受け取る純関数として書く。これにより
 * `aggregateEmbeddable()` で n8n Code node にそのまま貼り付けて実行できる
 * (ダッシュボード側は通常の import で同じ関数を直接使う — 集計ロジックの二重管理をしない)。
 *
 * `buildBiResult()` だけは期間プリセットの解決(fiscal.ts の `resolvePeriodPreset`)を必要と
 * するが、これも実行時 import ではなく引数(`resolvePeriod`)として渡してもらう設計にして
 * いる——`.toString()` で埋め込む都合上、関数本体が実際の import 文を含むと(バンドラでの
 * 変換のされ方次第で)埋め込み文字列の中に解決できない参照が残ってしまうため。呼び出し側
 * (agent-workflow.ts は fiscalEmbeddable() 経由、dashboard.ts は通常の import 経由)が
 * 同じ `resolvePeriodPreset` を渡すことで、期間解決ロジック自体は重複させない。
 *
 * LLM はこのファイルの一切を呼ばない・計算しない。ルーターLLMは metric/dimension/filters を
 * 選ぶだけ、ナレーションLLMはここで確定した数値を引用するだけ、という要件定義書の絶対原則を
 * 支える最下層。
 */

import type { DimensionCode } from './dimensions';
import type { MetricCode } from './metrics';
import type { PeriodPreset, FiscalYearRange } from './fiscal';
import type { TemplateId } from './templates';

export interface KintoneFieldValue {
  type?: string;
  value?: unknown;
}
export type KintoneRecordFields = Record<string, KintoneFieldValue | undefined>;

export type FilterOp = '=' | '!=' | 'in' | 'not_in' | 'range';
export interface FilterSpec {
  field: string;
  op: FilterOp;
  value: string | string[] | { start: string; end: string };
}

// 案件の受注/失注フェーズ名(schema.ts の OPPORTUNITY_STAGE_OPTIONS の値と一致させる)。
// aggregate.ts は import しない自己完結ファイルのため、ここではリテラルとして直接保持する
// (schema.ts 側とのドリフトは src/semantic/__tests__/aggregate.test.ts が検知する)。
const WON_STAGE = '成約';
const LOST_STAGE = '失注';
const STAGE_ORDER = ['初期接触', 'ヒアリング', '提案中', '見積提出', '交渉中', '成約', '失注'];

// DimensionCode -> { 実フィールドコード, 対象アプリ } の対応表。src/semantic/dimensions.ts の
// DIMENSIONS と内容は同じだが、埋め込み可能にするため import せずリテラルとして複製している。
// ドリフトは src/semantic/__tests__/aggregate.test.ts がガードする。
const DIMENSION_FIELD_MAP: Record<string, { field: string; targetApp: 'opportunity' | 'lead' }> = {
  owner: { field: 'owner', targetApp: 'opportunity' },
  stage: { field: 'stage', targetApp: 'opportunity' },
  industry: { field: 'industry', targetApp: 'opportunity' },
  loss_reason: { field: 'loss_reason', targetApp: 'opportunity' },
  account: { field: 'account', targetApp: 'opportunity' },
  lead_source: { field: 'source', targetApp: 'lead' },
  lead_status: { field: 'status', targetApp: 'lead' },
};

const METRIC_LABELS: Record<string, string> = {
  count: '件数',
  amount_sum: '金額合計',
  amount_avg: '平均金額',
  won_amount: '受注額',
  won_count: '受注件数',
  lost_count: '失注件数',
  win_rate: '受注率',
};

const DIMENSION_LABELS: Record<string, string> = {
  owner: '担当者',
  stage: 'フェーズ',
  industry: '業種',
  loss_reason: '失注理由',
  account: '取引先',
  lead_source: '流入経路',
  lead_status: 'リードステータス',
};

function fieldStr(record: KintoneRecordFields, field: string): string {
  const f = record[field];
  return f && typeof f.value === 'string' ? f.value : '';
}

function fieldNum(record: KintoneRecordFields, field: string): number {
  const f = record[field];
  if (!f || f.value == null || f.value === '') return 0;
  const n = Number(f.value);
  return Number.isFinite(n) ? n : 0;
}

function matchesFilter(record: KintoneRecordFields, filter: FilterSpec): boolean {
  const raw = fieldStr(record, filter.field);
  switch (filter.op) {
    case '=':
      return raw === filter.value;
    case '!=':
      return raw !== filter.value;
    case 'in':
      return Array.isArray(filter.value) && filter.value.includes(raw);
    case 'not_in':
      return Array.isArray(filter.value) && !filter.value.includes(raw);
    case 'range': {
      // close_date が空のレコードは期間集計から除外する(要件定義書 §3)。
      if (!raw) return false;
      const range = filter.value as { start: string; end: string };
      return raw >= range.start && raw <= range.end;
    }
    default:
      return true;
  }
}

export function applyFilters(records: KintoneRecordFields[], filters: FilterSpec[]): KintoneRecordFields[] {
  if (!filters || filters.length === 0) return records;
  return records.filter((r) => filters.every((f) => matchesFilter(r, f)));
}

/**
 * count/amount_sum/amount_avg/won_count/won_amount/lost_count/win_rate を単一パスでまとめて
 * 計算してから目的の値を選ぶ — win_rate の分子・分母や amount_avg の合計・件数が、必ず同一の
 * フィルタ済み集合から算出されることを構造的に保証する。
 */
export function computeMetric(records: KintoneRecordFields[], metric: string): number {
  let count = 0;
  let amountSum = 0;
  let wonCount = 0;
  let wonAmount = 0;
  let lostCount = 0;

  for (const r of records) {
    const stage = fieldStr(r, 'stage');
    const amount = fieldNum(r, 'amount');
    count += 1;
    amountSum += amount;
    if (stage === WON_STAGE) {
      wonCount += 1;
      wonAmount += amount;
    }
    if (stage === LOST_STAGE) {
      lostCount += 1;
    }
  }

  switch (metric) {
    case 'count':
      return count;
    case 'amount_sum':
      return amountSum;
    case 'amount_avg':
      return count > 0 ? amountSum / count : 0;
    case 'won_amount':
      return wonAmount;
    case 'won_count':
      return wonCount;
    case 'lost_count':
      return lostCount;
    case 'win_rate': {
      const closed = wonCount + lostCount;
      return closed > 0 ? wonCount / closed : 0;
    }
    default:
      return 0;
  }
}

export interface DimensionSeriesPoint {
  key: string;
  value: number;
}

/**
 * T2(カテゴリ別集計)向け。`categories` を渡すとゼロ件のカテゴリも含めて指定順で返す
 * (既存ダッシュボードの「ゼロ件のフェーズも表示する」挙動を踏襲)。渡さない場合は値の
 * 降順(ランキング表示向け)。
 */
export function aggregateByDimension(
  records: KintoneRecordFields[],
  metric: string,
  dimensionField: string,
  categories?: readonly string[],
): DimensionSeriesPoint[] {
  const buckets = new Map<string, KintoneRecordFields[]>();
  const seeded = !!(categories && categories.length > 0);
  if (seeded) {
    for (const key of categories!) buckets.set(key, []);
  }
  for (const r of records) {
    const key = fieldStr(r, dimensionField) || '(未設定)';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r);
  }

  const entries = Array.from(buckets.entries()).map(([key, recs]) => ({
    key,
    value: computeMetric(recs, metric),
  }));
  return seeded ? entries : entries.sort((a, b) => b.value - a.value);
}

export interface FunnelStepPoint {
  stage: string;
  value: number;
}

/** T4(パイプライン/ファネル)向け。`stageField` を変えればリードのステータス別ファネルにも使える。 */
export function aggregateFunnel(
  records: KintoneRecordFields[],
  metric: string,
  stageOrder: readonly string[],
  stageField = 'stage',
): FunnelStepPoint[] {
  return stageOrder.map((stage) => ({
    stage,
    value: computeMetric(
      records.filter((r) => fieldStr(r, stageField) === stage),
      metric,
    ),
  }));
}

export interface CrossTabResult {
  rows: string[];
  cols: string[];
  matrix: { row: string; col: string; value: number }[];
}

/** T5(クロス集計)向け。代表例は失注理由×業種(stage=失注 のフィルタと組み合わせて使う)。 */
export function aggregateCrossTab(
  records: KintoneRecordFields[],
  metric: string,
  rowField: string,
  rowOrder: readonly string[] | undefined,
  colField: string,
  colOrder: readonly string[] | undefined,
): CrossTabResult {
  const rows = rowOrder && rowOrder.length > 0 ? Array.from(rowOrder) : uniqueValues(records, rowField);
  const cols = colOrder && colOrder.length > 0 ? Array.from(colOrder) : uniqueValues(records, colField);

  const matrix: { row: string; col: string; value: number }[] = [];
  for (const row of rows) {
    for (const col of cols) {
      const subset = records.filter(
        (r) => (fieldStr(r, rowField) || '(未設定)') === row && (fieldStr(r, colField) || '(未設定)') === col,
      );
      matrix.push({ row, col, value: computeMetric(subset, metric) });
    }
  }
  return { rows, cols, matrix };
}

function uniqueValues(records: KintoneRecordFields[], field: string): string[] {
  const seen = new Set<string>();
  for (const r of records) seen.add(fieldStr(r, field) || '(未設定)');
  return Array.from(seen);
}

/** 決定的な「何を集計したか」の一文を組み立てる。LLM生成ではない(§4 の `interpretation` はここが担う)。 */
export function buildInterpretation(
  metric: string,
  dimension: string | undefined,
  dimensionB: string | undefined,
  filterLabels: string[],
): string {
  const metricLabel = METRIC_LABELS[metric] || metric;
  let subject = metricLabel;
  if (dimension && dimensionB) {
    subject += `を${DIMENSION_LABELS[dimension] || dimension}×${DIMENSION_LABELS[dimensionB] || dimensionB}別に`;
  } else if (dimension) {
    subject += `を${DIMENSION_LABELS[dimension] || dimension}別に`;
  }
  const filterText = filterLabels && filterLabels.length > 0 ? filterLabels.join('・') + 'で' : '';
  return `${filterText}${subject}集計しました。`;
}

export interface RunAggregateParams {
  template: TemplateId;
  metric: MetricCode;
  dimension?: DimensionCode;
  dimensionB?: DimensionCode;
  filters?: FilterSpec[];
  /** T1/T8はdimensionを持たないため対象(案件/リード)をdimensionのtargetAppから推測できない
   * ——「対応待ちリード件数」のような、次元なしでリードを対象にしたいカードのために明示する。
   * 省略時は従来どおり dimension の targetApp から判定し、それも無ければ案件を対象にする。 */
  entity?: 'opportunity' | 'lead';
}

export interface RunAggregateInput {
  opportunityRecords: KintoneRecordFields[];
  leadRecords: KintoneRecordFields[];
}

export type RunAggregateResult =
  | { ok: true; template: TemplateId; data: unknown }
  | { ok: false; message: string };

/**
 * n8n の Aggregate BI Code node から呼ばれるトップレベルの dispatcher。ルーターLLMが選んだ
 * template/metric/dimension(意味論コード)を実フィールドへ解決し、対応する集計関数へ振り分ける。
 * 不正な組み合わせは例外を投げず `{ ok: false, message }` を返す — LLM/前段の Parse BI Plan で
 * 大半は弾かれる想定だが、ここでも構造的に安全側に倒す。
 */
export function runAggregate(input: RunAggregateInput, params: RunAggregateParams): RunAggregateResult {
  const filters = params.filters || [];
  const dim = params.dimension ? DIMENSION_FIELD_MAP[params.dimension] : undefined;
  if (params.dimension && !dim) {
    return { ok: false, message: `未対応のディメンションです: ${params.dimension}` };
  }
  const targetsLead = params.entity ? params.entity === 'lead' : dim?.targetApp === 'lead';
  if (targetsLead && params.metric !== 'count') {
    return { ok: false, message: 'リードの分析では件数のみ集計できます' };
  }

  const baseRecords = targetsLead ? input.leadRecords : input.opportunityRecords;
  const filtered = applyFilters(baseRecords, filters);

  switch (params.template) {
    case 'T1': {
      const value = computeMetric(filtered, params.metric);
      return { ok: true, template: 'T1', data: { value } };
    }
    case 'T2': {
      if (!dim) return { ok: false, message: 'カテゴリ別集計にはディメンションの指定が必要です' };
      const categories = params.dimension === 'stage' ? STAGE_ORDER : undefined;
      const series = aggregateByDimension(filtered, params.metric, dim.field, categories);
      return { ok: true, template: 'T2', data: { series } };
    }
    case 'T4': {
      const funnelRecords = applyFilters(input.opportunityRecords, filters);
      const steps = aggregateFunnel(funnelRecords, params.metric, STAGE_ORDER, 'stage');
      return { ok: true, template: 'T4', data: { steps } };
    }
    case 'T5': {
      if (!dim || !params.dimensionB) {
        return { ok: false, message: 'クロス集計には2つのディメンションの指定が必要です' };
      }
      const dimB = DIMENSION_FIELD_MAP[params.dimensionB];
      if (!dimB) return { ok: false, message: `未対応のディメンションです: ${params.dimensionB}` };
      if (dim.targetApp !== dimB.targetApp) {
        return {
          ok: false,
          message: 'クロス集計は同じ対象(案件どうし、またはリードどうし)のディメンションのみ組み合わせられます',
        };
      }
      const rowOptions = params.dimension === 'stage' ? STAGE_ORDER : undefined;
      const colOptions = params.dimensionB === 'stage' ? STAGE_ORDER : undefined;
      const cross = aggregateCrossTab(filtered, params.metric, dim.field, rowOptions, dimB.field, colOptions);
      return { ok: true, template: 'T5', data: cross };
    }
    case 'T8': {
      const columns = targetsLead
        ? ['lead_name', 'company_name', 'source', 'status']
        : ['deal_name', 'account', 'amount', 'stage', 'owner', 'close_date'];
      const numericColumns = new Set(targetsLead ? [] : ['amount']);
      const records = filtered.slice(0, 50).map((r) => {
        const row: Record<string, string> = {};
        for (const c of columns) {
          row[c] = numericColumns.has(c) ? String(fieldNum(r, c)) : fieldStr(r, c);
        }
        row.$id = fieldStr(r, '$id');
        return row;
      });
      return { ok: true, template: 'T8', data: { columns, records } };
    }
    default:
      return { ok: false, message: `未対応のテンプレートです: ${params.template}` };
  }
}

const METRIC_UNITS: Record<string, string> = {
  count: '件',
  amount_sum: '円',
  amount_avg: '円',
  won_amount: '円',
  won_count: '件',
  lost_count: '件',
  win_rate: '%',
};

/** ナレーションLLMに渡す表示用文字列を決定的に整形する。円は万円表記に丸め、%は小数第1位まで
 * ——LLM自身に単位変換を計算させると桁を間違える(実際に本番で発生した事故)。 */
function formatMetricValueForFactSheet(metric: string, value: number): string {
  const unit = METRIC_UNITS[metric] || '';
  if (unit === '円') return '約' + Math.round(value / 10000).toLocaleString('ja-JP') + '万円';
  if (unit === '%') return value.toFixed(1) + '%';
  return value.toLocaleString('ja-JP') + unit;
}

/**
 * RELVA BI 追加要件定義書 §4 narrate — ナレーションLLMに渡す「引用してよい事実だけを並べた
 * 文字列」を、BiResult.data(表示スケール済み・runAggregateの結果そのまま)から組み立てる。
 * query/refine(新規集計の直後)でも、narrate(既存カードのdataを再利用するだけ)でも同じ関数を
 * 呼ぶ——data の形はどちらの経路でも同じ PayloadFor<T> なので分岐する必要がない。
 */
export function buildFactSheet(template: string, metric: string | undefined, title: string, data: Record<string, unknown>): string {
  if (template === 'T1') {
    return `${title}: ${formatMetricValueForFactSheet(metric || '', data.value as number)}`;
  }
  if (template === 'T2') {
    const series = data.series as { key: string; value: number }[];
    return series.map((s) => `${s.key}: ${formatMetricValueForFactSheet(metric || '', s.value)}`).join('、');
  }
  if (template === 'T4') {
    const steps = data.steps as { stage: string; value: number }[];
    return steps.map((s) => `${s.stage}: ${formatMetricValueForFactSheet(metric || '', s.value)}`).join('、');
  }
  if (template === 'T5') {
    const matrix = data.matrix as { row: string; col: string; value: number }[];
    return matrix
      .filter((m) => m.value > 0)
      .map((m) => `${m.row}×${m.col}: ${formatMetricValueForFactSheet(metric || '', m.value)}`)
      .join('、');
  }
  if (template === 'T8') {
    const records = data.records as Record<string, string>[];
    return `${records.length}件: ${records.map((r) => r.deal_name).join('、')}`;
  }
  return '';
}

const PERIOD_LABELS: Record<PeriodPreset, string> = {
  current_fiscal_year: '今期',
  current_month: '今月',
  last_month: '先月',
  all: '全期間',
};

/** buildBiResult() が受け取る、意味論コードだけで表現された「何を集計するか」の指示。
 * n8n の biPlan(query/refine/narrateいずれも同じ形)、ダッシュボードの CardSpec.params の
 * どちらから来ても、この形に正規化してから渡す(period は文字列プリセットに揃える —
 * TemplateParams.period の `{preset}` オブジェクト形はここでは受け取らない)。 */
export interface BiPlanLike {
  template: TemplateId;
  metric?: MetricCode;
  dimension?: DimensionCode;
  dimensionB?: DimensionCode;
  filters?: FilterSpec[];
  period?: PeriodPreset;
  entity?: 'opportunity' | 'lead';
}

export interface BuiltBiResult {
  template: TemplateId;
  title: string;
  interpretation: string;
  filtersApplied: { label: string; value: string }[];
  data: Record<string, unknown>;
  narrative: string;
}

export type BuildBiResultOutcome = { ok: true; biResult: BuiltBiResult; factSheet: string } | { ok: false; message: string };

/**
 * RELVA BI 追加要件定義書 — n8n の Aggregate BI ノードと src/customize/dashboard.ts(初期
 * ダッシュボード)の両方から呼ばれる、唯一の「意味論コード → 表示確定済みBiResult」変換。
 * period プリセットの絶対日付レンジへの解決(fiscal.ts)、runAggregate による集計、
 * interpretation/factSheet の決定的な文字列組み立てまでを1関数にまとめ、経路によって集計
 * ロジックや表示フォーマットが分岐・重複しないことを構造的に保証する(§6-3)。
 */
export function buildBiResult(
  input: RunAggregateInput,
  plan: BiPlanLike,
  today: Date,
  resolvePeriod: (preset: PeriodPreset, today: Date) => FiscalYearRange | null,
): BuildBiResultOutcome {
  const period = plan.period || 'current_fiscal_year';
  const range = resolvePeriod(period, today);
  const periodFilter: FilterSpec | null = range ? { field: 'close_date', op: 'range', value: range } : null;

  const filters = plan.filters ? plan.filters.slice() : [];
  if (periodFilter) filters.push(periodFilter);

  const result = runAggregate(input, {
    template: plan.template,
    metric: plan.metric as MetricCode,
    dimension: plan.dimension,
    dimensionB: plan.dimensionB,
    filters,
    entity: plan.entity,
  });

  if (!result.ok) return { ok: false, message: result.message };

  const filtersApplied: { label: string; value: string }[] = [];
  if (periodFilter) {
    const r = periodFilter.value as { start: string; end: string };
    filtersApplied.push({ label: '期間', value: `${PERIOD_LABELS[period] || period}(${r.start}〜${r.end})` });
  }
  for (const f of plan.filters || []) {
    filtersApplied.push({
      label: DIMENSION_LABELS[f.field] || f.field,
      value: Array.isArray(f.value) ? f.value.join('・') : String(f.value),
    });
  }

  const interpretationFilterLabels = filtersApplied.map((f) => `${f.label}=${f.value}`);
  // T8(条件抽出リスト)はmetricを持たない(runAggregateもmetricを使わない)ため、
  // buildInterpretationの「metricを○○別に集計」という文言はそもそも当てはまらない。
  const interpretation =
    plan.template === 'T8'
      ? (interpretationFilterLabels.length ? interpretationFilterLabels.join('・') + 'で' : '') + '条件に合う案件を抽出しました。'
      : buildInterpretation(plan.metric || '', plan.dimension, plan.dimensionB, interpretationFilterLabels);

  function toMetricView(code: string) {
    return { code, label: METRIC_LABELS[code] || code, unit: METRIC_UNITS[code] || '' };
  }
  function toDimView(code: string) {
    return { code, label: DIMENSION_LABELS[code] || code };
  }
  // computeMetric() の win_rate は 0〜1 の割合(0.4 = 40%)で返るが、unit は "%" として表示する
  // ため、表示用データに詰める直前にだけ 0〜100 のスケールへ直す(値そのものの再計算はしない)。
  function scaleForDisplay(metric: string | undefined, value: number) {
    return metric === 'win_rate' ? value * 100 : value;
  }

  let title = plan.template === 'T8' ? '条件に合う案件一覧' : METRIC_LABELS[plan.metric || ''] || plan.metric || '';
  let data: Record<string, unknown>;
  if (plan.template === 'T1') {
    data = { value: scaleForDisplay(plan.metric, (result.data as { value: number }).value), unit: METRIC_UNITS[plan.metric || ''] || '' };
  } else if (plan.template === 'T2') {
    title = title + `(${DIMENSION_LABELS[plan.dimension || ''] || plan.dimension}別)`;
    const series = (result.data as { series: DimensionSeriesPoint[] }).series.map((s) => ({
      key: s.key,
      value: scaleForDisplay(plan.metric, s.value),
    }));
    data = { metric: toMetricView(plan.metric || ''), dimension: toDimView(plan.dimension || ''), series };
  } else if (plan.template === 'T4') {
    title = title + '(パイプライン)';
    const steps = (result.data as { steps: FunnelStepPoint[] }).steps.map((s) => ({
      stage: s.stage,
      value: scaleForDisplay(plan.metric, s.value),
    }));
    data = { metric: toMetricView(plan.metric || ''), steps };
  } else if (plan.template === 'T5') {
    title = `${DIMENSION_LABELS[plan.dimension || ''] || plan.dimension} × ${DIMENSION_LABELS[plan.dimensionB || ''] || plan.dimensionB}`;
    const matrix = (result.data as CrossTabResult).matrix.map((m) => ({ row: m.row, col: m.col, value: scaleForDisplay(plan.metric, m.value) }));
    data = { metric: toMetricView(plan.metric || ''), rows: toDimView(plan.dimension || ''), cols: toDimView(plan.dimensionB || ''), matrix };
  } else {
    // T8
    data = result.data as Record<string, unknown>;
  }

  const factSheet = buildFactSheet(plan.template, plan.metric, title, data);
  const biResult: BuiltBiResult = { template: plan.template, title, interpretation, filtersApplied, data, narrative: '' };
  return { ok: true, biResult, factSheet };
}

/**
 * `recordToTextEmbeddable()`(src/lib/record-to-text.ts)と同じ手法: 各関数を `.toString()`
 * して連結し、n8n Code node にそのまま貼り付けて実行できる文字列を返す。定数(const)は
 * 関数と違って `.toString()` で拾えないため、`JSON.stringify` で再構築した宣言を先頭に足す。
 * 関数宣言は巻き上げられるため、連結順は自由(呼び出しは実行時=スクリプト末尾での起動時)。
 */
export function aggregateEmbeddable(): string {
  const shim = 'function __name(fn) { return fn; }';
  const consts = [
    `const WON_STAGE = ${JSON.stringify(WON_STAGE)};`,
    `const LOST_STAGE = ${JSON.stringify(LOST_STAGE)};`,
    `const STAGE_ORDER = ${JSON.stringify(STAGE_ORDER)};`,
    `const DIMENSION_FIELD_MAP = ${JSON.stringify(DIMENSION_FIELD_MAP)};`,
    `const METRIC_LABELS = ${JSON.stringify(METRIC_LABELS)};`,
    `const DIMENSION_LABELS = ${JSON.stringify(DIMENSION_LABELS)};`,
    `const METRIC_UNITS = ${JSON.stringify(METRIC_UNITS)};`,
    `const PERIOD_LABELS = ${JSON.stringify(PERIOD_LABELS)};`,
  ];
  const fns = [
    fieldStr,
    fieldNum,
    matchesFilter,
    uniqueValues,
    applyFilters,
    computeMetric,
    aggregateByDimension,
    aggregateFunnel,
    aggregateCrossTab,
    buildInterpretation,
    runAggregate,
    formatMetricValueForFactSheet,
    buildFactSheet,
    buildBiResult,
  ].map((fn) => fn.toString());
  return [shim, ...consts, ...fns].join('\n');
}
