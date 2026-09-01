import type { PayloadFor } from '../../semantic/templates';
import { formatMetricNumber } from '../format-utils';
import { CHART_COLORS, renderChart } from './echarts-base';

/**
 * 折れ線グラフ。「月別推移」(T2 + timeGranularity: 'month')に加え、通常のカテゴリ別T2
 * データにも使える——データ契約はどちらもPayloadFor<'T2'>で同じ(series の key が
 * 月ラベルかカテゴリ名かの違いだけ)。X軸はデータの並び順をそのまま使う(月別推移なら
 * 時系列順のまま、ソートし直さない)。
 *
 * areaOpacityで面グラフ(要件書に対するユーザー追加要望)も兼ねる——折れ線の下の塗りを
 * 薄く(既定0.12)か濃く(renderAreaChart経由で0.55)するだけの違いで、集計・データは
 * 完全に同じため別コンポーネントには分けていない。
 */
export function renderLineChart(container: HTMLElement, payload: PayloadFor<'T2'>, areaOpacity = 0.12): () => void {
  const categories = payload.series.map((s) => s.key);
  const values = payload.series.map((s) => s.value);

  return renderChart(container, {
    grid: { left: 56, right: 16, top: 20, bottom: 48, containLabel: true },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v) => formatMetricNumber(Number(v), payload.metric.unit),
    },
    xAxis: {
      type: 'category',
      data: categories,
      boundaryGap: false,
      axisLabel: { color: CHART_COLORS.label, fontSize: 11, fontWeight: 700, interval: 0, rotate: categories.length > 6 ? 30 : 0 },
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
        areaStyle: { color: CHART_COLORS.primary, opacity: areaOpacity },
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

/** 面グラフ(折れ線の下をしっかり塗りつぶす見た目)。データ・集計はrenderLineChartと完全に同じ。 */
export function renderAreaChart(container: HTMLElement, payload: PayloadFor<'T2'>): () => void {
  return renderLineChart(container, payload, 0.55);
}
