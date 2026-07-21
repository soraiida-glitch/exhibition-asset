import { escHtml, formatApiError } from './chat';

interface RoleplayMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface Persona {
  persona_name?: string;
  company?: string;
  title?: string;
  decision_authority?: string;
  main_issues?: string[];
  expectations?: string[];
  concerns?: string[];
  personality?: string;
  objections?: string[];
}

interface RoleplayFeedback {
  totalScore?: number;
  hearingScore?: number;
  issueScore?: number;
  proposalScore?: number;
  objectionScore?: number;
  closingScore?: number;
  goodPoints?: string[];
  improvementPoints?: string[];
  nextTrainingTheme?: string;
}

const RP_CONFIG = {
  opportunityAppId: __OPPORTUNITY_APP_ID__,
  webhookSecret: __WEBHOOK_SECRET__,
  startUrl: __ROLEPLAY_START_WEBHOOK_URL__,
  chatUrl: __ROLEPLAY_CHAT_WEBHOOK_URL__,
  feedbackUrl: __ROLEPLAY_FEEDBACK_WEBHOOK_URL__,
  transcribeUrl: __TRANSCRIBE_WEBHOOK_URL__,
  ttsUrl: __TTS_WEBHOOK_URL__,
};

// Below this, a recording is almost certainly an accidental tap, not real speech — the Salesforce
// version's roleplay feature had exactly this failure mode (short recordings misrecognized as noise).
const MIN_RECORDING_MS = 800;
const TTS_PLAYBACK_RATE = 1.3;

// Whisper hallucinates these exact phrases for near-silent/noise-only audio (a training-data
// artifact from YouTube captions) even when the backend's no_speech_prob check doesn't catch it —
// observed live during phase 5 testing (a silent recording transcribed as "you").
const HALLUCINATION_PATTERNS = [/^you\.?$/i, /^thank you\.?$/i, /^thanks for watching!?$/i, /^\.+$/];

function isLikelyHallucination(text: string): boolean {
  return HALLUCINATION_PATTERNS.some((pattern) => pattern.test(text));
}

let history: RoleplayMessage[] = [];
let persona: Persona | null = null;
let dealRecordId = '';
let dealName = '';
let voiceEnabled = false;
let finished = false;
let mediaRecorder: MediaRecorder | null = null;
let recordingChunks: Blob[] = [];
let recordingStartedAt = 0;

async function rpProxy(url: string, body: unknown): Promise<unknown> {
  const resp = await kintone.proxy(
    url,
    'POST',
    { 'Content-Type': 'application/json', 'x-webhook-secret': RP_CONFIG.webhookSecret },
    JSON.stringify(body),
  );
  const raw = String(resp[0] ?? '').trim();
  return JSON.parse(raw);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('音声データの読み込みに失敗しました。'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function injectRoleplayStyles(): void {
  if (document.getElementById('exh-rp-styles')) return;
  const style = document.createElement('style');
  style.id = 'exh-rp-styles';
  style.textContent = `
.exh-rp-launch-btn { background: #a24fe0; color: #fff; border: none; border-radius: 6px;
  padding: 6px 12px; font-size: 13px; cursor: pointer; margin-left: 8px; }
#exh-rp-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 10000;
  display: flex; align-items: center; justify-content: center; }
#exh-rp-overlay.exh-hidden { display: none; }
#exh-rp-card { width: min(720px, 92vw); height: min(640px, 88vh); background: #fff;
  border-radius: 12px; display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 8px 32px rgba(0,0,0,.3); }
#exh-rp-header { background: #a24fe0; color: #fff; padding: 12px 16px; display: flex;
  justify-content: space-between; align-items: center; }
#exh-rp-close { cursor: pointer; background: none; border: none; color: #fff; font-size: 18px; }
#exh-rp-persona { padding: 10px 16px; background: #f7f0ff; font-size: 12px; border-bottom: 1px solid #e5d6f5; }
#exh-rp-persona-title { font-weight: bold; color: #a24fe0; margin-bottom: 4px; }
#exh-rp-body { flex: 1; overflow-y: auto; padding: 12px 16px; background: #f5f6f8; }
.exh-rp-bubble { max-width: 85%; margin-bottom: 10px; padding: 8px 12px; border-radius: 10px;
  font-size: 13px; line-height: 1.5; white-space: pre-wrap; }
.exh-rp-bubble.exh-rp-user { background: #2f6fed; color: #fff; margin-left: auto; }
.exh-rp-bubble.exh-rp-ai { background: #fff; color: #222; border: 1px solid #e0e0e0; }
#exh-rp-footer { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e0e0e0; align-items: flex-end; }
#exh-rp-input { flex: 1; resize: none; border: 1px solid #ccc; border-radius: 8px; padding: 8px;
  font-size: 13px; max-height: 80px; }
.exh-rp-btn { border: none; border-radius: 8px; cursor: pointer; padding: 0 12px; height: 34px; }
#exh-rp-mic { background: #eee; font-size: 16px; }
#exh-rp-mic.exh-rp-recording { background: #ffdada; }
#exh-rp-voice-toggle { background: #eee; font-size: 16px; }
#exh-rp-voice-toggle.exh-rp-on { background: #dde6ff; }
#exh-rp-send { background: #2f6fed; color: #fff; }
#exh-rp-finish { background: #888; color: #fff; margin: 0 10px 10px; }
.exh-rp-feedback { padding: 14px 16px; background: #fafbff; border-top: 1px solid #e5d6f5; font-size: 13px; }
.exh-rp-scores { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 8px 0; }
.exh-rp-score { background: #f0e8ff; border-radius: 6px; padding: 6px; text-align: center; }
.exh-rp-score b { display: block; font-size: 16px; color: #a24fe0; }
`;
  document.head.appendChild(style);
}

function ensureModal(): HTMLElement {
  let overlay = document.getElementById('exh-rp-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'exh-rp-overlay';
  overlay.className = 'exh-hidden';
  overlay.innerHTML = `
    <div id="exh-rp-card">
      <div id="exh-rp-header">
        <span>🎭 AIロールプレイ練習</span>
        <button id="exh-rp-close">✕</button>
      </div>
      <div id="exh-rp-persona"></div>
      <div id="exh-rp-body"></div>
      <button id="exh-rp-finish" class="exh-rp-btn">🏁 終了してフィードバックをもらう</button>
      <div id="exh-rp-footer">
        <button id="exh-rp-mic" class="exh-rp-btn" title="音声入力">🎤</button>
        <button id="exh-rp-voice-toggle" class="exh-rp-btn" title="AIの応答を音声で再生">🔊</button>
        <textarea id="exh-rp-input" rows="1" placeholder="顧客への発言を入力..."></textarea>
        <button id="exh-rp-send" class="exh-rp-btn">送信</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#exh-rp-close')!.addEventListener('click', () => closeModal());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  const input = overlay.querySelector<HTMLTextAreaElement>('#exh-rp-input')!;
  const send = () => {
    const text = input.value.trim();
    if (!text || finished) return;
    input.value = '';
    void sendRoleplayMessage(text);
  };
  overlay.querySelector('#exh-rp-send')!.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  overlay.querySelector('#exh-rp-finish')!.addEventListener('click', () => {
    if (!finished) void finishRoleplay();
  });

  const voiceToggle = overlay.querySelector<HTMLButtonElement>('#exh-rp-voice-toggle')!;
  voiceToggle.addEventListener('click', () => {
    voiceEnabled = !voiceEnabled;
    voiceToggle.classList.toggle('exh-rp-on', voiceEnabled);
  });

  overlay.querySelector<HTMLButtonElement>('#exh-rp-mic')!.addEventListener('click', () => {
    void toggleRecording();
  });

  return overlay;
}

function closeModal(): void {
  document.getElementById('exh-rp-overlay')?.classList.add('exh-hidden');
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}

function getBodyEl(): HTMLElement {
  return document.getElementById('exh-rp-body')!;
}

function scrollBodyToBottom(): void {
  const body = getBodyEl();
  body.scrollTop = body.scrollHeight;
}

function pushBubble(role: 'user' | 'assistant', text: string): void {
  const el = document.createElement('div');
  el.className = `exh-rp-bubble ${role === 'user' ? 'exh-rp-user' : 'exh-rp-ai'}`;
  el.textContent = text;
  getBodyEl().appendChild(el);
  scrollBodyToBottom();
}

function renderPersona(p: Persona): void {
  const panel = document.getElementById('exh-rp-persona')!;
  const issues = (p.main_issues || []).join(' / ');
  const concerns = (p.concerns || []).join(' / ');
  panel.innerHTML = `
    <div id="exh-rp-persona-title">👤 ${escHtml(p.persona_name ?? '')} (${escHtml(p.title ?? '')} / ${escHtml(p.company ?? '')})</div>
    <div>課題: ${escHtml(issues)}</div>
    <div>懸念: ${escHtml(concerns)}</div>
  `;
}

function renderFeedback(f: RoleplayFeedback): void {
  const panel = document.createElement('div');
  panel.className = 'exh-rp-feedback';
  const good = (f.goodPoints || []).map((s) => `<li>${escHtml(s)}</li>`).join('');
  const improve = (f.improvementPoints || []).map((s) => `<li>${escHtml(s)}</li>`).join('');
  panel.innerHTML = `
    <div><strong>総合スコア: ${escHtml(f.totalScore ?? '?')}点</strong></div>
    <div class="exh-rp-scores">
      <div class="exh-rp-score"><b>${escHtml(f.hearingScore ?? '?')}</b>ヒアリング</div>
      <div class="exh-rp-score"><b>${escHtml(f.issueScore ?? '?')}</b>課題理解</div>
      <div class="exh-rp-score"><b>${escHtml(f.proposalScore ?? '?')}</b>提案力</div>
      <div class="exh-rp-score"><b>${escHtml(f.objectionScore ?? '?')}</b>反論対応</div>
      <div class="exh-rp-score"><b>${escHtml(f.closingScore ?? '?')}</b>クロージング</div>
    </div>
    ${good ? `<div>✅ 良かった点<ul>${good}</ul></div>` : ''}
    ${improve ? `<div>📌 改善点<ul>${improve}</ul></div>` : ''}
    <div>次回のテーマ: ${escHtml(f.nextTrainingTheme ?? '')}</div>
  `;
  getBodyEl().appendChild(panel);
  scrollBodyToBottom();

  const footer = document.getElementById('exh-rp-footer');
  const finishBtn = document.getElementById('exh-rp-finish');
  footer?.remove();
  finishBtn?.remove();
}

async function speak(text: string): Promise<void> {
  if (!voiceEnabled || !text) return;
  try {
    const resp = (await rpProxy(RP_CONFIG.ttsUrl, { text })) as { audio_base64?: string };
    if (!resp.audio_base64) return;
    const blob = base64ToBlob(resp.audio_base64, 'audio/mpeg');
    const audio = new Audio(URL.createObjectURL(blob));
    audio.playbackRate = TTS_PLAYBACK_RATE;
    void audio.play();
  } catch {
    // Voice playback is a non-essential enhancement; silently skip on failure.
  }
}

async function openRoleplayModal(): Promise<void> {
  injectRoleplayStyles();
  const overlay = ensureModal();
  overlay.classList.remove('exh-hidden');

  history = [];
  persona = null;
  finished = false;
  getBodyEl().innerHTML = '';
  document.getElementById('exh-rp-persona')!.innerHTML = '';
  pushBubble('assistant', 'ペルソナを生成中...');

  dealRecordId = String(kintone.app.record.getId() || '');
  const record = kintone.app.record.get().record;
  dealName = String((record.deal_name as { value?: string } | undefined)?.value ?? '');

  try {
    const user = kintone.getLoginUser();
    const resp = (await rpProxy(RP_CONFIG.startUrl, {
      recordId: dealRecordId,
      traineeName: user.name,
    })) as { persona: Persona; openingMessage: string };

    persona = resp.persona;
    renderPersona(persona);
    getBodyEl().innerHTML = '';
    history.push({ role: 'assistant', content: resp.openingMessage });
    pushBubble('assistant', resp.openingMessage);
    void speak(resp.openingMessage);
  } catch (err) {
    getBodyEl().innerHTML = '';
    pushBubble('assistant', 'ペルソナの生成に失敗しました: ' + formatApiError(err));
  }
}

async function sendRoleplayMessage(text: string): Promise<void> {
  pushBubble('user', text);

  try {
    const resp = (await rpProxy(RP_CONFIG.chatUrl, {
      recordId: dealRecordId,
      persona,
      history,
      userMessage: text,
    })) as { reply: string; shouldFinish?: boolean };

    history.push({ role: 'user', content: text });
    history.push({ role: 'assistant', content: resp.reply });
    pushBubble('assistant', resp.reply);
    void speak(resp.reply);

    if (resp.shouldFinish) {
      await finishRoleplay();
    }
  } catch (err) {
    pushBubble('assistant', 'エラーが発生しました: ' + formatApiError(err));
  }
}

async function finishRoleplay(): Promise<void> {
  if (finished) return;
  finished = true;
  pushBubble('assistant', 'フィードバックを生成中...');

  try {
    const user = kintone.getLoginUser();
    const feedback = (await rpProxy(RP_CONFIG.feedbackUrl, {
      recordId: dealRecordId,
      dealName,
      traineeName: user.name,
      persona,
      history,
    })) as RoleplayFeedback;
    renderFeedback(feedback);
  } catch (err) {
    pushBubble('assistant', 'フィードバックの生成に失敗しました: ' + formatApiError(err));
  }
}

async function toggleRecording(): Promise<void> {
  const micBtn = document.getElementById('exh-rp-mic')!;

  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    recordingStartedAt = Date.now();

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordingChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      micBtn.classList.remove('exh-rp-recording');
      stream.getTracks().forEach((t) => t.stop());
      const durationMs = Date.now() - recordingStartedAt;
      if (durationMs < MIN_RECORDING_MS) return;
      const blob = new Blob(recordingChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
      void handleRecordedAudio(blob);
    };

    mediaRecorder.start();
    micBtn.classList.add('exh-rp-recording');
  } catch (err) {
    pushBubble('assistant', 'マイクにアクセスできませんでした: ' + formatApiError(err));
  }
}

async function handleRecordedAudio(blob: Blob): Promise<void> {
  const input = document.getElementById('exh-rp-input') as HTMLTextAreaElement;
  try {
    const base64 = await blobToBase64(blob);
    const resp = (await rpProxy(RP_CONFIG.transcribeUrl, {
      audio_base64: base64,
      audio_type: blob.type || 'audio/webm',
    })) as { text?: string };

    const text = (resp.text || '').trim();
    if (!text || isLikelyHallucination(text)) return;
    input.value = '';
    void sendRoleplayMessage(text);
  } catch (err) {
    pushBubble('assistant', '音声認識に失敗しました: ' + formatApiError(err));
  }
}

export function initRoleplay(appId: string): void {
  if (appId !== RP_CONFIG.opportunityAppId) return;
  injectRoleplayStyles();
  if (document.getElementById('exh-rp-btn')) return;

  const space = kintone.app.record.getHeaderMenuSpaceElement();
  if (!space) return;

  const btn = document.createElement('button');
  btn.id = 'exh-rp-btn';
  btn.className = 'exh-rp-launch-btn';
  btn.textContent = '🎭 AIロールプレイ開始';
  space.appendChild(btn);

  btn.addEventListener('click', () => void openRoleplayModal());
}
