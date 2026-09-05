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

  // RELVA_BI_開発方針報告書_v2.docx §3.5 — AIによるインサイト・アドバイス(BI Narrative)は
  // 直接のAnthropic APIキーではなく、GCPのサービスアカウント(Vertex AI経由)でClaudeを呼ぶ。
  // .envにはJSON鍵ファイル全体をbase64化した1つの値として保存してある(private_keyの改行を
  // .envにそのまま書けないため)ので、ここでデコード・パースしてclient_email/private_keyを
  // 取り出す。
  const serviceAccountKeyBase64 = requireEnvValue('GOOGLE_SERVICE_ACCOUNT_KEY_BASE64', env.googleServiceAccountKeyBase64);
  const serviceAccountKey = JSON.parse(Buffer.from(serviceAccountKeyBase64, 'base64').toString('utf8')) as {
    client_email: string;
    private_key: string;
  };

  const workflow = buildAgentWorkflow({
    webhookSecret,
    openaiApiKey: requireEnvValue('OPENAI_API_KEY', env.openaiApiKey),
    googleServiceAccountEmail: serviceAccountKey.client_email,
    googleServiceAccountPrivateKey: serviceAccountKey.private_key,
    vertexProjectId: requireEnvValue('VERTEX_PROJECT_ID', env.vertexProjectId),
    vertexRegion: requireEnvValue('VERTEX_REGION', env.vertexRegion),
    vertexClaudeModelId: requireEnvValue('VERTEX_CLAUDE_MODEL_ID', env.vertexClaudeModelId),
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
    dailyAdviceAppId: requireAppId(env, 'kintoneAppIdDailyAdvice'),
    dailyAdviceApiToken: requireEnvValue(
      'KINTONE_API_TOKEN_DAILY_ADVICE',
      env.kintoneApiTokenDailyAdvice,
    ),
    salesScoreAppId: requireAppId(env, 'kintoneAppIdSalesScore'),
    salesScoreApiToken: requireEnvValue(
      'KINTONE_API_TOKEN_SALES_SCORE',
      env.kintoneApiTokenSalesScore,
    ),
    supabaseUrl: requireEnvValue('SUPABASE_URL', env.supabaseUrl),
    supabaseServiceRoleKey: requireEnvValue(
      'SUPABASE_SERVICE_ROLE_KEY',
      env.supabaseServiceRoleKey,
    ),
    tavilyApiKey: requireEnvValue('TAVILY_API_KEY', env.tavilyApiKey),
    pineconeHost: requireEnvValue('PINECONE_HOST', env.pineconeHost),
    pineconeApiKey: requireEnvValue('PINECONE_API_KEY', env.pineconeApiKey),
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
