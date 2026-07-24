import { loadEnv, patchEnvFile, requireAppId } from '../config/env';
import { N8nClient } from '../lib/n8n-client';
import { MEETING_LOG_PATH, buildMeetingLogWorkflow } from '../workflows/meeting-log-workflow';

function requireEnvValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Fill it in .env first.`);
  }
  return value;
}

async function main() {
  const env = loadEnv();

  const workflow = buildMeetingLogWorkflow({
    webhookSecret: requireEnvValue('N8N_WEBHOOK_SECRET', env.n8nWebhookSecret),
    openaiApiKey: requireEnvValue('OPENAI_API_KEY', env.openaiApiKey),
    kintoneBaseUrl: `https://${env.kintoneSubdomain}.cybozu.com`,
    meetingLogAppId: requireAppId(env, 'kintoneAppIdMeetingLog'),
    meetingLogApiToken: requireEnvValue('KINTONE_API_TOKEN_MEETING_LOG', env.kintoneApiTokenMeetingLog),
  });

  const n8n = new N8nClient({ instanceUrl: env.n8nInstanceUrl, apiKey: env.n8nApiKey });

  console.log(`Upserting workflow "${workflow.name}" ...`);
  const workflowId = await n8n.upsertWorkflowByName(workflow);
  console.log(`   -> id ${workflowId}`);

  console.log('Activating workflow ...');
  await n8n.activateWorkflow(workflowId);

  const webhookUrl = n8n.buildWebhookUrl(MEETING_LOG_PATH);
  patchEnvFile({ N8N_MEETING_LOG_WEBHOOK_URL: webhookUrl });
  console.log(`Wrote N8N_MEETING_LOG_WEBHOOK_URL=${webhookUrl} into .env`);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
