import type { PayloadFor } from '../../semantic/templates';
import { formatMetricNumber } from '../format-utils';
import { CHART_COLORS, renderChart } from './echarts-base';

/** ゲージの目盛りの最大値を決める。%指標(受注率等)は0〜100が自明なのでそのまま使う。
 * 件数・金額のように上限が無い指標は、値の1.5倍を「きれいな数字」に丸めて目盛りの
 * 最大にする(針が範囲の中間あたりに来るようにする——0にも上限ぴったりにも
 * 針が張り付くと、値の大小が伝わりにくいため)。 */
function niceMax(value: number, unit: string): number {
  if (unit === '%') return 100;
  if (value <= 0) return 1;
  const target = value * 1.5;
  const magnitude = Math.pow(10, Math.floor(Math.log10(target)));
  return Math.ceil(target / magnitude) * magnitude;
}

/** T1(単一KPI)のもう1つの見た目——ゲージ。数値カードと同じデータ(PayloadFor<'T1'>)を
 * 使い、目盛り上の位置で値の大小を直感的に見せる。 */
export function renderGauge(container: HTMLElement, payload: PayloadFor<'T1'>): () => void {
  const max = niceMax(payload.value, payload.unit);

  return renderChart(container, {
    series: [
      {
        type: 'gauge',
        min: 0,
        max,
        progress: { show: true, width: 14, itemStyle: { color: CHART_COLORS.primary } },
        axisLine: { lineStyle: { width: 14, color: [[1, CHART_COLORS.grid]] } },
        pointer: { itemStyle: { color: CHART_COLORS.primaryDeep } },
        axisTick: { show: false },
        splitLine: { length: 10, lineStyle: { color: CHART_COLORS.grid } },
        axisLabel: {
          color: CHART_COLORS.label,
          fontSize: 10,
          distance: 16,
          formatter: (v: number) => formatMetricNumber(v, payload.unit),
        },
        detail: {
          valueAnimation: true,
          formatter: (v: number) => formatMetricNumber(v, payload.unit),
          color: CHART_COLORS.label,
          fontSize: 20,
          fontWeight: 700,
          offsetCenter: [0, '70%'],
        },
        data: [{ value: payload.value }],
      },
    ],
  });
}
