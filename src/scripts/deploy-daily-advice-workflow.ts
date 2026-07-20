import { loadEnv, requireAppId } from '../config/env';
import { N8nClient } from '../lib/n8n-client';
import { buildDailyAdviceWorkflow } from '../workflows/daily-advice-workflow';

function requireEnvValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Fill it in .env first.`);
  }
  return value;
}

async function main() {
  const env = loadEnv();

  const workflow = buildDailyAdviceWorkflow({
    openaiApiKey: requireEnvValue('OPENAI_API_KEY', env.openaiApiKey),
    kintoneBaseUrl: `https://${env.kintoneSubdomain}.cybozu.com`,
    opportunityAppId: requireAppId(env, 'kintoneAppIdOpportunity'),
    opportunityApiToken: requireEnvValue(
      'KINTONE_API_TOKEN_OPPORTUNITY',
      env.kintoneApiTokenOpportunity,
    ),
    dailyAdviceAppId: requireAppId(env, 'kintoneAppIdDailyAdvice'),
    dailyAdviceApiToken: requireEnvValue(
      'KINTONE_API_TOKEN_DAILY_ADVICE',
      env.kintoneApiTokenDailyAdvice,
    ),
  });

  const n8n = new N8nClient({ instanceUrl: env.n8nInstanceUrl, apiKey: env.n8nApiKey });

  console.log(`Upserting workflow "${workflow.name}" ...`);
  const workflowId = await n8n.upsertWorkflowByName(workflow);
  console.log(`   -> id ${workflowId}`);

  console.log('Activating workflow ...');
  await n8n.activateWorkflow(workflowId);
  console.log('Done. Runs daily at 07:00 (n8n instance timezone).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
