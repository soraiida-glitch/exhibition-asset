/**
 * RELVA BI — 数値表示の共通フォーマッタ。円単位は「¥1,083万」のように万円表記に丸める
 * (space-dashboard.ts/pipeline-dashboard.ts の既存 formatYen() と同じ規約)。これを
 * チャート側(barH/donut/funnel/heatmap/kpiCard)でも共有することで、
 * (a) ダッシュボードとチャットで金額表記が食い違わないようにし、
 * (b) 生の円数値(例: "10,830,000")をそのまま棒グラフのラベルに出すと桁数が多すぎて
 *     幅の狭いカード/チャット吹き出しの右端で見切れる、という実際に見つかった表示崩れを防ぐ。
 */
export function formatMetricNumber(value: number, unit: string): string {
  if (unit === '円') {
    return '¥' + Math.round(value / 10000).toLocaleString('ja-JP') + '万';
  }
  return value.toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + unit;
}
