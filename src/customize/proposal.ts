import { escHtml, formatApiError } from './chat';

const PROPOSAL_CONFIG = {
  opportunityAppId: __OPPORTUNITY_APP_ID__,
  webhookSecret: __WEBHOOK_SECRET__,
  proposalWebhookUrl: __PROPOSAL_WEBHOOK_URL__,
};

function injectProposalStyles(): void {
  if (document.getElementById('exh-proposal-styles')) return;
  const style = document.createElement('style');
  style.id = 'exh-proposal-styles';
  style.textContent = `
.exh-proposal-btn { background: #2f9e6b; color: #fff; border: none; border-radius: 6px;
  padding: 6px 12px; font-size: 13px; cursor: pointer; margin-left: 8px; }
.exh-proposal-panel { margin-top: 10px; padding: 12px; border: 1px solid #e0e0e0; border-radius: 8px;
  background: #f5fbf8; font-size: 13px; max-width: 480px; }
.exh-proposal-panel.exh-hidden { display: none; }
.exh-proposal-link { display: inline-block; margin-top: 6px; background: #2f9e6b; color: #fff;
  text-decoration: none; border-radius: 6px; padding: 6px 14px; }
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
