import type { PayloadFor } from '../../semantic/templates';
import { CHART_COLORS, renderChart } from './echarts-base';

export interface RenderBarHOptions {
  /** カテゴリキーから、ツールチップの主指標の下にもう1行添える補足文字列を返す(例: 件数)。
   * PayloadFor<'T2'> は単一指標の契約(要件定義書 §4)のため、ダッシュボード移行時に
   * 金額+件数を両方見せていた旧HBarRowとのデグレを避けるための任意拡張。 */
  tooltipExtra?: (key: string) => string | undefined;
}

/**
 * T2(カテゴリ別集計)の横棒表示。件数・金額どちらの metric でも同じ見た目 — 値の意味は
 * `payload.metric` のラベル/単位で決まり、このコンポーネント自身は単位を解釈しない。
 */
export function renderBarH(container: HTMLElement, payload: PayloadFor<'T2'>, opts: RenderBarHOptions = {}): () => void {
  const categories = payload.series.map((s) => s.key);
  const values = payload.series.map((s) => s.value);

  return renderChart(container, {
    grid: { left: 90, right: 24, top: 12, bottom: 12, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const items = Array.isArray(params) ? params : [params];
        const first = items[0] as { name: string; value: number; marker: string };
        const mainLine = `${first.marker}${first.name}: ${Number(first.value).toLocaleString('ja-JP')}${payload.metric.unit}`;
        const extra = opts.tooltipExtra?.(first.name);
        return extra ? `${mainLine}<br/>${extra}` : mainLine;
      },
    },
    xAxis: { type: 'value', axisLabel: { color: CHART_COLORS.label, fontSize: 11 }, splitLine: { lineStyle: { color: CHART_COLORS.grid } } },
    yAxis: {
      type: 'category',
      data: categories,
      inverse: true,
      axisLabel: { color: CHART_COLORS.label, fontSize: 12, fontWeight: 700 },
      axisLine: { lineStyle: { color: CHART_COLORS.grid } },
    },
    series: [
      {
        type: 'bar',
        data: values,
        barMaxWidth: 22,
        itemStyle: { color: CHART_COLORS.primary, borderRadius: [0, 6, 6, 0] },
        label: {
          show: true,
          position: 'right',
          color: CHART_COLORS.label,
          fontSize: 11,
          fontWeight: 700,
          formatter: (p) => Number(p.value).toLocaleString('ja-JP'),
        },
      },
    ],
  });
}
