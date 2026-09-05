/**
 * RELVA BI 追加要件定義書 §3.3 拡張 — 「グラフ単位のチャット」。
 *
 * 「①グラフを自分で作れる」だけでなく、作った/固定表示されているグラフ1枚1枚に対して
 * 自然言語で「期間を先月にして」「これについて何か気づくことはある?」のように話しかけられる
 * ようにする——完成イメージ方針書(RELVA_BI_開発方針報告書_v2.docx)§3.3で明記した
 * 差別化ポイントそのもの。
 *
 * バックエンドは既存のBI Router/Parse BI Plan(refine/narrateのop分岐)をそのまま使う
 * ——新しい集計・新しいAIロジックは一切増やさない(§6ガードレール)。ここで足すのは
 * 「カード1枚だけをスコープにしたチャットUI」だけであり、送信自体は bi-webhook.ts の
 * sendBiCardMessage() を通す(全体チャット(chat.ts)の側パネルと送信ロジックは1本、
 * 状態管理だけを分ける)。chat.tsを直接importしない理由はbi-webhook.ts冒頭のコメント参照
 * (dashboard.tsのビルド時定数評価にvitestが巻き込まれてクラッシュするため)。
 * 複数のグラフに同時にチャットしても、それぞれが自分の card/sessionId 変数だけを更新する
 * ため互いに干渉しない(sessionIdはウィジェットごとに生成する独自のものを使う——全体
 * チャットのSESSION_IDとは意図的に別にし、Supabase側でも別の会話として記録される)。
 *
 * コンボ(棒+折れ線)カードはこの機能の対象外——コンボはchart-builder.ts側で
 * buildBiResultを2回呼んで組み立てる完全にクライアント側だけの概念で、n8nのAggregate BI
 * (buildBiResultを1回呼ぶだけ)はcomboMetricを一切解釈しない。もしコンボカードをこの
 * チャットでリファインすると、2本目の指標(折れ線)が静かに失われた1本だけのグラフに
 * なってしまう——安全側に倒し、呼び出し側(dashboard.ts/chart-builder.ts)がコンボカードを
 * 判定して、そもそもこのコンポーネントを描画しないようにする(このファイル自身は
 * chart-builder.tsに依存せず、判定は呼び出し側の責務のままにしておく)。
 */
import { renderCardControls } from './card-controls';
import type { AgentResponse } from './bi-webhook';
import { sendBiCardMessage } from './bi-webhook';
import type { ChatCardState } from '../semantic/cards';
import type { BuiltBiResult } from '../semantic/aggregate';
import { THEME } from './theme';

// 全体チャット(chat.ts)のSESSION_IDとは別に、このウィジェット専用のセッションIDを
// 1つだけ生成する(呼び出しごとではなくrenderCardChat呼び出しごと=カード1枚ごとに1つ)。
// 目的はSupabase側の会話ログを「別の会話」として自然に分けること——複数のグラフに
// 同時にチャットしても、ログ上でも互いに混ざらない。
function genCardChatSessionId(): string {
  return 'exh-card' + Math.random().toString(36).slice(2, 10);
}

export interface CardChatCallbacks {
  /** refine/narrateが成功してcardSpec(=このカードの新しい状態)が返ってきた時に呼ばれる。
   * 呼び出し側でチャートの再描画・タイトル更新・ピン留め用状態の更新などを行う。
   * biResultは常にcardSpecとセットで返るが、型を緩めに保つため念のためoptionalにしている。 */
  onUpdated: (newCard: ChatCardState, biResult?: BuiltBiResult) => void;
}

function injectCardChatStyles(): void {
  if (document.getElementById('exh-card-chat-styles')) return;
  const style = document.createElement('style');
  style.id = 'exh-card-chat-styles';
  style.textContent = `
.exh-card-chat-toggle { border: 1px solid ${THEME.mistLine}; background: #fff; color: ${THEME.soraDeep};
  font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 999px; cursor: pointer; }
.exh-card-chat-toggle:hover { background: ${THEME.cloud}; }
.exh-card-chat-panel { margin-top: 8px; border-top: 1px solid ${THEME.mistLine}; padding-top: 8px; }
.exh-card-chat-response { font-size: 12px; color: ${THEME.ink}; white-space: pre-wrap; line-height: 1.5;
  min-height: 1em; margin-bottom: 6px; }
.exh-card-chat-response.exh-card-chat-error { color: #b3341c; }
.exh-card-chat-form { display: flex; gap: 6px; }
.exh-card-chat-input { flex: 1; min-width: 0; border: 1px solid ${THEME.mistLine}; border-radius: 6px;
  padding: 5px 8px; font-size: 12px; font-family: ${THEME.font}; color: ${THEME.ink}; }
.exh-card-chat-send { border: none; background: ${THEME.sora}; color: #fff; font-size: 11.5px; font-weight: 700;
  padding: 5px 12px; border-radius: 999px; cursor: pointer; white-space: nowrap; }
.exh-card-chat-send:hover { background: ${THEME.soraDeep}; }
.exh-card-chat-send:disabled, .exh-card-chat-input:disabled { opacity: .6; cursor: default; }
`;
  document.head.appendChild(style);
}

/**
 * container に「🗨️ 質問・修正する」トグルボタンを描画する。クリックすると直下に
 * チップ(ワンクリックリファイン)+自然言語入力欄+応答欄が開閉する(常時表示にすると
 * 3列グリッドの狭いカードが埋まってしまうため、既定は畳んでおく)。
 *
 * initialCard はこの1枚のカードの現在の状態(ChatCardState)。以降のやり取りはこの関数の
 * 内部だけで完結するローカル変数として保持し、他のカード・全体チャットの状態には触れない。
 */
export function renderCardChat(container: HTMLElement, initialCard: ChatCardState, callbacks: CardChatCallbacks): void {
  injectCardChatStyles();
  container.innerHTML = '';

  let card = initialCard;
  let panelOpen = false;
  const sessionId = genCardChatSessionId();

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'exh-card-chat-toggle';
  toggleBtn.textContent = '🗨️ 質問・修正する';
  container.appendChild(toggleBtn);

  const panel = document.createElement('div');
  panel.className = 'exh-card-chat-panel';
  panel.style.display = 'none';
  container.appendChild(panel);

  const chipsContainer = document.createElement('div');
  panel.appendChild(chipsContainer);

  const responseEl = document.createElement('div');
  responseEl.className = 'exh-card-chat-response';
  panel.appendChild(responseEl);

  const form = document.createElement('form');
  form.className = 'exh-card-chat-form';
  panel.appendChild(form);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'exh-card-chat-input';
  input.placeholder = '例: 期間を先月にして / 何か気づくことはある?';
  form.appendChild(input);

  const sendBtn = document.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.className = 'exh-card-chat-send';
  sendBtn.textContent = '送信';
  form.appendChild(sendBtn);

  function renderChips(): void {
    // computeChipGroupsが1件も無ければrenderCardControls自身が何も描画しない
    // (card-controls.tsの既存の挙動をそのまま使う)。
    renderCardControls(chipsContainer, card, (phrase) => void send(phrase));
  }

  function setBusy(busy: boolean): void {
    input.disabled = busy;
    sendBtn.disabled = busy;
  }

  async function send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    input.value = '';
    setBusy(true);
    responseEl.classList.remove('exh-card-chat-error');
    responseEl.textContent = '考え中...';

    try {
      const data: AgentResponse = await sendBiCardMessage(trimmed, card, { sessionId });
      responseEl.textContent = data.answer || '';
      if (data.cardSpec) {
        card = data.cardSpec;
        renderChips();
        callbacks.onUpdated(card, data.biResult as BuiltBiResult | undefined);
      }
    } catch {
      responseEl.classList.add('exh-card-chat-error');
      responseEl.textContent = 'エラーが発生しました。もう一度お試しください。';
    } finally {
      setBusy(false);
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void send(input.value);
  });

  toggleBtn.addEventListener('click', () => {
    panelOpen = !panelOpen;
    panel.style.display = panelOpen ? '' : 'none';
    if (panelOpen && chipsContainer.childElementCount === 0) renderChips();
  });
}
