/**
 * RELVA BI 追加要件定義書 §5 — 豊富な初期ダッシュボード。
 *
 * dashboard-default.ts の6枚のカード(受注額/対応待ちリード/パイプライン/失注理由の内訳/
 * 担当者別受注額/失注理由×業種)を、チャットの会話結果と全く同じ経路(buildBiResult)で
 * 集計し、同じチャートコンポーネント(bi-chat.ts の renderBiChart)で描画する——
 * 「カード=テンプレインスタンス」という統一モデル(§2/§3)をダッシュボード側でも徹底し、
 * 集計ロジック・表示フォーマットが経路によって分岐/重複しないようにする(§6-3)。
 *
 * 各カードの「🗨️ このグラフについて聞く」ボタンは、チャットを開いてそのカードについての
 * narrate をそのまま送る(§3: ダッシュボード→チャットの橋渡し)。逆方向(チャットの会話
 * 結果をこのダッシュボードへピン留めする)は Supabase の pinned_cards テーブル(§7)が前提の
 * ため、テーブル作成後に別途実装する——現時点ではこの固定6枚のみを表示する。
 */
import { openChatWithBiQuestion } from './chat';
import { buildBiResult } from '../semantic/aggregate';
import type { BuiltBiResult, KintoneRecordFields } from '../semantic/aggregate';
import type { CardSpec, ChatCardState, TemplateParams } from '../semantic/cards';
import { buildDefaultDashboardCards } from '../semantic/dashboard-default';
import { resolvePeriodPreset } from '../semantic/fiscal';
import type { PeriodPreset } from '../semantic/fiscal';
import type { BiResult } from '../semantic/templates';
import { renderBiChart } from './bi-chat';
import { getOrCreateSpaceWidgetRow } from './space-dashboard';
import { THEME } from './theme';
import { injectVizStyles, renderVizError } from './viz';

const BI_DASHBOARD_CONFIG = {
  opportunityAppId: __OPPORTUNITY_APP_ID__,
  leadAppId: __LEAD_APP_ID__,
};

function injectBiDashboardStyles(): void {
  if (document.getElementById('exh-bi-dashboard-styles')) return;
  const style = document.createElement('style');
  style.id = 'exh-bi-dashboard-styles';
  style.textContent = `
#exh-bi-dashboard { flex: 0 0 420px; width: 420px; background: #fff; border-radius: 14px;
  box-shadow: 0 12px 32px -16px rgba(20,40,60,.35); border: 1px solid ${THEME.mistLine}; padding: 16px; font-size: 13px; }
.exh-bi-dashboard-title { font-weight: 800; font-size: 15px; margin-bottom: 10px; color: ${THEME.soraDeep}; }
.exh-bi-dashboard-grid { display: flex; flex-direction: column; gap: 14px; }
.exh-bi-dashboard-card { border: 1px solid ${THEME.mistLine}; border-radius: 10px; padding: 10px 12px; }
.exh-bi-dashboard-card-title { font-size: 12.5px; font-weight: 800; color: ${THEME.ink}; margin-bottom: 6px; }
/* renderBiChart() の既定サイズ(220px/260px)はチャット用——ダッシュボードは6枚並ぶため縮める。 */
#exh-bi-dashboard .exh-bi-chart-host { height: 150px; }
#exh-bi-dashboard .exh-bi-chart-host.exh-bi-chart-tall { height: 190px; }
.exh-bi-dashboard-ask-btn { margin-top: 6px; border: 1px solid ${THEME.mistLine}; background: ${THEME.cloud};
  color: ${THEME.soraDeep}; font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 999px; cursor: pointer; }
.exh-bi-dashboard-ask-btn:hover { background: ${THEME.mist}; }
`;
  document.head.appendChild(style);
}

async function fetchRecords(appId: number): Promise<KintoneRecordFields[]> {
  const result = (await kintone.api('/k/v1/records', 'GET', {
    app: appId,
    query: 'limit 500',
  })) as { records: KintoneRecordFields[] };
  return result.records;
}

/** TemplateParams.period(`{preset}`オブジェクト形)を buildBiResult が受け取る文字列プリセットへ
 * 正規化する(v1では相対プリセットのみ対応——from/toの絶対期間指定はスコープ外)。 */
function periodPresetOf(params: TemplateParams): PeriodPreset | undefined {
  const p = params.period;
  return p && 'preset' in p ? p.preset : undefined;
}

/** ダッシュボードのカードを、チャット側が保持する「直前のカード」と同じ形に変換する。
 * これにより「🗨️ このグラフについて聞く」から入った会話でも、そのままrefine/narrateが続けられる。
 * aggregate.ts(自己完結ファイル)は data を意図的に緩い Record<string, unknown> で返すため、
 * ChatCardState.data(同じく unknown)へはそのまま渡せる——テンプレ別の厳密な形は
 * PayloadFor<T> 側(templates.ts)の関心であり、ここでは関与しない。 */
function toChatCardState(card: CardSpec, biResult: BuiltBiResult): ChatCardState {
  return {
    template: card.template,
    params: card.params,
    title: biResult.title,
    interpretation: biResult.interpretation,
    filtersApplied: biResult.filtersApplied,
    data: biResult.data,
  };
}

async function render(container: HTMLElement): Promise<void> {
  const [opportunityRecords, leadRecords] = await Promise.all([
    fetchRecords(Number(BI_DASHBOARD_CONFIG.opportunityAppId)).catch(() => [] as KintoneRecordFields[]),
    fetchRecords(Number(BI_DASHBOARD_CONFIG.leadAppId)).catch(() => [] as KintoneRecordFields[]),
  ]);

  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'exh-bi-dashboard-grid';
  container.appendChild(grid);

  const today = new Date();
  for (const card of buildDefaultDashboardCards()) {
    const cardEl = document.createElement('div');
    cardEl.className = 'exh-bi-dashboard-card';
    grid.appendChild(cardEl);

    const titleEl = document.createElement('div');
    titleEl.className = 'exh-bi-dashboard-card-title';
    cardEl.appendChild(titleEl);

    // このカードだけ集計に失敗しても、残り5枚は問題なく表示を続ける
    // (既存space-dashboard.tsの「セクション単位で劣化」方針を踏襲)。
    const outcome = buildBiResult(
      { opportunityRecords, leadRecords },
      {
        template: card.template,
        metric: card.params.metric,
        dimension: card.params.dimension,
        dimensionB: card.params.dimensionB,
        filters: card.params.filters,
        period: periodPresetOf(card.params),
        entity: card.params.entity,
      },
      today,
      resolvePeriodPreset,
    );

    if (!outcome.ok) {
      titleEl.textContent = card.title || '';
      renderVizError(cardEl, outcome.message);
      continue;
    }

    titleEl.textContent = card.title || outcome.biResult.title;

    // Aggregate BI(n8n)側と同じ理由で data は緩い Record<string, unknown> 型——
    // renderBiChart はテンプレごとの厳密な PayloadFor<T> を要求するため、ここでキャストする
    // (実行時の形は runAggregate/buildBiResult が既に保証しているので安全)。
    const chartHost = document.createElement('div');
    cardEl.appendChild(chartHost);
    renderBiChart(chartHost, outcome.biResult as unknown as BiResult);

    const askBtn = document.createElement('button');
    askBtn.type = 'button';
    askBtn.className = 'exh-bi-dashboard-ask-btn';
    askBtn.textContent = '🗨️ このグラフについて聞く';
    askBtn.addEventListener('click', () => {
      openChatWithBiQuestion('このグラフについて何か気づくことはある?', toChatCardState(card, outcome.biResult));
    });
    cardEl.appendChild(askBtn);
  }
}

export function initBiDashboard(): void {
  injectVizStyles();
  injectBiDashboardStyles();
  if (document.getElementById('exh-bi-dashboard')) return;

  const card = document.createElement('div');
  card.id = 'exh-bi-dashboard';
  card.innerHTML =
    '<div class="exh-bi-dashboard-title">📊 分析ダッシュボード</div><div id="exh-bi-dashboard-body">読み込み中...</div>';
  getOrCreateSpaceWidgetRow().appendChild(card);

  const body = document.getElementById('exh-bi-dashboard-body')!;
  void render(body);
}
