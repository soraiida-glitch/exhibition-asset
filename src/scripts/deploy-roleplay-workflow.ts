import { loadEnv, patchEnvFile, requireAppId } from '../config/env';
import { N8nClient } from '../lib/n8n-client';
import {
  ROLEPLAY_CHAT_PATH,
  ROLEPLAY_FEEDBACK_PATH,
  ROLEPLAY_START_PATH,
  buildRoleplayWorkflow,
} from '../workflows/roleplay-workflow';

function requireEnvValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Fill it in .env first.`);
  }
  return value;
}

async function main() {
  const env = loadEnv();

  const workflow = buildRoleplayWorkflow({
    webhookSecret: requireEnvValue('N8N_WEBHOOK_SECRET', env.n8nWebhookSecret),
    openaiApiKey: requireEnvValue('OPENAI_API_KEY', env.openaiApiKey),
    kintoneBaseUrl: `https://${env.kintoneSubdomain}.cybozu.com`,
    opportunityAppId: requireAppId(env, 'kintoneAppIdOpportunity'),
    opportunityApiToken: requireEnvValue(
      'KINTONE_API_TOKEN_OPPORTUNITY',
      env.kintoneApiTokenOpportunity,
    ),
    roleplaySessionAppId: requireAppId(env, 'kintoneAppIdRoleplaySession'),
    roleplaySessionApiToken: requireEnvValue(
      'KINTONE_API_TOKEN_ROLEPLAY_SESSION',
      env.kintoneApiTokenRoleplaySession,
    ),
  });

  const n8n = new N8nClient({ instanceUrl: env.n8nInstanceUrl, apiKey: env.n8nApiKey });

  console.log(`Upserting workflow "${workflow.name}" ...`);
  const workflowId = await n8n.upsertWorkflowByName(workflow);
  console.log(`   -> id ${workflowId}`);

  console.log('Activating workflow ...');
  await n8n.activateWorkflow(workflowId);

  const startUrl = n8n.buildWebhookUrl(ROLEPLAY_START_PATH);
  const chatUrl = n8n.buildWebhookUrl(ROLEPLAY_CHAT_PATH);
  const feedbackUrl = n8n.buildWebhookUrl(ROLEPLAY_FEEDBACK_PATH);
  patchEnvFile({
    N8N_ROLEPLAY_START_WEBHOOK_URL: startUrl,
    N8N_ROLEPLAY_CHAT_WEBHOOK_URL: chatUrl,
    N8N_ROLEPLAY_FEEDBACK_WEBHOOK_URL: feedbackUrl,
  });
  console.log(`Wrote N8N_ROLEPLAY_START_WEBHOOK_URL=${startUrl} into .env`);
  console.log(`Wrote N8N_ROLEPLAY_CHAT_WEBHOOK_URL=${chatUrl} into .env`);
  console.log(`Wrote N8N_ROLEPLAY_FEEDBACK_WEBHOOK_URL=${feedbackUrl} into .env`);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
