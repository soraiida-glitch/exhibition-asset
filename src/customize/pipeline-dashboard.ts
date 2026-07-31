import { formatApiError } from './chat';
import { OPPORTUNITY_STAGE_OPTIONS } from '../apps/schema';
import { injectVizStyles, renderKpiCards, renderHBarRows, renderVizError, renderNote, type HBarRow } from './viz';

const PIPELINE_CONFIG = {
  opportunityAppId: __OPPORTUNITY_APP_ID__,
};

const WON_STAGE = '成約';
const LOST_STAGE = '失注';

interface OpportunityRecord {
  amount?: { value?: string };
  stage?: { value?: string };
}

interface StageBucket {
  count: number;
  amount: number;
}

function formatYen(amount: number): string {
  return '¥' + Math.round(amount / 10000).toLocaleString('ja-JP') + '万';
}

async function fetchOpportunities(): Promise<OpportunityRecord[]> {
  // Demo-scale dataset (a few dozen records) fits within kintone's single-request cap of 500 —
  // beyond that this would need an offset-paging loop like bulk-sync-pinecone.ts's.
  const result = (await kintone.api('/k/v1/records', 'GET', {
    app: Number(PIPELINE_CONFIG.opportunityAppId),
    fields: ['amount', 'stage'],
    query: 'limit 500',
  })) as { records: OpportunityRecord[] };
  return result.records;
}

function aggregate(records: OpportunityRecord[]) {
  const byStage = new Map<string, StageBucket>();
  for (const stage of OPPORTUNITY_STAGE_OPTIONS) byStage.set(stage, { count: 0, amount: 0 });

  let pipelineTotal = 0;
  let pipelineCount = 0;
  let wonTotal = 0;
  let wonCount = 0;
  let lostTotal = 0;
  let lostCount = 0;
  let allAmountSum = 0;
  let allCount = 0;

  for (const record of records) {
    const stage = record.stage?.value || '';
    const amount = Number(record.amount?.value || 0);
    const bucket = byStage.get(stage);
    if (!bucket) continue;
    bucket.count += 1;
    bucket.amount += amount;

    allAmountSum += amount;
    allCount += 1;
    if (stage === WON_STAGE) {
      wonTotal += amount;
      wonCount += 1;
    } else if (stage === LOST_STAGE) {
      lostTotal += amount;
      lostCount += 1;
    } else {
      pipelineTotal += amount;
      pipelineCount += 1;
    }
  }

  return { byStage, pipelineTotal, pipelineCount, wonTotal, wonCount, lostTotal, lostCount, allAmountSum, allCount };
}

function render(container: HTMLElement, agg: ReturnType<typeof aggregate>): void {
  const kpiEl = document.createElement('div');
  const panel = document.createElement('div');
  panel.className = 'exh-viz-panel';
  const titleEl = document.createElement('div');
  titleEl.className = 'exh-viz-panel-title';
  titleEl.textContent = 'フェーズ別パイプライン';
  const barsEl = document.createElement('div');
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

  const maxAmount = Math.max(1, ...Array.from(agg.byStage.values()).map((b) => b.amount));
  const rows: HBarRow[] = OPPORTUNITY_STAGE_OPTIONS.map((stage) => {
    const bucket = agg.byStage.get(stage)!;
    return {
      label: stage,
      amountLabel: formatYen(bucket.amount),
      countLabel: `${bucket.count}件`,
      pct: (bucket.amount / maxAmount) * 100,
      tone: stage === WON_STAGE ? 'positive' : stage === LOST_STAGE ? 'negative' : undefined,
    };
  });
  renderHBarRows(barsEl, rows);
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
