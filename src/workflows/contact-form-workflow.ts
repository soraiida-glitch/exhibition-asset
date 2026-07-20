export const CONTACT_FORM_WORKFLOW_NAME = '[kintone] 問い合わせ受信';
export const CONTACT_FORM_WEBHOOK_PATH = 'exhibition-contact-form';

export interface ContactFormWorkflowConfig {
  webhookSecret: string;
  kintoneBaseUrl: string;
  leadAppId: number;
  leadApiToken: string;
}

function offsetPositions(startX: number, y: number, count: number, gap = 220): [number, number][] {
  return Array.from({ length: count }, (_, i) => [startX + i * gap, y]);
}

export function buildContactFormWorkflow(config: ContactFormWorkflowConfig) {
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
        path: CONTACT_FORM_WEBHOOK_PATH,
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
return [{ json: {
  valid: provided === expected,
  validInput: !!(body.lead_name && String(body.lead_name).trim()),
  lead_name: body.lead_name || '',
  company_name: body.company_name || '',
  phone: body.phone || '',
  email: body.email || '',
  memo: body.memo || '',
} }];
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
      id: 'input_valid_if',
      name: 'Input Valid?',
      type: 'n8n-nodes-base.if',
      typeVersion: 1,
      position: nextPos(),
      parameters: {
        conditions: {
          boolean: [{ value1: '={{$json.validInput}}', value2: true }],
        },
      },
    },
    {
      id: 'respond_bad_request',
      name: 'Respond Bad Request',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: [positions[4][0] + 220, positions[4][1] + 200] as [number, number],
      parameters: {
        respondWith: 'json',
        responseBody: '={{ { "error": "lead_name is required" } }}',
        options: { responseCode: 400 },
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
      id: 'create_lead',
      name: 'Create Lead',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'POST',
        url: `${config.kintoneBaseUrl}/k/v1/record.json`,
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'X-Cybozu-API-Token', value: config.leadApiToken },
            { name: 'Content-Type', value: 'application/json' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ app: ${config.leadAppId}, record: { lead_name: { value: $node["Verify Secret"].json.lead_name }, company_name: { value: $node["Verify Secret"].json.company_name }, phone: { value: $node["Verify Secret"].json.phone }, email: { value: $node["Verify Secret"].json.email }, memo: { value: $node["Verify Secret"].json.memo }, source: { value: "問い合わせフォーム" }, status: { value: "未対応" } } }) }}`,
        options: {},
      },
    },
    {
      id: 'build_response',
      name: 'Build Response',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
const dupRecords = $node["Check Lead Duplicate"].json.records || [];
const isDuplicate = dupRecords.length > 0;
return [{ json: {
  status: 'ok',
  recordId: $json.id,
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
        [{ node: 'Input Valid?', type: 'main', index: 0 }],
        [{ node: 'Respond Unauthorized', type: 'main', index: 0 }],
      ],
    },
    'Input Valid?': {
      main: [
        [{ node: 'Check Lead Duplicate', type: 'main', index: 0 }],
        [{ node: 'Respond Bad Request', type: 'main', index: 0 }],
      ],
    },
    'Check Lead Duplicate': { main: [[{ node: 'Create Lead', type: 'main', index: 0 }]] },
    'Create Lead': { main: [[{ node: 'Build Response', type: 'main', index: 0 }]] },
    'Build Response': { main: [[{ node: 'Respond to Webhook', type: 'main', index: 0 }]] },
  };

  return { name: CONTACT_FORM_WORKFLOW_NAME, nodes, connections };
}
