import { escHtml } from '../html-utils';
import { formatMetricNumber } from '../format-utils';
import { THEME } from '../theme';
import type { PayloadFor } from '../../semantic/templates';

/** T1(単一KPI + 対比)。要件定義書通りHTMLのまま(ECharts化しない)。 */
export function injectKpiCardStyles(): void {
  if (document.getElementById('exh-bi-kpi-styles')) return;
  const style = document.createElement('style');
  style.id = 'exh-bi-kpi-styles';
  style.textContent = `
.exh-bi-kpi { background: #fff; border: 1px solid ${THEME.mistLine}; border-radius: 14px; padding: 18px 20px; font-family: ${THEME.font}; }
.exh-bi-kpi-value { font-family: ${THEME.fontDisplay}; font-size: 30px; font-weight: 700; color: ${THEME.ink}; font-variant-numeric: tabular-nums; line-height: 1.2; }
.exh-bi-kpi-delta { font-size: 12.5px; font-weight: 700; margin-top: 6px; }
.exh-bi-kpi-delta.exh-bi-up { color: #1c7a4c; }
.exh-bi-kpi-delta.exh-bi-down { color: #d33333; }
.exh-bi-kpi-delta.exh-bi-flat { color: #5a6b7a; }
`;
  document.head.appendChild(style);
}

export function renderKpiCard(container: HTMLElement, payload: PayloadFor<'T1'>): void {
  injectKpiCardStyles();

  // 円単位は「¥1,083万」のように万円表記に丸める(既存ダッシュボードの formatYen() と同じ
  // 規約)——生の円数値をそのまま出すと桁数が多く、値と単位を分けて表示する意味が薄れるため、
  // 1つの文字列にまとめて表示する。
  let deltaHtml = '';
  if (payload.delta) {
    const tone = payload.delta.diff > 0 ? 'exh-bi-up' : payload.delta.diff < 0 ? 'exh-bi-down' : 'exh-bi-flat';
    const sign = payload.delta.diff > 0 ? '+' : payload.delta.diff < 0 ? '-' : '';
    const diffDisplay = formatMetricNumber(Math.abs(payload.delta.diff), payload.unit);
    const pctDisplay = Math.abs(payload.delta.pct).toFixed(1);
    deltaHtml = `<div class="exh-bi-kpi-delta ${tone}">${escHtml(payload.delta.base)}比 ${sign}${diffDisplay} (${sign}${pctDisplay}%)</div>`;
  }

  container.className = 'exh-bi-kpi';
  container.innerHTML = `
    <span class="exh-bi-kpi-value">${escHtml(formatMetricNumber(payload.value, payload.unit))}</span>
    ${deltaHtml}
  `;
}
