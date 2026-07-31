import { escHtml } from './chat';
import { THEME } from './theme';

export interface KpiItem {
  label: string;
  value: string;
  sub?: string;
  tone?: 'accent' | 'warn';
}

export interface HBarRow {
  label: string;
  amountLabel: string;
  countLabel: string;
  pct: number;
  tone?: 'positive' | 'negative';
}

export interface DonutSegment {
  label: string;
  count: number;
  color: string;
}

export interface FunnelStep {
  label: string;
  count: number;
  pct: number;
  tone?: 'warn' | 'positive';
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

.exh-viz-hbar-row { display: grid; grid-template-columns: 84px 1fr 78px; align-items: center; gap: 8px; margin-bottom: 8px; }
.exh-viz-hbar-label { font-size: 12px; font-weight: 700; color: #5a6b7a; }
.exh-viz-hbar-track { height: 20px; border-radius: 7px; background: ${t.mist}; overflow: hidden; }
.exh-viz-hbar-fill { height: 100%; border-radius: 7px; background: linear-gradient(90deg, ${t.sora}, ${t.soraDeep});
  display: flex; align-items: center; justify-content: flex-end; padding-right: 7px; transition: width .5s ease; }
.exh-viz-hbar-fill span { font-size: 10px; color: #fff; font-weight: 700; }
.exh-viz-hbar-fill.exh-viz-positive { background: rgba(46,168,107,.85); }
.exh-viz-hbar-fill.exh-viz-negative { background: rgba(211,51,51,.75); }
.exh-viz-hbar-amount { text-align: right; font-size: 11.5px; font-weight: 700; color: ${t.ink}; font-variant-numeric: tabular-nums; }

.exh-viz-donut-row { display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
.exh-viz-donut { width: 108px; height: 108px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.exh-viz-donut-hole { width: 68px; height: 68px; border-radius: 50%; background: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.exh-viz-donut-hole .exh-viz-donut-n { font-size: 17px; font-weight: 800; font-variant-numeric: tabular-nums; }
.exh-viz-donut-hole .exh-viz-donut-l { font-size: 9px; color: #5a6b7a; }
.exh-viz-legend { display: flex; flex-direction: column; gap: 6px; }
.exh-viz-legend-item { display: flex; align-items: center; gap: 7px; font-size: 12px; }
.exh-viz-legend-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.exh-viz-legend-item .exh-viz-legend-v { font-weight: 700; margin-left: auto; font-variant-numeric: tabular-nums; }

.exh-viz-funnel { display: flex; flex-direction: column; gap: 8px; }
.exh-viz-funnel-step { display: flex; align-items: center; gap: 12px; }
.exh-viz-funnel-name { width: 78px; font-size: 12px; font-weight: 700; color: #5a6b7a; flex-shrink: 0; }
.exh-viz-funnel-bar-wrap { flex: 1; display: flex; justify-content: center; }
.exh-viz-funnel-bar { height: 32px; border-radius: 8px; background: linear-gradient(90deg, ${t.sora}, ${t.soraDeep});
  display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; font-size: 12px; font-variant-numeric: tabular-nums; }
.exh-viz-funnel-bar.exh-viz-funnel-warn { background: linear-gradient(90deg, ${t.hinode}, #e8632e); }
.exh-viz-funnel-bar.exh-viz-funnel-positive { background: linear-gradient(90deg, rgba(46,168,107,.95), rgba(28,122,76,.95)); }

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

export function renderHBarRows(container: HTMLElement, rows: HBarRow[]): void {
  container.innerHTML = rows
    .map((row) => {
      const fillClass = row.tone === 'positive' ? ' exh-viz-positive' : row.tone === 'negative' ? ' exh-viz-negative' : '';
      const displayPct = row.pct <= 0 ? 0 : Math.max(row.pct, 4);
      return `<div class="exh-viz-hbar-row">
        <div class="exh-viz-hbar-label">${escHtml(row.label)}</div>
        <div class="exh-viz-hbar-track"><div class="exh-viz-hbar-fill${fillClass}" style="width:${displayPct}%"><span>${escHtml(row.countLabel)}</span></div></div>
        <div class="exh-viz-hbar-amount">${escHtml(row.amountLabel)}</div>
      </div>`;
    })
    .join('');
}

export function renderDonut(container: HTMLElement, segments: DonutSegment[], centerLabel: string): void {
  const total = segments.reduce((sum, s) => sum + s.count, 0);
  let donutBg: string = THEME.mist;
  if (total > 0) {
    let acc = 0;
    const stops = segments.map((s) => {
      const from = (acc / total) * 100;
      acc += s.count;
      const to = (acc / total) * 100;
      return `${s.color} ${from}% ${to}%`;
    });
    donutBg = `conic-gradient(${stops.join(', ')})`;
  }

  const legendHtml = segments
    .map(
      (s) =>
        `<div class="exh-viz-legend-item"><span class="exh-viz-legend-dot" style="background:${s.color}"></span>${escHtml(s.label)}<span class="exh-viz-legend-v">${s.count}件</span></div>`,
    )
    .join('');

  container.innerHTML = `<div class="exh-viz-donut-row">
    <div class="exh-viz-donut" style="background:${donutBg}">
      <div class="exh-viz-donut-hole"><div class="exh-viz-donut-n">${total}</div><div class="exh-viz-donut-l">${escHtml(centerLabel)}</div></div>
    </div>
    <div class="exh-viz-legend">${legendHtml}</div>
  </div>`;
}

export function renderFunnel(container: HTMLElement, steps: FunnelStep[]): void {
  container.className = 'exh-viz-funnel';
  container.innerHTML = steps
    .map((step) => {
      const toneClass =
        step.tone === 'warn' ? ' exh-viz-funnel-warn' : step.tone === 'positive' ? ' exh-viz-funnel-positive' : '';
      const displayPct = step.pct <= 0 ? 0 : Math.max(step.pct, 20);
      return `<div class="exh-viz-funnel-step">
        <div class="exh-viz-funnel-name">${escHtml(step.label)}</div>
        <div class="exh-viz-funnel-bar-wrap"><div class="exh-viz-funnel-bar${toneClass}" style="width:${displayPct}%">${step.count}件</div></div>
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
