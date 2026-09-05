/**
 * RELVA BI 追加要件定義書 §3 — BIルーター(n8nのBI Router/Parse BI Plan)への送信だけを担う、
 * UIに一切依存しない自己完結モジュール。全体チャット(chat.ts)・グラフ単位のチャット
 * (card-chat.ts)の両方がこの1関数を通す(§3「入口が2つ、処理は1本」と同じ形)。
 *
 * chat.ts は起動時に dashboard.ts(→ __OPPORTUNITY_APP_ID__ 等のビルド時定数をモジュール
 * トップレベルで評価する)を import している。もし card-chat.ts が chat.ts を直接 import
 * すると、chart-builder.ts(→ card-chat.ts)を読み込むだけの vitest テスト
 * (chart-builder.test.ts)まで dashboard.ts の評価に巻き込まれてクラッシュする
 * ——vite.config.ts の __XXX__ 定数注入は実際の `vite build` 時にしか行われず、vitest 環境には
 * 無いため(以前 viz.ts→chat.ts→__WEBHOOK_URL__ で発生したのと全く同じ種類の事故)。
 * このファイルは chat.ts・dashboard.ts のどちらも import しない葉モジュールとして独立させ、
 * 両方のチャットUIから安全に再利用できるようにしている。
 */
import type { ChatCardState } from '../semantic/cards';
import type { BiResult } from '../semantic/templates';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface KintoneContextRef {
  recordId: string;
  appName: string;
  label: string;
}

interface ReferencedRecord {
  label: string;
  recordId?: string;
  appName?: string;
}

type AgentAction =
  | 'show_form_account'
  | 'show_form_edit_account'
  | 'show_form_opportunity'
  | 'show_form_edit_opportunity'
  | 'generate_proposal';

export interface AgentResponse {
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

export interface SendBiMessageOptions {
  /** Supabase の answer_log 等で会話をグループ化するためのキー。全体チャットは自分の
   * SESSION_ID を、グラフ単位のチャットはウィジェットごとに生成した独自のIDを渡す
   * ——別の会話として扱われて構わない(むしろ正しい)。 */
  sessionId: string;
  /** BI Router のプロンプトに渡す直近の会話履歴。グラフ単位のチャットはそのカードに
   * 閉じたやり取りのみを想定するため省略可(空配列扱い)。 */
  history?: ChatMessage[];
  lastKintoneContext?: KintoneContextRef | null;
}

/**
 * webhookへのPOST + レスポンスのパースだけを行う。呼び出し側(chat.ts の handleSend、
 * card-chat.ts の renderCardChat)がそれぞれ自分のスコープの currentCard/history を渡す
 * ——複数のグラフに同時にチャットしても、互いの状態には一切触れない。
 *
 * __WEBHOOK_URL__/__WEBHOOK_SECRET__ の参照はこの関数の中に置く(モジュールトップレベルに
 * 置かない)——単に import しただけ(chart-builder.test.ts のようにテストが renderVisual等
 * 別の関数だけを使う場合)ではこれらのビルド時定数を評価しないようにするため。vite build時は
 * defineによりリテラル値へ置き換わるので、実行時のパフォーマンスへの影響は無い。
 */
export async function sendBiCardMessage(
  text: string,
  scopeCard: ChatCardState | null,
  opts: SendBiMessageOptions,
): Promise<AgentResponse> {
  const webhookUrl = __WEBHOOK_URL__;
  const webhookSecret = __WEBHOOK_SECRET__;
  const user = kintone.getLoginUser();
  const appId = String(kintone.app.getId() || '');
  const recordId = String(kintone.app.record?.getId?.() || '');

  const resp = await kintone.proxy(
    webhookUrl,
    'POST',
    { 'Content-Type': 'application/json', 'x-webhook-secret': webhookSecret },
    JSON.stringify({
      message: text,
      sessionId: opts.sessionId,
      userId: user.id,
      userName: user.name,
      userCode: user.code,
      appId,
      recordId,
      history: opts.history || [],
      lastKintoneContext: opts.lastKintoneContext ?? null,
      currentCard: scopeCard,
    }),
  );

  const raw = String(resp[0] ?? '').trim();
  try {
    return raw.startsWith('<') ? { answer: '応答の取得に失敗しました。' } : JSON.parse(raw);
  } catch {
    return { answer: raw || '応答の取得に失敗しました。' };
  }
}
