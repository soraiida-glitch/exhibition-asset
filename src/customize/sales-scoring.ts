import { escHtml, formatApiError } from './chat';
import { THEME } from './theme';

interface SalesScoreRecord {
  assignee_name?: { value?: string };
  total_score?: { value?: string };
  score_rank?: { value?: string };
  exec_rate?: { value?: string };
  behavior_score?: { value?: string };
  outcome_score?: { value?: string };
  ai_comment?: { value?: string };
  status?: { value?: string };
  period_end?: { value?: string };
}

const SS_CONFIG = {
  assigneeAppId: __ASSIGNEE_APP_ID__,
  salesScoreAppId: __SALES_SCORE_APP_ID__,
  webhookSecret: __WEBHOOK_SECRET__,
  salesScoringWebhookUrl: __SALES_SCORING_WEBHOOK_URL__,
};

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 24; // 5s * 24 = 2分

function injectSalesScoringStyles(): void {
  if (document.getElementById('exh-ss-styles')) return;
  const style = document.createElement('style');
  style.id = 'exh-ss-styles';
  const t = THEME;
  style.textContent = `
.exh-ss-btn { background: linear-gradient(135deg, ${t.hinode}, #e8632e); color: #fff; border: none;
  border-radius: 8px; padding: 7px 14px; font-size: 13px; font-weight: 700; cursor: pointer; margin-left: 8px; }
.exh-ss-panel { margin-top: 10px; padding: 14px; border: 1px solid ${t.mistLine}; border-radius: 12px;
  background: #fff; font-size: 13px; max-width: 560px; }
.exh-ss-panel.exh-hidden { display: none; }
.exh-ss-inputs { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.exh-ss-inputs input { border: 1px solid ${t.mistLine}; border-radius: 6px; padding: 5px 7px; font-size: 12px;
  background: ${t.cloud}; color: ${t.ink}; }

.exh-ss-rank-list { display: flex; flex-direction: column; gap: 10px; }
.exh-ss-rank-card { display: grid; grid-template-columns: 38px 1fr auto; gap: 12px; align-items: center;
  padding: 10px 12px; border-radius: 12px; background: ${t.cloud}; border: 1px solid ${t.mistLine}; }
.exh-ss-rank-card.exh-ss-top1 { border-color: ${t.sora}; background: linear-gradient(120deg, rgba(0,152,187,.10), rgba(0,152,187,.03)); }
.exh-ss-rank-badge { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center;
  justify-content: center; font-weight: 800; font-size: 14px; color: #fff;
  background: linear-gradient(135deg, #5aa9bd, ${t.soraDeep}); }
.exh-ss-rank-card.exh-ss-top1 .exh-ss-rank-badge { background: linear-gradient(135deg, ${t.sora}, ${t.soraDeep});
  font-size: 16px; box-shadow: 0 0 0 4px rgba(0,152,187,.16); }
.exh-ss-rank-card.exh-ss-top3 .exh-ss-rank-badge { background: linear-gradient(135deg, ${t.mistLine}, #9fbfc9); color: ${t.ink}; }
.exh-ss-name-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.exh-ss-name { font-weight: 800; font-size: 14px; }
.exh-ss-grade { font-size: 10.5px; font-weight: 800; padding: 1px 7px; border-radius: 999px;
  background: rgba(0,152,187,.14); color: ${t.soraDeep}; }
.exh-ss-comment { font-size: 12px; color: #5a6b7a; margin-top: 3px; }
.exh-ss-bars { display: flex; gap: 8px; margin-top: 6px; }
.exh-ss-bar { flex: 1; }
.exh-ss-bar-label { font-size: 10px; color: #5a6b7a; margin-bottom: 2px; }
.exh-ss-bar-track { height: 5px; border-radius: 999px; background: ${t.mist}; overflow: hidden; }
.exh-ss-bar-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg, ${t.sora}, ${t.soraDeep}); }
.exh-ss-score { text-align: right; }
.exh-ss-score .exh-ss-num { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; }
.exh-ss-score .exh-ss-unit { font-size: 10.5px; color: #5a6b7a; }
`;
  document.head.appendChild(style);
}

// +9h before slicing so the date reflects JST (this demo's actual timezone), not UTC — JST has no
// DST, so a fixed offset is exact, unlike toISOString() alone which reports the UTC calendar date
// (e.g. a JST browser at 07:00 already local-morning would otherwise still show yesterday's date).
function jstDateString(d: Date): string {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function defaultPeriod(): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  return { start: jstDateString(start), end: jstDateString(end) };
}

const MEDALS = ['🥇', '🥈', '🥉'];

function renderScores(panel: HTMLElement, records: SalesScoreRecord[]): void {
  if (!records.length) {
    panel.innerHTML = '<div>まだ結果がありません...</div>';
    return;
  }

  const pending = records.filter((r) => r.status?.value !== '完了');
  // 順位(1位/2位/3位)はスコアの序列、score_rank(S~D評価)は別概念の評価グレードなので、
  // カード内では「バッジ=順位」「ピル=評価」と明確に分けて出す。
  const ranked = records
    .filter((r) => r.status?.value === '完了')
    .slice()
    .sort((a, b) => Number(b.total_score?.value ?? 0) - Number(a.total_score?.value ?? 0));

  const pendingHtml = pending
    .map((r) => `<div class="exh-ss-comment">${escHtml(r.assignee_name?.value ?? '')} — 生成中...</div>`)
    .join('');

  const rankedHtml = ranked
    .map((r, idx) => {
      const topClass = idx === 0 ? ' exh-ss-top1' : idx === 1 ? ' exh-ss-top2' : idx === 2 ? ' exh-ss-top3' : '';
      const badge = idx < 3 ? MEDALS[idx] : String(idx + 1);
      const bar = (label: string, raw: string | undefined) => {
        const pct = Math.max(0, Math.min(100, Number(raw ?? 0)));
        return `<div class="exh-ss-bar"><div class="exh-ss-bar-label">${label} ${escHtml(raw ?? '?')}</div>
          <div class="exh-ss-bar-track"><div class="exh-ss-bar-fill" style="width:${pct}%"></div></div></div>`;
      };
      return `<div class="exh-ss-rank-card${topClass}">
        <div class="exh-ss-rank-badge">${badge}</div>
        <div>
          <div class="exh-ss-name-row">
            <span class="exh-ss-name">${escHtml(r.assignee_name?.value ?? '')}</span>
            <span class="exh-ss-grade">${escHtml(r.score_rank?.value ?? '?')}評価</span>
          </div>
          ${r.ai_comment?.value ? `<div class="exh-ss-comment">${escHtml(r.ai_comment.value)}</div>` : ''}
          <div class="exh-ss-bars">
            ${bar('実行率', r.exec_rate?.value)}
            ${bar('行動', r.behavior_score?.value)}
            ${bar('成果', r.outcome_score?.value)}
          </div>
        </div>
        <div class="exh-ss-score"><div class="exh-ss-num">${escHtml(r.total_score?.value ?? '?')}</div><div class="exh-ss-unit">総合点</div></div>
      </div>`;
    })
    .join('');

  panel.innerHTML = `${pendingHtml}<div class="exh-ss-rank-list">${rankedHtml}</div>`;
}

async function pollResults(periodStart: string, periodEnd: string, panel: HTMLElement): Promise<void> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const result = (await kintone.api('/k/v1/records', 'GET', {
      app: Number(SS_CONFIG.salesScoreAppId),
      query: `period_start = "${periodStart}" and period_end = "${periodEnd}"`,
    })) as { records: SalesScoreRecord[] };

    renderScores(panel, result.records);

    if (result.records.length > 0 && result.records.every((r) => r.status?.value === '完了')) {
      return;
    }
  }
}

/** Auto-populates the ranking on page load from the most recently completed scoring run, so
 * exhibition staff see a live leaderboard without first having to click "全員スコアリング実行". */
async function loadLatestScores(panel: HTMLElement): Promise<void> {
  try {
    const latestResult = (await kintone.api('/k/v1/records', 'GET', {
      app: Number(SS_CONFIG.salesScoreAppId),
      // kintone reserves the "status" field code for process management and only allows the
      // in/not in operators on it (confirmed live: "=" fails with GAIA_IQ03).
      query: 'status in ("完了") order by period_end desc limit 1',
    })) as { records: SalesScoreRecord[] };
    const latestPeriodEnd = latestResult.records[0]?.period_end?.value;
    if (!latestPeriodEnd) {
      panel.innerHTML = '<div>まだスコアリング結果がありません。上のボタンから実行してください。</div>';
      return;
    }

    const result = (await kintone.api('/k/v1/records', 'GET', {
      app: Number(SS_CONFIG.salesScoreAppId),
      query: `period_end = "${latestPeriodEnd.replace(/"/g, '')}"`,
    })) as { records: SalesScoreRecord[] };
    renderScores(panel, result.records);
  } catch (err) {
    panel.textContent = 'ランキングの取得に失敗しました: ' + formatApiError(err);
  }
}

async function handleRunScoring(panel: HTMLElement, periodStart: string, periodEnd: string): Promise<void> {
  panel.classList.remove('exh-hidden');
  panel.innerHTML = '<div>スコアリングを開始しています...</div>';

  try {
    await kintone.proxy(
      SS_CONFIG.salesScoringWebhookUrl,
      'POST',
      { 'Content-Type': 'application/json', 'x-webhook-secret': SS_CONFIG.webhookSecret },
      JSON.stringify({ periodStart, periodEnd }),
    );
    panel.innerHTML = '<div>スコアリング中... (担当者数に応じて数十秒〜数分かかります)</div>';
    await pollResults(periodStart, periodEnd, panel);
  } catch (err) {
    panel.textContent = 'スコアリングに失敗しました: ' + formatApiError(err);
  }
}

export function initSalesScoring(appId: string): void {
  if (appId !== SS_CONFIG.assigneeAppId) return;
  injectSalesScoringStyles();
  if (document.getElementById('exh-ss-btn')) return;

  const space = kintone.app.getHeaderMenuSpaceElement();
  if (!space) return;

  const { start, end } = defaultPeriod();

  const btn = document.createElement('button');
  btn.id = 'exh-ss-btn';
  btn.className = 'exh-ss-btn';
  btn.textContent = '🏆 全員スコアリング実行';
  space.appendChild(btn);

  const inputs = document.createElement('span');
  inputs.className = 'exh-ss-inputs';
  inputs.innerHTML = `
    <input type="date" id="exh-ss-period-start" value="${start}">
    〜
    <input type="date" id="exh-ss-period-end" value="${end}">
  `;
  space.appendChild(inputs);

  const panel = document.createElement('div');
  panel.id = 'exh-ss-panel';
  panel.className = 'exh-ss-panel';
  panel.innerHTML = '<div>読み込み中...</div>';
  document.body.appendChild(panel);

  btn.addEventListener('click', () => {
    const periodStart = (document.getElementById('exh-ss-period-start') as HTMLInputElement).value;
    const periodEnd = (document.getElementById('exh-ss-period-end') as HTMLInputElement).value;
    void handleRunScoring(panel, periodStart, periodEnd);
  });

  void loadLatestScores(panel);
}
