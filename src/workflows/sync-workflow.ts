import { recordToTextEmbeddable } from '../lib/record-to-text';

export const SYNC_WORKFLOW_NAME = '[kintone] Pineconeシンク';
export const SYNC_WEBHOOK_PATH = 'exhibition-kintone-sync';

export interface SyncWorkflowConfig {
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
  const positions = offsetPositions(0, 300, 5);
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
      id: 'parse_webhook_payload',
      name: 'Parse Webhook Payload',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        // kintone's own Webhook feature has no verification-token or auth field at all in its UI
        // (confirmed against the real settings screen) — unlike Relava's meishi webhook, which
        // relied on URL-path obscurity alone, this is the same tradeoff here, not a check we can
        // actually enforce. This node only normalizes the payload shape, nothing more.
        jsCode: `
const appNameMap = ${JSON.stringify(appNameMap)};
const body = $input.item.json.body || {};
const appId = body.app && body.app.id;
const appName = appNameMap[String(appId)];
return [{ json: {
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
      position: [positions[4][0] + 220, positions[4][1] - 100] as [number, number],
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
      position: [positions[4][0] + 220, positions[4][1] + 100] as [number, number],
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
      position: [positions[4][0] + 440, positions[4][1] + 100] as [number, number],
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
    Webhook: { main: [[{ node: 'Parse Webhook Payload', type: 'main', index: 0 }]] },
    'Parse Webhook Payload': { main: [[{ node: 'Record to Text', type: 'main', index: 0 }]] },
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
