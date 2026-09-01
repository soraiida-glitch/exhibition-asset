import type { PayloadFor } from '../../semantic/templates';
import { formatMetricNumber } from '../format-utils';
import { CHART_COLORS, renderChart } from './echarts-base';

/**
 * 「月別推移」(T2 + timeGranularity: 'month')向けの折れ線グラフ。データ契約は通常のT2
 * (PayloadFor<'T2'>)と全く同じ——series の key が月ラベル("2026-04"等)である点だけが違う。
 * X軸は必ず時系列順(データの並び順をそのまま使う——ソートし直さない)。
 */
export function renderLineChart(container: HTMLElement, payload: PayloadFor<'T2'>): () => void {
  const categories = payload.series.map((s) => s.key);
  const values = payload.series.map((s) => s.value);

  return renderChart(container, {
    grid: { left: 56, right: 16, top: 20, bottom: 32, containLabel: true },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v) => formatMetricNumber(Number(v), payload.metric.unit),
    },
    xAxis: {
      type: 'category',
      data: categories,
      boundaryGap: false,
      axisLabel: { color: CHART_COLORS.label, fontSize: 11, fontWeight: 700 },
      axisLine: { lineStyle: { color: CHART_COLORS.grid } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: CHART_COLORS.label, fontSize: 11, formatter: (v: number) => formatMetricNumber(v, payload.metric.unit) },
      splitLine: { lineStyle: { color: CHART_COLORS.grid } },
    },
    series: [
      {
        type: 'line',
        data: values,
        smooth: false,
        symbolSize: 7,
        lineStyle: { color: CHART_COLORS.primary, width: 3 },
        itemStyle: { color: CHART_COLORS.primaryDeep },
        areaStyle: { color: CHART_COLORS.primary, opacity: 0.12 },
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
