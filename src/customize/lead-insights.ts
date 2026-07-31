import { formatApiError } from './chat';
import { LEAD_SOURCE_OPTIONS, LEAD_STATUS_OPTIONS } from '../apps/schema';
import { THEME } from './theme';
import {
  injectVizStyles,
  renderFunnel,
  renderDonut,
  renderVizError,
  type FunnelStep,
  type DonutSegment,
} from './viz';

const LEAD_CONFIG = {
  leadAppId: __LEAD_APP_ID__,
};

const EXCLUDED_STATUS = '対象外';
const AWAITING_STATUS = '未対応';
const CONVERTED_STATUS = '変換済み';

const SOURCE_COLORS = [THEME.sora, THEME.hinode, THEME.sun, THEME.mistLine];

interface LeadRecord {
  status?: { value?: string };
  source?: { value?: string };
}

async function fetchLeads(): Promise<LeadRecord[]> {
  // Demo-scale dataset (a handful of records) fits within kintone's single-request cap of 500 —
  // beyond that this would need an offset-paging loop like bulk-sync-pinecone.ts's.
  const result = (await kintone.api('/k/v1/records', 'GET', {
    app: Number(LEAD_CONFIG.leadAppId),
    fields: ['status', 'source'],
    query: 'limit 500',
  })) as { records: LeadRecord[] };
  return result.records;
}

function aggregate(records: LeadRecord[]) {
  const byStatus = new Map<string, number>();
  for (const status of LEAD_STATUS_OPTIONS) byStatus.set(status, 0);
  const bySource = new Map<string, number>();
  for (const source of LEAD_SOURCE_OPTIONS) bySource.set(source, 0);

  for (const record of records) {
    const status = record.status?.value || '';
    if (byStatus.has(status)) byStatus.set(status, byStatus.get(status)! + 1);
    const source = record.source?.value || '';
    if (bySource.has(source)) bySource.set(source, bySource.get(source)! + 1);
  }
  return { byStatus, bySource };
}

function render(container: HTMLElement, agg: ReturnType<typeof aggregate>): void {
  const funnelPanel = document.createElement('div');
  funnelPanel.className = 'exh-viz-panel';
  const funnelTitle = document.createElement('div');
  funnelTitle.className = 'exh-viz-panel-title';
  funnelTitle.textContent = 'ステータス別ファネル';
  const funnelBody = document.createElement('div');
  funnelPanel.appendChild(funnelTitle);
  funnelPanel.appendChild(funnelBody);

  const donutPanel = document.createElement('div');
  donutPanel.className = 'exh-viz-panel';
  const donutTitle = document.createElement('div');
  donutTitle.className = 'exh-viz-panel-title';
  donutTitle.textContent = '流入経路の内訳';
  const donutBody = document.createElement('div');
  donutPanel.appendChild(donutTitle);
  donutPanel.appendChild(donutBody);

  container.innerHTML = '';
  container.appendChild(funnelPanel);
  container.appendChild(donutPanel);

  // 対象外は案件化フローの外なので、ファネル(未対応→対応中→変換済み)の分母から除外する。
  const funnelStatuses = LEAD_STATUS_OPTIONS.filter((s) => s !== EXCLUDED_STATUS);
  const maxCount = Math.max(1, ...funnelStatuses.map((s) => agg.byStatus.get(s) || 0));
  const steps: FunnelStep[] = funnelStatuses.map((status) => {
    const count = agg.byStatus.get(status) || 0;
    return {
      label: status,
      count,
      pct: (count / maxCount) * 100,
      tone: status === AWAITING_STATUS ? 'warn' : status === CONVERTED_STATUS ? 'positive' : undefined,
    };
  });
  renderFunnel(funnelBody, steps);

  const segments: DonutSegment[] = LEAD_SOURCE_OPTIONS.map((source, idx) => ({
    label: source,
    count: agg.bySource.get(source) || 0,
    color: SOURCE_COLORS[idx % SOURCE_COLORS.length],
  }));
  renderDonut(donutBody, segments, '件');
}

async function loadAndRender(container: HTMLElement): Promise<void> {
  try {
    const records = await fetchLeads();
    render(container, aggregate(records));
  } catch (err) {
    renderVizError(container, 'リードの取得に失敗しました: ' + formatApiError(err));
  }
}

export function initLeadInsights(appId: string): void {
  if (appId !== LEAD_CONFIG.leadAppId) return;
  injectVizStyles();
  if (document.getElementById('exh-lead-insights')) return;

  const space = kintone.app.getHeaderSpaceElement();
  if (!space) return;

  const container = document.createElement('div');
  container.id = 'exh-lead-insights';
  space.appendChild(container);

  void loadAndRender(container);
}
