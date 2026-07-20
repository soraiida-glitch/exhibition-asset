import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../config/env';

const OUTPUT_PATH = path.resolve(process.cwd(), 'dist/test-contact-form.html');

function requireEnvValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Run "npm run setup:contact-form" first.`);
  }
  return value;
}

function buildHtml(webhookUrl: string, webhookSecret: string): string {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>[開発用] お問い合わせフォーム テスト</title>
<style>
body { font-family: sans-serif; max-width: 480px; margin: 40px auto; padding: 0 16px; }
label { display: block; margin-top: 12px; font-size: 13px; color: #555; }
input, textarea { width: 100%; box-sizing: border-box; padding: 8px; margin-top: 4px;
  border: 1px solid #ccc; border-radius: 6px; font-size: 14px; }
button { margin-top: 16px; padding: 10px 16px; background: #2f6fed; color: #fff; border: none;
  border-radius: 6px; cursor: pointer; font-size: 14px; }
#result { margin-top: 16px; padding: 10px; border-radius: 6px; font-size: 13px; white-space: pre-wrap; }
</style>
</head>
<body>
<h1>[開発用] お問い合わせフォーム テスト</h1>
<p>これは exhibition-asset の「問い合わせフォームCRM取込」を手元で検証するためのテスト用
ページです。本番の外部フォームではありません。</p>
<form id="form">
  <label>氏名(必須)<input name="lead_name" required></label>
  <label>会社名<input name="company_name"></label>
  <label>電話番号<input name="phone"></label>
  <label>メールアドレス<input name="email" type="email"></label>
  <label>お問い合わせ内容<textarea name="memo" rows="4"></textarea></label>
  <button type="submit">送信</button>
</form>
<div id="result"></div>
<script>
const WEBHOOK_URL = ${JSON.stringify(webhookUrl)};
const WEBHOOK_SECRET = ${JSON.stringify(webhookSecret)};

document.getElementById('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const payload = {
    lead_name: form.lead_name.value,
    company_name: form.company_name.value,
    phone: form.phone.value,
    email: form.email.value,
    memo: form.memo.value,
  };
  const resultEl = document.getElementById('result');
  resultEl.textContent = '送信中...';
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-secret': WEBHOOK_SECRET },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    resultEl.style.background = res.ok ? '#e8f5e9' : '#ffebee';
    resultEl.textContent = 'status: ' + res.status + '\\n' + JSON.stringify(body, null, 2);
  } catch (err) {
    resultEl.style.background = '#ffebee';
    resultEl.textContent = 'エラー: ' + err;
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
  console.log('Open it directly in a browser to test the contact-form webhook (dev-only, not for deployment).');
}

main();
