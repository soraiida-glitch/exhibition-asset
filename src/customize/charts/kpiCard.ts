import { escHtml } from '../html-utils';
import { THEME } from '../theme';
import type { PayloadFor } from '../../semantic/templates';

/** T1(単一KPI + 対比)。要件定義書通りHTMLのまま(ECharts化しない)。 */
export function injectKpiCardStyles(): void {
  if (document.getElementById('exh-bi-kpi-styles')) return;
  const style = document.createElement('style');
  style.id = 'exh-bi-kpi-styles';
  style.textContent = `
.exh-bi-kpi { background: #fff; border: 1px solid ${THEME.mistLine}; border-radius: 14px; padding: 18px 20px; }
.exh-bi-kpi-value { font-size: 30px; font-weight: 800; color: ${THEME.ink}; font-variant-numeric: tabular-nums; line-height: 1.2; }
.exh-bi-kpi-unit { font-size: 15px; font-weight: 700; color: #5a6b7a; margin-left: 4px; }
.exh-bi-kpi-delta { font-size: 12.5px; font-weight: 700; margin-top: 6px; }
.exh-bi-kpi-delta.exh-bi-up { color: #1c7a4c; }
.exh-bi-kpi-delta.exh-bi-down { color: #d33333; }
.exh-bi-kpi-delta.exh-bi-flat { color: #5a6b7a; }
`;
  document.head.appendChild(style);
}

function formatNumber(value: number): string {
  return value.toLocaleString('ja-JP', { maximumFractionDigits: 1 });
}

export function renderKpiCard(container: HTMLElement, payload: PayloadFor<'T1'>): void {
  injectKpiCardStyles();

  let deltaHtml = '';
  if (payload.delta) {
    const tone = payload.delta.diff > 0 ? 'exh-bi-up' : payload.delta.diff < 0 ? 'exh-bi-down' : 'exh-bi-flat';
    const sign = payload.delta.diff > 0 ? '+' : '';
    deltaHtml = `<div class="exh-bi-kpi-delta ${tone}">${escHtml(payload.delta.base)}比 ${sign}${formatNumber(payload.delta.diff)}${escHtml(payload.unit)} (${sign}${formatNumber(payload.delta.pct)}%)</div>`;
  }

  container.className = 'exh-bi-kpi';
  container.innerHTML = `
    <span class="exh-bi-kpi-value">${formatNumber(payload.value)}</span><span class="exh-bi-kpi-unit">${escHtml(payload.unit)}</span>
    ${deltaHtml}
  `;
}
