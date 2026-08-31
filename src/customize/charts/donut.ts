import type { PayloadFor } from '../../semantic/templates';
import { formatMetricNumber } from '../format-utils';
import { CHART_COLORS, renderChart } from './echarts-base';

/** T2(カテゴリ別集計)の「全体に占める割合」表示。カテゴリ数が多い/ランキング目的なら BarH を使う。 */
export function renderDonut(container: HTMLElement, payload: PayloadFor<'T2'>): () => void {
  const total = payload.series.reduce((sum, s) => sum + s.value, 0);

  return renderChart(container, {
    color: [...CHART_COLORS.neutralSteps],
    tooltip: {
      trigger: 'item',
      valueFormatter: (v) => formatMetricNumber(Number(v), payload.metric.unit),
    },
    legend: {
      orient: 'vertical',
      right: 8,
      top: 'middle',
      textStyle: { color: CHART_COLORS.label, fontSize: 12 },
    },
    series: [
      {
        type: 'pie',
        radius: ['55%', '78%'],
        center: ['38%', '50%'],
        avoidLabelOverlap: true,
        label: { show: false },
        labelLine: { show: false },
        data: payload.series.map((s) => ({ name: s.key, value: s.value })),
      },
      // 中心のラベル(合計)は独立した pie シリーズではなく title で表現するとレイアウトが崩れやすいため、
      // 見えない極小の中心テキストとして表現する(既存 viz.ts の donut-hole の考え方を踏襲)。
    ],
    graphic: [
      {
        type: 'text',
        left: '38%',
        top: '50%',
        style: {
          text: formatMetricNumber(total, payload.metric.unit),
          textAlign: 'center',
          textVerticalAlign: 'middle',
          fill: CHART_COLORS.label,
          fontSize: 14,
          fontWeight: 700,
          lineHeight: 18,
        },
      },
    ],
  });
}
