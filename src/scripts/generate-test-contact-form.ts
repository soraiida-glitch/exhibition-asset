import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../config/env';

const OUTPUT_PATH = path.resolve(process.cwd(), 'dist/test-contact-form.html');
const LOGO_ICON_PATH = path.resolve(process.cwd(), 'templates/logo-icon.png');
const LOGO_WORDMARK_PATH = path.resolve(process.cwd(), 'templates/logo-wordmark.png');

function requireEnvValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Run "npm run setup:contact-form" first.`);
  }
  return value;
}

function toDataUri(filePath: string): string {
  return `data:image/png;base64,${fs.readFileSync(filePath).toString('base64')}`;
}

/**
 * Colors mirror src/customize/theme.ts's THEME constants (kept in sync manually — same tradeoff
 * as kintone-theme.css: this is a standalone generated HTML file with no build step, so there's
 * no TS/JS pipeline to import the constants through). The two logo images are the same ones
 * baked into templates/proposal_template.pptx's cover slide (white-on-transparent, so they need a
 * solid dark/brand-colored background to read — hence the gradient header band below).
 */
function buildHtml(webhookUrl: string, webhookSecret: string): string {
  const logoIcon = toDataUri(LOGO_ICON_PATH);
  const logoWordmark = toDataUri(LOGO_WORDMARK_PATH);

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>お問い合わせ | Novagrid</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Meiryo, "Hiragino Kaku Gothic ProN", sans-serif; margin: 0;
    background: #f5fbfc; color: #14233a; min-height: 100vh; display: flex; flex-direction: column; align-items: center; }
  .exh-header { width: 100%; background: linear-gradient(135deg, #0098bb, #00728e);
    padding: 28px 20px 32px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .exh-header img.exh-icon { height: 40px; }
  .exh-header img.exh-wordmark { height: 16px; }
  .exh-card { background: #fff; border-radius: 16px; box-shadow: 0 12px 32px -18px rgba(20,40,60,.35);
    max-width: 480px; width: calc(100% - 32px); margin: -20px 16px 32px; padding: 28px 24px 24px; }
  h1 { font-size: 19px; font-weight: 800; margin: 0 0 8px; color: #14233a; }
  .exh-lede { font-size: 13px; color: #5a6b7a; line-height: 1.7; margin: 0 0 20px; }
  label { display: block; margin-top: 14px; font-size: 12.5px; font-weight: 700; color: #4a6472; }
  input, textarea { width: 100%; padding: 10px 12px; margin-top: 5px; font-family: inherit;
    border: 1px solid #c3e0e6; border-radius: 10px; font-size: 14px; color: #14233a; background: #f5fbfc;
    transition: border-color .15s ease, box-shadow .15s ease; }
  input:focus, textarea:focus { outline: none; border-color: #0098bb; box-shadow: 0 0 0 3px rgba(0,152,187,.15); background: #fff; }
  textarea { resize: vertical; min-height: 72px; }
  button { margin-top: 20px; width: 100%; padding: 12px; background: linear-gradient(135deg, #0098bb, #00728e);
    color: #fff; border: none; border-radius: 10px; cursor: pointer; font-size: 14.5px; font-weight: 700;
    box-shadow: 0 8px 18px -8px rgba(0,152,187,.55); transition: transform .15s ease, box-shadow .15s ease; }
  button:hover { transform: translateY(-1px); box-shadow: 0 12px 22px -8px rgba(0,152,187,.6); }
  button:disabled { opacity: .6; cursor: default; transform: none; }
  #exh-result { display: none; text-align: center; padding: 12px 0; }
  #exh-result.exh-show { display: block; }
  #exh-result .exh-icon-circle { width: 52px; height: 52px; border-radius: 50%; margin: 0 auto 14px;
    display: flex; align-items: center; justify-content: center; font-size: 26px; color: #fff; }
  #exh-result.exh-ok .exh-icon-circle { background: #1c7a4c; }
  #exh-result.exh-err .exh-icon-circle { background: #b23a3a; }
  #exh-result .exh-msg { font-size: 14px; font-weight: 700; margin-bottom: 4px; }
  #exh-result .exh-sub { font-size: 12.5px; color: #7a8a94; }
  .exh-footer { font-size: 11px; color: #9aa7b0; margin-top: -12px; margin-bottom: 24px; }
</style>
</head>
<body>
<div class="exh-header">
  <img class="exh-icon" src="${logoIcon}" alt="">
  <img class="exh-wordmark" src="${logoWordmark}" alt="Novagrid">
</div>
<div class="exh-card">
  <div id="exh-form-head">
    <h1>お問い合わせ</h1>
    <p class="exh-lede">下記フォームにご記入のうえ送信してください。担当者より順次ご連絡いたします。</p>
  </div>
  <form id="exh-form">
    <label>お名前(必須)<input name="lead_name" required autocomplete="name"></label>
    <label>会社名<input name="company_name" autocomplete="organization"></label>
    <label>電話番号<input name="phone" type="tel" autocomplete="tel"></label>
    <label>メールアドレス<input name="email" type="email" autocomplete="email"></label>
    <label>ご質問・ご相談内容<textarea name="memo" rows="3"></textarea></label>
    <button type="submit" id="exh-submit">送信する</button>
  </form>
  <div id="exh-result"></div>
</div>
<script>
const WEBHOOK_URL = ${JSON.stringify(webhookUrl)};
const WEBHOOK_SECRET = ${JSON.stringify(webhookSecret)};

const form = document.getElementById('exh-form');
const submitBtn = document.getElementById('exh-submit');
const resultEl = document.getElementById('exh-result');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    lead_name: form.lead_name.value,
    company_name: form.company_name.value,
    phone: form.phone.value,
    email: form.email.value,
    memo: form.memo.value,
  };
  submitBtn.disabled = true;
  submitBtn.textContent = '送信中...';
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-secret': WEBHOOK_SECRET },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    document.getElementById('exh-form-head').style.display = 'none';
    form.style.display = 'none';
    resultEl.className = res.ok ? 'exh-show exh-ok' : 'exh-show exh-err';
    if (res.ok) {
      resultEl.innerHTML = '<div class="exh-icon-circle">✓</div>' +
        '<div class="exh-msg">送信しました</div>' +
        '<div class="exh-sub">お問い合わせありがとうございます。担当者よりご連絡いたします。</div>';
    } else {
      resultEl.innerHTML = '<div class="exh-icon-circle">!</div>' +
        '<div class="exh-msg">送信に失敗しました</div>' +
        '<div class="exh-sub">' + (body && body.error ? body.error : 'お手数ですがスタッフにお声がけください。') + '</div>';
    }
  } catch (err) {
    document.getElementById('exh-form-head').style.display = 'none';
    form.style.display = 'none';
    resultEl.className = 'exh-show exh-err';
    resultEl.innerHTML = '<div class="exh-icon-circle">!</div>' +
      '<div class="exh-msg">送信に失敗しました</div>' +
      '<div class="exh-sub">お手数ですがスタッフにお声がけください。</div>';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '送信する';
  }
});
</script>
</body>
</html>
`;
}

function main() {
  const env = loadEnv();
  const webhookUrl = requireEnvValue('N8N_CONTACT_FORM_WEBHOOK_URL', env.n8nContactFormWebhookUrl);
  const webhookSecret = requireEnvValue('N8N_CONTACT_FORM_SECRET', env.n8nContactFormSecret);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, buildHtml(webhookUrl, webhookSecret));
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(
    'Open it directly in a browser. Usable as-is at the booth (no build step needed), but note ' +
      'the webhook secret is visible in the page source (view-source) — acceptable for this demo ' +
      'lead app, but do not reuse this pattern for anything more sensitive.',
  );
}

main();
