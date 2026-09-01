import type { PayloadFor } from '../../semantic/templates';
import { formatMetricNumber } from '../format-utils';
import { CHART_COLORS, renderChart } from './echarts-base';

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      result.push(v);
    }
  }
  return result;
}

export interface CrossTabBarOptions {
  /** true=積み上げ(1本の棒の中に列カテゴリを積む)、false=集合(列カテゴリごとに棒を並べる)。 */
  stacked: boolean;
  /** true=横棒(カテゴリ軸が縦)、false=縦棒(カテゴリ軸が横)。 */
  horizontal: boolean;
}

/**
 * T5(クロス集計)の同じmatrixデータを、ヒートマップの代わりに棒グラフとして見せる
 * ——グラフビルダー(chart-builder.ts)で「集合縦棒/集合横棒/積み上げ縦棒/積み上げ横棒」を
 * 選んだ場合に使う。列(cols)カテゴリごとに1系列を作り、行(rows)カテゴリを軸のカテゴリに
 * する。新しい集計は一切行わない——同じ matrix を描画方法だけ変えて見せる。
 */
export function renderCrossTabBar(container: HTMLElement, payload: PayloadFor<'T5'>, opts: CrossTabBarOptions): () => void {
  const rowLabels = uniqueInOrder(payload.matrix.map((cell) => cell.row));
  const colLabels = uniqueInOrder(payload.matrix.map((cell) => cell.col));

  const series = colLabels.map((col, i) => ({
    name: col,
    type: 'bar' as const,
    stack: opts.stacked ? 'total' : undefined,
    barMaxWidth: opts.stacked ? 36 : 22,
    itemStyle: { color: CHART_COLORS.neutralSteps[i % CHART_COLORS.neutralSteps.length] },
    data: rowLabels.map((row) => payload.matrix.find((cell) => cell.row === row && cell.col === col)?.value ?? 0),
  }));

  const categoryAxis = {
    type: 'category' as const,
    data: rowLabels,
    axisLabel: { color: CHART_COLORS.label, fontSize: 11, fontWeight: 700, interval: 0, rotate: !opts.horizontal && rowLabels.length > 5 ? 30 : 0 },
    axisLine: { lineStyle: { color: CHART_COLORS.grid } },
    inverse: opts.horizontal,
  };
  const valueAxis = {
    type: 'value' as const,
    axisLabel: { color: CHART_COLORS.label, fontSize: 11, formatter: (v: number) => formatMetricNumber(v, payload.metric.unit) },
    splitLine: { lineStyle: { color: CHART_COLORS.grid } },
  };

  return renderChart(container, {
    grid: opts.horizontal
      ? { left: 90, right: 24, top: 36, bottom: 12, containLabel: true }
      : { left: 56, right: 16, top: 36, bottom: 60, containLabel: true },
    legend: {
      top: 0,
      left: 'center',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: CHART_COLORS.label, fontSize: 11 },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (v) => formatMetricNumber(Number(v), payload.metric.unit),
    },
    xAxis: opts.horizontal ? valueAxis : categoryAxis,
    yAxis: opts.horizontal ? categoryAxis : valueAxis,
    series,
  });
}
