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
 * 集計ロジックを経路によって分岐/重複させない)。作成したグラフは「📌 ダッシュボードに
 * ピン留め」から永続化でき、その後は他の固定カードと完全に同じ扱いになる。
 */
import type { KintoneRecordFields } from '../semantic/aggregate';
import { buildBiResult } from '../semantic/aggregate';
import { allowedParamKeys } from '../semantic/cards';
import type { ChatCardState, SortSpec, TemplateParams } from '../semantic/cards';
import { DIMENSIONS, type DimensionCode, type DimensionDef } from '../semantic/dimensions';
import { METRICS, type MetricCode, type MetricDef } from '../semantic/metrics';
import { resolvePeriodPreset, type PeriodPreset } from '../semantic/fiscal';
import type { BiResult, TemplateId } from '../semantic/templates';
import { renderBiChart } from './bi-chat';
import { THEME } from './theme';
import { renderVizError } from './viz';

const TEMPLATE_VISUAL_LABELS: Record<TemplateId, string> = {
  T1: '数値カード',
  T2: 'カテゴリ別グラフ',
  T4: 'パイプライン(ファネル)',
  T5: 'クロス集計ヒートマップ',
  T8: '案件一覧',
};

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
  };
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
.exh-chart-builder .exh-bi-chart-host { height: 220px; }
.exh-chart-builder .exh-bi-chart-host.exh-bi-chart-tall { height: 300px; }
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

  const templateField = makeField('種類');
  setOptions(
    templateField.select,
    (Object.keys(TEMPLATE_VISUAL_LABELS) as TemplateId[]).map((t) => ({ value: t, label: TEMPLATE_VISUAL_LABELS[t] })),
  );
  fieldsRow.appendChild(templateField.wrap);

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

  // 選んだテンプレ/次元に応じて、表示する欄・選べる候補を更新する
  // (存在しない組み合わせのフィールドはそもそも出さない——ガードレール)。
  function syncFieldVisibility(): void {
    const template = templateField.select.value as TemplateId;
    const fields = builderFieldsFor(template);
    entityField.wrap.style.display = fields.entity ? '' : 'none';
    dimensionField.wrap.style.display = fields.dimension ? '' : 'none';
    dimensionBField.wrap.style.display = fields.dimensionB ? '' : 'none';
    metricField.wrap.style.display = fields.metric ? '' : 'none';
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
  function syncMetricOptions(): void {
    if (metricField.wrap.style.display === 'none') return;
    const template = templateField.select.value as TemplateId;
    const fields = builderFieldsFor(template);
    const dim = fields.dimension ? (dimensionField.select.value as DimensionCode | '') : undefined;
    setOptions(metricField.select, metricOptionsFor(dim || undefined).map((m) => ({ value: m.code, label: m.label })));
  }

  templateField.select.addEventListener('change', syncFieldVisibility);
  dimensionField.select.addEventListener('change', () => {
    syncDimensionBOptions();
    syncMetricOptions();
  });

  syncFieldVisibility();

  buildBtn.addEventListener('click', () => {
    const template = templateField.select.value as TemplateId;
    const fields = builderFieldsFor(template);
    const params: TemplateParams = {
      period: { preset: periodField.select.value as PeriodPreset },
    };
    if (fields.entity) params.entity = entityField.select.value as 'opportunity' | 'lead';
    if (fields.dimension) params.dimension = dimensionField.select.value as DimensionCode;
    if (fields.dimensionB) params.dimensionB = dimensionBField.select.value as DimensionCode;
    if (fields.metric) params.metric = metricField.select.value as MetricCode;
    if (fields.topN && topNInput.value) params.topN = Number(topNInput.value);
    if (fields.sort) params.sort = sortField.select.value as SortSpec;

    const outcome = buildBiResult(
      datasets,
      {
        template,
        metric: params.metric as MetricCode,
        dimension: params.dimension,
        dimensionB: params.dimensionB,
        filters: [],
        period: periodField.select.value as PeriodPreset,
        entity: params.entity,
        topN: params.topN,
        sort: params.sort,
      },
      today,
      resolvePeriodPreset,
    );

    previewWrap.style.display = '';
    previewWrap.innerHTML = '';

    if (!outcome.ok) {
      renderVizError(previewWrap, outcome.message);
      return;
    }

    const previewTitleEl = document.createElement('div');
    previewTitleEl.className = 'exh-chart-builder-preview-title';
    previewTitleEl.textContent = outcome.biResult.title;
    previewWrap.appendChild(previewTitleEl);

    const chartHost = document.createElement('div');
    previewWrap.appendChild(chartHost);
    renderBiChart(chartHost, outcome.biResult as unknown as BiResult);

    const cardState: ChatCardState = {
      template,
      params,
      title: outcome.biResult.title,
      interpretation: outcome.biResult.interpretation,
      filtersApplied: outcome.biResult.filtersApplied,
      data: outcome.biResult.data,
    };

    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'exh-chart-builder-pin-btn';
    pinBtn.textContent = '📌 ダッシュボードにピン留め';
    pinBtn.addEventListener('click', () => {
      pinBtn.disabled = true;
      pinBtn.textContent = 'ピン留め中...';
      callbacks
        .onPin(cardState)
        .then(() => {
          pinBtn.textContent = '📌 ピン留めしました';
        })
        .catch(() => {
          pinBtn.disabled = false;
          pinBtn.textContent = '📌 ダッシュボードにピン留め';
        });
    });
    previewWrap.appendChild(pinBtn);
  });
}
