import { formatApiError } from './chat';
import { OPPORTUNITY_STAGE_OPTIONS } from '../apps/schema';
import { aggregateByDimension, computeMetric } from '../semantic/aggregate';
import type { KintoneRecordFields } from '../semantic/aggregate';
import type { DimensionSeries } from '../semantic/templates';
import { renderBarH } from './charts/barH';
import { THEME } from './theme';
import { injectVizStyles, renderKpiCards, renderMiniRankList, renderVizError, type KpiItem, type MiniRankItem } from './viz';

const SPACE_DASHBOARD_CONFIG = {
  opportunityAppId: __OPPORTUNITY_APP_ID__,
  leadAppId: __LEAD_APP_ID__,
  salesScoreAppId: __SALES_SCORE_APP_ID__,
};

const AWAITING_LEAD_STATUS = '未対応';

interface OpportunityRecord {
  amount?: { value?: string };
  stage?: { value?: string };
}

interface LeadRecord {
  status?: { value?: string };
}

interface SalesScoreRecord {
  assignee_name?: { value?: string };
  total_score?: { value?: string };
  score_rank?: { value?: string };
  period_end?: { value?: string };
}

function formatYen(amount: number): string {
  return '¥' + Math.round(amount / 10000).toLocaleString('ja-JP') + '万';
}

function injectSpaceDashboardStyles(): void {
  if (document.getElementById('exh-space-dashboard-styles')) return;
  const style = document.createElement('style');
  style.id = 'exh-space-dashboard-styles';
  style.textContent = `
/* The row sits in the normal page flow (inserted right after the "お知らせ" card) rather than
   floating fixed to the viewport, so its contents scroll away with the page instead of staying
   pinned on screen and overlapping the announcements area above them. */
#exh-space-widget-row { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 32px; margin: 16px 16px 0; }
/* Explicit width (not just max-width) so the KPI grid inside has a definite container to compute
   its column count against — without it, the grid collapsed to 1 column and the whole card
   rendered as a tall, narrow strip instead of the intended 2-column KPI layout. */
#exh-space-dashboard { flex: 0 0 400px; width: 400px;
  background: #fff; border-radius: 14px; box-shadow: 0 12px 32px -16px rgba(20,40,60,.35);
  border: 1px solid ${THEME.mistLine}; padding: 16px; font-size: 13px; }
.exh-space-dashboard-title { font-weight: 800; font-size: 15px; margin-bottom: 10px; color: ${THEME.soraDeep}; }
.exh-space-dashboard-section-title { font-size: 12.5px; font-weight: 800; margin: 14px 0 8px; color: ${THEME.ink}; }
.exh-space-dashboard-chart { width: 100%; height: 210px; }
`;
  document.head.appendChild(style);
}

/** Finds the space's native "お知らせ" (announcements) card so the shared widget row can be
 * inserted right after it. kintone exposes no official hook for this — we can't inspect the live
 * DOM from here, so this is a best-effort text search with a heuristic walk up to the enclosing
 * card, falling back to appending at the end of <body> (guaranteed not to land above the banner)
 * if it doesn't match. */
function findAnnouncementsCard(): HTMLElement | null {
  const heading = Array.from(document.querySelectorAll<HTMLElement>('div, section, h1, h2, h3, span')).find(
    (el) => el.textContent?.trim() === 'お知らせ' && el.children.length === 0,
  );
  if (!heading) return null;

  let node: HTMLElement = heading;
  for (let i = 0; i < 6 && node.parentElement; i++) {
    node = node.parentElement;
    if (node.clientHeight > 100) return node;
  }
  return null;
}

/** Shared row for space-portal widgets (this dashboard, the daily-advice card) so they sit side
 * by side in the page's normal flow instead of each floating independently. Idempotent: whichever
 * widget initializes first creates the row, the other just appends into it. */
export function getOrCreateSpaceWidgetRow(): HTMLElement {
  const existing = document.getElementById('exh-space-widget-row');
  if (existing) return existing;

  injectSpaceDashboardStyles();

  const row = document.createElement('div');
  row.id = 'exh-space-widget-row';

  const announcementsCard = findAnnouncementsCard();
  if (announcementsCard?.parentElement) {
    announcementsCard.parentElement.insertBefore(row, announcementsCard.nextSibling);
  } else {
    document.body.appendChild(row);
  }
  return row;
}

interface OpportunitySummary {
  kpis: KpiItem[];
  amountByStage: DimensionSeries[];
  countByStage: Record<string, number>;
}

async function loadOpportunitySummary(): Promise<OpportunitySummary | null> {
  try {
    // Demo-scale dataset fits within kintone's single-request cap of 500 — beyond that this
    // would need an offset-paging loop like bulk-sync-pinecone.ts's.
    const result = (await kintone.api('/k/v1/records', 'GET', {
      app: Number(SPACE_DASHBOARD_CONFIG.opportunityAppId),
      fields: ['amount', 'stage'],
      query: 'limit 500',
    })) as { records: OpportunityRecord[] };
    const records = result.records as unknown as KintoneRecordFields[];

    // RELVA BI (要件定義書 §6-3): フェーズ別の集計は semantic/aggregate.ts の共有関数を使う
    // (このファイル自身では計算しない) — チャット経由のBI集計と同じ数式で二重管理を避ける。
    const total = computeMetric(records, 'amount_sum');
    const won = computeMetric(records, 'won_amount');
    const amountByStage = aggregateByDimension(records, 'amount_sum', 'stage', OPPORTUNITY_STAGE_OPTIONS);
    const countSeries = aggregateByDimension(records, 'count', 'stage', OPPORTUNITY_STAGE_OPTIONS);
    const countByStage: Record<string, number> = {};
    for (const s of countSeries) countByStage[s.key] = s.value;

    return {
      kpis: [
        { label: '案件総額', value: formatYen(total), sub: `全${result.records.length}件` },
        { label: '成約金額', value: formatYen(won), tone: 'accent' },
      ],
      amountByStage,
      countByStage,
    };
  } catch {
    return null;
  }
}

async function loadLeadKpi(): Promise<KpiItem> {
  try {
    const result = (await kintone.api('/k/v1/records', 'GET', {
      app: Number(SPACE_DASHBOARD_CONFIG.leadAppId),
      fields: ['status'],
      query: 'limit 500',
    })) as { records: LeadRecord[] };
    const awaiting = result.records.filter((r) => r.status?.value === AWAITING_LEAD_STATUS).length;
    return {
      label: '対応待ちリード',
      value: `${awaiting}件`,
      sub: `全${result.records.length}件中`,
      tone: awaiting > 0 ? 'warn' : undefined,
    };
  } catch (err) {
    return { label: 'リード', value: '—', sub: '取得に失敗: ' + formatApiError(err) };
  }
}

async function loadTopAssignees(): Promise<MiniRankItem[] | null> {
  try {
    // sales-scoring is a user-triggered batch (period_start/period_end chosen manually each run),
    // so "latest" means the most recent completed period_end, not "this calendar week" — first
    // find that period_end, then rank within it.
    // kintone reserves the "status" field code for process management and only allows the
    // in/not in operators on it (confirmed live: "=" fails with GAIA_IQ03).
    const latestResult = (await kintone.api('/k/v1/records', 'GET', {
      app: Number(SPACE_DASHBOARD_CONFIG.salesScoreAppId),
      fields: ['period_end'],
      query: 'status in ("完了") order by period_end desc limit 1',
    })) as { records: SalesScoreRecord[] };
    const latestPeriodEnd = latestResult.records[0]?.period_end?.value;
    if (!latestPeriodEnd) return [];

    const topResult = (await kintone.api('/k/v1/records', 'GET', {
      app: Number(SPACE_DASHBOARD_CONFIG.salesScoreAppId),
      fields: ['assignee_name', 'total_score', 'score_rank'],
      query: `status in ("完了") and period_end = "${latestPeriodEnd.replace(/"/g, '')}" order by total_score desc limit 3`,
    })) as { records: SalesScoreRecord[] };

    return topResult.records.map((r) => ({
      label: r.assignee_name?.value || '?',
      value: `${r.total_score?.value ?? '?'}点`,
    }));
  } catch {
    return null;
  }
}

async function render(container: HTMLElement): Promise<void> {
  const [oppSummary, leadKpi, topAssignees] = await Promise.all([
    loadOpportunitySummary(),
    loadLeadKpi(),
    loadTopAssignees(),
  ]);

  const kpiEl = document.createElement('div');
  const pipelineTitleEl = document.createElement('div');
  pipelineTitleEl.className = 'exh-space-dashboard-section-title';
  pipelineTitleEl.textContent = '📈 フェーズ別パイプライン';
  const pipelineEl = document.createElement('div');
  const rankTitleEl = document.createElement('div');
  rankTitleEl.className = 'exh-space-dashboard-section-title';
  rankTitleEl.textContent = '🏆 営業ランキング TOP3';
  const rankEl = document.createElement('div');

  container.innerHTML = '';
  container.appendChild(kpiEl);
  container.appendChild(pipelineTitleEl);
  container.appendChild(pipelineEl);
  container.appendChild(rankTitleEl);
  container.appendChild(rankEl);

  const kpis: KpiItem[] = oppSummary ? [...oppSummary.kpis, leadKpi] : [leadKpi];
  if (!oppSummary) kpis.unshift({ label: '案件', value: '—', sub: '取得に失敗しました' });
  renderKpiCards(kpiEl, kpis);

  if (oppSummary) {
    pipelineEl.className = 'exh-space-dashboard-chart';
    renderBarH(pipelineEl, {
      metric: { code: 'amount_sum', label: '金額合計', unit: '円' },
      dimension: { code: 'stage', label: 'フェーズ' },
      series: oppSummary.amountByStage,
    }, {
      tooltipExtra: (stage) => `件数: ${oppSummary.countByStage[stage] ?? 0}件`,
    });
  } else {
    renderVizError(pipelineEl, 'パイプラインの取得に失敗しました');
  }

  if (topAssignees === null) renderVizError(rankEl, '営業ランキングの取得に失敗しました');
  else if (topAssignees.length === 0) rankEl.innerHTML = '<div class="exh-viz-kpi-sub">スコアリング未実行</div>';
  else renderMiniRankList(rankEl, topAssignees);
}

export function initSpaceDashboard(): void {
  injectVizStyles();
  injectSpaceDashboardStyles();
  if (document.getElementById('exh-space-dashboard')) return;

  const card = document.createElement('div');
  card.id = 'exh-space-dashboard';
  card.innerHTML =
    '<div class="exh-space-dashboard-title">🗂️ ダッシュボード</div><div id="exh-space-dashboard-body">読み込み中...</div>';
  getOrCreateSpaceWidgetRow().appendChild(card);

  const body = document.getElementById('exh-space-dashboard-body')!;
  void render(body);
}
