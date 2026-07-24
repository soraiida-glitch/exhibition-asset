import path from 'node:path';
import { loadEnv, patchEnvFile, requireAppId } from '../config/env';
import { buildPptxCodeNodeSource } from '../lib/pptx-template';
import { N8nClient } from '../lib/n8n-client';
import { PROPOSAL_PATH, buildProposalWorkflow } from '../workflows/proposal-workflow';

function requireEnvValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Fill it in .env first.`);
  }
  return value;
}

async function main() {
  const env = loadEnv();

  const templatePath = path.resolve(process.cwd(), 'templates', 'proposal_template.pptx');
  console.log(`Building PPTX code node source from ${templatePath} ...`);
  const pptxCodeSource = buildPptxCodeNodeSource(templatePath);
  console.log(`   -> generated ${pptxCodeSource.length} chars`);

  const workflow = buildProposalWorkflow({
    webhookSecret: requireEnvValue('N8N_WEBHOOK_SECRET', env.n8nWebhookSecret),
    openaiApiKey: requireEnvValue('OPENAI_API_KEY', env.openaiApiKey),
    kintoneBaseUrl: `https://${env.kintoneSubdomain}.cybozu.com`,
    opportunityAppId: requireAppId(env, 'kintoneAppIdOpportunity'),
    opportunityApiToken: requireEnvValue(
      'KINTONE_API_TOKEN_OPPORTUNITY',
      env.kintoneApiTokenOpportunity,
    ),
    meetingLogAppId: requireAppId(env, 'kintoneAppIdMeetingLog'),
    meetingLogApiToken: requireEnvValue('KINTONE_API_TOKEN_MEETING_LOG', env.kintoneApiTokenMeetingLog),
    boxClientId: requireEnvValue('BOX_CLIENT_ID', env.boxClientId),
    boxClientSecret: requireEnvValue('BOX_CLIENT_SECRET', env.boxClientSecret),
    boxEnterpriseId: requireEnvValue('BOX_ENTERPRISE_ID', env.boxEnterpriseId),
    boxFolderId: requireEnvValue('BOX_FOLDER_ID', env.boxFolderId),
    pptxCodeSource,
  });

  const n8n = new N8nClient({ instanceUrl: env.n8nInstanceUrl, apiKey: env.n8nApiKey });

  console.log(`Upserting workflow "${workflow.name}" ...`);
  const workflowId = await n8n.upsertWorkflowByName(workflow);
  console.log(`   -> id ${workflowId}`);

  console.log('Activating workflow ...');
  await n8n.activateWorkflow(workflowId);

  const webhookUrl = n8n.buildWebhookUrl(PROPOSAL_PATH);
  patchEnvFile({ N8N_PROPOSAL_WEBHOOK_URL: webhookUrl });
  console.log(`Wrote N8N_PROPOSAL_WEBHOOK_URL=${webhookUrl} into .env`);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
