import type { PayloadFor } from '../../semantic/templates';
import { formatMetricNumber } from '../format-utils';
import { CHART_COLORS, renderChart } from './echarts-base';

/** T4(パイプライン/ファネル)。ステップの順序は semantic/aggregate.ts の aggregateFunnel が既に確定させている。 */
export function renderFunnel(container: HTMLElement, payload: PayloadFor<'T4'>): () => void {
  return renderChart(container, {
    tooltip: {
      trigger: 'item',
      valueFormatter: (v) => formatMetricNumber(Number(v), payload.metric.unit),
    },
    series: [
      {
        type: 'funnel',
        left: '6%',
        right: '24%',
        top: 12,
        bottom: 12,
        min: 0,
        sort: 'none', // 値の大小ではなく、渡された stage 順(工程順)をそのまま描画する
        gap: 4,
        label: {
          show: true,
          position: 'inside',
          color: '#fff',
          fontWeight: 700,
          fontSize: 12,
          formatter: (p) => `${p.name}  ${formatMetricNumber(Number(p.value), payload.metric.unit)}`,
        },
        itemStyle: { borderColor: '#fff', borderWidth: 1 },
        color: [...CHART_COLORS.neutralSteps],
        data: payload.steps.map((s) => ({ name: s.stage, value: s.value })),
      },
    ],
  });
}
