import { recordToTextEmbeddable } from '../lib/record-to-text';

export const SCHEDULED_SYNC_WORKFLOW_NAME = '[kintone] Pinecone定期同期';

export interface ScheduledSyncWorkflowConfig {
  openaiApiKey: string;
  pineconeApiKey: string;
  pineconeHost: string;
  pineconeNamespace: string;
  kintoneBaseUrl: string;
  accountAppId: number;
  accountApiToken: string;
  opportunityAppId: number;
  opportunityApiToken: string;
  leadAppId: number;
  leadApiToken: string;
}

function offsetPositions(startX: number, y: number, count: number, gap = 220): [number, number][] {
  return Array.from({ length: count }, (_, i) => [startX + i * gap, y]);
}

export function buildScheduledSyncWorkflow(config: ScheduledSyncWorkflowConfig) {
  const positions = offsetPositions(0, 300, 10);
  let p = 0;
  const nextPos = () => positions[p++];

  const kintoneHeader = (token: string) => [{ name: 'X-Cybozu-API-Token', value: token }];
  const pineconeHeader = () => [{ name: 'Api-Key', value: config.pineconeApiKey }];

  const nodes = [
    {
      id: 'schedule_trigger',
      name: 'Schedule Trigger',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: nextPos(),
      parameters: {
        rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] },
      },
    },
    {
      id: 'build_since_timestamp',
      name: 'Build Since Timestamp',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
const sinceDate = new Date(Date.now() - 7 * 60 * 1000);
const sinceStr = sinceDate.toISOString().replace('T', ' ').replace(/\\.\\d{3}Z$/, '+00:00');
return [{ json: { sinceStr } }];
`.trim(),
      },
    },
    {
      id: 'fetch_updated_account',
      name: 'Fetch Updated Account',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'GET',
        url: `${config.kintoneBaseUrl}/k/v1/records.json`,
        sendHeaders: true,
        headerParameters: { parameters: kintoneHeader(config.accountApiToken) },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'app', value: String(config.accountAppId) },
            {
              name: 'query',
              value: '={{ "updated_time >= \\"" + $json.sinceStr + "\\" order by $id asc limit 100" }}',
            },
          ],
        },
        options: {},
      },
    },
    {
      id: 'fetch_updated_opportunity',
      name: 'Fetch Updated Opportunity',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'GET',
        url: `${config.kintoneBaseUrl}/k/v1/records.json`,
        sendHeaders: true,
        headerParameters: { parameters: kintoneHeader(config.opportunityApiToken) },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'app', value: String(config.opportunityAppId) },
            {
              name: 'query',
              value:
                '={{ "updated_time >= \\"" + $node["Build Since Timestamp"].json.sinceStr + "\\" order by $id asc limit 100" }}',
            },
          ],
        },
        options: {},
      },
    },
    {
      id: 'fetch_updated_lead',
      name: 'Fetch Updated Lead',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'GET',
        url: `${config.kintoneBaseUrl}/k/v1/records.json`,
        sendHeaders: true,
        headerParameters: { parameters: kintoneHeader(config.leadApiToken) },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'app', value: String(config.leadAppId) },
            {
              name: 'query',
              value:
                '={{ "updated_time >= \\"" + $node["Build Since Timestamp"].json.sinceStr + "\\" order by $id asc limit 100" }}',
            },
          ],
        },
        options: {},
      },
    },
    {
      id: 'merge_and_build_texts',
      name: 'Merge & Build Texts',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
${recordToTextEmbeddable()}

const groups = [
  { appName: '取引先', appId: ${config.accountAppId}, records: ($node["Fetch Updated Account"].json.records || []) },
  { appName: '案件', appId: ${config.opportunityAppId}, records: ($node["Fetch Updated Opportunity"].json.records || []) },
  { appName: 'リード', appId: ${config.leadAppId}, records: ($node["Fetch Updated Lead"].json.records || []) },
];

const texts = [];
const vectorMeta = [];
for (const group of groups) {
  for (const record of group.records) {
    const recordId = record.$id.value;
    const text = "[kintone " + group.appName + "] " + recordToText(group.appName, record);
    const metadata = { source: 'kintone', appName: group.appName, appId: String(group.appId), recordId };
    if (group.appName === '案件' && record.stage && record.stage.value) {
      metadata.stage = record.stage.value;
    }
    texts.push(text);
    vectorMeta.push({ vectorId: "exhibition_" + group.appId + "_" + recordId, text, metadata });
  }
}

return [{ json: { texts, vectorMeta, hasRecords: texts.length > 0 } }];
`.trim(),
      },
    },
    {
      id: 'has_records_if',
      name: 'Has Records?',
      type: 'n8n-nodes-base.if',
      typeVersion: 1,
      position: nextPos(),
      parameters: {
        conditions: {
          boolean: [{ value1: '={{$json.hasRecords}}', value2: true }],
        },
      },
    },
    {
      id: 'stop_no_updates',
      name: 'Stop (No Updates)',
      type: 'n8n-nodes-base.noOp',
      typeVersion: 1,
      position: [positions[6][0] + 220, positions[6][1] + 200] as [number, number],
      parameters: {},
    },
    {
      id: 'embed_batch',
      name: 'Embed Batch',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
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
        jsonBody:
          '={{ JSON.stringify({ model: "text-embedding-3-small", input: $json.texts }) }}',
        options: {},
      },
    },
    {
      id: 'build_vectors_and_upsert',
      name: 'Build Vectors and Upsert',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'POST',
        url: `https://${config.pineconeHost}/vectors/upsert`,
        sendHeaders: true,
        headerParameters: { parameters: pineconeHeader() },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ vectors: $node["Merge & Build Texts"].json.vectorMeta.map((m, i) => ({ id: m.vectorId, values: $json.data[i].embedding, metadata: { ...m.metadata, text: m.text } })), namespace: ${JSON.stringify(config.pineconeNamespace)} }) }}`,
        options: {},
      },
    },
  ];

  const connections = {
    'Schedule Trigger': { main: [[{ node: 'Build Since Timestamp', type: 'main', index: 0 }]] },
    'Build Since Timestamp': { main: [[{ node: 'Fetch Updated Account', type: 'main', index: 0 }]] },
    'Fetch Updated Account': { main: [[{ node: 'Fetch Updated Opportunity', type: 'main', index: 0 }]] },
    'Fetch Updated Opportunity': { main: [[{ node: 'Fetch Updated Lead', type: 'main', index: 0 }]] },
    'Fetch Updated Lead': { main: [[{ node: 'Merge & Build Texts', type: 'main', index: 0 }]] },
    'Merge & Build Texts': { main: [[{ node: 'Has Records?', type: 'main', index: 0 }]] },
    'Has Records?': {
      main: [
        [{ node: 'Embed Batch', type: 'main', index: 0 }],
        [{ node: 'Stop (No Updates)', type: 'main', index: 0 }],
      ],
    },
    'Embed Batch': { main: [[{ node: 'Build Vectors and Upsert', type: 'main', index: 0 }]] },
  };

  return { name: SCHEDULED_SYNC_WORKFLOW_NAME, nodes, connections };
}
