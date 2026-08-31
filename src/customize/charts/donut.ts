import type { PayloadFor } from '../../semantic/templates';
import { formatMetricNumber } from '../format-utils';
import { CHART_COLORS, renderChart } from './echarts-base';

/**
 * T2(カテゴリ別集計)の「全体に占める割合」表示。カテゴリ数が多い/ランキング目的なら BarH を使う。
 *
 * 凡例はドーナツの右側ではなく下に横並びで置く——右側に縦積みすると、ダッシュボードのように
 * カード自体の横幅が狭い場所ではドーナツ本体と凡例がぶつかって重なってしまう実害があった
 * (幅が狭いほど「右に寄せた分だけ確保できる余白」も狭くなるため)。下に置けば、凡例の行数が
 * 増えるだけで横方向の取り合いは起きない。
 */
export function renderDonut(container: HTMLElement, payload: PayloadFor<'T2'>): () => void {
  const total = payload.series.reduce((sum, s) => sum + s.value, 0);

  return renderChart(container, {
    color: [...CHART_COLORS.neutralSteps],
    tooltip: {
      trigger: 'item',
      valueFormatter: (v) => formatMetricNumber(Number(v), payload.metric.unit),
    },
    legend: {
      orient: 'horizontal',
      bottom: 0,
      left: 'center',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: CHART_COLORS.label, fontSize: 11 },
    },
    series: [
      {
        type: 'pie',
        radius: ['46%', '68%'],
        center: ['50%', '42%'],
        avoidLabelOverlap: true,
        label: { show: false },
        labelLine: { show: false },
        data: payload.series.map((s) => ({ name: s.key, value: s.value })),
      },
    ],
    graphic: [
      {
        type: 'text',
        left: '50%',
        top: '42%',
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
