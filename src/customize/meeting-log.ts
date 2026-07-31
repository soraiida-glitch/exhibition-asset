import { escHtml, formatApiError } from './chat';
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
  if (document.getElementById('exh-ml-btn')) return;

  const space = kintone.app.record.getHeaderMenuSpaceElement();
  if (!space) return;

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
