import type { PayloadFor } from '../../semantic/templates';
import { formatMetricNumber } from '../format-utils';
import { CHART_COLORS, renderChart } from './echarts-base';

/**
 * 散布図(ユーザー要望)。データ契約はT2と同じ(PayloadFor<'T2'>)だが、series の各要素は
 * 「カテゴリごとの合計値」ではなく「案件1件の金額」——同じカテゴリ(key)に複数の点が
 * 並ぶ(aggregate.tsのextractRecordPoints/buildScatterResult参照)。カテゴリ軸上に
 * ランダムなジッター(横方向のわずかなズレ)を加えて、同額付近の点が重なって
 * 1つに見えてしまわないようにする。
 */
export function renderScatter(container: HTMLElement, payload: PayloadFor<'T2'>): () => void {
  const categories = Array.from(new Set(payload.series.map((s) => s.key)));
  // 同じカテゴリ内の点が横一列に重ならないよう、カテゴリのインデックスに小さな
  // ジッターを加える(見た目だけの調整——値そのものは一切変えない)。
  const seen = new Map<string, number>();
  const data = payload.series.map((s) => {
    const baseIndex = categories.indexOf(s.key);
    const count = seen.get(s.key) || 0;
    seen.set(s.key, count + 1);
    const jitter = ((count % 9) - 4) * 0.035;
    return [baseIndex + jitter, s.value, s.key];
  });

  return renderChart(container, {
    grid: { left: 56, right: 16, top: 20, bottom: 48, containLabel: true },
    tooltip: {
      trigger: 'item',
      formatter: (p: unknown) => {
        const point = p as { data: [number, number, string] };
        return `${point.data[2]}: ${formatMetricNumber(point.data[1], payload.metric.unit)}`;
      },
    },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: { color: CHART_COLORS.label, fontSize: 11, fontWeight: 700, interval: 0, rotate: categories.length > 5 ? 30 : 0 },
      axisLine: { lineStyle: { color: CHART_COLORS.grid } },
      boundaryGap: true,
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: CHART_COLORS.label, fontSize: 11, formatter: (v: number) => formatMetricNumber(v, payload.metric.unit) },
      splitLine: { lineStyle: { color: CHART_COLORS.grid } },
    },
    series: [
      {
        type: 'scatter',
        data,
        symbolSize: 10,
        itemStyle: { color: CHART_COLORS.primary, opacity: 0.75 },
      },
    ],
  });
}
