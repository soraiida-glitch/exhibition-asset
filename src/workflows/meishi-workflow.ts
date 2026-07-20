export const MEISHI_WORKFLOW_NAME = '[kintone] 名刺解析';
export const MEISHI_WEBHOOK_PATH = 'exhibition-meishi-upload';

export interface MeishiWorkflowConfig {
  webhookSecret: string;
  openaiApiKey: string;
  kintoneBaseUrl: string;
  leadAppId: number;
  leadApiToken: string;
}

const EXTRACT_PROMPT = `名刺画像から情報を抽出してください。以下のJSON形式のみで回答してください
(説明文やコードブロックは不要):
{"lead_name": "氏名(フルネーム)", "company_name": "会社名", "phone": "電話番号", "email": "メールアドレス", "memo": "役職・部署・住所など、上記以外の情報を改行区切りで"}

読み取れない項目は空文字にしてください。`;

function offsetPositions(startX: number, y: number, count: number, gap = 220): [number, number][] {
  return Array.from({ length: count }, (_, i) => [startX + i * gap, y]);
}

export function buildMeishiWorkflow(config: MeishiWorkflowConfig) {
  const positions = offsetPositions(0, 300, 8);
  let p = 0;
  const nextPos = () => positions[p++];

  const nodes = [
    {
      id: 'webhook',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        httpMethod: 'POST',
        path: MEISHI_WEBHOOK_PATH,
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
return [{ json: { ...$input.item.json, valid: provided === expected } }];
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
      id: 'openai_vision',
      name: 'OpenAI Vision',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Authorization', value: `Bearer ${config.openaiApiKey}` },
            { name: 'Content-Type', value: 'application/json' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ model: "gpt-4o", response_format: { type: "json_object" }, messages: [ { role: "user", content: [ { type: "text", text: ${JSON.stringify(EXTRACT_PROMPT)} }, { type: "image_url", image_url: { url: "data:" + ($node["Verify Secret"].json.body.image_type || "image/jpeg") + ";base64," + $node["Verify Secret"].json.body.image_base64, detail: "high" } } ] } ] }) }}`,
        options: { timeout: 60000 },
      },
    },
    {
      id: 'parse_card_data',
      name: 'Parse Card Data',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
let data;
try {
  data = JSON.parse($json.choices[0].message.content);
} catch (e) {
  data = { lead_name: '', company_name: '', phone: '', email: '', memo: '' };
}
return [{ json: {
  lead_name: data.lead_name || '',
  company_name: data.company_name || '',
  phone: data.phone || '',
  email: data.email || '',
  memo: data.memo || '',
} }];
`.trim(),
      },
    },
    {
      id: 'check_lead_duplicate',
      name: 'Check Lead Duplicate',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'GET',
        url: `${config.kintoneBaseUrl}/k/v1/records.json`,
        sendHeaders: true,
        headerParameters: {
          parameters: [{ name: 'X-Cybozu-API-Token', value: config.leadApiToken }],
        },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'app', value: String(config.leadAppId) },
            {
              name: 'query',
              value:
                '={{ $json.company_name && $json.lead_name ? ("company_name = \\"" + $json.company_name.replace(/"/g, "") + "\\" and lead_name = \\"" + $json.lead_name.replace(/"/g, "") + "\\" limit 1") : "limit 0" }}',
            },
          ],
        },
        options: {},
      },
    },
    {
      id: 'merge_and_respond',
      name: 'Merge & Respond',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
const data = $node["Parse Card Data"].json;
const dupRecords = $json.records || [];
const isDuplicate = dupRecords.length > 0;
return [{ json: {
  data,
  isDuplicate,
  duplicateRecordId: isDuplicate ? dupRecords[0].$id.value : null,
} }];
`.trim(),
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
        responseBody: '={{ $json }}',
      },
    },
  ];

  const connections = {
    Webhook: { main: [[{ node: 'Verify Secret', type: 'main', index: 0 }]] },
    'Verify Secret': { main: [[{ node: 'Secret Valid?', type: 'main', index: 0 }]] },
    'Secret Valid?': {
      main: [
        [{ node: 'OpenAI Vision', type: 'main', index: 0 }],
        [{ node: 'Respond Unauthorized', type: 'main', index: 0 }],
      ],
    },
    'OpenAI Vision': { main: [[{ node: 'Parse Card Data', type: 'main', index: 0 }]] },
    'Parse Card Data': { main: [[{ node: 'Check Lead Duplicate', type: 'main', index: 0 }]] },
    'Check Lead Duplicate': { main: [[{ node: 'Merge & Respond', type: 'main', index: 0 }]] },
    'Merge & Respond': { main: [[{ node: 'Respond to Webhook', type: 'main', index: 0 }]] },
  };

  return { name: MEISHI_WORKFLOW_NAME, nodes, connections };
}
