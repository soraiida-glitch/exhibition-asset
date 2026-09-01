/**
 * RELVA BI (要件定義書 §6) — ECharts の共通初期化ヘルパー。
 *
 * kintone の全ページで読み込まれる IIFE バンドルに載るため、`echarts` のフルバンドルではなく
 * `echarts/core` + 実際に使うチャート/コンポーネント/レンダラーだけを明示 import する
 * (tree-shaking 前提のバレルではなく手動選択 — バンドルサイズの規律)。
 *
 * 色は新しいパレットを作らず、既存の THEME(単色アクセント #0098bb + グレー、
 * 本セッションで確立した「レインボー禁止」方針)をそのまま再利用する。
 */
import * as echarts from 'echarts/core';
import { BarChart, PieChart, FunnelChart, HeatmapChart, LineChart } from 'echarts/charts';
import type {
  BarSeriesOption,
  PieSeriesOption,
  FunnelSeriesOption,
  HeatmapSeriesOption,
  LineSeriesOption,
} from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
} from 'echarts/components';
import type {
  GridComponentOption,
  TooltipComponentOption,
  LegendComponentOption,
  VisualMapComponentOption,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { THEME } from '../theme';

echarts.use([
  BarChart,
  PieChart,
  FunnelChart,
  HeatmapChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export type EChartsInstance = echarts.ECharts;
export type EChartsOption = echarts.ComposeOption<
  | BarSeriesOption
  | PieSeriesOption
  | FunnelSeriesOption
  | HeatmapSeriesOption
  | LineSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | VisualMapComponentOption
>;

/**
 * 単色アクセント+グレーのみ。カテゴリが増えても虹色にせず、濃淡(1つの色相の階調)で区別する。
 * 8段階(業種8区分・担当者6名などをカバー)——5段階だった旧配列は、8区分あるドーナツで
 * 色が循環して2区分が同じ色になったり、末尾2色(mistLine/mist)が白背景にほぼ溶け込んで
 * 見分けが付かなくなる実害があったため拡張した。全段階とも白背景に対して視認できる濃さを
 * 保つ(最も薄い段階でも#b8dae2程度に留め、mist(#d8ecf0)のような白に近すぎる色は使わない)。
 */
export const CHART_COLORS = {
  primary: THEME.sora,
  primaryDeep: THEME.soraDeep,
  warn: THEME.hinode,
  grid: THEME.mistLine,
  label: '#5a6b7a',
  neutralSteps: ['#00434f', THEME.soraDeep, THEME.sora, '#2ba9c4', '#5aa9bd', '#7cc0d3', '#9ecfdc', '#b8dae2'],
} as const;

export function initChart(container: HTMLElement): EChartsInstance {
  return echarts.init(container, undefined, { renderer: 'canvas' });
}

export function disposeChart(chart: EChartsInstance): void {
  if (!chart.isDisposed()) chart.dispose();
}

/** ResizeObserver で container のサイズ変化に追従する。返り値の関数で監視を止める(dispose とセットで呼ぶ)。 */
export function attachResize(chart: EChartsInstance, container: HTMLElement): () => void {
  const observer = new ResizeObserver(() => {
    if (!chart.isDisposed()) chart.resize();
  });
  observer.observe(container);
  return () => observer.disconnect();
}

/**
 * container に対して EChartsインスタンスを作成し、option を適用し、リサイズ追従を貼る。
 * 返り値の関数を呼べば resize監視の解除とインスタンスの破棄をまとめて行う
 * (バー/ドーナツ/ファネル/ヒートマップの各ラッパーはこれを土台にする)。
 */
export function renderChart(container: HTMLElement, option: EChartsOption): () => void {
  const chart = initChart(container);
  chart.setOption(option);
  const detachResize = attachResize(chart, container);
  return () => {
    detachResize();
    disposeChart(chart);
  };
}
