import { recordToTextEmbeddable } from '../lib/record-to-text';

export const SYNC_WORKFLOW_NAME = '[kintone] Pineconeシンク';
export const SYNC_WEBHOOK_PATH = 'exhibition-kintone-sync';

export interface SyncWorkflowConfig {
  kintoneWebhookToken: string;
  openaiApiKey: string;
  pineconeApiKey: string;
  pineconeHost: string;
  pineconeNamespace: string;
  accountAppId: number;
  opportunityAppId: number;
  leadAppId: number;
}

function offsetPositions(startX: number, y: number, count: number, gap = 220): [number, number][] {
  return Array.from({ length: count }, (_, i) => [startX + i * gap, y]);
}

export function buildSyncWorkflow(config: SyncWorkflowConfig) {
  const positions = offsetPositions(0, 300, 6);
  let p = 0;
  const nextPos = () => positions[p++];

  const appNameMap: Record<number, string> = {
    [config.accountAppId]: '取引先',
    [config.opportunityAppId]: '案件',
    [config.leadAppId]: 'リード',
  };

  const pineconeHeader = () => [{ name: 'Api-Key', value: config.pineconeApiKey }];

  const nodes = [
    {
      id: 'webhook',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        httpMethod: 'POST',
        path: SYNC_WEBHOOK_PATH,
        responseMode: 'onReceived',
      },
    },
    {
      id: 'verify_webhook_token',
      name: 'Verify Webhook Token',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
const expected = ${JSON.stringify(config.kintoneWebhookToken)};
const appNameMap = ${JSON.stringify(appNameMap)};
const headers = $input.item.json.headers || {};
const provided = headers['x-cybozu-webhook-token'];
const body = $input.item.json.body || {};
const appId = body.app && body.app.id;
const appName = appNameMap[String(appId)];
return [{ json: {
  valid: provided === expected && !!appName,
  appName: appName || '',
  type: body.type || '',
  record: body.record || {},
  appId: appId || '',
  recordId: (body.recordId != null ? String(body.recordId) : ''),
} }];
`.trim(),
      },
    },
    {
      id: 'token_valid_if',
      name: 'Token Valid?',
      type: 'n8n-nodes-base.if',
      typeVersion: 1,
      position: nextPos(),
      parameters: {
        conditions: {
          boolean: [{ value1: '={{$json.valid}}', value2: true }],
        },
      },
    },
    {
      id: 'stop_invalid',
      name: 'Stop (Invalid Token)',
      type: 'n8n-nodes-base.noOp',
      typeVersion: 1,
      position: [positions[2][0] + 220, positions[2][1] + 200] as [number, number],
      parameters: {},
    },
    {
      id: 'record_to_text',
      name: 'Record to Text',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
${recordToTextEmbeddable()}

const appName = $json.appName;
const appId = $json.appId;
const recordId = $json.recordId;
const vectorId = "exhibition_" + appId + "_" + recordId;

if ($json.type === 'DELETE_RECORD') {
  return [{ json: { action: 'delete', vectorId, appId, recordId } }];
}

const record = $json.record;
const text = "[kintone " + appName + "] " + recordToText(appName, record);
const metadata = { source: 'kintone', appName, appId: String(appId), recordId };
if (appName === '案件' && record.stage && record.stage.value) {
  metadata.stage = record.stage.value;
}

return [{ json: { action: 'upsert', vectorId, text, metadata } }];
`.trim(),
      },
    },
    {
      id: 'route_by_action',
      name: 'Route by Action',
      type: 'n8n-nodes-base.if',
      typeVersion: 1,
      position: nextPos(),
      parameters: {
        conditions: {
          string: [{ value1: '={{$json.action}}', value2: 'delete' }],
        },
      },
    },
    {
      id: 'pinecone_delete',
      name: 'Pinecone Delete',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [positions[5][0] + 220, positions[5][1] - 100] as [number, number],
      parameters: {
        method: 'POST',
        url: `https://${config.pineconeHost}/vectors/delete`,
        sendHeaders: true,
        headerParameters: { parameters: pineconeHeader() },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ ids: [$json.vectorId], namespace: ${JSON.stringify(config.pineconeNamespace)} }) }}`,
        options: {},
      },
    },
    {
      id: 'embed_text',
      name: 'Embed Text',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [positions[5][0] + 220, positions[5][1] + 100] as [number, number],
      parameters: {
        method: 'POST',
        url: 'https://api.openai.com/v1/embeddings',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Authorization', value: `Bearer ${config.openaiApiKey}` },
            { name: 'Content-Type', value: 'application/json' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify({ model: "text-embedding-3-small", input: $json.text }) }}',
        options: {},
      },
    },
    {
      id: 'pinecone_upsert',
      name: 'Pinecone Upsert',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [positions[5][0] + 440, positions[5][1] + 100] as [number, number],
      parameters: {
        method: 'POST',
        url: `https://${config.pineconeHost}/vectors/upsert`,
        sendHeaders: true,
        headerParameters: { parameters: pineconeHeader() },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ vectors: [{ id: $node["Record to Text"].json.vectorId, values: $json.data[0].embedding, metadata: { ...$node["Record to Text"].json.metadata, text: $node["Record to Text"].json.text } }], namespace: ${JSON.stringify(config.pineconeNamespace)} }) }}`,
        options: {},
      },
    },
  ];

  const connections = {
    Webhook: { main: [[{ node: 'Verify Webhook Token', type: 'main', index: 0 }]] },
    'Verify Webhook Token': { main: [[{ node: 'Token Valid?', type: 'main', index: 0 }]] },
    'Token Valid?': {
      main: [
        [{ node: 'Record to Text', type: 'main', index: 0 }],
        [{ node: 'Stop (Invalid Token)', type: 'main', index: 0 }],
      ],
    },
    'Record to Text': { main: [[{ node: 'Route by Action', type: 'main', index: 0 }]] },
    'Route by Action': {
      main: [
        [{ node: 'Pinecone Delete', type: 'main', index: 0 }],
        [{ node: 'Embed Text', type: 'main', index: 0 }],
      ],
    },
    'Embed Text': { main: [[{ node: 'Pinecone Upsert', type: 'main', index: 0 }]] },
  };

  return { name: SYNC_WORKFLOW_NAME, nodes, connections };
}
