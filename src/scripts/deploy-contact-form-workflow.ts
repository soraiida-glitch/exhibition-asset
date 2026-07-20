import crypto from 'node:crypto';
import { loadEnv, patchEnvFile, requireAppId } from '../config/env';
import { N8nClient } from '../lib/n8n-client';
import {
  CONTACT_FORM_WEBHOOK_PATH,
  buildContactFormWorkflow,
} from '../workflows/contact-form-workflow';

function requireEnvValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Fill it in .env first.`);
  }
  return value;
}

async function main() {
  const env = loadEnv();

  const webhookSecret = env.n8nContactFormSecret || crypto.randomBytes(24).toString('hex');
  if (!env.n8nContactFormSecret) {
    patchEnvFile({ N8N_CONTACT_FORM_SECRET: webhookSecret });
    console.log('Generated a new N8N_CONTACT_FORM_SECRET and wrote it to .env');
  }

  const workflow = buildContactFormWorkflow({
    webhookSecret,
    kintoneBaseUrl: `https://${env.kintoneSubdomain}.cybozu.com`,
    leadAppId: requireAppId(env, 'kintoneAppIdLead'),
    leadApiToken: requireEnvValue('KINTONE_API_TOKEN_LEAD', env.kintoneApiTokenLead),
  });

  const n8n = new N8nClient({ instanceUrl: env.n8nInstanceUrl, apiKey: env.n8nApiKey });

  console.log(`Upserting workflow "${workflow.name}" ...`);
  const workflowId = await n8n.upsertWorkflowByName(workflow);
  console.log(`   -> id ${workflowId}`);

  console.log('Activating workflow ...');
  await n8n.activateWorkflow(workflowId);

  const webhookUrl = n8n.buildWebhookUrl(CONTACT_FORM_WEBHOOK_PATH);
  patchEnvFile({ N8N_CONTACT_FORM_WEBHOOK_URL: webhookUrl });
  console.log(`Wrote N8N_CONTACT_FORM_WEBHOOK_URL=${webhookUrl} into .env`);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
