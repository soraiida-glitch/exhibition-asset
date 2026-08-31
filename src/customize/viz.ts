import { escHtml } from './chat';
import { THEME } from './theme';

export interface KpiItem {
  label: string;
  value: string;
  sub?: string;
  tone?: 'accent' | 'warn';
}

export interface MiniRankItem {
  label: string;
  value: string;
}

/** Shared KPI-tile/bar-chart/donut CSS for pipeline-dashboard.ts, lead-insights.ts, and
 * space-dashboard.ts — factored out once these three ended up needing the same visual language. */
export function injectVizStyles(): void {
  if (document.getElementById('exh-viz-styles')) return;
  const style = document.createElement('style');
  style.id = 'exh-viz-styles';
  const t = THEME;
  style.textContent = `
.exh-viz-kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 14px; }
.exh-viz-kpi-card { background: #fff; border: 1px solid ${t.mistLine}; border-radius: 12px; padding: 11px 13px; }
.exh-viz-kpi-label { font-size: 11px; color: #5a6b7a; font-weight: 700; }
.exh-viz-kpi-value { font-size: 20px; font-weight: 800; margin-top: 3px; color: ${t.ink}; font-variant-numeric: tabular-nums; }
.exh-viz-kpi-value.exh-viz-accent { color: ${t.soraDeep}; }
.exh-viz-kpi-value.exh-viz-warn { color: ${t.hinode}; }
.exh-viz-kpi-sub { font-size: 11px; color: #5a6b7a; margin-top: 1px; }

.exh-viz-panel { background: #fff; border: 1px solid ${t.mistLine}; border-radius: 14px; padding: 16px; margin-bottom: 14px; }
.exh-viz-panel-title { font-size: 13.5px; font-weight: 800; margin-bottom: 10px; color: ${t.ink}; }

.exh-viz-note { font-size: 11px; color: #5a6b7a; margin-top: 2px; }

.exh-viz-mini-rank { display: flex; flex-direction: column; gap: 6px; }
.exh-viz-mini-rank-item { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.exh-viz-mini-rank-badge { width: 22px; height: 22px; border-radius: 50%; color: #fff; font-size: 11px; font-weight: 800;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  background: linear-gradient(135deg, #5aa9bd, ${t.soraDeep}); }
.exh-viz-mini-rank-item.exh-viz-mini-rank-top1 .exh-viz-mini-rank-badge {
  background: linear-gradient(135deg, ${t.sora}, ${t.soraDeep}); box-shadow: 0 0 0 3px rgba(0,152,187,.16); }
.exh-viz-mini-rank-name { font-weight: 700; }
.exh-viz-mini-rank-value { margin-left: auto; font-weight: 800; font-variant-numeric: tabular-nums; color: ${t.soraDeep}; }

.exh-viz-error { font-size: 12px; color: #b23a3a; padding: 8px 0; }
`;
  document.head.appendChild(style);
}

export function renderKpiCards(container: HTMLElement, items: KpiItem[]): void {
  container.className = 'exh-viz-kpi-row';
  container.innerHTML = items
    .map((item) => {
      const toneClass = item.tone === 'accent' ? ' exh-viz-accent' : item.tone === 'warn' ? ' exh-viz-warn' : '';
      return `<div class="exh-viz-kpi-card">
        <div class="exh-viz-kpi-label">${escHtml(item.label)}</div>
        <div class="exh-viz-kpi-value${toneClass}">${escHtml(item.value)}</div>
        ${item.sub ? `<div class="exh-viz-kpi-sub">${escHtml(item.sub)}</div>` : ''}
      </div>`;
    })
    .join('');
}

export function renderVizError(container: HTMLElement, message: string): void {
  container.innerHTML = `<div class="exh-viz-error">${escHtml(message)}</div>`;
}

export function renderNote(container: HTMLElement, message: string): void {
  container.innerHTML = `<div class="exh-viz-note">${escHtml(message)}</div>`;
}

export function renderMiniRankList(container: HTMLElement, items: MiniRankItem[]): void {
  container.className = 'exh-viz-mini-rank';
  container.innerHTML = items
    .map((item, idx) => {
      const topClass = idx === 0 ? ' exh-viz-mini-rank-top1' : '';
      return `<div class="exh-viz-mini-rank-item${topClass}">
        <span class="exh-viz-mini-rank-badge">${idx + 1}</span>
        <span class="exh-viz-mini-rank-name">${escHtml(item.label)}</span>
        <span class="exh-viz-mini-rank-value">${escHtml(item.value)}</span>
      </div>`;
    })
    .join('');
}
