import { formatApiError } from './chat';
import { LEAD_SOURCE_OPTIONS, LEAD_STATUS_OPTIONS } from '../apps/schema';
import { aggregateByDimension, aggregateFunnel } from '../semantic/aggregate';
import type { KintoneRecordFields } from '../semantic/aggregate';
import { renderDonut } from './charts/donut';
import { renderFunnel } from './charts/funnel';
import { injectVizStyles, renderVizError } from './viz';

const LEAD_CONFIG = {
  leadAppId: __LEAD_APP_ID__,
};

const EXCLUDED_STATUS = '対象外';

async function fetchLeads(): Promise<KintoneRecordFields[]> {
  // Demo-scale dataset (a handful of records) fits within kintone's single-request cap of 500 —
  // beyond that this would need an offset-paging loop like bulk-sync-pinecone.ts's.
  const result = (await kintone.api('/k/v1/records', 'GET', {
    app: Number(LEAD_CONFIG.leadAppId),
    fields: ['status', 'source'],
    query: 'limit 500',
  })) as { records: KintoneRecordFields[] };
  return result.records;
}

function render(container: HTMLElement, records: KintoneRecordFields[]): void {
  const funnelPanel = document.createElement('div');
  funnelPanel.className = 'exh-viz-panel';
  const funnelTitle = document.createElement('div');
  funnelTitle.className = 'exh-viz-panel-title';
  funnelTitle.textContent = 'ステータス別ファネル';
  const funnelBody = document.createElement('div');
  funnelBody.style.width = '100%';
  funnelBody.style.height = '220px';
  funnelPanel.appendChild(funnelTitle);
  funnelPanel.appendChild(funnelBody);

  const donutPanel = document.createElement('div');
  donutPanel.className = 'exh-viz-panel';
  const donutTitle = document.createElement('div');
  donutTitle.className = 'exh-viz-panel-title';
  donutTitle.textContent = '流入経路の内訳';
  const donutBody = document.createElement('div');
  donutBody.style.width = '100%';
  donutBody.style.height = '220px';
  donutPanel.appendChild(donutTitle);
  donutPanel.appendChild(donutBody);

  container.innerHTML = '';
  container.appendChild(funnelPanel);
  container.appendChild(donutPanel);

  // RELVA BI (要件定義書 §6-3): 集計は semantic/aggregate.ts の共有関数のみを使う
  // (このファイル自身では計算しない)。対象外は案件化フローの外なので、ファネル
  // (未対応→対応中→変換済み)の分母から除外する。
  const funnelStatuses = LEAD_STATUS_OPTIONS.filter((s) => s !== EXCLUDED_STATUS);
  const steps = aggregateFunnel(records, 'count', funnelStatuses, 'status');
  renderFunnel(funnelBody, { metric: { code: 'count', label: '件数', unit: '件' }, steps });

  const series = aggregateByDimension(records, 'count', 'source', LEAD_SOURCE_OPTIONS);
  renderDonut(donutBody, {
    metric: { code: 'count', label: '件数', unit: '件' },
    dimension: { code: 'lead_source', label: '流入経路' },
    series,
  });
}

async function loadAndRender(container: HTMLElement): Promise<void> {
  try {
    const records = await fetchLeads();
    render(container, records);
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
