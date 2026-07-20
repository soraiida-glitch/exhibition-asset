import crypto from 'node:crypto';
import { loadEnv, patchEnvFile, requireAppId } from '../config/env';
import { N8nClient } from '../lib/n8n-client';
import { AGENT_WEBHOOK_PATH, buildAgentWorkflow } from '../workflows/agent-workflow';

function requireEnvValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Fill it in .env first.`);
  }
  return value;
}

async function main() {
  const env = loadEnv();

  const webhookSecret = env.n8nWebhookSecret || crypto.randomBytes(24).toString('hex');
  if (!env.n8nWebhookSecret) {
    patchEnvFile({ N8N_WEBHOOK_SECRET: webhookSecret });
    console.log('Generated a new N8N_WEBHOOK_SECRET and wrote it to .env');
  }

  const workflow = buildAgentWorkflow({
    webhookSecret,
    openaiApiKey: requireEnvValue('OPENAI_API_KEY', env.openaiApiKey),
    kintoneBaseUrl: `https://${env.kintoneSubdomain}.cybozu.com`,
    accountAppId: requireAppId(env, 'kintoneAppIdAccount'),
    accountApiToken: requireEnvValue('KINTONE_API_TOKEN_ACCOUNT', env.kintoneApiTokenAccount),
    opportunityAppId: requireAppId(env, 'kintoneAppIdOpportunity'),
    opportunityApiToken: requireEnvValue(
      'KINTONE_API_TOKEN_OPPORTUNITY',
      env.kintoneApiTokenOpportunity,
    ),
    leadAppId: requireAppId(env, 'kintoneAppIdLead'),
    leadApiToken: requireEnvValue('KINTONE_API_TOKEN_LEAD', env.kintoneApiTokenLead),
    conversationLogAppId: requireAppId(env, 'kintoneAppIdConversationLog'),
    conversationLogApiToken: requireEnvValue(
      'KINTONE_API_TOKEN_CONVERSATION_LOG',
      env.kintoneApiTokenConversationLog,
    ),
  });

  const n8n = new N8nClient({ instanceUrl: env.n8nInstanceUrl, apiKey: env.n8nApiKey });

  console.log(`Upserting workflow "${workflow.name}" ...`);
  const workflowId = await n8n.upsertWorkflowByName(workflow);
  console.log(`   -> id ${workflowId}`);

  console.log('Activating workflow ...');
  await n8n.activateWorkflow(workflowId);

  const webhookUrl = n8n.buildWebhookUrl(AGENT_WEBHOOK_PATH);
  patchEnvFile({ N8N_KINTONE_AGENT_WEBHOOK_URL: webhookUrl });
  console.log(`Wrote N8N_KINTONE_AGENT_WEBHOOK_URL=${webhookUrl} into .env`);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
