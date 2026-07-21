import { loadEnv, requireAppId } from '../config/env';

function requireEnvValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Fill it in .env first.`);
  }
  return value;
}

/**
 * kintone's Webhook settings have no working public REST API on this instance (every
 * `/k/v1/[preview/]app/notifications/webhook.json` variant returns a generic 404 "This link is
 * not valid" page, not a JSON API error — confirmed by direct testing, and no official kintone.dev
 * docs page could be found for it either). Registering webhooks is therefore a manual step, same
 * category as issuing API tokens.
 *
 * Also: kintone's actual Webhook settings screen has no verification-token/secret field at all
 * (confirmed against kintone's own help docs) — sync-workflow.ts relies on the webhook path being
 * unguessable, same tradeoff as the existing meishi webhook, not on any shared-secret check.
 */
async function main() {
  const env = loadEnv();
  const webhookUrl = requireEnvValue('N8N_SYNC_WEBHOOK_URL', env.n8nSyncWebhookUrl);

  const targets = [
    { label: 'exhibition_取引先', appId: requireAppId(env, 'kintoneAppIdAccount') },
    { label: 'exhibition_案件', appId: requireAppId(env, 'kintoneAppIdOpportunity') },
    { label: 'exhibition_リード', appId: requireAppId(env, 'kintoneAppIdLead') },
  ];

  console.log(`
========================================================================
kintone Webhookの設定は手動が必要です(REST APIでは自動化できません)。

以下の3アプリそれぞれで:
kintone管理画面 → 対象アプリの設定 → Webhook → 追加

  - exhibition_取引先  (app id ${targets[0].appId})
  - exhibition_案件    (app id ${targets[1].appId})
  - exhibition_リード  (app id ${targets[2].appId})

設定値:
  URL: ${webhookUrl}
  イベント: レコードの追加・編集・削除 すべてにチェック
  (検証トークン等の入力欄はkintoneのWebhook設定画面には存在しません)

設定後、対象アプリを再デプロイ(反映)してください。
========================================================================
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
