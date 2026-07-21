import { loadEnv, patchEnvFile, requireAppId } from '../config/env';
import { N8nClient } from '../lib/n8n-client';
import { SYNC_WEBHOOK_PATH, buildSyncWorkflow } from '../workflows/sync-workflow';

function requireEnvValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Fill it in .env first.`);
  }
  return value;
}

async function main() {
  const env = loadEnv();

  const workflow = buildSyncWorkflow({
    openaiApiKey: requireEnvValue('OPENAI_API_KEY', env.openaiApiKey),
    pineconeApiKey: requireEnvValue('PINECONE_API_KEY', env.pineconeApiKey),
    pineconeHost: requireEnvValue('PINECONE_HOST', env.pineconeHost),
    pineconeNamespace: env.pineconeNamespace || 'exhibition-kintone',
    accountAppId: requireAppId(env, 'kintoneAppIdAccount'),
    opportunityAppId: requireAppId(env, 'kintoneAppIdOpportunity'),
    leadAppId: requireAppId(env, 'kintoneAppIdLead'),
  });

  const n8n = new N8nClient({ instanceUrl: env.n8nInstanceUrl, apiKey: env.n8nApiKey });

  console.log(`Upserting workflow "${workflow.name}" ...`);
  const workflowId = await n8n.upsertWorkflowByName(workflow);
  console.log(`   -> id ${workflowId}`);

  console.log('Activating workflow ...');
  await n8n.activateWorkflow(workflowId);

  const webhookUrl = n8n.buildWebhookUrl(SYNC_WEBHOOK_PATH);
  patchEnvFile({ N8N_SYNC_WEBHOOK_URL: webhookUrl });
  console.log(`Wrote N8N_SYNC_WEBHOOK_URL=${webhookUrl} into .env`);
  console.log('Next: run "npm run setup:webhooks" to register this URL as a kintone webhook on the 3 apps.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
