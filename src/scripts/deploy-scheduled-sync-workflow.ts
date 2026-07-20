import { loadEnv, requireAppId } from '../config/env';
import { N8nClient } from '../lib/n8n-client';
import { buildScheduledSyncWorkflow } from '../workflows/scheduled-sync-workflow';

function requireEnvValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Fill it in .env first.`);
  }
  return value;
}

async function main() {
  const env = loadEnv();

  const workflow = buildScheduledSyncWorkflow({
    openaiApiKey: requireEnvValue('OPENAI_API_KEY', env.openaiApiKey),
    pineconeApiKey: requireEnvValue('PINECONE_API_KEY', env.pineconeApiKey),
    pineconeHost: requireEnvValue('PINECONE_HOST', env.pineconeHost),
    pineconeNamespace: env.pineconeNamespace || 'exhibition-kintone',
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
  });

  const n8n = new N8nClient({ instanceUrl: env.n8nInstanceUrl, apiKey: env.n8nApiKey });

  console.log(`Upserting workflow "${workflow.name}" ...`);
  const workflowId = await n8n.upsertWorkflowByName(workflow);
  console.log(`   -> id ${workflowId}`);

  console.log('Activating workflow ...');
  await n8n.activateWorkflow(workflowId);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
