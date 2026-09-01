import type { PayloadFor } from '../../semantic/templates';
import { formatMetricNumber } from '../format-utils';
import { CHART_COLORS, renderChart } from './echarts-base';

/**
 * T2(カテゴリ別集計)の縦棒表示。renderBarH(横棒)と同じデータ契約——軸を入れ替えただけ。
 * グラフビルダー(chart-builder.ts)でユーザーが「縦棒グラフ」を選んだ場合に使う
 * (自動選択(bi-chat.tsのpickT2Component)は横棒/ドーナツのみを使い続ける——
 * 既存の表示を変えない)。
 */
export function renderBarV(container: HTMLElement, payload: PayloadFor<'T2'>): () => void {
  const categories = payload.series.map((s) => s.key);
  const values = payload.series.map((s) => s.value);

  return renderChart(container, {
    grid: { left: 56, right: 16, top: 20, bottom: 48, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (v) => formatMetricNumber(Number(v), payload.metric.unit),
    },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: { color: CHART_COLORS.label, fontSize: 11, fontWeight: 700, interval: 0, rotate: categories.length > 5 ? 30 : 0 },
      axisLine: { lineStyle: { color: CHART_COLORS.grid } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: CHART_COLORS.label, fontSize: 11, formatter: (v: number) => formatMetricNumber(v, payload.metric.unit) },
      splitLine: { lineStyle: { color: CHART_COLORS.grid } },
    },
    series: [
      {
        type: 'bar',
        data: values,
        barMaxWidth: 36,
        itemStyle: { color: CHART_COLORS.primary, borderRadius: [6, 6, 0, 0] },
        label: {
          show: true,
          position: 'top',
          color: CHART_COLORS.label,
          fontSize: 11,
          fontWeight: 700,
          formatter: (p) => formatMetricNumber(Number(p.value), payload.metric.unit),
        },
      },
    ],
  });
}
