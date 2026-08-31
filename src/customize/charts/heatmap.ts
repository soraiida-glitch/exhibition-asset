import type { PayloadFor } from '../../semantic/templates';
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

/**
 * T5(クロス集計)。代表例: 失注理由×業種。単色の濃淡グラデーション(白 -> THEME.sora -> THEME.soraDeep)
 * のみを使い、レインボーの visualMap にはしない。
 */
export function renderHeatmap(container: HTMLElement, payload: PayloadFor<'T5'>): () => void {
  // payload.rows/cols は「どの次元を使ったか」(DimView) のメタデータで、カテゴリ値そのものではない
  // — 実際の行/列ラベルは matrix に現れた値から復元する(要件定義書 §4 の型定義通り)。
  const rowLabels = uniqueInOrder(payload.matrix.map((cell) => cell.row));
  const colLabels = uniqueInOrder(payload.matrix.map((cell) => cell.col));
  const values = payload.matrix.map((cell) => cell.value);
  const max = values.length > 0 ? Math.max(...values) : 0;

  const data = payload.matrix.map((cell) => [
    colLabels.indexOf(cell.col),
    rowLabels.indexOf(cell.row),
    cell.value,
  ]);

  return renderChart(container, {
    grid: { left: 90, right: 24, top: 12, bottom: 60, containLabel: true },
    tooltip: {
      position: 'top',
      formatter: (p: unknown) => {
        const point = p as { data: [number, number, number] };
        const col = colLabels[point.data[0]];
        const row = rowLabels[point.data[1]];
        const value = point.data[2];
        return `${row} × ${col}<br/>${payload.metric.label}: ${value.toLocaleString('ja-JP')}${payload.metric.unit}`;
      },
    },
    xAxis: {
      type: 'category',
      data: colLabels,
      splitArea: { show: true },
      axisLabel: { color: CHART_COLORS.label, fontSize: 11, interval: 0, rotate: colLabels.length > 4 ? 30 : 0 },
    },
    yAxis: {
      type: 'category',
      data: rowLabels,
      splitArea: { show: true },
      axisLabel: { color: CHART_COLORS.label, fontSize: 12, fontWeight: 700 },
    },
    visualMap: {
      min: 0,
      max: max || 1,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      inRange: { color: ['#ffffff', CHART_COLORS.primary, CHART_COLORS.primaryDeep] },
      textStyle: { color: CHART_COLORS.label },
    },
    series: [
      {
        type: 'heatmap',
        data,
        label: {
          show: true,
          color: '#14233a',
          fontWeight: 700,
          formatter: (p) => String((p.data as number[])[2]),
        },
        emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,.2)' } },
      },
    ],
  });
}
