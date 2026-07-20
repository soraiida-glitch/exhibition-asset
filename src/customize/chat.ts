import {
  ACCOUNT_INDUSTRY_OPTIONS,
  ACCOUNT_STATUS_OPTIONS,
  LEAD_SOURCE_OPTIONS,
  LEAD_STATUS_OPTIONS,
  OPPORTUNITY_STAGE_OPTIONS,
} from '../apps/schema';
import { JPEG_QUALITY, MAX_IMAGE_BYTES, RESIZE_MAX_PX, computeResizedDimensions } from './image-utils';

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
  | 'show_form_edit_opportunity';

interface AgentResponse {
  answer?: string;
  referencedRecords?: ReferencedRecord[];
  action?: AgentAction | null;
  prefill?: Record<string, unknown>;
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
  meishiWebhookUrl: __MEISHI_WEBHOOK_URL__,
};

const EVENTS = [
  'app.record.index.show',
  'app.record.detail.show',
  'app.record.create.show',
  'app.record.edit.show',
  'portal.show',
  'mobile.app.record.index.show',
  'mobile.app.record.detail.show',
  'mobile.portal.show',
];

function genId(): string {
  return 'exh' + Math.random().toString(36).slice(2, 10);
}

const SESSION_ID = genId();
const conversationHistory: ChatMessage[] = [];
let lastKintoneContext: KintoneContextRef | null = null;
let msgSeq = 0;

function escHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function md2html(text: string): string {
  let html = escHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

function injectStyles(): void {
  if (document.getElementById('exh-styles')) return;
  const style = document.createElement('style');
  style.id = 'exh-styles';
  style.textContent = `
#exh-fab { position: fixed; bottom: 24px; right: 24px; width: 56px; height: 56px; border-radius: 50%;
  background: #2f6fed; color: #fff; font-size: 24px; display: flex; align-items: center;
  justify-content: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.25); z-index: 9999; border: none; }
#exh-panel { position: fixed; bottom: 90px; right: 24px; width: 360px; max-height: 70vh;
  background: #fff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,.2); display: flex;
  flex-direction: column; z-index: 9999; overflow: hidden; }
#exh-panel.exh-hidden { display: none; }
#exh-header { background: #2f6fed; color: #fff; padding: 12px 16px; display: flex;
  justify-content: space-between; align-items: center; }
#exh-close { cursor: pointer; background: none; border: none; color: #fff; font-size: 18px; }
#exh-msgs { flex: 1; overflow-y: auto; padding: 12px; background: #f5f6f8; }
#exh-chips { display: flex; gap: 6px; padding: 8px 10px 0; flex-wrap: wrap; }
.exh-chip { background: #eef2ff; color: #2f6fed; border: none; border-radius: 999px;
  padding: 6px 12px; font-size: 12px; cursor: pointer; }
.exh-chip:hover { background: #dde6ff; }
.exh-bubble { max-width: 85%; margin-bottom: 10px; padding: 8px 12px; border-radius: 10px;
  font-size: 13px; line-height: 1.5; white-space: pre-wrap; }
.exh-bubble.exh-user { background: #2f6fed; color: #fff; margin-left: auto; }
.exh-bubble.exh-ai { background: #fff; color: #222; border: 1px solid #e0e0e0; }
.exh-pill { display: inline-block; margin: 4px 4px 0 0; padding: 2px 8px; border-radius: 999px;
  background: #eef2ff; color: #2f6fed; font-size: 11px; text-decoration: none; }
#exh-footer { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e0e0e0; align-items: flex-end; }
#exh-image-btn { background: none; border: none; font-size: 20px; cursor: pointer; padding: 0 2px; }
#exh-input { flex: 1; resize: none; border: 1px solid #ccc; border-radius: 8px; padding: 8px;
  font-size: 13px; max-height: 80px; }
#exh-send { background: #2f6fed; color: #fff; border: none; border-radius: 8px; padding: 0 14px;
  cursor: pointer; }
.exh-form { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 10px;
  margin-top: 6px; font-size: 12px; }
.exh-form label { display: block; margin-top: 6px; color: #555; }
.exh-form input, .exh-form textarea, .exh-form select { width: 100%; box-sizing: border-box;
  padding: 6px; border: 1px solid #ccc; border-radius: 6px; font-size: 12px; margin-top: 2px; }
.exh-form-submit { margin-top: 8px; width: 100%; background: #2f6fed; color: #fff; border: none;
  border-radius: 6px; padding: 8px; cursor: pointer; }
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
      <span>営業AI秘書</span>
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

function pushAI(text: string, data?: AgentResponse): void {
  const id = 'exh-msg-' + msgSeq++;
  const el = document.createElement('div');
  el.className = 'exh-bubble exh-ai';
  el.id = id;
  el.innerHTML = md2html(text || '');

  if (data?.referencedRecords?.length) {
    for (const ref of data.referencedRecords) {
      const pill = document.createElement('span');
      pill.className = 'exh-pill';
      pill.textContent = ref.label;
      el.appendChild(pill);
    }
    const first = data.referencedRecords[0];
    if (first?.recordId && first.appName) {
      lastKintoneContext = { recordId: first.recordId, appName: first.appName, label: first.label };
    }
  }

  getMsgsEl().appendChild(el);
  scrollToBottom();

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
      }
    }, 150);
  }
}

function formatApiError(err: unknown): string {
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
    pushAI(answer, data);
  } catch (err) {
    pushAI('エラーが発生しました: ' + formatApiError(err));
  }
}

kintone.events.on(EVENTS, (event) => {
  injectStyles();
  buildUI();
  return event;
});
