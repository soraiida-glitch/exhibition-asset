import { escHtml, formatApiError } from './chat';

interface SalesScoreRecord {
  assignee_name?: { value?: string };
  total_score?: { value?: string };
  score_rank?: { value?: string };
  exec_rate?: { value?: string };
  behavior_score?: { value?: string };
  outcome_score?: { value?: string };
  ai_comment?: { value?: string };
  status?: { value?: string };
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
  style.textContent = `
.exh-ss-btn { background: #c77c1f; color: #fff; border: none; border-radius: 6px;
  padding: 6px 12px; font-size: 13px; cursor: pointer; margin-left: 8px; }
.exh-ss-panel { margin-top: 10px; padding: 12px; border: 1px solid #e0e0e0; border-radius: 8px;
  background: #fff8ef; font-size: 13px; max-width: 560px; }
.exh-ss-panel.exh-hidden { display: none; }
.exh-ss-inputs { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.exh-ss-inputs input { border: 1px solid #ccc; border-radius: 4px; padding: 4px; font-size: 12px; }
.exh-ss-card { border-bottom: 1px solid #eee; padding: 6px 0; }
.exh-ss-rank { display: inline-block; width: 22px; height: 22px; text-align: center;
  border-radius: 50%; background: #c77c1f; color: #fff; font-weight: bold; margin-right: 6px; }
`;
  document.head.appendChild(style);
}

function defaultPeriod(): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function renderScores(panel: HTMLElement, records: SalesScoreRecord[]): void {
  if (!records.length) {
    panel.innerHTML = '<div>まだ結果がありません...</div>';
    return;
  }
  panel.innerHTML = records
    .map((r) => {
      const status = r.status?.value;
      if (status !== '完了') {
        return `<div class="exh-ss-card">${escHtml(r.assignee_name?.value ?? '')} — 生成中...</div>`;
      }
      return `<div class="exh-ss-card">
        <span class="exh-ss-rank">${escHtml(r.score_rank?.value ?? '?')}</span>
        <strong>${escHtml(r.assignee_name?.value ?? '')}</strong> 総合${escHtml(r.total_score?.value ?? '?')}点
        (実行率${escHtml(r.exec_rate?.value ?? '?')} / 行動${escHtml(r.behavior_score?.value ?? '?')} / 成果${escHtml(r.outcome_score?.value ?? '?')})
        <div>${escHtml(r.ai_comment?.value ?? '')}</div>
      </div>`;
    })
    .join('');
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
  panel.className = 'exh-ss-panel exh-hidden';
  document.body.appendChild(panel);

  btn.addEventListener('click', () => {
    const periodStart = (document.getElementById('exh-ss-period-start') as HTMLInputElement).value;
    const periodEnd = (document.getElementById('exh-ss-period-end') as HTMLInputElement).value;
    void handleRunScoring(panel, periodStart, periodEnd);
  });
}
