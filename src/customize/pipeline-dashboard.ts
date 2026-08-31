import { formatApiError } from './chat';
import { OPPORTUNITY_STAGE_OPTIONS } from '../apps/schema';
import { aggregateByDimension, applyFilters, computeMetric } from '../semantic/aggregate';
import type { KintoneRecordFields } from '../semantic/aggregate';
import { renderBarH } from './charts/barH';
import { injectVizStyles, renderKpiCards, renderVizError, renderNote } from './viz';

const PIPELINE_CONFIG = {
  opportunityAppId: __OPPORTUNITY_APP_ID__,
};

const CLOSED_STAGES = ['成約', '失注'];

function formatYen(amount: number): string {
  return '¥' + Math.round(amount / 10000).toLocaleString('ja-JP') + '万';
}

async function fetchOpportunities(): Promise<KintoneRecordFields[]> {
  // Demo-scale dataset (a few dozen records) fits within kintone's single-request cap of 500 —
  // beyond that this would need an offset-paging loop like bulk-sync-pinecone.ts's.
  const result = (await kintone.api('/k/v1/records', 'GET', {
    app: Number(PIPELINE_CONFIG.opportunityAppId),
    fields: ['amount', 'stage'],
    query: 'limit 500',
  })) as { records: KintoneRecordFields[] };
  return result.records;
}

// RELVA BI (要件定義書 §6-3): 集計は semantic/aggregate.ts の共有関数のみを使い、このファイル
// 自身では計算しない — チャット経由のBI集計と同じ数式で二重管理を避ける。
function aggregate(records: KintoneRecordFields[]) {
  const pipelineRecords = applyFilters(records, [{ field: 'stage', op: 'not_in', value: CLOSED_STAGES }]);
  const lostRecords = applyFilters(records, [{ field: 'stage', op: '=', value: '失注' }]);

  const amountByStage = aggregateByDimension(records, 'amount_sum', 'stage', OPPORTUNITY_STAGE_OPTIONS);
  const countSeries = aggregateByDimension(records, 'count', 'stage', OPPORTUNITY_STAGE_OPTIONS);
  const countByStage: Record<string, number> = {};
  for (const s of countSeries) countByStage[s.key] = s.value;

  return {
    pipelineTotal: computeMetric(pipelineRecords, 'amount_sum'),
    pipelineCount: computeMetric(pipelineRecords, 'count'),
    wonTotal: computeMetric(records, 'won_amount'),
    wonCount: computeMetric(records, 'won_count'),
    lostTotal: computeMetric(lostRecords, 'amount_sum'),
    lostCount: computeMetric(records, 'lost_count'),
    allAmountSum: computeMetric(records, 'amount_sum'),
    allCount: computeMetric(records, 'count'),
    amountByStage,
    countByStage,
  };
}

function render(container: HTMLElement, agg: ReturnType<typeof aggregate>): void {
  const kpiEl = document.createElement('div');
  const panel = document.createElement('div');
  panel.className = 'exh-viz-panel';
  const titleEl = document.createElement('div');
  titleEl.className = 'exh-viz-panel-title';
  titleEl.textContent = 'フェーズ別パイプライン';
  const barsEl = document.createElement('div');
  barsEl.style.width = '100%';
  barsEl.style.height = '260px';
  const noteEl = document.createElement('div');
  panel.appendChild(titleEl);
  panel.appendChild(barsEl);
  panel.appendChild(noteEl);
  renderNote(noteEl, '帯の長さは金額の大きさを表します(件数が同じでも金額が違えば長さが変わります)');

  container.innerHTML = '';
  container.appendChild(kpiEl);
  container.appendChild(panel);

  renderKpiCards(kpiEl, [
    { label: 'パイプライン総額(進行中)', value: formatYen(agg.pipelineTotal), sub: `${agg.pipelineCount}件` },
    { label: '成約金額', value: formatYen(agg.wonTotal), sub: `${agg.wonCount}件`, tone: 'accent' },
    {
      label: '案件平均単価',
      value: agg.allCount ? formatYen(agg.allAmountSum / agg.allCount) : '¥0万',
      sub: `全${agg.allCount}件`,
    },
    { label: '失注', value: formatYen(agg.lostTotal), sub: `${agg.lostCount}件` },
  ]);

  renderBarH(
    barsEl,
    {
      metric: { code: 'amount_sum', label: '金額合計', unit: '円' },
      dimension: { code: 'stage', label: 'フェーズ' },
      series: agg.amountByStage,
    },
    { tooltipExtra: (stage) => `件数: ${agg.countByStage[stage] ?? 0}件` },
  );
}

async function loadAndRender(container: HTMLElement): Promise<void> {
  try {
    const records = await fetchOpportunities();
    render(container, aggregate(records));
  } catch (err) {
    renderVizError(container, 'パイプラインの取得に失敗しました: ' + formatApiError(err));
  }
}

export function initPipelineDashboard(appId: string): void {
  if (appId !== PIPELINE_CONFIG.opportunityAppId) return;
  injectVizStyles();
  if (document.getElementById('exh-pipeline-dashboard')) return;

  const space = kintone.app.getHeaderSpaceElement();
  if (!space) return;

  const container = document.createElement('div');
  container.id = 'exh-pipeline-dashboard';
  space.appendChild(container);

  void loadAndRender(container);
}
