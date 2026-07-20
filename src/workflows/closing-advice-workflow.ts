import { recordToTextEmbeddable } from '../lib/record-to-text';

export const CLOSING_ADVICE_WORKFLOW_NAME = '[kintone] クロージングアドバイス';
export const CLOSING_ADVICE_WEBHOOK_PATH = 'exhibition-closing-advice';

export interface ClosingAdviceWorkflowConfig {
  webhookSecret: string;
  openaiApiKey: string;
  pineconeApiKey: string;
  pineconeHost: string;
  pineconeNamespace: string;
  kintoneBaseUrl: string;
  opportunityAppId: number;
  opportunityApiToken: string;
}

const ADVICE_SYSTEM_PROMPT = `あなたは営業案件のクロージングを支援するAIです。現在の案件情報と、
過去の類似する受注/失注案件を参考に、この案件の受注確度・成功要因・リスク要因・推奨アクションを
分析してください。

回答は必ず次のJSON形式のみで返してください(説明文やコードブロックは不要):
{
  "closingProbability": 0から100の整数,
  "positiveSignals": ["受注に有利な要因"],
  "riskFactors": ["リスク・懸念点"],
  "recommendedActions": ["次に取るべき具体的なアクション"],
  "summary": "全体を50字程度で要約したコメント"
}

類似案件が少ない、または関連性が低い場合でも、現在の案件情報だけを根拠に妥当な分析を行い、
必ず上記JSON形式で回答してください。`;

function offsetPositions(startX: number, y: number, count: number, gap = 220): [number, number][] {
  return Array.from({ length: count }, (_, i) => [startX + i * gap, y]);
}

export function buildClosingAdviceWorkflow(config: ClosingAdviceWorkflowConfig) {
  const positions = offsetPositions(0, 300, 12);
  let p = 0;
  const nextPos = () => positions[p++];

  const kintoneHeader = () => [
    { name: 'X-Cybozu-API-Token', value: config.opportunityApiToken },
  ];
  const openaiHeaders = () => [
    { name: 'Authorization', value: `Bearer ${config.openaiApiKey}` },
    { name: 'Content-Type', value: 'application/json' },
  ];
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
        path: CLOSING_ADVICE_WEBHOOK_PATH,
        responseMode: 'responseNode',
      },
    },
    {
      id: 'verify_secret',
      name: 'Verify Secret',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
const expected = ${JSON.stringify(config.webhookSecret)};
const headers = $input.item.json.headers || {};
const provided = headers['x-webhook-secret'];
const body = $input.item.json.body || {};
return [{ json: { ...body, valid: provided === expected } }];
`.trim(),
      },
    },
    {
      id: 'secret_valid_if',
      name: 'Secret Valid?',
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
      id: 'respond_unauthorized',
      name: 'Respond Unauthorized',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: [positions[2][0] + 220, positions[2][1] + 200] as [number, number],
      parameters: {
        respondWith: 'json',
        responseBody: '={{ { "error": "invalid webhook secret" } }}',
        options: { responseCode: 401 },
      },
    },
    {
      id: 'fetch_deal',
      name: 'Fetch Deal',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'GET',
        url: `${config.kintoneBaseUrl}/k/v1/record.json`,
        sendHeaders: true,
        headerParameters: { parameters: kintoneHeader() },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'app', value: String(config.opportunityAppId) },
            { name: 'id', value: '={{ $node["Verify Secret"].json.recordId }}' },
          ],
        },
        options: {},
      },
    },
    {
      id: 'build_deal_text',
      name: 'Build Deal Text',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
${recordToTextEmbeddable()}

const record = $json.record;
const text = recordToText('案件', record);
return [{ json: { dealText: text, record } }];
`.trim(),
      },
    },
    {
      id: 'embed_deal',
      name: 'Embed Deal',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'POST',
        url: 'https://api.openai.com/v1/embeddings',
        sendHeaders: true,
        headerParameters: { parameters: openaiHeaders() },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify({ model: "text-embedding-3-small", input: $json.dealText }) }}',
        options: {},
      },
    },
    {
      id: 'pinecone_query',
      name: 'Pinecone Query',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'POST',
        url: `https://${config.pineconeHost}/query`,
        sendHeaders: true,
        headerParameters: { parameters: pineconeHeader() },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ vector: $json.data[0].embedding, topK: 8, namespace: ${JSON.stringify(config.pineconeNamespace)}, includeMetadata: true, filter: { appName: { "$eq": "案件" }, stage: { "$in": ["成約", "失注"] } } }) }}`,
        options: {},
      },
    },
    {
      id: 'build_similar_deals_context',
      name: 'Build Similar Deals Context',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
const matches = Array.isArray($json.matches) ? $json.matches : [];
const highConf = matches.filter((m) => (m.score || 0) >= 0.70);
let similarDealsContext = '';
highConf.slice(0, 5).forEach((m, idx) => {
  const score = Math.round((m.score || 0) * 100);
  const meta = m.metadata || {};
  similarDealsContext += "\\n[" + (idx + 1) + "] スコア:" + score + "% ステータス:" + (meta.stage || '') + "\\n";
  if (meta.text) similarDealsContext += String(meta.text).slice(0, 400) + "\\n";
});
return [{ json: {
  dealText: $node["Build Deal Text"].json.dealText,
  recordId: $node["Verify Secret"].json.recordId,
  similarDealsContext,
} }];
`.trim(),
      },
    },
    {
      id: 'generate_advice',
      name: 'Generate Advice',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions',
        sendHeaders: true,
        headerParameters: { parameters: openaiHeaders() },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ model: "gpt-4o", response_format: { type: "json_object" }, messages: [ { role: "system", content: ${JSON.stringify(ADVICE_SYSTEM_PROMPT)} }, { role: "user", content: JSON.stringify({ currentDeal: $json.dealText, similarPastDeals: $json.similarDealsContext || "(類似案件は見つかりませんでした)" }) } ] }) }}`,
        options: {},
      },
    },
    {
      id: 'parse_advice',
      name: 'Parse Advice',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
const FALLBACK = { summary: "解析に失敗しました", closingProbability: 0, positiveSignals: [], riskFactors: [], recommendedActions: [] };
let advice;
try {
  advice = JSON.parse($json.choices[0].message.content);
} catch (e) {
  advice = FALLBACK;
}
return [{ json: { advice, recordId: $node["Build Similar Deals Context"].json.recordId } }];
`.trim(),
      },
    },
    {
      id: 'write_back',
      name: 'Write Back',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'PUT',
        url: `${config.kintoneBaseUrl}/k/v1/record.json`,
        sendHeaders: true,
        headerParameters: {
          parameters: [...kintoneHeader(), { name: 'Content-Type', value: 'application/json' }],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ app: ${config.opportunityAppId}, id: Number($json.recordId), record: { closing_advice: { value: JSON.stringify($json.advice) } } }) }}`,
        options: {},
      },
    },
    {
      id: 'respond_to_webhook',
      name: 'Respond to Webhook',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: nextPos(),
      parameters: {
        respondWith: 'json',
        responseBody: '={{ $node["Parse Advice"].json.advice }}',
      },
    },
  ];

  const connections = {
    Webhook: { main: [[{ node: 'Verify Secret', type: 'main', index: 0 }]] },
    'Verify Secret': { main: [[{ node: 'Secret Valid?', type: 'main', index: 0 }]] },
    'Secret Valid?': {
      main: [
        [{ node: 'Fetch Deal', type: 'main', index: 0 }],
        [{ node: 'Respond Unauthorized', type: 'main', index: 0 }],
      ],
    },
    'Fetch Deal': { main: [[{ node: 'Build Deal Text', type: 'main', index: 0 }]] },
    'Build Deal Text': { main: [[{ node: 'Embed Deal', type: 'main', index: 0 }]] },
    'Embed Deal': { main: [[{ node: 'Pinecone Query', type: 'main', index: 0 }]] },
    'Pinecone Query': { main: [[{ node: 'Build Similar Deals Context', type: 'main', index: 0 }]] },
    'Build Similar Deals Context': { main: [[{ node: 'Generate Advice', type: 'main', index: 0 }]] },
    'Generate Advice': { main: [[{ node: 'Parse Advice', type: 'main', index: 0 }]] },
    'Parse Advice': { main: [[{ node: 'Write Back', type: 'main', index: 0 }]] },
    'Write Back': { main: [[{ node: 'Respond to Webhook', type: 'main', index: 0 }]] },
  };

  return { name: CLOSING_ADVICE_WORKFLOW_NAME, nodes, connections };
}
