import type { PayloadFor } from '../../semantic/templates';
import { formatMetricNumber } from '../format-utils';
import { CHART_COLORS, renderChart } from './echarts-base';

/** T4(パイプライン/ファネル)。ステップの順序は semantic/aggregate.ts の aggregateFunnel が既に確定させている。
 * ラベルは各セグメントの外側(右)に引き出し線付きで出す——中に収めようとすると、コンパクトな
 * 高さ(ダッシュボードのカード内など)でセグメントが細くなった時にラベル同士が重なって
 * 読めなくなる実害があったため。 */
export function renderFunnel(container: HTMLElement, payload: PayloadFor<'T4'>): () => void {
  return renderChart(container, {
    tooltip: {
      trigger: 'item',
      valueFormatter: (v) => formatMetricNumber(Number(v), payload.metric.unit),
    },
    series: [
      {
        type: 'funnel',
        left: '4%',
        right: '30%',
        top: 12,
        bottom: 12,
        min: 0,
        sort: 'none', // 値の大小ではなく、渡された stage 順(工程順)をそのまま描画する
        gap: 4,
        label: {
          show: true,
          position: 'right',
          color: CHART_COLORS.label,
          fontWeight: 700,
          fontSize: 12,
          formatter: (p) => `${p.name}  ${formatMetricNumber(Number(p.value), payload.metric.unit)}`,
        },
        labelLine: { show: true, length: 12, lineStyle: { color: CHART_COLORS.grid } },
        itemStyle: { borderColor: '#fff', borderWidth: 1 },
        color: [...CHART_COLORS.neutralSteps],
        data: payload.steps.map((s) => ({ name: s.stage, value: s.value })),
      },
    ],
  });
}
