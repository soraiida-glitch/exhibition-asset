/**
 * RELVA BI 追加要件定義書 §3・§6 — 「グラフビルダー」。
 *
 * Power BIの「ビジュアルタイプを選び、X軸/Y軸にフィールドをドラッグする」という操作感を、
 * ダッシュボードの下に常設のUIとして再現する。ただし中身は §6 の絶対ガードレールを厳密に
 * 守る: ここで選べる「軸」「指標」は意味レイヤー(DIMENSIONS/METRICS)の検証済みの項目だけで、
 * 任意のkintoneフィールドを自由に選べるわけではない——ドラッグアンドドロップの代わりに
 * プルダウンにしているのも、選べる範囲を構造的に「存在する組み合わせ」だけへ絞るため。
 *
 * 集計はチャット・ダッシュボードの固定カードと全く同じ buildBiResult() を通す(§6-3:
 * 集計ロジックを経路によって分岐/重複させない)。ビジュアルタイプ(棒グラフの向き・
 * 集合/積み上げ、ヒートマップ等)は表示層だけの選択であり、集計そのものは変えない
 * ——同じT2/T5のデータを見せ方だけ変える(集合/積み上げ横棒・縦棒はT5の同じmatrixを、
 * 横棒/縦棒/ドーナツはT2の同じseriesを描き分けるだけ)。作成したグラフは「📌 ダッシュボードに
 * ピン留め」から永続化でき、その後は他の固定カードと完全に同じ扱いになる。
 */
import type { BuiltBiResult, KintoneRecordFields } from '../semantic/aggregate';
import { buildBiResult } from '../semantic/aggregate';
import { allowedParamKeys } from '../semantic/cards';
import type { ChatCardState, SortSpec, TemplateParams } from '../semantic/cards';
import { DIMENSIONS, type DimensionCode, type DimensionDef } from '../semantic/dimensions';
import { METRICS, type MetricCode, type MetricDef } from '../semantic/metrics';
import { resolvePeriodPreset, type PeriodPreset } from '../semantic/fiscal';
import type { PayloadFor, TemplateId } from '../semantic/templates';
import { renderBarH } from './charts/barH';
import { renderBarV } from './charts/barV';
import { renderComboChart, type ComboSeriesInput } from './charts/comboChart';
import { renderCrossTabBar } from './charts/crossTabBar';
import { renderDonut } from './charts/donut';
import { renderFunnel } from './charts/funnel';
import { renderGauge } from './charts/gauge';
import { renderHeatmap } from './charts/heatmap';
import { renderKpiCard } from './charts/kpiCard';
import { renderAreaChart, renderLineChart } from './charts/lineChart';
import { renderRecordList } from './charts/recordList';
import { renderScatter } from './charts/scatter';
import { renderCardChat } from './card-chat';
import { THEME } from './theme';
import { renderVizError } from './viz';

/**
 * ユーザーが選ぶ「見た目」の一覧。テンプレ(T1/T2/T4/T5/T8)よりも1段細かい粒度——
 * 例えばT2は横棒/縦棒/ドーナツ/月別推移(折れ線)の4通りの見た目を持てる。
 * 集計方法(template・timeGranularity)は各見た目ごとに固定で、ユーザーが個別に選ぶのは
 * 軸・指標・期間などのパラメータだけ(§6ガードレール — 見た目の種類を増やしても
 * 「何を集計するか」の自由度は増やさない)。
 */
export type BuilderVisual =
  | 'kpi'
  | 'gauge'
  | 'bar_h'
  | 'bar_v'
  | 'donut'
  | 'area'
  | 'scatter'
  | 'trend_line'
  | 'trend_area'
  | 'combo_bar_line'
  | 'funnel'
  | 'crosstab_heatmap'
  | 'crosstab_grouped_h'
  | 'crosstab_grouped_v'
  | 'crosstab_stacked_h'
  | 'crosstab_stacked_v'
  | 'record_list';

interface VisualDef {
  code: BuilderVisual;
  label: string;
  template: TemplateId;
  timeGranularity?: 'month';
  /** 集計をせずレコード1件=1点として並べる(散布図)。 */
  scatter?: boolean;
  /** 棒+折れ線の2指標コンボ。buildBiResultを2回呼ぶ特別な組み立てが必要なため、
   * renderVisual()の通常経路(1回のbiResultを描くだけ)には乗らない。 */
  combo?: boolean;
}

const VISUALS: VisualDef[] = [
  { code: 'kpi', label: '数値カード', template: 'T1' },
  { code: 'gauge', label: 'ゲージ', template: 'T1' },
  { code: 'bar_h', label: 'カテゴリ別・横棒グラフ', template: 'T2' },
  { code: 'bar_v', label: 'カテゴリ別・縦棒グラフ', template: 'T2' },
  { code: 'donut', label: 'カテゴリ別・円グラフ(ドーナツ)', template: 'T2' },
  { code: 'area', label: 'カテゴリ別・面グラフ', template: 'T2' },
  { code: 'scatter', label: 'カテゴリ別・散布図(案件1件ごとの金額)', template: 'T2', scatter: true },
  { code: 'trend_line', label: '月別推移(折れ線)', template: 'T2', timeGranularity: 'month' },
  { code: 'trend_area', label: '月別推移(面グラフ)', template: 'T2', timeGranularity: 'month' },
  { code: 'combo_bar_line', label: 'コンボ(棒+折れ線・2指標重ね表示)', template: 'T2', combo: true },
  { code: 'funnel', label: 'パイプライン(ファネル)', template: 'T4' },
  { code: 'crosstab_heatmap', label: 'クロス集計・ヒートマップ', template: 'T5' },
  { code: 'crosstab_grouped_h', label: 'クロス集計・集合横棒', template: 'T5' },
  { code: 'crosstab_grouped_v', label: 'クロス集計・集合縦棒', template: 'T5' },
  { code: 'crosstab_stacked_h', label: 'クロス集計・積み上げ横棒', template: 'T5' },
  { code: 'crosstab_stacked_v', label: 'クロス集計・積み上げ縦棒', template: 'T5' },
  { code: 'record_list', label: '案件一覧', template: 'T8' },
];

function visualDefOf(code: BuilderVisual): VisualDef {
  return VISUALS.find((v) => v.code === code) || VISUALS[0];
}

const PERIOD_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: 'current_fiscal_year', label: '今期' },
  { value: 'current_month', label: '今月' },
  { value: 'last_month', label: '先月' },
  { value: 'all', label: '全期間' },
];

const SORT_OPTIONS: { value: SortSpec; label: string }[] = [
  { value: 'value_desc', label: '値の多い順' },
  { value: 'value_asc', label: '値の少ない順' },
  { value: 'label', label: '名前順' },
];

/** テンプレごとにどの入力欄を出すか(cards.tsのALLOWED_PARAM_KEYSと完全に同じ表を参照する
 * ——card-controls.tsのチップと同じ「存在する組み合わせしか出さない」というガードレール)。 */
export interface BuilderFieldVisibility {
  entity: boolean;
  dimension: boolean;
  dimensionB: boolean;
  metric: boolean;
  topN: boolean;
  sort: boolean;
  /** コンボ(棒+折れ線)専用の「第2の指標」欄。T2の他の見た目では常にfalse。 */
  comboMetric: boolean;
}

export function builderFieldsFor(template: TemplateId): BuilderFieldVisibility {
  const allowed = allowedParamKeys(template);
  return {
    entity: allowed.includes('entity'),
    dimension: allowed.includes('dimension'),
    dimensionB: allowed.includes('dimensionB'),
    metric: allowed.includes('metric'),
    topN: allowed.includes('topN'),
    sort: allowed.includes('sort'),
    comboMetric: false,
  };
}

/** 選んだ「見た目」に対する入力欄の表示可否。月別推移(trend_line)はT2だが、切り口
 * (dimension)は使わない(日付を月単位でバケット化するだけで、カテゴリの切り口を選ばない)
 * ——builderFieldsForの結果をそのまま使わず、ここで上書きする。 */
export function fieldsForVisual(visual: BuilderVisual): BuilderFieldVisibility {
  const def = visualDefOf(visual);
  const fields = builderFieldsFor(def.template);
  if (def.timeGranularity) {
    return { ...fields, dimension: false, entity: false, sort: false };
  }
  if (def.scatter) {
    // 散布図はY軸(金額)を固定するため指標選択を出さない——切り口(X軸)は選ぶ。
    return { ...fields, metric: false, topN: false, sort: false };
  }
  if (def.combo) {
    // コンボは指標を2つ選ぶ(1本目=棒、2本目=折れ線)。上位N件・並び順は2系列の対応が
    // 崩れるため出さない(2つの指標で「上位」の基準が食い違ってしまうため)。
    return { ...fields, comboMetric: true, topN: false, sort: false };
  }
  return fields;
}

/** 選べる次元の候補(指定したtargetAppのものだけに絞る——案件側とリード側を混在させない)。 */
export function dimensionOptionsFor(targetApp?: 'opportunity' | 'lead'): DimensionDef[] {
  return (Object.values(DIMENSIONS) as DimensionDef[]).filter((d) => !targetApp || d.targetApp === targetApp);
}

/** 選べる指標の候補(次元がリード側ならcountのみ——runAggregateの制約と同じ)。 */
export function metricOptionsFor(dimensionCode?: DimensionCode): MetricDef[] {
  const dim = dimensionCode ? DIMENSIONS[dimensionCode] : undefined;
  if (dim?.targetApp === 'lead') return [METRICS.count];
  return Object.values(METRICS) as MetricDef[];
}

function injectChartBuilderStyles(): void {
  if (document.getElementById('exh-chart-builder-styles')) return;
  const style = document.createElement('style');
  style.id = 'exh-chart-builder-styles';
  style.textContent = `
.exh-chart-builder { grid-column: 1 / -1; border: 1px dashed ${THEME.mistLine}; border-radius: 10px; padding: 12px; }
.exh-chart-builder-title { font-size: 12.5px; font-weight: 800; color: ${THEME.ink}; margin-bottom: 8px; }
.exh-chart-builder-fields { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
.exh-chart-builder-field { display: flex; flex-direction: column; gap: 3px; min-width: 120px; }
.exh-chart-builder-field label { font-size: 10.5px; font-weight: 700; color: #5a6b7a; }
.exh-chart-builder-field select, .exh-chart-builder-field input { border: 1px solid ${THEME.mistLine}; border-radius: 6px;
  padding: 5px 8px; font-size: 12px; font-family: ${THEME.font}; background: #fff; color: ${THEME.ink}; }
.exh-chart-builder-build-btn { border: none; background: ${THEME.sora}; color: #fff; font-size: 12.5px; font-weight: 700;
  padding: 7px 16px; border-radius: 999px; cursor: pointer; }
.exh-chart-builder-build-btn:hover { background: ${THEME.soraDeep}; }
.exh-chart-builder-preview { margin-top: 14px; border-top: 1px solid ${THEME.mistLine}; padding-top: 12px; }
.exh-chart-builder-preview-title { font-size: 12.5px; font-weight: 800; color: ${THEME.ink}; margin-bottom: 6px; }
/* renderVisual()はbi-chat.tsと同じクラス名(exh-bi-chart-host/exh-bi-chart-tall)を使うため、
   プレビュー用のサイズはここで上書きする(ダッシュボードの固定カードより少し広めに取る
   ——ビルダーは常に全幅なので、他のカードより余裕がある)。 */
.exh-chart-builder .exh-bi-chart-host { width: 100%; height: 260px; }
.exh-chart-builder .exh-bi-chart-host.exh-bi-chart-tall { height: 340px; }
.exh-chart-builder-pin-btn { margin-top: 8px; border: 1px solid ${THEME.mistLine}; background: ${THEME.cloud};
  color: ${THEME.soraDeep}; font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 999px; cursor: pointer; }
.exh-chart-builder-pin-btn:hover { background: ${THEME.mist}; }
.exh-chart-builder-pin-btn:disabled { opacity: .6; cursor: default; }
`;
  document.head.appendChild(style);
}

function makeField(labelText: string): { wrap: HTMLElement; select: HTMLSelectElement } {
  const wrap = document.createElement('div');
  wrap.className = 'exh-chart-builder-field';
  const label = document.createElement('label');
  label.textContent = labelText;
  wrap.appendChild(label);
  const select = document.createElement('select');
  wrap.appendChild(select);
  return { wrap, select };
}

function setOptions(select: HTMLSelectElement, options: { value: string; label: string }[]): void {
  const prev = select.value;
  select.innerHTML = '';
  for (const opt of options) {
    const el = document.createElement('option');
    el.value = opt.value;
    el.textContent = opt.label;
    select.appendChild(el);
  }
  if (options.some((o) => o.value === prev)) select.value = prev;
}

/**
 * 選ばれた見た目に応じて、対応するチャートコンポーネントで描画する。集計(buildBiResult)は
 * どの見た目でも共通——ここで分岐するのは「同じデータをどう見せるか」だけ。
 * dashboard.ts(ピン留めカードの再描画)とこのファイル自身(プレビュー)の両方から呼ばれる
 * ため、サイズ調整用のクラス名は引数で受け取る——既定値は bi-chat.ts の renderBiChart() と
 * 同じクラス名(exh-bi-chart-host/exh-bi-chart-tall)にして、ダッシュボードの既存CSS
 * (#exh-bi-dashboard .exh-bi-chart-host 等のサイズ上書き)がそのまま効くようにしている。
 */
export function renderVisual(
  container: HTMLElement,
  visual: BuilderVisual,
  biResult: BuiltBiResult,
  hostClassName = 'exh-bi-chart-host',
  tallClassName = 'exh-bi-chart-tall',
): () => void {
  const chartHost = document.createElement('div');
  chartHost.className = hostClassName;
  container.appendChild(chartHost);

  switch (visual) {
    case 'kpi':
      chartHost.classList.remove(hostClassName);
      chartHost.style.height = 'auto';
      renderKpiCard(chartHost, biResult.data as PayloadFor<'T1'>);
      return () => undefined;
    case 'gauge':
      return renderGauge(chartHost, biResult.data as PayloadFor<'T1'>);
    case 'bar_h':
      return renderBarH(chartHost, biResult.data as PayloadFor<'T2'>);
    case 'bar_v':
      return renderBarV(chartHost, biResult.data as PayloadFor<'T2'>);
    case 'donut':
      return renderDonut(chartHost, biResult.data as PayloadFor<'T2'>);
    case 'area':
      return renderAreaChart(chartHost, biResult.data as PayloadFor<'T2'>);
    case 'scatter':
      return renderScatter(chartHost, biResult.data as PayloadFor<'T2'>);
    case 'trend_line':
      return renderLineChart(chartHost, biResult.data as PayloadFor<'T2'>);
    case 'trend_area':
      return renderAreaChart(chartHost, biResult.data as PayloadFor<'T2'>);
    case 'funnel':
      return renderFunnel(chartHost, biResult.data as PayloadFor<'T4'>);
    case 'crosstab_heatmap':
      chartHost.classList.add(tallClassName);
      return renderHeatmap(chartHost, biResult.data as PayloadFor<'T5'>);
    case 'crosstab_grouped_h':
      chartHost.classList.add(tallClassName);
      return renderCrossTabBar(chartHost, biResult.data as PayloadFor<'T5'>, { stacked: false, horizontal: true });
    case 'crosstab_grouped_v':
      chartHost.classList.add(tallClassName);
      return renderCrossTabBar(chartHost, biResult.data as PayloadFor<'T5'>, { stacked: false, horizontal: false });
    case 'crosstab_stacked_h':
      chartHost.classList.add(tallClassName);
      return renderCrossTabBar(chartHost, biResult.data as PayloadFor<'T5'>, { stacked: true, horizontal: true });
    case 'crosstab_stacked_v':
      chartHost.classList.add(tallClassName);
      return renderCrossTabBar(chartHost, biResult.data as PayloadFor<'T5'>, { stacked: true, horizontal: false });
    case 'record_list':
      chartHost.classList.remove(hostClassName);
      chartHost.style.height = 'auto';
      renderRecordList(chartHost, biResult.data as PayloadFor<'T8'>);
      return () => undefined;
    default:
      return () => undefined;
  }
}

/** template(T1/T2/T4/T5/T8)から既定の見た目を1つ選ぶ——固定6枚のようにvisualを持たない
 * カード(ユーザーが明示的に見た目を選んでいない場合)のフォールバック用。既存の自動選択
 * (bi-chat.tsのrenderBiChart)とは違い、ここではドーナツを既定にせず横棒を既定にする——
 * chart-builder.ts経由で明示的にvisualを選んだカードとの一貫性より、fallback自体の単純さを
 * 優先している(固定6枚は今まで通りrenderBiChartの自動選択を使い続けるため、実際にはこの
 * フォールバックが使われるのは「visualの無い古いピン留めカード」のような限定的なケースのみ)。 */
function defaultVisualFor(template: TemplateId): BuilderVisual {
  switch (template) {
    case 'T1':
      return 'kpi';
    case 'T2':
      return 'bar_h';
    case 'T4':
      return 'funnel';
    case 'T5':
      return 'crosstab_heatmap';
    case 'T8':
      return 'record_list';
    default:
      return 'kpi';
  }
}

/** カードのparams.visualを妥当な BuilderVisual として解決する(不正・未設定ならテンプレの
 * 既定値にフォールバックする)。dashboard.tsがピン留めカードを再描画する際に使う。 */
export function resolveVisual(template: TemplateId, visual: string | undefined): BuilderVisual {
  if (visual && VISUALS.some((v) => v.code === visual && v.template === template)) return visual as BuilderVisual;
  return defaultVisualFor(template);
}

export function isComboVisual(visual: BuilderVisual): boolean {
  return visualDefOf(visual).combo === true;
}

function periodPresetOfParams(params: TemplateParams): PeriodPreset {
  const p = params.period;
  return p && 'preset' in p ? p.preset : 'current_fiscal_year';
}

export interface ComboResult {
  bar: ComboSeriesInput;
  line: ComboSeriesInput;
  title: string;
  interpretation: string;
  filtersApplied: { label: string; value: string }[];
  /** 「このグラフについて聞く」用の代表データ(棒=1本目の指標の集計結果)。コンボ全体を
   * 1つのT2データとして表現できないため、narrate/factSheetは1本目の指標だけを見て話す
   * ——2本とも詳しく話せるようにするより、既存のbuildFactSheet(PayloadFor<'T2'>前提)を
   * そのまま安全に使えることを優先した割り切り。 */
  primaryData: PayloadFor<'T2'>;
}
export type ComboOutcome = { ok: true; result: ComboResult } | { ok: false; message: string };

/**
 * 棒(metric)+折れ線(comboMetric)のコンボチャートを組み立てる。buildBiResultを指標ごとに
 * 2回呼ぶだけで、集計ロジック自体は他のT2カードと完全に同じ——2回分の結果を1つのグラフに
 * まとめる部分だけがコンボ特有の処理。dashboard.ts(ピン留めカードの再描画)と
 * このファイル自身(プレビュー)の両方から呼ぶ。
 */
export function buildComboOutcome(
  datasets: { opportunityRecords: KintoneRecordFields[]; leadRecords: KintoneRecordFields[] },
  params: TemplateParams,
  today: Date,
): ComboOutcome {
  if (!params.metric || !params.comboMetric) {
    return { ok: false, message: '2つの指標を選んでください。' };
  }
  const shared = {
    template: 'T2' as const,
    dimension: params.dimension,
    period: periodPresetOfParams(params),
    filters: params.filters,
  };
  const outcomeA = buildBiResult(datasets, { ...shared, metric: params.metric }, today, resolvePeriodPreset);
  if (!outcomeA.ok) return { ok: false, message: outcomeA.message };
  const outcomeB = buildBiResult(datasets, { ...shared, metric: params.comboMetric }, today, resolvePeriodPreset);
  if (!outcomeB.ok) return { ok: false, message: outcomeB.message };

  const dataA = outcomeA.biResult.data as PayloadFor<'T2'>;
  const dataB = outcomeB.biResult.data as PayloadFor<'T2'>;
  return {
    ok: true,
    result: {
      bar: { metricLabel: dataA.metric.label, metricUnit: dataA.metric.unit, series: dataA.series },
      line: { metricLabel: dataB.metric.label, metricUnit: dataB.metric.unit, series: dataB.series },
      title: `${outcomeA.biResult.title} / ${outcomeB.biResult.title}`,
      interpretation: `${outcomeA.biResult.interpretation} ${outcomeB.biResult.interpretation}`,
      filtersApplied: outcomeA.biResult.filtersApplied,
      primaryData: dataA,
    },
  };
}

/** ComboResultをrenderComboChart()で描画する。renderVisual()と同じ理由でクラス名を
 * 引数化している(dashboard.tsとこのファイルの両方から使うため)。 */
export function renderCombo(
  container: HTMLElement,
  result: ComboResult,
  hostClassName = 'exh-bi-chart-host',
  tallClassName = 'exh-bi-chart-tall',
): () => void {
  const chartHost = document.createElement('div');
  chartHost.className = `${hostClassName} ${tallClassName}`;
  container.appendChild(chartHost);
  return renderComboChart(chartHost, result.bar, result.line);
}

export interface ChartBuilderCallbacks {
  /** 「📌 ダッシュボードにピン留め」押下時に呼ばれる。成功したら呼び出し側でダッシュボードを再描画する。 */
  onPin: (card: ChatCardState) => Promise<void>;
}

/**
 * container に「グラフビルダー」を描画する。ダッシュボードの固定6枚の下に常設し、
 * ユーザーが意味レイヤーの範囲内で自由にグラフを組み立てられるようにする(Power BIの
 * X軸/Y軸選択に相当——ただし選べる項目は検証済みのものだけ)。
 */
export function renderChartBuilder(
  container: HTMLElement,
  datasets: { opportunityRecords: KintoneRecordFields[]; leadRecords: KintoneRecordFields[] },
  today: Date,
  callbacks: ChartBuilderCallbacks,
): void {
  injectChartBuilderStyles();
  container.className = 'exh-chart-builder';
  container.innerHTML = '';

  const titleEl = document.createElement('div');
  titleEl.className = 'exh-chart-builder-title';
  titleEl.textContent = '📊 グラフを作成';
  container.appendChild(titleEl);

  const fieldsRow = document.createElement('div');
  fieldsRow.className = 'exh-chart-builder-fields';
  container.appendChild(fieldsRow);

  const visualField = makeField('種類');
  setOptions(visualField.select, VISUALS.map((v) => ({ value: v.code, label: v.label })));
  fieldsRow.appendChild(visualField.wrap);

  const entityField = makeField('対象');
  setOptions(entityField.select, [
    { value: 'opportunity', label: '案件' },
    { value: 'lead', label: 'リード' },
  ]);
  fieldsRow.appendChild(entityField.wrap);

  const dimensionField = makeField('切り口(X軸)');
  fieldsRow.appendChild(dimensionField.wrap);

  const dimensionBField = makeField('第2の切り口');
  fieldsRow.appendChild(dimensionBField.wrap);

  const metricField = makeField('指標(Y軸)');
  fieldsRow.appendChild(metricField.wrap);

  const comboMetricField = makeField('第2の指標(折れ線)');
  fieldsRow.appendChild(comboMetricField.wrap);

  const periodField = makeField('期間');
  setOptions(periodField.select, PERIOD_OPTIONS);
  fieldsRow.appendChild(periodField.wrap);

  const topNField = makeField('上位N件');
  const topNInput = document.createElement('input');
  topNInput.type = 'number';
  topNInput.min = '1';
  topNInput.placeholder = '(指定なし)';
  topNField.wrap.replaceChild(topNInput, topNField.select);
  fieldsRow.appendChild(topNField.wrap);

  const sortField = makeField('並び順');
  setOptions(sortField.select, SORT_OPTIONS);
  fieldsRow.appendChild(sortField.wrap);

  const buildBtn = document.createElement('button');
  buildBtn.type = 'button';
  buildBtn.className = 'exh-chart-builder-build-btn';
  buildBtn.textContent = 'グラフを作成';
  fieldsRow.appendChild(buildBtn);

  const previewWrap = document.createElement('div');
  previewWrap.className = 'exh-chart-builder-preview';
  previewWrap.style.display = 'none';
  container.appendChild(previewWrap);
  let disposePreview: (() => void) | undefined;

  // 選んだ見た目/次元に応じて、表示する欄・選べる候補を更新する
  // (存在しない組み合わせのフィールドはそもそも出さない——ガードレール)。
  function syncFieldVisibility(): void {
    const visual = visualField.select.value as BuilderVisual;
    const fields = fieldsForVisual(visual);
    entityField.wrap.style.display = fields.entity ? '' : 'none';
    dimensionField.wrap.style.display = fields.dimension ? '' : 'none';
    dimensionBField.wrap.style.display = fields.dimensionB ? '' : 'none';
    metricField.wrap.style.display = fields.metric ? '' : 'none';
    comboMetricField.wrap.style.display = fields.comboMetric ? '' : 'none';
    topNField.wrap.style.display = fields.topN ? '' : 'none';
    sortField.wrap.style.display = fields.sort ? '' : 'none';

    if (fields.dimension) {
      setOptions(dimensionField.select, dimensionOptionsFor().map((d) => ({ value: d.code, label: d.label })));
    }
    syncDimensionBOptions();
    syncMetricOptions();
  }

  // 第2の切り口は、1つ目の切り口と同じ対象(案件/リード)のものだけに絞る
  // (T5は同じ対象どうしのクロス集計しかrunAggregateが受け付けないため)。
  function syncDimensionBOptions(): void {
    if (dimensionBField.wrap.style.display === 'none') return;
    const dim = dimensionField.select.value as DimensionCode | '';
    const targetApp = dim ? DIMENSIONS[dim]?.targetApp : undefined;
    setOptions(
      dimensionBField.select,
      dimensionOptionsFor(targetApp)
        .filter((d) => d.code !== dim)
        .map((d) => ({ value: d.code, label: d.label })),
    );
  }

  // 指標は、選ばれている切り口がリード側ならcountだけに絞る(runAggregateの制約と同じ)。
  // 月別推移(次元を使わない)はcloseDateが案件にしか無いため常に全指標を候補にする。
  function syncMetricOptions(): void {
    const fields = fieldsForVisual(visualField.select.value as BuilderVisual);
    const dim = fields.dimension ? (dimensionField.select.value as DimensionCode | '') : undefined;
    const options = metricOptionsFor(dim || undefined).map((m) => ({ value: m.code, label: m.label }));
    if (metricField.wrap.style.display !== 'none') setOptions(metricField.select, options);
    if (fields.comboMetric) setOptions(comboMetricField.select, options);
  }

  visualField.select.addEventListener('change', syncFieldVisibility);
  dimensionField.select.addEventListener('change', () => {
    syncDimensionBOptions();
    syncMetricOptions();
  });

  syncFieldVisibility();

  // プレビュー下の「📌 ダッシュボードにピン留め」ボタン。単一グラフ・コンボの両方から呼ぶ
  // (押した後の挙動はどちらも同じ——onPin()を呼んで完了メッセージに切り替えるだけ)。
  // getCardStateを都度呼ぶことで、グラフ単位のチャット(card-chat.ts)でリファインした後に
  // ピン留めしても、リファイン後の最新の内容がそのままピン留めされるようにしている。
  function appendPinButton(getCardState: () => ChatCardState): void {
    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'exh-chart-builder-pin-btn';
    pinBtn.textContent = '📌 ダッシュボードにピン留め';
    pinBtn.addEventListener('click', () => {
      pinBtn.disabled = true;
      pinBtn.textContent = 'ピン留め中...';
      callbacks
        .onPin(getCardState())
        .then(() => {
          pinBtn.textContent = '📌 ピン留めしました';
        })
        .catch(() => {
          pinBtn.disabled = false;
          pinBtn.textContent = '📌 ダッシュボードにピン留め';
        });
    });
    previewWrap.appendChild(pinBtn);
  }

  buildBtn.addEventListener('click', () => {
    const visual = visualField.select.value as BuilderVisual;
    const visualDef = visualDefOf(visual);
    const fields = fieldsForVisual(visual);
    const params: TemplateParams = {
      period: { preset: periodField.select.value as PeriodPreset },
      visual, // ピン留め後も選んだ見た目のまま再描画するため(dashboard.tsのrenderCard参照)。
    };
    if (visualDef.timeGranularity) params.timeGranularity = visualDef.timeGranularity;
    if (fields.entity) params.entity = entityField.select.value as 'opportunity' | 'lead';
    if (fields.dimension) params.dimension = dimensionField.select.value as DimensionCode;
    if (fields.dimensionB) params.dimensionB = dimensionBField.select.value as DimensionCode;
    if (fields.metric) params.metric = metricField.select.value as MetricCode;
    if (fields.comboMetric) params.comboMetric = comboMetricField.select.value as MetricCode;
    if (fields.topN && topNInput.value) params.topN = Number(topNInput.value);
    if (fields.sort) params.sort = sortField.select.value as SortSpec;

    disposePreview?.();
    previewWrap.style.display = '';
    previewWrap.innerHTML = '';

    const previewTitleEl = document.createElement('div');
    previewTitleEl.className = 'exh-chart-builder-preview-title';
    previewWrap.appendChild(previewTitleEl);

    // チャート本体だけを別のコンテナに入れておく——グラフ単位のチャットでリファインした際、
    // タイトル/チャット欄/ピン留めボタンには触れずチャートだけを差し替えられるようにするため。
    const chartWrap = document.createElement('div');
    previewWrap.appendChild(chartWrap);

    // コンボ(棒+折れ線)は指標を2回集計する特別な組み立てが必要——buildBiResultを1回だけ
    // 呼ぶ通常経路とは別に処理する。n8n側がcomboMetricを解釈できないため、グラフ単位の
    // チャットもコンボには提供しない(card-chat.ts冒頭のコメント参照)。
    if (visualDef.combo) {
      const comboOutcome = buildComboOutcome(datasets, params, today);
      if (!comboOutcome.ok) {
        renderVizError(previewWrap, comboOutcome.message);
        return;
      }
      previewTitleEl.textContent = comboOutcome.result.title;
      disposePreview = renderCombo(chartWrap, comboOutcome.result);

      appendPinButton(() => ({
        template: 'T2',
        params,
        title: comboOutcome.result.title,
        interpretation: comboOutcome.result.interpretation,
        filtersApplied: comboOutcome.result.filtersApplied,
        data: comboOutcome.result.primaryData,
      }));
      return;
    }

    const outcome = buildBiResult(
      datasets,
      {
        template: visualDef.template,
        metric: params.metric as MetricCode,
        dimension: params.dimension,
        dimensionB: params.dimensionB,
        filters: [],
        period: periodField.select.value as PeriodPreset,
        entity: params.entity,
        topN: params.topN,
        sort: params.sort,
        timeGranularity: params.timeGranularity,
        scatter: visualDef.scatter,
      },
      today,
      resolvePeriodPreset,
    );

    if (!outcome.ok) {
      renderVizError(previewWrap, outcome.message);
      return;
    }

    previewTitleEl.textContent = outcome.biResult.title;
    disposePreview = renderVisual(chartWrap, visual, outcome.biResult);

    // ピン留め前でも自然言語で調整できるようにする(方針書§3.3「②作成→③チャットで
    // 微調整→④ピン留め」の順序どおり)。cardStateはletで持ち、リファインのたびに
    // 差し替える——appendPinButtonはgetCardState()で常に最新の内容を読むため、
    // リファイン後にピン留めしても最新の内容がそのまま保存される。
    let cardState: ChatCardState = {
      template: visualDef.template,
      params,
      title: outcome.biResult.title,
      interpretation: outcome.biResult.interpretation,
      filtersApplied: outcome.biResult.filtersApplied,
      data: outcome.biResult.data,
    };

    const chatWrap = document.createElement('div');
    previewWrap.appendChild(chatWrap);
    renderCardChat(chatWrap, cardState, {
      onUpdated: (newCard, biResult) => {
        cardState = newCard;
        if (!biResult) return;
        previewTitleEl.textContent = newCard.title || biResult.title;
        disposePreview?.();
        chartWrap.innerHTML = '';
        disposePreview = renderVisual(chartWrap, visual, biResult);
      },
    });

    appendPinButton(() => cardState);
  });
}
