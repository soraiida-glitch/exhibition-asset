import { formatMetricNumber } from '../format-utils';
import { CHART_COLORS, renderChart } from './echarts-base';

export interface ComboSeriesInput {
  metricLabel: string;
  metricUnit: string;
  series: { key: string; value: number }[];
}

/**
 * 棒グラフ+折れ線グラフを1つのグラフにまとめて表示する「コンボチャート」(ユーザー要望:
 * 「棒グラフとか折れ線グラフとかは同じグラフにまとめて表示したいときとかある」)。
 *
 * 2つの指標(例: 金額合計を棒、件数を折れ線)を同じ切り口(dimension、または月別推移)の
 * 上に重ねる——集計は変わらず、chart-builder.ts が buildBiResult() を指標ごとに2回呼んで
 * 得た2つの結果をここで1つのグラフにまとめて描画するだけ。指標ごとに単位・スケールが
 * 違うことが多いため、右軸・左軸に分ける(2軸構成)。
 */
export function renderComboChart(container: HTMLElement, bar: ComboSeriesInput, line: ComboSeriesInput): () => void {
  // barの並び順(カテゴリの順序)を基準にする——2回の集計は同じdimension/期間で行うため
  // カテゴリの集合は基本一致するが、念のためlineに無いキーは0として扱う。
  const categories = bar.series.map((s) => s.key);
  const barValues = bar.series.map((s) => s.value);
  const lineValueByKey = new Map(line.series.map((s) => [s.key, s.value]));
  const lineValues = categories.map((key) => lineValueByKey.get(key) ?? 0);

  return renderChart(container, {
    grid: { left: 64, right: 64, top: 40, bottom: 48, containLabel: true },
    legend: {
      top: 0,
      left: 'center',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: CHART_COLORS.label, fontSize: 11 },
    },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: categories,
      axisLabel: { color: CHART_COLORS.label, fontSize: 11, fontWeight: 700, interval: 0, rotate: categories.length > 6 ? 30 : 0 },
      axisLine: { lineStyle: { color: CHART_COLORS.grid } },
    },
    yAxis: [
      {
        type: 'value',
        name: bar.metricLabel,
        position: 'left',
        axisLabel: { color: CHART_COLORS.label, fontSize: 10, formatter: (v: number) => formatMetricNumber(v, bar.metricUnit) },
        splitLine: { lineStyle: { color: CHART_COLORS.grid } },
      },
      {
        type: 'value',
        name: line.metricLabel,
        position: 'right',
        axisLabel: { color: CHART_COLORS.label, fontSize: 10, formatter: (v: number) => formatMetricNumber(v, line.metricUnit) },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: bar.metricLabel,
        type: 'bar',
        yAxisIndex: 0,
        data: barValues,
        barMaxWidth: 32,
        itemStyle: { color: CHART_COLORS.primary, borderRadius: [4, 4, 0, 0] },
        tooltip: { valueFormatter: (v) => formatMetricNumber(Number(v), bar.metricUnit) },
      },
      {
        name: line.metricLabel,
        type: 'line',
        yAxisIndex: 1,
        data: lineValues,
        symbolSize: 7,
        lineStyle: { color: CHART_COLORS.warn, width: 3 },
        itemStyle: { color: CHART_COLORS.warn },
        tooltip: { valueFormatter: (v) => formatMetricNumber(Number(v), line.metricUnit) },
      },
    ],
  });
}
