export const DAILY_ADVICE_WORKFLOW_NAME = '[kintone] デイリーアドバイス生成';
export const DAILY_ADVICE_WEBHOOK_PATH = 'exhibition-daily-advice-regenerate';

export interface DailyAdviceWorkflowConfig {
  webhookSecret: string;
  openaiApiKey: string;
  kintoneBaseUrl: string;
  opportunityAppId: number;
  opportunityApiToken: string;
  dailyAdviceAppId: number;
  dailyAdviceApiToken: string;
}

function offsetPositions(startX: number, y: number, count: number, gap = 220): [number, number][] {
  return Array.from({ length: count }, (_, i) => [startX + i * gap, y]);
}

export function buildDailyAdviceWorkflow(config: DailyAdviceWorkflowConfig) {
  const positions = offsetPositions(0, 300, 14);
  let p = 0;
  const nextPos = () => positions[p++];

  const opportunityHeader = () => [
    { name: 'X-Cybozu-API-Token', value: config.opportunityApiToken },
  ];
  const dailyAdviceHeader = () => [
    { name: 'X-Cybozu-API-Token', value: config.dailyAdviceApiToken },
  ];
  const openaiHeaders = () => [
    { name: 'Authorization', value: `Bearer ${config.openaiApiKey}` },
    { name: 'Content-Type', value: 'application/json' },
  ];

  const nodes = [
    {
      id: 'schedule_trigger',
      name: 'Schedule Trigger',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: nextPos(),
      parameters: {
        rule: { interval: [{ field: 'cronExpression', expression: '0 7 * * *' }] },
      },
    },
    {
      // Lets a demo organizer force-regenerate today's advice on demand (e.g. right before a
      // customer demo) instead of only ever running at the fixed 7:00 cron time — same
      // "manual trigger alongside the schedule" pattern as sales-scoring-workflow.ts.
      id: 'manual_webhook',
      name: 'Manual Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: nextPos(),
      parameters: { httpMethod: 'POST', path: DAILY_ADVICE_WEBHOOK_PATH, responseMode: 'responseNode' },
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
return [{ json: { valid: provided === expected } }];
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
        conditions: { boolean: [{ value1: '={{$json.valid}}', value2: true }] },
      },
    },
    {
      id: 'respond_unauthorized',
      name: 'Respond Unauthorized',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: nextPos(),
      parameters: {
        respondWith: 'json',
        responseBody: '={{ { "error": "invalid webhook secret" } }}',
        options: { responseCode: 401 },
      },
    },
    {
      id: 'respond_started',
      name: 'Respond Started',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: nextPos(),
      parameters: {
        respondWith: 'json',
        responseBody: '={{ { started: true } }}',
      },
    },
    {
      id: 'fetch_open_deals',
      name: 'Fetch Open Deals',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'GET',
        url: `${config.kintoneBaseUrl}/k/v1/records.json`,
        sendHeaders: true,
        headerParameters: { parameters: opportunityHeader() },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'app', value: String(config.opportunityAppId) },
            { name: 'query', value: 'stage not in ("成約","失注") order by $id asc limit 200' },
          ],
        },
        options: {},
      },
    },
    {
      id: 'group_by_owner',
      name: 'Group By Owner',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
const deals = $json.records || [];
const groups = {};
for (const deal of deals) {
  const owner = (deal.owner && deal.owner.value) || '(未設定)';
  if (!groups[owner]) groups[owner] = [];
  groups[owner].push(deal);
}
return Object.entries(groups).map(([owner, ownerDeals]) => ({ json: { owner, deals: ownerDeals } }));
`.trim(),
      },
    },
    {
      id: 'build_advice_request',
      name: 'Build Advice Request',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        // Code nodes default to "run once for all items", which would silently collapse the
        // per-owner fan-out from "Group By Owner" down to a single execution over item[0] only
        // (confirmed live: every day's advice was generated for the same one owner).
        mode: 'runOnceForEachItem',
        jsCode: `
const owner = $json.owner;
const deals = $json.deals;
const dealsText = deals.map((d) => {
  const id = (d.$id && d.$id.value) || '';
  const name = (d.deal_name && d.deal_name.value) || '';
  const account = (d.account && d.account.value) || '(取引先未設定)';
  const stage = (d.stage && d.stage.value) || '';
  const amount = (d.amount && d.amount.value) || '';
  const closeDate = (d.close_date && d.close_date.value) || '';
  return "- [ID:" + id + "] " + name + " / 取引先:" + account + " (フェーズ:" + stage + ", 金額:" + amount + "円, クロージング予定:" + closeDate + ")";
}).join('\\n');

const prompt = "あなたは営業マネージャーのアシスタントです。担当者「" + owner + "」が現在担当している" +
  "以下の案件一覧から、本日優先して取り組むべきアクションを3〜7個、優先度付きで提案してください。\\n\\n" +
  "案件一覧:\\n" + dealsText + "\\n\\n" +
  "actionとreasonの文章には、案件名だけでなく取引先名(会社名)も必ず含めてください" +
  "(例: 「〇〇株式会社向けの△△案件の提案を進める」)。\\n\\n" +
  "必ず次のJSON形式のみで回答してください(説明文は不要):\\n" +
  '{"context_summary": "50字以内の要約", "actions": [{"priority": "high|medium|low", "action": "...", "reason": "...", "relatedRecord": "案件名", "relatedRecordId": "案件一覧の[ID:xxx]の値(該当なければ空文字)", "executed": false}]}';

return { json: { owner, prompt } };
`.trim(),
      },
    },
    {
      id: 'generate_advice_ai',
      name: 'Generate Advice AI',
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
        jsonBody:
          '={{ JSON.stringify({ model: "gpt-4o-mini", response_format: { type: "json_object" }, messages: [ { role: "user", content: $json.prompt } ] }) }}',
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
        mode: 'runOnceForEachItem',
        jsCode: `
const owner = $('Build Advice Request').item.json.owner;
let parsed;
try {
  parsed = JSON.parse($json.choices[0].message.content);
} catch (e) {
  parsed = { context_summary: '', actions: [] };
}
const today = new Date().toISOString().slice(0, 10);
return { json: {
  owner,
  today,
  contextSummary: parsed.context_summary || '',
  adviceJson: JSON.stringify(parsed),
} };
`.trim(),
      },
    },
    {
      id: 'check_existing_record',
      name: 'Check Existing Record',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'GET',
        url: `${config.kintoneBaseUrl}/k/v1/records.json`,
        sendHeaders: true,
        headerParameters: { parameters: dailyAdviceHeader() },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'app', value: String(config.dailyAdviceAppId) },
            {
              name: 'query',
              value:
                '={{ "advice_date = \\"" + $json.today + "\\" and assignee_code = \\"" + $json.owner.replace(/"/g, "") + "\\" limit 1" }}',
            },
          ],
        },
        options: {},
      },
    },
    {
      id: 'record_exists_if',
      name: 'Record Exists?',
      type: 'n8n-nodes-base.if',
      typeVersion: 1,
      position: nextPos(),
      parameters: {
        conditions: {
          number: [{ value1: '={{$json.records.length}}', operation: 'larger', value2: 0 }],
        },
      },
    },
    {
      id: 'update_daily_advice',
      name: 'Update DailyAdvice',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [positions[12][0] + 220, positions[12][1] - 100] as [number, number],
      parameters: {
        method: 'PUT',
        url: `${config.kintoneBaseUrl}/k/v1/record.json`,
        sendHeaders: true,
        headerParameters: {
          parameters: [...dailyAdviceHeader(), { name: 'Content-Type', value: 'application/json' }],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ app: ${config.dailyAdviceAppId}, id: Number($json.records[0].$id.value), record: { context_summary: { value: $('Parse Advice').item.json.contextSummary }, advice_json: { value: $('Parse Advice').item.json.adviceJson }, status: { value: "完了" } } }) }}`,
        options: {},
      },
    },
    {
      id: 'create_daily_advice',
      name: 'Create DailyAdvice',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [positions[12][0] + 220, positions[12][1] + 100] as [number, number],
      parameters: {
        method: 'POST',
        url: `${config.kintoneBaseUrl}/k/v1/record.json`,
        sendHeaders: true,
        headerParameters: {
          parameters: [...dailyAdviceHeader(), { name: 'Content-Type', value: 'application/json' }],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ app: ${config.dailyAdviceAppId}, record: { advice_date: { value: $('Parse Advice').item.json.today }, assignee_code: { value: $('Parse Advice').item.json.owner }, assignee_name: { value: $('Parse Advice').item.json.owner }, context_summary: { value: $('Parse Advice').item.json.contextSummary }, advice_json: { value: $('Parse Advice').item.json.adviceJson }, status: { value: "完了" } } }) }}`,
        options: {},
      },
    },
  ];

  const connections = {
    'Schedule Trigger': { main: [[{ node: 'Fetch Open Deals', type: 'main', index: 0 }]] },
    'Manual Webhook': { main: [[{ node: 'Verify Secret', type: 'main', index: 0 }]] },
    'Verify Secret': { main: [[{ node: 'Secret Valid?', type: 'main', index: 0 }]] },
    'Secret Valid?': {
      main: [
        [
          { node: 'Respond Started', type: 'main', index: 0 },
          { node: 'Fetch Open Deals', type: 'main', index: 0 },
        ],
        [{ node: 'Respond Unauthorized', type: 'main', index: 0 }],
      ],
    },
    'Fetch Open Deals': { main: [[{ node: 'Group By Owner', type: 'main', index: 0 }]] },
    'Group By Owner': { main: [[{ node: 'Build Advice Request', type: 'main', index: 0 }]] },
    'Build Advice Request': { main: [[{ node: 'Generate Advice AI', type: 'main', index: 0 }]] },
    'Generate Advice AI': { main: [[{ node: 'Parse Advice', type: 'main', index: 0 }]] },
    'Parse Advice': { main: [[{ node: 'Check Existing Record', type: 'main', index: 0 }]] },
    'Check Existing Record': { main: [[{ node: 'Record Exists?', type: 'main', index: 0 }]] },
    'Record Exists?': {
      main: [
        [{ node: 'Update DailyAdvice', type: 'main', index: 0 }],
        [{ node: 'Create DailyAdvice', type: 'main', index: 0 }],
      ],
    },
  };

  return { name: DAILY_ADVICE_WORKFLOW_NAME, nodes, connections };
}
