import { loadEnv } from '../config/env';
import { N8nClient } from '../lib/n8n-client';

const WORKFLOW_NAME = '[kintone] 疎通確認';
const WEBHOOK_PATH = 'exhibition-ping';

function buildPingWorkflow() {
  return {
    name: WORKFLOW_NAME,
    nodes: [
      {
        id: 'webhook',
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [240, 300],
        parameters: {
          httpMethod: 'POST',
          path: WEBHOOK_PATH,
          responseMode: 'responseNode',
        },
      },
      {
        id: 'echo',
        name: 'Echo',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [460, 300],
        parameters: {
          jsCode:
            'return [{ json: { pong: true, receivedAt: new Date().toISOString(), echo: $input.item.json.body } }];',
        },
      },
      {
        id: 'respond',
        name: 'Respond to Webhook',
        type: 'n8n-nodes-base.respondToWebhook',
        typeVersion: 1.1,
        position: [680, 300],
        parameters: {
          respondWith: 'json',
          responseBody: '={{ $json }}',
        },
      },
    ],
    connections: {
      Webhook: { main: [[{ node: 'Echo', type: 'main', index: 0 }]] },
      Echo: { main: [[{ node: 'Respond to Webhook', type: 'main', index: 0 }]] },
    },
  };
}

async function main() {
  const env = loadEnv();
  const n8n = new N8nClient({ instanceUrl: env.n8nInstanceUrl, apiKey: env.n8nApiKey });

  console.log(`Upserting workflow "${WORKFLOW_NAME}" ...`);
  const workflowId = await n8n.upsertWorkflowByName(buildPingWorkflow());
  console.log(`   -> id ${workflowId}`);

  console.log('Activating workflow ...');
  await n8n.activateWorkflow(workflowId);

  const webhookUrl = n8n.buildWebhookUrl(WEBHOOK_PATH);
  const nonce = `exhibition-asset-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  console.log(`Round-tripping via ${webhookUrl} with nonce=${nonce} ...`);

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'exhibition-asset-setup-script', nonce, ts: Date.now() }),
  });

  if (!res.ok) {
    throw new Error(`Webhook call failed: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as { pong?: boolean; echo?: { nonce?: string } };

  if (body.pong !== true || body.echo?.nonce !== nonce) {
    throw new Error(`Round-trip mismatch: ${JSON.stringify(body)}`);
  }

  console.log('OK: n8n round-trip confirmed (nonce matched).');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
