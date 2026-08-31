import {
  ACCOUNT_INDUSTRY_OPTIONS,
  ACCOUNT_STATUS_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  LEAD_STATUS_OPTIONS,
  OPPORTUNITY_STAGE_OPTIONS,
} from '../apps/schema';
import type { ChatCardState } from '../semantic/cards';
import type { BiResult } from '../semantic/templates';
import { escHtml } from './html-utils';
// 既存の `import { escHtml } from './chat'` を壊さないための re-export。中身は html-utils.ts
// (副作用のない場所) にある — RELVA BI のチャートコンポーネント(src/customize/charts/*)は
// dev/playground からも読み込まれるため、chat.ts 経由ではなく html-utils.ts から直接 import する。
export { escHtml };
import { renderBiResult } from './bi-chat';
import { renderCardControls } from './card-controls';
import { initBiDashboard } from './dashboard';
import { JPEG_QUALITY, MAX_IMAGE_BYTES, RESIZE_MAX_PX, computeResizedDimensions } from './image-utils';
import { initLeadInsights } from './lead-insights';
import { initMeetingLog } from './meeting-log';
import { initPipelineDashboard } from './pipeline-dashboard';
import { initProposal } from './proposal';
import { initRecordSummary } from './record-summary';
import { initRoleplay } from './roleplay';
import { initSalesScoring } from './sales-scoring';
import { getOrCreateSpaceWidgetRow } from './space-dashboard';
import { THEME, injectFontStyles } from './theme';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ReferencedRecord {
  label: string;
  recordId?: string;
  appName?: string;
}

interface KintoneContextRef {
  recordId: string;
  appName: string;
  label: string;
}

type AgentAction =
  | 'show_form_account'
  | 'show_form_edit_account'
  | 'show_form_opportunity'
  | 'show_form_edit_opportunity'
  | 'generate_proposal';

interface AgentResponse {
  answer?: string;
  referencedRecords?: ReferencedRecord[];
  action?: AgentAction | null;
  prefill?: Record<string, unknown>;
  /** RELVA BI (要件定義書) — n8n の Format BI Response が設定する。ある場合のみチャートを描画する。 */
  biResult?: BiResult;
  /** RELVA BI 追加要件定義書 §3/§4 — 「直前に表示したカード」。次のリファイン/ナレーション
   *  リクエストに currentCard として載せて送り返すことで、ルーターが会話の続きだと判断できる。 */
  cardSpec?: ChatCardState;
}

interface MeishiResult {
  data: {
    lead_name?: string;
    company_name?: string;
    phone?: string;
    email?: string;
    memo?: string;
  };
  isDuplicate: boolean;
  duplicateRecordId: string | null;
}

const CONFIG = {
  webhookUrl: __WEBHOOK_URL__,
  webhookSecret: __WEBHOOK_SECRET__,
  accountAppId: __ACCOUNT_APP_ID__,
  opportunityAppId: __OPPORTUNITY_APP_ID__,
  leadAppId: __LEAD_APP_ID__,
  assigneeAppId: __ASSIGNEE_APP_ID__,
  meishiWebhookUrl: __MEISHI_WEBHOOK_URL__,
  closingAdviceWebhookUrl: __CLOSING_ADVICE_WEBHOOK_URL__,
  dailyAdviceAppId: __DAILY_ADVICE_APP_ID__,
  proposalWebhookUrl: __PROPOSAL_WEBHOOK_URL__,
};

// chat.js is loaded both per-app (on our 4 exhibition_* apps) AND org-wide via
// 「kintone全体のカスタマイズ」(the only way to react to space.portal.show at all — see
// README's Phase 6 setup notes). Because org-wide customize fires app.record.* events for
// *every* app in the whole kintone environment, not just ours, the chat widget must check this
// allowlist before rendering — otherwise it leaks onto every other Novagrid app in the org.
const EXHIBITION_APP_IDS = new Set([
  CONFIG.accountAppId,
  CONFIG.opportunityAppId,
  CONFIG.leadAppId,
  CONFIG.assigneeAppId,
]);

interface ClosingAdvice {
  closingProbability?: number;
  positiveSignals?: string[];
  riskFactors?: string[];
  recommendedActions?: string[];
  summary?: string;
}

interface DailyAdviceAction {
  priority?: 'high' | 'medium' | 'low';
  action?: string;
  reason?: string;
  relatedRecord?: string;
  relatedRecordId?: string;
  executed?: boolean;
}

const EVENTS = [
  'app.record.index.show',
  'app.record.detail.show',
  'app.record.create.show',
  'app.record.edit.show',
  'space.portal.show',
  'mobile.app.record.index.show',
  'mobile.app.record.detail.show',
  'mobile.space.portal.show',
];

function genId(): string {
  return 'exh' + Math.random().toString(36).slice(2, 10);
}

// Maps the AI's Japanese appName label (see MAIN_SYSTEM_PROMPT's referencedRecords spec in
// agent-workflow.ts) to the actual kintone app ID, so a referenced record can link straight to
// its detail page instead of just showing as inert text.
const RECORD_APP_IDS: Record<string, string> = {
  取引先: CONFIG.accountAppId,
  案件: CONFIG.opportunityAppId,
  リード: CONFIG.leadAppId,
};

function buildRecordUrl(appName: string, recordId: string): string | null {
  const appId = RECORD_APP_IDS[appName];
  if (!appId) return null;
  return `/k/${appId}/show#record=${encodeURIComponent(recordId)}`;
}

// kintone's space-wide JS/CSS customization slot is global (there is no per-space attachment
// point), so space-facing features (the exhibition-booth chat widget, the daily-advice card)
// scope themselves to one space by checking event.spaceId at runtime instead — chosen by the
// user to avoid showing up on every space in the org.
const EXHIBITION_SPACE_ID = '2';

const SESSION_ID = genId();
const conversationHistory: ChatMessage[] = [];
let lastKintoneContext: KintoneContextRef | null = null;
// RELVA BI 追加要件定義書 §4: 直前に表示したカード(query/refine/narrateのどれで出たかは
// 問わない)。ルーターがrefine/narrateを判定するための唯一の手がかりなので、セッション中は
// ここでしか保持しない(Supabaseへの永続化はピン留めされたカードだけ——§3-3・§7)。
let currentCard: ChatCardState | null = null;
let msgSeq = 0;

function md2html(text: string): string {
  let html = escHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

function injectStyles(): void {
  if (document.getElementById('exh-styles')) return;
  injectFontStyles();
  const style = document.createElement('style');
  style.id = 'exh-styles';
  const t = THEME;
  style.textContent = `
#exh-fab { position: fixed; bottom: 24px; right: 24px; width: 64px; height: 64px; border-radius: 50%;
  background: linear-gradient(145deg, ${t.sora}, ${t.soraDeep}); color: #fff; font-size: 26px; display: flex;
  align-items: center; justify-content: center; cursor: pointer;
  box-shadow: 0 16px 32px -12px rgba(0,152,187,.55), 0 0 0 6px rgba(0,152,187,.16);
  z-index: 9999; border: none; animation: exh-pulse 2.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { #exh-fab { animation: none; } }
@keyframes exh-pulse {
  0%, 100% { box-shadow: 0 16px 32px -12px rgba(0,152,187,.55), 0 0 0 6px rgba(0,152,187,.16); }
  50% { box-shadow: 0 16px 32px -12px rgba(0,152,187,.7), 0 0 0 12px rgba(0,152,187,.08); }
}
#exh-panel { position: fixed; bottom: 100px; right: 24px; width: 400px; max-height: 72vh;
  background: ${t.cloud}; border-radius: 18px; box-shadow: 0 24px 60px -24px rgba(20,40,60,.35);
  display: flex; flex-direction: column; z-index: 9999; overflow: hidden; border: 1px solid ${t.mistLine};
  font-family: ${t.font}; }
#exh-panel.exh-hidden { display: none; }
#exh-header { background: linear-gradient(120deg, ${t.sora} 0%, ${t.soraDeep} 70%, #005872 130%);
  color: #fff; padding: 14px 16px; display: flex; justify-content: space-between; align-items: center; }
.exh-header-who { display: flex; align-items: center; gap: 10px; }
.exh-avatar { width: 32px; height: 32px; border-radius: 50%; background: rgba(255,255,255,.22);
  display: flex; align-items: center; justify-content: center; font-size: 16px; flex: 0 0 auto; }
.exh-header-name { font-weight: 800; font-size: 14px; }
.exh-header-status { font-size: 11px; opacity: .85; display: flex; align-items: center; gap: 5px; margin-top: 1px; }
.exh-header-status .exh-led { width: 6px; height: 6px; border-radius: 50%; background: ${t.sun};
  box-shadow: 0 0 0 2px rgba(255,255,255,.25); }
#exh-close { cursor: pointer; background: rgba(255,255,255,.18); border: none; color: #fff; font-size: 13px;
  width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
  flex: 0 0 auto; }
#exh-msgs { flex: 1; overflow-y: auto; padding: 14px; background: ${t.cloud}; display: flex;
  flex-direction: column; gap: 10px; }
#exh-chips { display: flex; gap: 8px; padding: 8px 12px 0; flex-wrap: wrap; }
.exh-chip { display: flex; align-items: center; gap: 4px; background: rgba(255,122,69,.14); color: #c85a2e;
  border: 1px solid rgba(255,122,69,.32); border-radius: 999px; padding: 7px 13px; font-size: 12.5px;
  font-weight: 700; cursor: pointer; }
.exh-chip:hover { background: rgba(255,122,69,.24); }
.exh-bubble { max-width: 85%; padding: 10px 13px; border-radius: 14px;
  font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
.exh-bubble.exh-user { background: linear-gradient(135deg, ${t.sora}, ${t.soraDeep}); color: #fff;
  margin-left: auto; border-bottom-right-radius: 4px; }
.exh-bubble.exh-ai { background: #fff; color: ${t.ink}; border: 1px solid ${t.mistLine};
  border-bottom-left-radius: 4px; }
.exh-pill { display: inline-block; margin: 4px 4px 0 0; padding: 2px 9px; border-radius: 999px;
  background: rgba(0,152,187,.14); color: ${t.soraDeep}; font-size: 11px; text-decoration: none; font-weight: 600; }
a.exh-pill { cursor: pointer; }
a.exh-pill:hover { background: rgba(0,152,187,.26); text-decoration: underline; }
.exh-fb-row { display: flex; gap: 6px; margin-top: 6px; align-items: center; }
.exh-fb-btn { background: none; border: 1px solid ${t.mistLine}; border-radius: 8px; font-size: 13px;
  padding: 3px 8px; cursor: pointer; line-height: 1; }
.exh-fb-btn:hover { background: ${t.mist}; }
.exh-fb-btn.exh-fb-active { background: ${t.sora}; border-color: ${t.sora}; opacity: .85; pointer-events: none; }
.exh-fb-note { font-size: 11.5px; color: #7a8a94; }
.exh-fb-correction { margin-top: 6px; }
.exh-fb-correction textarea { width: 100%; box-sizing: border-box; border: 1px solid ${t.mistLine};
  border-radius: 8px; padding: 6px 8px; font-size: 12px; font-family: inherit; resize: vertical;
  min-height: 44px; background: ${t.cloud}; color: ${t.ink}; }
.exh-fb-correction-submit { margin-top: 4px; border: none; border-radius: 8px; padding: 5px 12px;
  font-size: 12px; font-weight: 700; color: #fff; cursor: pointer;
  background: linear-gradient(120deg, ${t.hinode}, #e8632e); }
#exh-footer { display: flex; gap: 8px; padding: 12px; border-top: 1px solid ${t.mistLine}; align-items: flex-end;
  background: #fff; }
#exh-image-btn { background: rgba(255,201,60,.24); border: none; font-size: 18px; cursor: pointer; padding: 0;
  width: 36px; height: 36px; border-radius: 10px; flex: 0 0 auto; }
#exh-input { flex: 1; resize: none; border: 1px solid ${t.mistLine}; border-radius: 10px; padding: 9px 11px;
  font-size: 13px; max-height: 80px; font-family: inherit; background: ${t.cloud}; color: ${t.ink}; }
#exh-input:focus { outline: 2px solid ${t.sora}; outline-offset: 1px; }
#exh-send { background: linear-gradient(135deg, ${t.sora}, ${t.soraDeep}); color: #fff; border: none;
  border-radius: 10px; padding: 0 18px; height: 36px; font-weight: 700; cursor: pointer; }
.exh-form { background: #fff; border: 1px solid ${t.mistLine}; border-radius: 12px; padding: 12px;
  margin-top: 4px; font-size: 12.5px; }
.exh-form > div:first-child { font-weight: 800; font-size: 13px; margin-bottom: 4px; }
.exh-form label { display: block; margin-top: 8px; color: #5a6b7a; font-size: 12px; }
.exh-form input, .exh-form textarea, .exh-form select { width: 100%; box-sizing: border-box;
  padding: 7px 9px; border: 1px solid ${t.mistLine}; border-radius: 8px; font-size: 12.5px; margin-top: 3px;
  font-family: inherit; background: ${t.cloud}; color: ${t.ink}; }
.exh-form input:focus, .exh-form textarea:focus, .exh-form select:focus { outline: 2px solid ${t.sora};
  outline-offset: 1px; }
.exh-form-submit { margin-top: 10px; width: 100%; border: none; border-radius: 10px; padding: 9px;
  font-weight: 800; font-size: 12.5px; color: #fff; cursor: pointer;
  background: linear-gradient(120deg, ${t.hinode}, #e8632e); }
.exh-closing-advice-btn { background: linear-gradient(135deg, ${t.sora}, ${t.soraDeep}); color: #fff; border: none;
  border-radius: 10px; padding: 8px 16px; font-size: 13px; font-weight: 700; cursor: pointer; margin: 0 8px 8px 0;
  box-shadow: 0 6px 14px -6px rgba(0,152,187,.55); transition: transform .15s ease, box-shadow .15s ease; }
.exh-closing-advice-btn:hover { transform: translateY(-1px); box-shadow: 0 10px 20px -8px rgba(0,152,187,.6); }
.exh-closing-advice-panel { margin-top: 10px; padding: 14px; border: 1px solid ${t.mistLine};
  border-radius: 12px; background: #fff; font-size: 13px; max-width: 480px; }
.exh-closing-advice-panel.exh-hidden { display: none; }
.exh-advice-title { font-size: 15px; font-weight: 800; margin-bottom: 6px; color: ${t.soraDeep}; }
.exh-advice-section { margin-top: 8px; }
.exh-advice-section ul { margin: 4px 0 0; padding-left: 18px; }
/* Sits in the normal page flow (inside the shared widget row next to the dashboard card) rather
   than floating fixed to the viewport, so it scrolls away with the page instead of staying
   pinned on screen — same reasoning as space-dashboard.ts's card. */
#exh-daily-advice-card { width: 300px; max-height: 60vh; flex: 0 0 auto;
  overflow-y: auto; background: #fff; border-radius: 14px; box-shadow: 0 12px 32px -16px rgba(20,40,60,.35);
  border: 1px solid ${t.mistLine}; padding: 14px; font-size: 13px; }
.exh-daily-advice-title { font-weight: 800; margin-bottom: 8px; color: ${t.soraDeep}; }
.exh-daily-advice-item { padding: 6px 0; border-bottom: 1px solid ${t.mist}; }
.exh-daily-advice-item label { cursor: pointer; display: flex; align-items: flex-start; gap: 6px; }
.exh-daily-advice-item.exh-daily-advice-done { color: #93a3ac; text-decoration: line-through; }
.exh-daily-advice-related { color: #7a8a94; font-size: 11px; }
.exh-daily-advice-fallback-note { color: #7a8a94; font-size: 11px; margin-bottom: 6px; font-style: italic; }
.exh-daily-advice-error { color: #d33; font-size: 11px; padding-bottom: 6px; }
.exh-status-pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px;
  border-radius: 999px; font-size: 11.5px; font-weight: 700; white-space: nowrap; }
.exh-status-pill::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.exh-pill-neutral { background: ${t.mist}; color: #5a6b7a; }
.exh-pill-progress { background: rgba(255,122,69,.16); color: #c85a2e; }
.exh-pill-positive { background: rgba(46,168,107,.16); color: #1c7a4c; }
.exh-pill-negative { background: rgba(211,51,51,.12); color: #b23a3a; }
`;
  document.head.appendChild(style);
}

function buildUI(): void {
  if (document.getElementById('exh-fab')) return;

  const fab = document.createElement('button');
  fab.id = 'exh-fab';
  fab.textContent = '💬';
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.id = 'exh-panel';
  panel.className = 'exh-hidden';
  panel.innerHTML = `
    <div id="exh-header">
      <div class="exh-header-who">
        <div class="exh-avatar">🤖</div>
        <div>
          <div class="exh-header-name">営業AI秘書</div>
          <div class="exh-header-status"><span class="exh-led"></span>展示会サポート中</div>
        </div>
      </div>
      <button id="exh-close">✕</button>
    </div>
    <div id="exh-msgs"></div>
    <div id="exh-chips">
      <button class="exh-chip" data-chip="account">📋 取引先登録</button>
      <button class="exh-chip" data-chip="opportunity">💼 案件登録</button>
      <button class="exh-chip" data-chip="lead">🧑 リード登録</button>
    </div>
    <div id="exh-footer">
      <button id="exh-image-btn" type="button" title="名刺画像をアップロード">📷</button>
      <input id="exh-image-input" type="file" accept="image/*" style="display:none">
      <textarea id="exh-input" rows="1" placeholder="質問や依頼を入力..."></textarea>
      <button id="exh-send">送信</button>
    </div>
  `;
  document.body.appendChild(panel);

  fab.addEventListener('click', () => panel.classList.toggle('exh-hidden'));
  panel.querySelector('#exh-close')!.addEventListener('click', () => panel.classList.add('exh-hidden'));

  panel.querySelector('[data-chip="account"]')!.addEventListener('click', () => pushAccountForm({}));
  panel
    .querySelector('[data-chip="opportunity"]')!
    .addEventListener('click', () => pushOpportunityForm({}));
  panel.querySelector('[data-chip="lead"]')!.addEventListener('click', () => pushLeadForm({}));

  const imageBtn = panel.querySelector<HTMLButtonElement>('#exh-image-btn')!;
  const imageInput = panel.querySelector<HTMLInputElement>('#exh-image-input')!;
  imageBtn.addEventListener('click', () => imageInput.click());
  imageInput.addEventListener('change', () => {
    const file = imageInput.files?.[0];
    imageInput.value = '';
    if (file) void handleMeishiUpload(file);
  });

  const input = panel.querySelector<HTMLTextAreaElement>('#exh-input')!;
  const sendBtn = panel.querySelector<HTMLButtonElement>('#exh-send')!;

  const send = () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    void handleSend(text);
  };

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
}

function getMsgsEl(): HTMLElement {
  return document.getElementById('exh-msgs')!;
}

function pushUser(text: string): void {
  const el = document.createElement('div');
  el.className = 'exh-bubble exh-user';
  el.textContent = text;
  getMsgsEl().appendChild(el);
  scrollToBottom();
}

function scrollToBottom(): void {
  const msgs = getMsgsEl();
  msgs.scrollTop = msgs.scrollHeight;
}

function pushLoadingBubble(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'exh-bubble exh-ai';
  el.textContent = text;
  getMsgsEl().appendChild(el);
  scrollToBottom();
  return el;
}

async function sendFeedback(payload: Record<string, unknown>): Promise<void> {
  try {
    await kintone.proxy(
      CONFIG.webhookUrl,
      'POST',
      { 'Content-Type': 'application/json', 'x-webhook-secret': CONFIG.webhookSecret },
      JSON.stringify({ message: '__feedback__', sessionId: SESSION_ID, feedback: payload }),
    );
  } catch {
    // フィードバック送信の失敗はチャット自体の応答をブロックしない
  }
}

function renderFeedbackRow(container: HTMLElement, question: string, answer: string): void {
  const row = document.createElement('div');
  row.className = 'exh-fb-row';
  row.innerHTML = `
    <button class="exh-fb-btn" data-fb="positive" title="役に立った">👍</button>
    <button class="exh-fb-btn" data-fb="negative" title="訂正がある">👎</button>
  `;
  container.appendChild(row);

  const positiveBtn = row.querySelector<HTMLButtonElement>('[data-fb="positive"]')!;
  const negativeBtn = row.querySelector<HTMLButtonElement>('[data-fb="negative"]')!;

  positiveBtn.addEventListener('click', () => {
    positiveBtn.classList.add('exh-fb-active');
    negativeBtn.disabled = true;
    void sendFeedback({ type: 'positive', question, ai_answer: answer });
  });

  negativeBtn.addEventListener('click', () => {
    if (container.querySelector('.exh-fb-correction')) return;
    positiveBtn.disabled = true;
    negativeBtn.classList.add('exh-fb-active');

    const box = document.createElement('div');
    box.className = 'exh-fb-correction';
    box.innerHTML = `
      <textarea placeholder="どう訂正すればよかったか教えてください"></textarea>
      <button class="exh-fb-correction-submit">送信</button>
    `;
    container.appendChild(box);

    const textarea = box.querySelector('textarea')!;
    const submitBtn = box.querySelector<HTMLButtonElement>('.exh-fb-correction-submit')!;
    submitBtn.addEventListener('click', () => {
      const correction = textarea.value.trim();
      if (!correction) return;
      void sendFeedback({ type: 'negative', question, ai_answer: answer, user_correction: correction });
      box.innerHTML = '<span class="exh-fb-note">フィードバックありがとうございます</span>';
    });
  });
}

function updateAIBubble(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.innerHTML = md2html(text);
}

function pushAI(text: string, data?: AgentResponse, question?: string): string {
  const id = 'exh-msg-' + msgSeq++;
  const el = document.createElement('div');
  el.className = 'exh-bubble exh-ai';
  el.id = id;
  el.innerHTML = md2html(text || '');

  if (data?.referencedRecords?.length) {
    for (const ref of data.referencedRecords) {
      const url = ref.recordId && ref.appName ? buildRecordUrl(ref.appName, ref.recordId) : null;
      const pill = document.createElement(url ? 'a' : 'span');
      pill.className = 'exh-pill';
      pill.textContent = ref.label;
      if (url) {
        pill.setAttribute('href', url);
        pill.setAttribute('target', '_blank');
        pill.setAttribute('rel', 'noopener');
      }
      el.appendChild(pill);
    }
    const first = data.referencedRecords[0];
    if (first?.recordId && first.appName) {
      lastKintoneContext = { recordId: first.recordId, appName: first.appName, label: first.label };
    }
  }

  if (data?.biResult) {
    const biContainer = document.createElement('div');
    el.appendChild(biContainer);
    // ドリルダウンボタンは自然文をそのまま送信するだけ(ユーザーが打って送ったのと同じ扱い)。
    // handleSend/pinCard は下で定義されているが、関数宣言は巻き上げられるためこの前方参照で
    // 問題ない。cardSpecが無い応答(一般チャット等)にはピンボタンを出さない。
    renderBiResult(
      biContainer,
      data.biResult,
      (routerQuery) => void handleSend(routerQuery),
      data.cardSpec ? () => void pinCard(data.cardSpec!) : undefined,
    );

    // RELVA BI 追加要件定義書 §3-1 — ワンクリックのリファインチップ。クリックすると
    // §3-2の例文と全く同じ自然文が送られるだけで、refine自体は既存のrouter/Parse BI Plan
    // (cards.tsのrefine())をそのまま通る——チップ専用の処理経路は無い。
    if (data.cardSpec) {
      const controlsContainer = document.createElement('div');
      el.appendChild(controlsContainer);
      renderCardControls(controlsContainer, data.cardSpec, (phrase) => void handleSend(phrase));
    }
  }

  // このメッセージがカードを1枚出したなら「直前のカード」を更新する。BIの質問ではない
  // 一般チャットの応答にはcardSpecが付かないため、その場合は前のカードをそのまま維持する
  // (「これについて教えて」のような後続質問が直前のBI応答を指し続けられるようにするため)。
  if (data?.cardSpec) {
    currentCard = data.cardSpec;
  }

  getMsgsEl().appendChild(el);
  scrollToBottom();

  if (question) {
    renderFeedbackRow(el, question, text || '');
  }

  if (data?.action) {
    const prefill = data.prefill || {};
    setTimeout(() => {
      if (data.action === 'show_form_account' || data.action === 'show_form_edit_account') {
        pushAccountForm(prefill);
      } else if (
        data.action === 'show_form_opportunity' ||
        data.action === 'show_form_edit_opportunity'
      ) {
        pushOpportunityForm(prefill);
      } else if (data.action === 'generate_proposal') {
        const recordId = String(prefill._recordId || '');
        if (recordId) void generateProposalFromChat(recordId);
      }
    }, 150);
  }

  return id;
}

async function generateProposalFromChat(recordId: string): Promise<void> {
  const bubbleId = pushAI('📊 提案資料を生成中です... (30秒ほどかかります)');
  try {
    const resp = await kintone.proxy(
      CONFIG.proposalWebhookUrl,
      'POST',
      { 'Content-Type': 'application/json', 'x-webhook-secret': CONFIG.webhookSecret },
      JSON.stringify({ recordId }),
    );
    const raw = String(resp[0] ?? '').trim();
    const result = JSON.parse(raw) as { success?: boolean; boxUrl?: string | null };
    if (result.success && result.boxUrl) {
      updateAIBubble(bubbleId, `提案資料を生成しました。\n\n[📄 Boxで開く](${result.boxUrl})`);
    } else {
      updateAIBubble(bubbleId, '提案資料の生成に失敗しました。');
    }
  } catch (err) {
    updateAIBubble(bubbleId, '提案資料の生成に失敗しました: ' + formatApiError(err));
  }
}

export function formatApiError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const obj = err as { message?: unknown; errors?: unknown };
    const parts: string[] = [];
    if (obj.message) parts.push(String(obj.message));
    if (obj.errors) {
      try {
        parts.push(JSON.stringify(obj.errors));
      } catch {
        // ignore
      }
    }
    if (parts.length) return parts.join(' / ');
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function fieldValue(form: HTMLElement, code: string): string {
  return form.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    `[data-f="${code}"]`,
  )!.value;
}

function buildSelectHtml(code: string, options: string[], selected: unknown): string {
  const selectedStr = String(selected ?? '');
  const optionTags = [
    `<option value=""></option>`,
    ...options.map(
      (opt) =>
        `<option value="${escHtml(opt)}"${opt === selectedStr ? ' selected' : ''}>${escHtml(opt)}</option>`,
    ),
  ].join('');
  return `<select data-f="${code}">${optionTags}</select>`;
}

function pushAccountForm(prefill: Record<string, unknown>): void {
  const isEdit = !!prefill._recordId;
  const wrap = document.createElement('div');
  wrap.className = 'exh-form';
  wrap.innerHTML = `
    <div>${isEdit ? '✏️ 取引先情報を編集' : '📋 新規取引先登録'}</div>
    <label>会社名<input data-f="company_name" value="${escHtml(prefill.company_name ?? '')}"></label>
    <label>業種${buildSelectHtml('industry', ACCOUNT_INDUSTRY_OPTIONS, prefill.industry)}</label>
    <label>担当者名<input data-f="contact_name" value="${escHtml(prefill.contact_name ?? '')}"></label>
    <label>電話番号<input data-f="phone" value="${escHtml(prefill.phone ?? '')}"></label>
    <label>メールアドレス<input data-f="email" value="${escHtml(prefill.email ?? '')}"></label>
    <label>ステータス${buildSelectHtml('status', ACCOUNT_STATUS_OPTIONS, prefill.status)}</label>
    <label>メモ<textarea data-f="memo">${escHtml(prefill.memo ?? '')}</textarea></label>
    <button class="exh-form-submit">${isEdit ? '✅ 更新する' : '✅ 登録する'}</button>
  `;
  wrap.querySelector('.exh-form-submit')!.addEventListener('click', () => {
    void registerAccountRecord(wrap, isEdit ? String(prefill._recordId) : undefined);
  });
  getMsgsEl().appendChild(wrap);
  scrollToBottom();
}

function pushOpportunityForm(prefill: Record<string, unknown>): void {
  const isEdit = !!prefill._recordId;
  const wrap = document.createElement('div');
  wrap.className = 'exh-form';
  wrap.innerHTML = `
    <div>${isEdit ? '✏️ 案件情報を編集' : '📋 新規案件登録'}</div>
    <label>案件名<input data-f="deal_name" value="${escHtml(prefill.deal_name ?? '')}"></label>
    <label>取引先(会社名)<input data-f="account" value="${escHtml(prefill.account ?? '')}"></label>
    <label>金額(円)<input data-f="amount" value="${escHtml(prefill.amount ?? '')}"></label>
    <label>フェーズ${buildSelectHtml('stage', OPPORTUNITY_STAGE_OPTIONS, prefill.stage)}</label>
    <label>クロージング予定日<input data-f="close_date" type="date" value="${escHtml(prefill.close_date ?? '')}"></label>
    <label>担当者<input data-f="owner" value="${escHtml(prefill.owner ?? '')}"></label>
    <label>概要<textarea data-f="description">${escHtml(prefill.description ?? '')}</textarea></label>
    <button class="exh-form-submit">${isEdit ? '✅ 更新する' : '✅ 登録する'}</button>
  `;
  wrap.querySelector('.exh-form-submit')!.addEventListener('click', () => {
    void registerOpportunityRecord(wrap, isEdit ? String(prefill._recordId) : undefined);
  });
  getMsgsEl().appendChild(wrap);
  scrollToBottom();
}

function pushLeadForm(prefill: Record<string, unknown>): void {
  const isEdit = !!prefill._recordId;
  const wrap = document.createElement('div');
  wrap.className = 'exh-form';
  wrap.innerHTML = `
    <div>${isEdit ? '✏️ リード情報を編集' : '📋 新規リード登録'}</div>
    <label>氏名<input data-f="lead_name" value="${escHtml(prefill.lead_name ?? '')}"></label>
    <label>会社名<input data-f="company_name" value="${escHtml(prefill.company_name ?? '')}"></label>
    <label>電話番号<input data-f="phone" value="${escHtml(prefill.phone ?? '')}"></label>
    <label>メールアドレス<input data-f="email" value="${escHtml(prefill.email ?? '')}"></label>
    <label>流入経路${buildSelectHtml('source', LEAD_SOURCE_OPTIONS, prefill.source)}</label>
    <label>ステータス${buildSelectHtml('status', LEAD_STATUS_OPTIONS, prefill.status)}</label>
    <label>メモ<textarea data-f="memo">${escHtml(prefill.memo ?? '')}</textarea></label>
    <button class="exh-form-submit">${isEdit ? '✅ 更新する' : '✅ 登録する'}</button>
  `;
  wrap.querySelector('.exh-form-submit')!.addEventListener('click', () => {
    void registerLeadRecord(wrap, isEdit ? String(prefill._recordId) : undefined);
  });
  getMsgsEl().appendChild(wrap);
  scrollToBottom();
}

async function registerAccountRecord(form: HTMLElement, recordId?: string): Promise<void> {
  const record = {
    company_name: { value: fieldValue(form, 'company_name') },
    industry: { value: fieldValue(form, 'industry') },
    contact_name: { value: fieldValue(form, 'contact_name') },
    phone: { value: fieldValue(form, 'phone') },
    email: { value: fieldValue(form, 'email') },
    status: { value: fieldValue(form, 'status') },
    memo: { value: fieldValue(form, 'memo') },
  };
  const appId = Number(CONFIG.accountAppId);
  try {
    if (recordId) {
      await kintone.api('/k/v1/record', 'PUT', { app: appId, id: Number(recordId), record });
    } else {
      await kintone.api('/k/v1/record', 'POST', { app: appId, record });
    }
    pushAI(recordId ? '取引先情報を更新しました。' : '取引先を登録しました。');
  } catch (err) {
    pushAI('登録・更新に失敗しました: ' + formatApiError(err));
  }
}

async function registerOpportunityRecord(form: HTMLElement, recordId?: string): Promise<void> {
  const record = {
    deal_name: { value: fieldValue(form, 'deal_name') },
    account: { value: fieldValue(form, 'account') },
    amount: { value: fieldValue(form, 'amount') },
    stage: { value: fieldValue(form, 'stage') },
    close_date: { value: fieldValue(form, 'close_date') },
    owner: { value: fieldValue(form, 'owner') },
    description: { value: fieldValue(form, 'description') },
  };
  const appId = Number(CONFIG.opportunityAppId);
  try {
    if (recordId) {
      await kintone.api('/k/v1/record', 'PUT', { app: appId, id: Number(recordId), record });
    } else {
      await kintone.api('/k/v1/record', 'POST', { app: appId, record });
    }
    pushAI(recordId ? '案件情報を更新しました。' : '案件を登録しました。');
  } catch (err) {
    pushAI('登録・更新に失敗しました: ' + formatApiError(err));
  }
}

async function registerLeadRecord(form: HTMLElement, recordId?: string): Promise<void> {
  const record = {
    lead_name: { value: fieldValue(form, 'lead_name') },
    company_name: { value: fieldValue(form, 'company_name') },
    phone: { value: fieldValue(form, 'phone') },
    email: { value: fieldValue(form, 'email') },
    source: { value: fieldValue(form, 'source') },
    status: { value: fieldValue(form, 'status') },
    memo: { value: fieldValue(form, 'memo') },
  };
  const appId = Number(CONFIG.leadAppId);
  try {
    if (recordId) {
      await kintone.api('/k/v1/record', 'PUT', { app: appId, id: Number(recordId), record });
    } else {
      await kintone.api('/k/v1/record', 'POST', { app: appId, record });
    }
    pushAI(recordId ? 'リード情報を更新しました。' : 'リードを登録しました。');
  } catch (err) {
    pushAI('登録・更新に失敗しました: ' + formatApiError(err));
  }
}

function resizeAndCompressImage(file: File): Promise<{ base64: string; type: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('画像の読み込みに失敗しました。'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('画像の読み込みに失敗しました。'));
      img.onload = () => {
        const { width, height } = computeResizedDimensions(img.width, img.height, RESIZE_MAX_PX);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas未対応のブラウザです。'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
        resolve({ base64: dataUrl.split(',')[1] ?? '', type: 'image/jpeg' });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

async function handleMeishiUpload(file: File): Promise<void> {
  if (file.size > MAX_IMAGE_BYTES) {
    pushAI('ファイルサイズが4MBを超えています。別の画像を選択してください。');
    return;
  }

  const loadingEl = pushLoadingBubble('📷 名刺を解析中...');

  try {
    const { base64, type } = await resizeAndCompressImage(file);
    const resp = await kintone.proxy(
      CONFIG.meishiWebhookUrl,
      'POST',
      { 'Content-Type': 'application/json', 'x-webhook-secret': CONFIG.webhookSecret },
      JSON.stringify({ image_base64: base64, image_type: type }),
    );
    loadingEl.remove();

    const raw = String(resp[0] ?? '').trim();
    const result = JSON.parse(raw) as MeishiResult;

    if (result.isDuplicate && result.duplicateRecordId) {
      pushAI(
        `⚠️ 類似のリードが既に登録されている可能性があります(ID: ${result.duplicateRecordId})。内容を確認のうえ登録してください。`,
      );
    }
    pushLeadForm({ ...result.data, source: '名刺' });
  } catch (err) {
    loadingEl.remove();
    pushAI('名刺の解析に失敗しました: ' + formatApiError(err));
  }
}

/**
 * RELVA BI 追加要件定義書 §3/§7 — チャットの会話結果をダッシュボードのカードに変換する
 * (「カード=テンプレインスタンス」統一モデルの、pinによる唯一の橋渡し)。永続化するのは
 * template+params+titleだけで、表示済みのdataは送らない——ダッシュボード表示時に毎回
 * buildBiResultで最新のkintoneデータから再計算する(§3-3)。
 */
async function pinCard(card: ChatCardState): Promise<void> {
  const user = kintone.getLoginUser();
  try {
    await kintone.proxy(
      CONFIG.webhookUrl,
      'POST',
      { 'Content-Type': 'application/json', 'x-webhook-secret': CONFIG.webhookSecret },
      JSON.stringify({
        message: '__pin_card__',
        cardSpec: card,
        sessionId: SESSION_ID,
        userId: user.id,
        userName: user.name,
      }),
    );
  } catch (err) {
    pushAI('ピン留めに失敗しました: ' + formatApiError(err));
  }
}

async function handleSend(text: string): Promise<void> {
  pushUser(text);
  conversationHistory.push({ role: 'user', content: text });

  const user = kintone.getLoginUser();
  const appId = String(kintone.app.getId() || '');
  const recordId = String(kintone.app.record?.getId?.() || '');

  try {
    const resp = await kintone.proxy(
      CONFIG.webhookUrl,
      'POST',
      { 'Content-Type': 'application/json', 'x-webhook-secret': CONFIG.webhookSecret },
      JSON.stringify({
        message: text,
        sessionId: SESSION_ID,
        userId: user.id,
        userName: user.name,
        userCode: user.code,
        appId,
        recordId,
        history: conversationHistory.slice(-12),
        lastKintoneContext,
        currentCard,
      }),
    );

    const raw = String(resp[0] ?? '').trim();
    let data: AgentResponse;
    try {
      data = raw.startsWith('<') ? { answer: '応答の取得に失敗しました。' } : JSON.parse(raw);
    } catch {
      data = { answer: raw || '応答の取得に失敗しました。' };
    }

    const answer = data.answer || '';
    conversationHistory.push({ role: 'assistant', content: answer });
    pushAI(answer, data, text);
  } catch (err) {
    pushAI('エラーが発生しました: ' + formatApiError(err));
  }
}

/**
 * RELVA BI 追加要件定義書 §3 — 「カード=ピン留めしたテンプレインスタンス」の橋渡し。
 * ダッシュボード(src/customize/dashboard.ts)の各カードから「このグラフについて聞く」で
 * チャットへ入り、そのカードについての narrate/refine をそのまま続けられるようにする——
 * ダッシュボードとチャットで別々の集計・別々の状態管理を持たない。
 */
export function openChatWithBiQuestion(message: string, card: ChatCardState): void {
  const panel = document.getElementById('exh-panel');
  panel?.classList.remove('exh-hidden');
  currentCard = card;
  void handleSend(message);
}

// Called with the record straight from the detail.show event (kintone.app.record.get() is
// disallowed while a record-show event handler is still processing — see record-summary.ts for
// the same lesson). Previously the panel only ever showed advice right after a fresh generation
// click and reset to hidden on every page load/record switch — the JSON already persisted in
// closing_advice was never rendered again, so revisiting a record only showed kintone's own raw
// JSON text display for that field. This now renders the saved advice automatically whenever
// there is one.
function injectClosingAdviceButton(eventRecord: unknown): void {
  const space = kintone.app.record.getHeaderMenuSpaceElement();
  if (!space) return;

  let btn = document.getElementById('exh-closing-advice-btn') as HTMLButtonElement | null;
  let panel = document.getElementById('exh-closing-advice-panel');

  if (!btn || !panel) {
    btn = document.createElement('button');
    btn.id = 'exh-closing-advice-btn';
    btn.className = 'exh-closing-advice-btn';
    btn.textContent = '🔍 クロージングアドバイスを生成';
    space.appendChild(btn);

    panel = document.createElement('div');
    panel.id = 'exh-closing-advice-panel';
    panel.className = 'exh-closing-advice-panel exh-hidden';
    space.appendChild(panel);

    const clickPanel = panel;
    btn.addEventListener('click', () => void generateClosingAdvice(clickPanel));
  }

  const record = (eventRecord || {}) as { closing_advice?: { value?: string } };
  const savedRaw = record.closing_advice?.value;
  if (savedRaw) {
    try {
      renderClosingAdvice(panel, JSON.parse(savedRaw) as ClosingAdvice);
      panel.classList.remove('exh-hidden');
    } catch {
      panel.classList.add('exh-hidden');
      panel.innerHTML = '';
    }
  } else {
    panel.classList.add('exh-hidden');
    panel.innerHTML = '';
  }
}

async function generateClosingAdvice(panel: HTMLElement): Promise<void> {
  const recordId = String(kintone.app.record.getId() || '');
  if (!recordId) return;

  panel.classList.remove('exh-hidden');
  panel.textContent = '分析中...';

  try {
    const resp = await kintone.proxy(
      CONFIG.closingAdviceWebhookUrl,
      'POST',
      { 'Content-Type': 'application/json', 'x-webhook-secret': CONFIG.webhookSecret },
      JSON.stringify({ recordId }),
    );
    const raw = String(resp[0] ?? '').trim();
    const advice = JSON.parse(raw) as ClosingAdvice;
    renderClosingAdvice(panel, advice);
  } catch (err) {
    panel.textContent = '生成に失敗しました: ' + formatApiError(err);
  }
}

function renderClosingAdvice(panel: HTMLElement, advice: ClosingAdvice): void {
  const positives = (advice.positiveSignals || []).map((s) => `<li>${escHtml(s)}</li>`).join('');
  const risks = (advice.riskFactors || []).map((s) => `<li>${escHtml(s)}</li>`).join('');
  const actions = (advice.recommendedActions || []).map((s) => `<li>${escHtml(s)}</li>`).join('');
  panel.innerHTML = `
    <div class="exh-advice-title">受注確度: ${escHtml(advice.closingProbability ?? '?')}%</div>
    <div>${escHtml(advice.summary ?? '')}</div>
    ${positives ? `<div class="exh-advice-section">✅ ポジティブ要因<ul>${positives}</ul></div>` : ''}
    ${risks ? `<div class="exh-advice-section">⚠️ リスク要因<ul>${risks}</ul></div>` : ''}
    ${actions ? `<div class="exh-advice-section">📌 推奨アクション<ul>${actions}</ul></div>` : ''}
  `;
}

interface DailyAdviceState {
  recordId: string;
  parsed: { context_summary?: string; actions: DailyAdviceAction[] };
}

let currentDailyAdvice: DailyAdviceState | null = null;

function injectDailyAdviceCard(): void {
  if (document.getElementById('exh-daily-advice-card')) return;

  const card = document.createElement('div');
  card.id = 'exh-daily-advice-card';
  card.innerHTML =
    '<div class="exh-daily-advice-title">📌 本日のアドバイス</div><div id="exh-daily-advice-body">読み込み中...</div>';
  getOrCreateSpaceWidgetRow().appendChild(card);

  card.querySelector('#exh-daily-advice-body')!.addEventListener('change', (e) => {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.classList.contains('exh-daily-advice-checkbox')) {
      void toggleActionExecuted(Number(target.dataset.idx));
    }
  });

  void loadDailyAdvice();
}

async function loadDailyAdvice(): Promise<void> {
  const bodyEl = document.getElementById('exh-daily-advice-body');
  if (!bodyEl) return;

  try {
    const user = kintone.getLoginUser();
    // +9h before slicing so this matches the JST calendar date the Cron writes advice_date as
    // (see daily-advice-workflow.ts's comment on the same fix) — without it, a visitor checking
    // before ~9am JST would see UTC's still-yesterday date and never find the record the 7:00 JST
    // Cron had just created that morning.
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const appId = Number(CONFIG.dailyAdviceAppId);
    const query = `advice_date = "${today}" and assignee_code = "${user.code.replace(/"/g, '')}" limit 1`;
    const result = (await kintone.api('/k/v1/records', 'GET', { app: appId, query })) as {
      records: Array<{ $id?: { value: string }; advice_json?: { value: string } }>;
    };

    const record = result.records[0];
    const parsed = record?.advice_json ? (JSON.parse(record.advice_json.value) as { actions?: DailyAdviceAction[] }) : null;
    const actions = parsed?.actions || [];
    if (!record?.$id || !actions.length) {
      // The Cron that generates this only runs once a day — anyone checking before it fires that
      // day would otherwise see a dead-end "no advice" message even though the chat agent (which
      // has its own live fallback for the same gap, see agent-workflow.ts's myOpenDeals) can still
      // answer "今日やること" questions. Mirror that fallback here so the two surfaces agree.
      currentDailyAdvice = null;
      await renderOpenDealsFallback(bodyEl, user.code);
      return;
    }

    currentDailyAdvice = { recordId: record.$id.value, parsed: { ...parsed, actions } };
    renderDailyAdvice(bodyEl);
  } catch (err) {
    bodyEl.textContent = '読み込みに失敗しました: ' + formatApiError(err);
  }
}

const CLOSED_STAGES = ['成約', '失注'];

async function renderOpenDealsFallback(bodyEl: HTMLElement, userCode: string): Promise<void> {
  try {
    const stageList = CLOSED_STAGES.map((s) => `"${s}"`).join(', ');
    const query = `owner = "${userCode.replace(/"/g, '')}" and stage not in (${stageList}) order by close_date asc limit 5`;
    const result = (await kintone.api('/k/v1/records', 'GET', {
      app: Number(CONFIG.opportunityAppId),
      query,
    })) as { records: Array<{ deal_name?: { value?: string }; account?: { value?: string }; close_date?: { value?: string } }> };

    if (!result.records.length) {
      bodyEl.textContent = '本日のアドバイスはまだ生成されていません。現在担当している案件もありません。';
      return;
    }

    bodyEl.innerHTML =
      '<div class="exh-daily-advice-fallback-note">本日分の正式なアドバイスはまだ生成されていませんが、現在担当している案件から:</div>' +
      result.records
        .map((r) => {
          const account = r.account?.value ? ` <span class="exh-daily-advice-related">(${escHtml(r.account.value)})</span>` : '';
          const closeDate = r.close_date?.value ? ` — ${escHtml(r.close_date.value)}` : '';
          return `<div class="exh-daily-advice-item">🔹 ${escHtml(r.deal_name?.value ?? '')}${account}${closeDate}</div>`;
        })
        .join('');
  } catch (err) {
    bodyEl.textContent = '読み込みに失敗しました: ' + formatApiError(err);
  }
}

function renderDailyAdvice(bodyEl: HTMLElement): void {
  if (!currentDailyAdvice) return;
  const priorityIcon = (priority?: string) =>
    priority === 'high' ? '🔴' : priority === 'medium' ? '🟡' : '🟢';
  bodyEl.innerHTML = currentDailyAdvice.parsed.actions
    .map((a, idx) => {
      const related = a.relatedRecord
        ? ` <span class="exh-daily-advice-related">(${escHtml(a.relatedRecord)})</span>`
        : '';
      const doneClass = a.executed ? ' exh-daily-advice-done' : '';
      return `<div class="exh-daily-advice-item${doneClass}"><label>
        <input type="checkbox" class="exh-daily-advice-checkbox" data-idx="${idx}" ${a.executed ? 'checked' : ''}>
        ${priorityIcon(a.priority)} ${escHtml(a.action ?? '')}${related}
      </label></div>`;
    })
    .join('');
}

async function toggleActionExecuted(idx: number): Promise<void> {
  if (!currentDailyAdvice) return;
  const action = currentDailyAdvice.parsed.actions[idx];
  if (!action) return;
  const bodyEl = document.getElementById('exh-daily-advice-body');

  action.executed = !action.executed;
  if (bodyEl) renderDailyAdvice(bodyEl);

  try {
    await kintone.api('/k/v1/record', 'PUT', {
      app: Number(CONFIG.dailyAdviceAppId),
      id: Number(currentDailyAdvice.recordId),
      record: { advice_json: { value: JSON.stringify(currentDailyAdvice.parsed) } },
    });
  } catch (err) {
    action.executed = !action.executed;
    if (bodyEl) {
      renderDailyAdvice(bodyEl);
      const errEl = document.createElement('div');
      errEl.className = 'exh-daily-advice-error';
      errEl.textContent = '更新に失敗しました: ' + formatApiError(err);
      bodyEl.prepend(errEl);
      setTimeout(() => errEl.remove(), 4000);
    }
  }
}

// kintone has no way to color-code a DROP_DOWN's list-view cell by its value via settings, so
// this walks the rendered list looking for known status text and wraps it in a colored pill.
// `.value-<fieldCode>` is an undocumented kintone class name (not a public API) — if a future
// kintone update renames it, this silently stops matching and the list just falls back to
// plain text, so there's no functional risk in relying on it.
export const STATUS_PILL_CLASS: Record<string, string> = {
  成約: 'exh-pill-positive',
  取引中: 'exh-pill-positive',
  有効: 'exh-pill-positive',
  変換済み: 'exh-pill-positive',
  完了: 'exh-pill-positive',
  提案中: 'exh-pill-progress',
  見積提出: 'exh-pill-progress',
  交渉中: 'exh-pill-progress',
  対応中: 'exh-pill-progress',
  生成中: 'exh-pill-progress',
  処理中: 'exh-pill-progress',
  失注: 'exh-pill-negative',
  休眠: 'exh-pill-negative',
  無効: 'exh-pill-negative',
  対象外: 'exh-pill-negative',
  エラー: 'exh-pill-negative',
  初期接触: 'exh-pill-neutral',
  ヒアリング: 'exh-pill-neutral',
  見込み: 'exh-pill-neutral',
  未対応: 'exh-pill-neutral',
  未生成: 'exh-pill-neutral',
  ポジティブ: 'exh-pill-positive',
  ネガティブ: 'exh-pill-negative',
  ニュートラル: 'exh-pill-neutral',
};

const PILL_FIELD_CODES = ['stage', 'status', 'proposal_status'];

function colorizeStatusPills(): void {
  for (const fieldCode of PILL_FIELD_CODES) {
    const cells = document.querySelectorAll<HTMLElement>(`.value-${fieldCode}`);
    cells.forEach((cell) => {
      if (cell.querySelector('.exh-status-pill')) return;
      const text = cell.textContent?.trim();
      if (!text) return;
      const cls = STATUS_PILL_CLASS[text] || 'exh-pill-neutral';
      cell.innerHTML = '';
      const pill = document.createElement('span');
      pill.className = `exh-status-pill ${cls}`;
      pill.textContent = text;
      cell.appendChild(pill);
    });
  }
}

// The list view exposes ".value-<fieldCode>" (used above), but the detail view instead exposes
// ".value-<numeric internal field id>" — a per-app, per-field number with no code mapping
// available from customize JS. Matching by the field's visible Japanese label text sidesteps that
// entirely (confirmed against the live DOM: label text lives in ".control-label-text-gaia",
// sharing a ".control-gaia" ancestor with the value's ".control-value-gaia").
const PILL_FIELD_LABELS = ['フェーズ', 'ステータス', '提案書ステータス'];

function colorizeDetailStatusPills(): void {
  const labels = document.querySelectorAll<HTMLElement>('#record-gaia .control-label-text-gaia');
  labels.forEach((labelEl) => {
    const labelText = labelEl.textContent?.trim();
    if (!labelText || !PILL_FIELD_LABELS.includes(labelText)) return;
    const wrapper = labelEl.closest('.control-gaia');
    const valueEl = wrapper?.querySelector<HTMLElement>('.control-value-gaia');
    if (!valueEl || valueEl.querySelector('.exh-status-pill')) return;
    const text = valueEl.textContent?.trim();
    if (!text) return;
    const cls = STATUS_PILL_CLASS[text] || 'exh-pill-neutral';
    valueEl.innerHTML = '';
    const pill = document.createElement('span');
    pill.className = `exh-status-pill ${cls}`;
    pill.textContent = text;
    valueEl.appendChild(pill);
  });
}

kintone.events.on(EVENTS, (event) => {
  // kintone's org-wide "kintone全体のカスタマイズ" JS slot (the only way to react to
  // space.portal.show at all — see README's Phase 6 setup notes) loads this same chat.js on
  // EVERY space's portal page across the whole kintone environment, not just this app's own
  // space — hence the spaceId check. The exhibition-booth chat widget shows here too (for staff
  // to use it directly from the space's landing page, without first opening an individual app),
  // alongside the daily-advice card.
  if (event.type === 'space.portal.show' || event.type === 'mobile.space.portal.show') {
    const spaceId = String((event as { spaceId?: unknown }).spaceId ?? '');
    if (spaceId === EXHIBITION_SPACE_ID) {
      injectStyles();
      buildUI();
      // Order matters: getOrCreateSpaceWidgetRow() appends children in call order, and the
      // dashboard is meant to render to the left of the daily-advice card.
      // RELVA BI 追加要件定義書 §5 の6枚の分析ダッシュボード(+ピン留めカード)が旧
      // space-dashboard(案件総額/成約金額のKPI・フェーズ別パイプライン・営業ランキング)の
      // 内容を完全に包含して置き換えたため、旧ダッシュボードは廃止した(二重表示を避けるため)。
      initBiDashboard();
      injectDailyAdviceCard();
    }
    return event;
  }

  const appId = String(kintone.app.getId() || '');
  if (!EXHIBITION_APP_IDS.has(appId)) {
    return event;
  }

  injectStyles();
  buildUI();

  if (event.type === 'app.record.detail.show') {
    colorizeStatusPills();
    colorizeDetailStatusPills();
  }
  if (appId === CONFIG.opportunityAppId && event.type === 'app.record.detail.show') {
    // Each wrapped independently: one throwing must not stop the rest from running (an earlier
    // version had initRecordSummary silently never execute if something ahead of it threw).
    for (const fn of [() => injectClosingAdviceButton((event as { record?: unknown }).record), () => initRoleplay(appId), () => initMeetingLog(appId), () => initProposal(appId), () => initRecordSummary(appId, (event as { record?: unknown }).record)]) {
      try {
        fn();
      } catch (err) {
        console.error('[exh] detail.show init failed:', err);
      }
    }
  }
  if (event.type === 'app.record.index.show') {
    initSalesScoring(appId);
    colorizeStatusPills();
    initPipelineDashboard(appId);
    initLeadInsights(appId);
  }

  return event;
});
