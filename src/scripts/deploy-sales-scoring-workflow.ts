import { loadEnv, patchEnvFile, requireAppId } from '../config/env';
import { N8nClient } from '../lib/n8n-client';
import { SALES_SCORING_PATH, buildSalesScoringWorkflow } from '../workflows/sales-scoring-workflow';

function requireEnvValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Fill it in .env first.`);
  }
  return value;
}

async function main() {
  const env = loadEnv();

  const workflow = buildSalesScoringWorkflow({
    webhookSecret: requireEnvValue('N8N_WEBHOOK_SECRET', env.n8nWebhookSecret),
    openaiApiKey: requireEnvValue('OPENAI_API_KEY', env.openaiApiKey),
    kintoneBaseUrl: `https://${env.kintoneSubdomain}.cybozu.com`,
    opportunityAppId: requireAppId(env, 'kintoneAppIdOpportunity'),
    opportunityApiToken: requireEnvValue(
      'KINTONE_API_TOKEN_OPPORTUNITY',
      env.kintoneApiTokenOpportunity,
    ),
    dailyAdviceAppId: requireAppId(env, 'kintoneAppIdDailyAdvice'),
    dailyAdviceApiToken: requireEnvValue('KINTONE_API_TOKEN_DAILY_ADVICE', env.kintoneApiTokenDailyAdvice),
    meetingLogAppId: requireAppId(env, 'kintoneAppIdMeetingLog'),
    meetingLogApiToken: requireEnvValue('KINTONE_API_TOKEN_MEETING_LOG', env.kintoneApiTokenMeetingLog),
    assigneeAppId: requireAppId(env, 'kintoneAppIdAssignee'),
    assigneeApiToken: requireEnvValue('KINTONE_API_TOKEN_ASSIGNEE', env.kintoneApiTokenAssignee),
    salesScoreAppId: requireAppId(env, 'kintoneAppIdSalesScore'),
    salesScoreApiToken: requireEnvValue('KINTONE_API_TOKEN_SALES_SCORE', env.kintoneApiTokenSalesScore),
  });

  const n8n = new N8nClient({ instanceUrl: env.n8nInstanceUrl, apiKey: env.n8nApiKey });

  console.log(`Upserting workflow "${workflow.name}" ...`);
  const workflowId = await n8n.upsertWorkflowByName(workflow);
  console.log(`   -> id ${workflowId}`);

  console.log('Activating workflow ...');
  await n8n.activateWorkflow(workflowId);

  const webhookUrl = n8n.buildWebhookUrl(SALES_SCORING_PATH);
  patchEnvFile({ N8N_SALES_SCORING_WEBHOOK_URL: webhookUrl });
  console.log(`Wrote N8N_SALES_SCORING_WEBHOOK_URL=${webhookUrl} into .env`);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
