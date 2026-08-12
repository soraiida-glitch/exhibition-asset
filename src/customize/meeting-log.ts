import { STATUS_PILL_CLASS, escHtml, formatApiError } from './chat';
import { THEME } from './theme';

interface MeetingLogRecord {
  status?: { value?: string };
  summary?: { value?: string };
  next_actions?: { value?: string };
  sentiment_score?: { value?: string };
  sentiment_label?: { value?: string };
  keywords?: { value?: string };
  topics?: { value?: string };
}

interface MeetingLogHistoryRecord extends MeetingLogRecord {
  $id?: { value?: string };
  recorded_at?: { value?: string };
}

const ML_CONFIG = {
  opportunityAppId: __OPPORTUNITY_APP_ID__,
  meetingLogAppId: __MEETING_LOG_APP_ID__,
  webhookSecret: __WEBHOOK_SECRET__,
  meetingLogWebhookUrl: __MEETING_LOG_WEBHOOK_URL__,
};

// OpenAI's Whisper API rejects files over 25MB — this leaves a small safety margin.
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 36; // 5s * 36 = 3分

function injectMeetingLogStyles(): void {
  if (document.getElementById('exh-ml-styles')) return;
  const style = document.createElement('style');
  style.id = 'exh-ml-styles';
  const t = THEME;
  style.textContent = `
.exh-ml-btn { background: linear-gradient(135deg, ${t.sora}, ${t.soraDeep}); color: #fff; border: none;
  border-radius: 10px; padding: 8px 16px; font-size: 13px; font-weight: 700; cursor: pointer; margin: 0 8px 8px 0;
  box-shadow: 0 6px 14px -6px rgba(0,152,187,.55); transition: transform .15s ease, box-shadow .15s ease; }
.exh-ml-btn:hover { transform: translateY(-1px); box-shadow: 0 10px 20px -8px rgba(0,152,187,.6); }
.exh-ml-panel { margin-top: 10px; padding: 14px; border: 1px solid ${t.mistLine}; border-radius: 12px;
  background: #fff; font-size: 13px; max-width: 480px; }
.exh-ml-panel.exh-hidden { display: none; }
.exh-ml-section { margin-top: 8px; }
.exh-ml-section ul { margin: 4px 0 0; padding-left: 18px; }
.exh-ml-history { margin-top: 10px; max-width: 520px; }
.exh-ml-history-title { font-size: 12px; font-weight: 700; color: #4a6472; margin-bottom: 6px; }
.exh-ml-history-item { padding: 10px 12px; border: 1px solid ${t.mistLine}; border-radius: 10px;
  background: #fff; font-size: 12px; margin-bottom: 8px; }
.exh-ml-history-item-head { display: flex; justify-content: space-between; align-items: center;
  color: #7a8a94; margin-bottom: 6px; font-size: 11px; }
.exh-ml-history-label { font-size: 10px; font-weight: 700; color: #8a97a0; letter-spacing: .03em;
  margin: 8px 0 3px; text-transform: uppercase; }
.exh-ml-history-label:first-of-type { margin-top: 0; }
.exh-ml-history-summary { color: #14233a; line-height: 1.6; }
.exh-ml-history-item ul { margin: 2px 0 0; padding-left: 16px; line-height: 1.6; }
.exh-ml-history-keywords { display: flex; flex-wrap: wrap; gap: 5px; }
.exh-ml-history-tag { background: ${t.mist}; color: #5a6b7a; border-radius: 999px; padding: 2px 9px;
  font-size: 10.5px; }
.exh-ml-history-empty { font-size: 12px; color: #7a8a94; }
`;
  document.head.appendChild(style);
}

async function uploadAudioFile(file: File): Promise<string> {
  // kintone.api() re-serializes whatever body it's given, which breaks a FormData's multipart
  // boundary (kintone's own file endpoint then rejects it: "HTTPリクエストはマルチパート形式で
  // ある必要があります" even though the caller did send FormData) — confirmed live. A same-origin
  // fetch() leaves the browser's own multipart encoding intact; kintone's session cookie handles
  // auth, and X-Requested-With is kintone's documented CSRF requirement for calls that bypass
  // kintone.api().
  const formData = new FormData();
  formData.append('__REQUEST_TOKEN__', kintone.getRequestToken());
  formData.append('file', file);
  const res = await fetch('/k/v1/file.json', {
    method: 'POST',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    body: formData,
  });
  if (!res.ok) {
    throw new Error(`ファイルアップロードに失敗しました (status ${res.status})`);
  }
  const json = (await res.json()) as { fileKey: string };
  return json.fileKey;
}

function renderHistoryItem(r: MeetingLogHistoryRecord): string {
  const recordedAt = r.recorded_at?.value
    ? new Date(r.recorded_at.value).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })
    : '';
  const sentimentLabel = r.sentiment_label?.value;
  const sentimentPill = sentimentLabel
    ? `<span class="exh-status-pill ${STATUS_PILL_CLASS[sentimentLabel] || 'exh-pill-neutral'}">${escHtml(sentimentLabel)}${
        r.sentiment_score?.value ? ` (${escHtml(r.sentiment_score.value)})` : ''
      }</span>`
    : '';

  if (r.status?.value === '処理中') {
    return `<div class="exh-ml-history-item">
      <div class="exh-ml-history-item-head"><span>${escHtml(recordedAt)}</span><span>分析中...</span></div>
    </div>`;
  }
  if (r.status?.value === 'エラー') {
    return `<div class="exh-ml-history-item">
      <div class="exh-ml-history-item-head"><span>${escHtml(recordedAt)}</span><span class="exh-status-pill exh-pill-negative">分析エラー</span></div>
    </div>`;
  }

  const actions = (r.next_actions?.value || '')
    .split('\n')
    .filter(Boolean)
    .map((s) => `<li>${escHtml(s)}</li>`)
    .join('');
  const keywords = (r.keywords?.value || '')
    .split('\n')
    .filter(Boolean)
    .map((k) => `<span class="exh-ml-history-tag">${escHtml(k)}</span>`)
    .join('');

  return `<div class="exh-ml-history-item">
    <div class="exh-ml-history-item-head"><span>${escHtml(recordedAt)}</span>${sentimentPill}</div>
    <div class="exh-ml-history-label">要約</div>
    <div class="exh-ml-history-summary">${escHtml(r.summary?.value ?? '')}</div>
    ${actions ? `<div class="exh-ml-history-label">📌 ネクストアクション</div><ul>${actions}</ul>` : ''}
    ${keywords ? `<div class="exh-ml-history-label">🔑 キーワード</div><div class="exh-ml-history-keywords">${keywords}</div>` : ''}
  </div>`;
}

// The upload/analyze panel above is fire-and-forget: it only shows content right after a fresh
// upload completes, and reverts to hidden on the next page load. Nothing anywhere else lets a
// user see a deal's past meeting-log entries, even though they persist in exhibition_商談ログ
// (linked via its deal_record_id field) — a native kintone "関連レコード一覧" field can't express
// this link because deal_record_id is SINGLE_LINE_TEXT while the opportunity app's record number
// is RECORD_NUMBER (kintone rejects that type pairing with CB_VA01), so this renders the history
// itself instead.
async function loadMeetingLogHistory(container: HTMLElement): Promise<void> {
  const recordId = String(kintone.app.record.getId() || '');
  if (!recordId) return;

  try {
    const result = (await kintone.api('/k/v1/records', 'GET', {
      app: Number(ML_CONFIG.meetingLogAppId),
      query: `deal_record_id = "${recordId.replace(/"/g, '')}" order by recorded_at desc limit 5`,
    })) as { records: MeetingLogHistoryRecord[] };

    if (!result.records.length) {
      container.innerHTML = '<div class="exh-ml-history-empty">この案件の商談ログはまだありません。</div>';
      return;
    }

    container.innerHTML = result.records.map(renderHistoryItem).join('');
  } catch (err) {
    container.innerHTML = `<div class="exh-ml-history-empty">読み込みに失敗しました: ${escHtml(formatApiError(err))}</div>`;
  }
}

function renderResult(panel: HTMLElement, record: MeetingLogRecord): void {
  const actions = (record.next_actions?.value || '')
    .split('\n')
    .filter(Boolean)
    .map((s) => `<li>${escHtml(s)}</li>`)
    .join('');
  const keywords = (record.keywords?.value || '').split('\n').filter(Boolean).join(' / ');
  panel.innerHTML = `
    <div><strong>感情: ${escHtml(record.sentiment_label ?.value ?? '')} (${escHtml(record.sentiment_score?.value ?? '')})</strong></div>
    <div class="exh-ml-section">${escHtml(record.summary?.value ?? '')}</div>
    ${actions ? `<div class="exh-ml-section">📌 ネクストアクション<ul>${actions}</ul></div>` : ''}
    ${keywords ? `<div class="exh-ml-section">🔑 ${escHtml(keywords)}</div>` : ''}
  `;
}

async function pollForResult(recordId: string, panel: HTMLElement): Promise<void> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const result = (await kintone.api('/k/v1/record', 'GET', {
      app: Number(ML_CONFIG.meetingLogAppId),
      id: recordId,
    })) as { record: MeetingLogRecord };

    const status = result.record.status?.value;
    if (status === '完了') {
      renderResult(panel, result.record);
      return;
    }
    if (status === 'エラー') {
      panel.textContent = '分析中にエラーが発生しました。';
      return;
    }
  }
  panel.textContent = '分析が完了しませんでした(タイムアウト)。しばらくしてから再読み込みしてください。';
}

async function handleAudioUpload(file: File, panel: HTMLElement): Promise<void> {
  if (file.size > MAX_AUDIO_BYTES) {
    panel.classList.remove('exh-hidden');
    panel.textContent = `ファイルサイズが大きすぎます(上限${Math.floor(MAX_AUDIO_BYTES / 1024 / 1024)}MB)。`;
    return;
  }

  panel.classList.remove('exh-hidden');
  panel.textContent = 'アップロード中...';

  try {
    const fileKey = await uploadAudioFile(file);

    const recordId = String(kintone.app.record.getId() || '');
    const record = kintone.app.record.get().record;
    const dealName = String((record.deal_name as { value?: string } | undefined)?.value ?? '');

    const createResp = (await kintone.api('/k/v1/record', 'POST', {
      app: Number(ML_CONFIG.meetingLogAppId),
      record: {
        deal_record_id: { value: recordId },
        deal_name: { value: dealName },
        audio_file: { value: [{ fileKey }] },
        recorded_at: { value: new Date().toISOString() },
        status: { value: '処理中' },
      },
    })) as { id: string };

    panel.textContent = '分析中... (数十秒かかります)';

    await kintone.proxy(
      ML_CONFIG.meetingLogWebhookUrl,
      'POST',
      { 'Content-Type': 'application/json', 'x-webhook-secret': ML_CONFIG.webhookSecret },
      JSON.stringify({ meetingLogRecordId: createResp.id }),
    );

    await pollForResult(createResp.id, panel);
  } catch (err) {
    panel.textContent = '分析に失敗しました: ' + formatApiError(err);
  }
}

export function initMeetingLog(appId: string): void {
  if (appId !== ML_CONFIG.opportunityAppId) return;
  injectMeetingLogStyles();

  const space = kintone.app.record.getHeaderMenuSpaceElement();
  if (!space) return;

  // The button/upload-input/result-panel aren't record-specific at creation time (their click
  // handler reads kintone.app.record.getId() fresh, at click time), so they're safe to create
  // once and skip on repeat calls.
  if (!document.getElementById('exh-ml-btn')) {
    const btn = document.createElement('button');
    btn.id = 'exh-ml-btn';
    btn.className = 'exh-ml-btn';
    btn.textContent = '🎙️ 商談録音を分析';
    space.appendChild(btn);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*';
    fileInput.style.display = 'none';
    space.appendChild(fileInput);

    const panel = document.createElement('div');
    panel.id = 'exh-ml-panel';
    panel.className = 'exh-ml-panel exh-hidden';
    space.appendChild(panel);

    btn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) void handleAudioUpload(file, panel);
    });
  }

  // Always rebuilt, unlike the elements above: this shows THIS record's own history, and kintone's
  // detail view can navigate between records (prev/next arrows) without a full page reload, which
  // would otherwise leave it frozen on whichever record was viewed first (see record-summary.ts's
  // fix for the same lesson learned the hard way).
  document.getElementById('exh-ml-history')?.remove();
  const history = document.createElement('div');
  history.id = 'exh-ml-history';
  history.className = 'exh-ml-history';
  history.innerHTML =
    '<div class="exh-ml-history-title">📋 商談ログ履歴</div><div id="exh-ml-history-body">読み込み中...</div>';
  space.appendChild(history);
  const historyBody = history.querySelector<HTMLElement>('#exh-ml-history-body');
  if (historyBody) void loadMeetingLogHistory(historyBody);
}
