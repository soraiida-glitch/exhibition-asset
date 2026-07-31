import { escHtml, formatApiError } from './chat';
import { THEME } from './theme';

const PROPOSAL_CONFIG = {
  opportunityAppId: __OPPORTUNITY_APP_ID__,
  webhookSecret: __WEBHOOK_SECRET__,
  proposalWebhookUrl: __PROPOSAL_WEBHOOK_URL__,
};

function injectProposalStyles(): void {
  if (document.getElementById('exh-proposal-styles')) return;
  const style = document.createElement('style');
  style.id = 'exh-proposal-styles';
  const t = THEME;
  style.textContent = `
.exh-proposal-btn { background: linear-gradient(135deg, ${t.sora}, ${t.soraDeep}); color: #fff; border: none;
  border-radius: 10px; padding: 8px 16px; font-size: 13px; font-weight: 700; cursor: pointer; margin: 0 8px 8px 0;
  box-shadow: 0 6px 14px -6px rgba(0,152,187,.55); transition: transform .15s ease, box-shadow .15s ease; }
.exh-proposal-btn:hover { transform: translateY(-1px); box-shadow: 0 10px 20px -8px rgba(0,152,187,.6); }
.exh-proposal-panel { margin-top: 10px; padding: 14px; border: 1px solid ${t.mistLine}; border-radius: 12px;
  background: #fff; font-size: 13px; max-width: 480px; }
.exh-proposal-panel.exh-hidden { display: none; }
.exh-proposal-link { display: inline-block; margin-top: 6px; background: linear-gradient(135deg, ${t.sora}, ${t.soraDeep});
  color: #fff; text-decoration: none; font-weight: 700; border-radius: 8px; padding: 7px 16px; }
`;
  document.head.appendChild(style);
}

async function generateProposal(panel: HTMLElement): Promise<void> {
  const recordId = String(kintone.app.record.getId() || '');
  if (!recordId) return;

  panel.classList.remove('exh-hidden');
  panel.textContent = '提案資料を生成中... (30秒ほどかかります)';

  try {
    const resp = await kintone.proxy(
      PROPOSAL_CONFIG.proposalWebhookUrl,
      'POST',
      { 'Content-Type': 'application/json', 'x-webhook-secret': PROPOSAL_CONFIG.webhookSecret },
      JSON.stringify({ recordId }),
    );
    const raw = String(resp[0] ?? '').trim();
    const result = JSON.parse(raw) as { success?: boolean; boxUrl?: string | null };

    if (result.success && result.boxUrl) {
      panel.innerHTML = `
        <div>提案資料を生成しました。</div>
        <a class="exh-proposal-link" href="${escHtml(result.boxUrl)}" target="_blank" rel="noopener">📄 Boxで開く</a>
      `;
    } else {
      panel.textContent = '提案資料の生成に失敗しました。';
    }
  } catch (err) {
    panel.textContent = '提案資料の生成に失敗しました: ' + formatApiError(err);
  }
}

export function initProposal(appId: string): void {
  if (appId !== PROPOSAL_CONFIG.opportunityAppId) return;
  injectProposalStyles();
  if (document.getElementById('exh-proposal-btn')) return;

  const space = kintone.app.record.getHeaderMenuSpaceElement();
  if (!space) return;

  const btn = document.createElement('button');
  btn.id = 'exh-proposal-btn';
  btn.className = 'exh-proposal-btn';
  btn.textContent = '📊 提案資料を生成';
  space.appendChild(btn);

  const panel = document.createElement('div');
  panel.id = 'exh-proposal-panel';
  panel.className = 'exh-proposal-panel exh-hidden';
  space.appendChild(panel);

  btn.addEventListener('click', () => void generateProposal(panel));
}
