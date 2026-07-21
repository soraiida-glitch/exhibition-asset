import { loadEnv, patchEnvFile } from '../config/env';
import { N8nClient } from '../lib/n8n-client';
import { TRANSCRIBE_PATH, TTS_PATH, buildAudioWorkflow } from '../workflows/audio-workflow';

function requireEnvValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Fill it in .env first.`);
  }
  return value;
}

async function main() {
  const env = loadEnv();

  const workflow = buildAudioWorkflow({
    webhookSecret: requireEnvValue('N8N_WEBHOOK_SECRET', env.n8nWebhookSecret),
    openaiApiKey: requireEnvValue('OPENAI_API_KEY', env.openaiApiKey),
  });

  const n8n = new N8nClient({ instanceUrl: env.n8nInstanceUrl, apiKey: env.n8nApiKey });

  console.log(`Upserting workflow "${workflow.name}" ...`);
  const workflowId = await n8n.upsertWorkflowByName(workflow);
  console.log(`   -> id ${workflowId}`);

  console.log('Activating workflow ...');
  await n8n.activateWorkflow(workflowId);

  const transcribeUrl = n8n.buildWebhookUrl(TRANSCRIBE_PATH);
  const ttsUrl = n8n.buildWebhookUrl(TTS_PATH);
  patchEnvFile({
    N8N_TRANSCRIBE_WEBHOOK_URL: transcribeUrl,
    N8N_TTS_WEBHOOK_URL: ttsUrl,
  });
  console.log(`Wrote N8N_TRANSCRIBE_WEBHOOK_URL=${transcribeUrl} into .env`);
  console.log(`Wrote N8N_TTS_WEBHOOK_URL=${ttsUrl} into .env`);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
