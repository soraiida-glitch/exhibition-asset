/**
 * RELVA BI 追加要件定義書 §5・§7 — 豊富な初期ダッシュボード + ピン留めカードの永続化。
 *
 * dashboard-default.ts の6枚の固定カード(受注額/対応待ちリード/パイプライン/失注理由の内訳/
 * 担当者別受注額/失注理由×業種)と、チャットからピン留めされた追加カード(Supabaseの
 * pinned_cards)を、どちらもチャットの会話結果と全く同じ経路(buildBiResult)で集計し、
 * 同じチャートコンポーネント(bi-chat.ts の renderBiChart)で描画する——「カード=テンプレ
 * インスタンス」という統一モデル(§2/§3)をダッシュボード側でも徹底し、集計ロジック・表示
 * フォーマットが経路によって分岐/重複しないようにする(§6-3)。ピン留めカードは
 * template+params+title だけを永続化し、表示データ自体は保存しない(§3-3) — 開くたびに
 * ここで最新のkintoneデータから再計算するため、常に「今」の値を表示する。
 *
 * 各カードの「🗨️ このグラフについて聞く」ボタンは、チャットを開いてそのカードについての
 * narrate をそのまま送る(§3: ダッシュボード→チャットの橋渡し)。逆方向(チャットの会話
 * 結果をこのダッシュボードへピン留めする)は bi-chat.ts の「📌 ダッシュボードにピン留め」
 * ボタン(chat.ts の pinCard())から行う。
 */
import { openChatWithBiQuestion } from './chat';
import { buildBiResult } from '../semantic/aggregate';
import type { BuiltBiResult, KintoneRecordFields } from '../semantic/aggregate';
import type { CardSpec, ChatCardState, TemplateParams } from '../semantic/cards';
import { buildDefaultDashboardCards } from '../semantic/dashboard-default';
import { resolvePeriodPreset } from '../semantic/fiscal';
import type { PeriodPreset } from '../semantic/fiscal';
import type { BiResult, TemplateId } from '../semantic/templates';
import { renderBiChart } from './bi-chat';
import { formatApiError } from './chat';
import { formatMetricNumber } from './format-utils';
import { getOrCreateSpaceWidgetRow } from './space-dashboard';
import { THEME, injectFontStyles } from './theme';
import { injectVizStyles, renderVizError } from './viz';

const BI_DASHBOARD_CONFIG = {
  opportunityAppId: __OPPORTUNITY_APP_ID__,
  leadAppId: __LEAD_APP_ID__,
  webhookUrl: __WEBHOOK_URL__,
  webhookSecret: __WEBHOOK_SECRET__,
};

/** Supabaseのpinned_cardsから返る1行分の形(表示データは持たない——§3-3)。 */
interface PinnedCardRow {
  id: string;
  template: TemplateId;
  params: TemplateParams;
  title?: string;
  pinned_by_name?: string;
}

function injectBiDashboardStyles(): void {
  if (document.getElementById('exh-bi-dashboard-styles')) return;
  const style = document.createElement('style');
  style.id = 'exh-bi-dashboard-styles';
  style.textContent = `
/* 横に空いているスペースを活かすため、縦1列積みではなく3列グリッドで並べる
   (ユーザーフィードバック: 「空いているスペースを有効活用したい」)。 */
/* box-sizing: border-box にしないと、width指定にpadding/borderの分(実測34px)が上乗せされて
   実際の描画幅がわずかにはみ出す——「アプリ」「ピープル」パネルとほんの少し重なって見える
   というユーザー報告の原因だった。 */
#exh-bi-dashboard { box-sizing: border-box; flex: 0 0 auto; width: min(860px, 100%); background: #fff;
  border-radius: 14px; box-shadow: 0 12px 32px -16px rgba(20,40,60,.35); border: 1px solid ${THEME.mistLine};
  padding: 16px; font-size: 13px; font-family: ${THEME.font}; }
.exh-bi-dashboard-title { font-weight: 800; font-size: 15px; margin-bottom: 10px; color: ${THEME.soraDeep}; }
.exh-bi-dashboard-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
/* 幅が狭い画面(モバイル等)では列数を落として潰れないようにする。 */
@media (max-width: 720px) { .exh-bi-dashboard-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 480px) { .exh-bi-dashboard-grid { grid-template-columns: 1fr; } }
/* 「📌 ピン留めされたカード」の見出し行はカード1枚分ではなく、グリッド全体の幅いっぱいに
   広げる(グリッド内の1セルとして扱われると、見出しが小さな1コマに収まってしまうため)。 */
.exh-bi-dashboard-section-title { grid-column: 1 / -1; font-weight: 800; font-size: 13px; color: ${THEME.soraDeep};
  margin-top: 4px; }
.exh-bi-dashboard-card { border: 1px solid ${THEME.mistLine}; border-radius: 10px; padding: 10px 12px; min-width: 0; }
/* 商談パイプライン・失注理由×業種は凡例・軸ラベルの本数が多く、他のカードと同じ1/3幅では
   ラベルが重なって読めなくなる(ユーザー報告)ため、行全体の幅を使う。 */
.exh-bi-dashboard-card-full { grid-column: 1 / -1; }
.exh-bi-dashboard-card-title { font-size: 12.5px; font-weight: 800; color: ${THEME.ink}; margin-bottom: 6px; }
/* renderBiChart() の既定サイズ(220px/260px)はチャット用——ダッシュボードは3列グリッドの
   幅の狭いカードに収めるため縮める。フルwidthのカード(パイプライン・クロス集計)は
   ラベルの本数が多いぶん、縦方向にも余裕を持たせる。 */
#exh-bi-dashboard .exh-bi-chart-host { height: 140px; }
#exh-bi-dashboard .exh-bi-chart-host.exh-bi-chart-tall { height: 170px; }
#exh-bi-dashboard .exh-bi-dashboard-card-full .exh-bi-chart-host { height: 220px; }
#exh-bi-dashboard .exh-bi-dashboard-card-full .exh-bi-chart-host.exh-bi-chart-tall { height: 340px; }
.exh-bi-dashboard-card-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.exh-bi-dashboard-ask-btn, .exh-bi-dashboard-unpin-btn { border: 1px solid ${THEME.mistLine}; background: ${THEME.cloud};
  color: ${THEME.soraDeep}; font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 999px; cursor: pointer; }
.exh-bi-dashboard-ask-btn:hover, .exh-bi-dashboard-unpin-btn:hover { background: ${THEME.mist}; }
.exh-bi-dashboard-pinned-note { font-size: 11px; color: ${THEME.soraDeep}; margin-top: 4px; }
/* KPIコンボカード(受注額・対応待ちリードをまとめて1コマに収める)。ユーザーから
   「数値カードはグラフほど大きくなくていい、2枚合わせてグラフ1枚分くらいの面積で十分」
   というフィードバックを受け、単独の巨大な数値表示ではなく、コンパクトな2行にした。 */
.exh-bi-dashboard-kpi-combo { display: flex; flex-direction: column; gap: 10px; justify-content: center; height: 100%; }
.exh-bi-dashboard-kpi-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  padding-bottom: 8px; border-bottom: 1px solid ${THEME.mistLine}; }
.exh-bi-dashboard-kpi-row:last-child { border-bottom: none; padding-bottom: 0; }
.exh-bi-dashboard-kpi-label { font-size: 11.5px; font-weight: 700; color: #5a6b7a; }
.exh-bi-dashboard-kpi-value { font-family: ${THEME.fontDisplay}; font-size: 20px; font-weight: 700; color: ${THEME.ink};
  font-variant-numeric: tabular-nums; }
.exh-bi-dashboard-kpi-ask-btn { border: none; background: none; color: ${THEME.soraDeep}; font-size: 14px; cursor: pointer;
  padding: 2px; line-height: 1; }
.exh-bi-dashboard-kpi-ask-btn:hover { opacity: .7; }
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

/** 既存のチャットwebhookを再利用する(feedback送信と同じ「特殊なmessage値」パターン
 * ——別webhookを新設せず、既存の秘密検証をそのまま使う)。 */
async function callAgentWebhook<T>(body: Record<string, unknown>): Promise<T> {
  const resp = await kintone.proxy(
    BI_DASHBOARD_CONFIG.webhookUrl,
    'POST',
    { 'Content-Type': 'application/json', 'x-webhook-secret': BI_DASHBOARD_CONFIG.webhookSecret },
    JSON.stringify(body),
  );
  const raw = String(resp[0] ?? '').trim();
  return JSON.parse(raw) as T;
}

async function fetchPinnedCards(): Promise<PinnedCardRow[]> {
  try {
    const user = kintone.getLoginUser();
    const data = await callAgentWebhook<{ success: boolean; cards: PinnedCardRow[] }>({
      message: '__list_pinned_cards__',
      sessionId: 'dashboard',
      userId: user.id,
      userName: user.name,
    });
    return Array.isArray(data.cards) ? data.cards : [];
  } catch {
    // ピン留めの取得に失敗しても、固定6枚の表示は問題なく続ける(セクション単位で劣化)。
    return [];
  }
}

async function unpinCard(cardId: string): Promise<void> {
  const user = kintone.getLoginUser();
  await callAgentWebhook<{ success: boolean }>({
    message: '__unpin_card__',
    cardId,
    sessionId: 'dashboard',
    userId: user.id,
    userName: user.name,
  });
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

/** buildBiResultの呼び出しをカード形式(CardSpec.params)から組み立てる共通ヘルパー。
 * renderCard・renderKpiComboCardの両方(通常カード・KPIコンボカード)が同じ集計経路を通る。 */
function computeCardOutcome(
  card: CardSpec,
  datasets: { opportunityRecords: KintoneRecordFields[]; leadRecords: KintoneRecordFields[] },
  today: Date,
) {
  return buildBiResult(
    datasets,
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
}

interface RenderCardOptions {
  /** ピン留めカードのみ持つ、Supabase側の行id。指定時のみ「ピン解除」ボタンを出す。 */
  pinnedCardId?: string;
  /** 商談パイプライン・失注理由×業種のように凡例/軸ラベルが多いカードは、1/3幅では
   * ラベルが重なるため行全体の幅を使う(ユーザー報告への対応)。 */
  fullWidth?: boolean;
}

/** 1枚のカード(固定6枚・ピン留めどちらも同じ形)を集計して描画する。デフォルトカードと
 * ピン留めカードで集計・描画ロジックが分岐しないよう、この1関数だけを両方から呼ぶ。 */
function renderCard(
  grid: HTMLElement,
  card: CardSpec,
  datasets: { opportunityRecords: KintoneRecordFields[]; leadRecords: KintoneRecordFields[] },
  today: Date,
  opts: RenderCardOptions = {},
): void {
  const cardEl = document.createElement('div');
  cardEl.className = opts.fullWidth ? 'exh-bi-dashboard-card exh-bi-dashboard-card-full' : 'exh-bi-dashboard-card';
  grid.appendChild(cardEl);

  const titleEl = document.createElement('div');
  titleEl.className = 'exh-bi-dashboard-card-title';
  cardEl.appendChild(titleEl);

  // このカードだけ集計に失敗しても、他のカードは問題なく表示を続ける
  // (既存space-dashboard.tsの「セクション単位で劣化」方針を踏襲)。
  const outcome = computeCardOutcome(card, datasets, today);

  if (!outcome.ok) {
    titleEl.textContent = card.title || '';
    renderVizError(cardEl, outcome.message);
    return;
  }

  titleEl.textContent = card.title || outcome.biResult.title;

  // Aggregate BI(n8n)側と同じ理由で data は緩い Record<string, unknown> 型——
  // renderBiChart はテンプレごとの厳密な PayloadFor<T> を要求するため、ここでキャストする
  // (実行時の形は runAggregate/buildBiResult が既に保証しているので安全)。
  const chartHost = document.createElement('div');
  cardEl.appendChild(chartHost);
  renderBiChart(chartHost, outcome.biResult as unknown as BiResult);

  const actionsRow = document.createElement('div');
  actionsRow.className = 'exh-bi-dashboard-card-actions';
  cardEl.appendChild(actionsRow);

  const askBtn = document.createElement('button');
  askBtn.type = 'button';
  askBtn.className = 'exh-bi-dashboard-ask-btn';
  askBtn.textContent = '🗨️ このグラフについて聞く';
  askBtn.addEventListener('click', () => {
    openChatWithBiQuestion('このグラフについて何か気づくことはある?', toChatCardState(card, outcome.biResult));
  });
  actionsRow.appendChild(askBtn);

  if (opts.pinnedCardId) {
    const unpinBtn = document.createElement('button');
    unpinBtn.type = 'button';
    unpinBtn.className = 'exh-bi-dashboard-unpin-btn';
    unpinBtn.textContent = '📌 ピン解除';
    unpinBtn.addEventListener('click', () => {
      unpinBtn.disabled = true;
      void unpinCard(opts.pinnedCardId!)
        .then(() => cardEl.remove())
        .catch((err) => {
          unpinBtn.disabled = false;
          renderVizError(cardEl, 'ピン解除に失敗しました: ' + formatApiError(err));
        });
    });
    actionsRow.appendChild(unpinBtn);
  }
}

/**
 * 受注額・対応待ちリードのような単一数値(T1)カードを、それぞれ1コマ丸ごと使う代わりに
 * 1つのコンパクトなカードへまとめて描画する。ユーザーフィードバック: 「数値は
 * グラフほど大きく表示する必要はない、2つ合わせてグラフ1枚分くらいの面積で十分」。
 */
function renderKpiComboCard(
  grid: HTMLElement,
  kpiCards: CardSpec[],
  datasets: { opportunityRecords: KintoneRecordFields[]; leadRecords: KintoneRecordFields[] },
  today: Date,
): void {
  const cardEl = document.createElement('div');
  cardEl.className = 'exh-bi-dashboard-card';
  grid.appendChild(cardEl);

  const combo = document.createElement('div');
  combo.className = 'exh-bi-dashboard-kpi-combo';
  cardEl.appendChild(combo);

  for (const card of kpiCards) {
    const row = document.createElement('div');
    row.className = 'exh-bi-dashboard-kpi-row';
    combo.appendChild(row);

    const outcome = computeCardOutcome(card, datasets, today);
    if (!outcome.ok) {
      row.textContent = `${card.title || ''}: ${outcome.message}`;
      continue;
    }

    const labelEl = document.createElement('div');
    labelEl.className = 'exh-bi-dashboard-kpi-label';
    labelEl.textContent = card.title || outcome.biResult.title;
    row.appendChild(labelEl);

    const valueWrap = document.createElement('div');
    valueWrap.style.display = 'flex';
    valueWrap.style.alignItems = 'center';
    valueWrap.style.gap = '4px';
    row.appendChild(valueWrap);

    const data = outcome.biResult.data as { value: number; unit: string };
    const valueEl = document.createElement('span');
    valueEl.className = 'exh-bi-dashboard-kpi-value';
    valueEl.textContent = formatMetricNumber(data.value, data.unit);
    valueWrap.appendChild(valueEl);

    const askBtn = document.createElement('button');
    askBtn.type = 'button';
    askBtn.className = 'exh-bi-dashboard-kpi-ask-btn';
    askBtn.textContent = '🗨️';
    askBtn.title = 'このグラフについて聞く';
    askBtn.addEventListener('click', () => {
      openChatWithBiQuestion('このグラフについて何か気づくことはある?', toChatCardState(card, outcome.biResult));
    });
    valueWrap.appendChild(askBtn);
  }
}

async function render(container: HTMLElement): Promise<void> {
  const [opportunityRecords, leadRecords, pinnedCards] = await Promise.all([
    fetchRecords(Number(BI_DASHBOARD_CONFIG.opportunityAppId)).catch(() => [] as KintoneRecordFields[]),
    fetchRecords(Number(BI_DASHBOARD_CONFIG.leadAppId)).catch(() => [] as KintoneRecordFields[]),
    fetchPinnedCards(),
  ]);
  const datasets = { opportunityRecords, leadRecords };

  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'exh-bi-dashboard-grid';
  container.appendChild(grid);

  const today = new Date();
  // T1(単一数値)はコンボカードへまとめ、残りはドーナツ(T2)を先に、ラベルの多いフルwidth
  // カード(パイプライン・クロス集計)を後に——グリッドの自動折返しで
  // [KPIコンボ, ドーナツ, ドーナツ] → [フルwidthカード] → [フルwidthカード] という
  // 見た目になる(ユーザー報告の「配置が不自然」への対応)。
  const allCards = buildDefaultDashboardCards();
  const kpiCards = allCards.filter((c) => c.template === 'T1');
  const compactCards = allCards.filter((c) => c.template === 'T2');
  const wideCards = allCards.filter((c) => c.template === 'T4' || c.template === 'T5');

  if (kpiCards.length > 0) renderKpiComboCard(grid, kpiCards, datasets, today);
  for (const card of compactCards) renderCard(grid, card, datasets, today);
  for (const card of wideCards) renderCard(grid, card, datasets, today, { fullWidth: true });

  if (pinnedCards.length > 0) {
    const pinnedTitleEl = document.createElement('div');
    pinnedTitleEl.className = 'exh-bi-dashboard-section-title';
    pinnedTitleEl.textContent = '📌 ピン留めされたカード';
    grid.appendChild(pinnedTitleEl);

    for (const row of pinnedCards) {
      const card: CardSpec = { id: row.id, template: row.template, params: row.params, title: row.title, pinned: true };
      const fullWidth = row.template === 'T4' || row.template === 'T5' || row.template === 'T8';
      renderCard(grid, card, datasets, today, { pinnedCardId: row.id, fullWidth });
    }
  }
}

export function initBiDashboard(): void {
  injectFontStyles();
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
