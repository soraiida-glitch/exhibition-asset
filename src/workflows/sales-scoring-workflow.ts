export const SALES_SCORING_WORKFLOW_NAME = '[kintone] 営業評価';
export const SALES_SCORING_PATH = 'exhibition-sales-scoring';

export interface SalesScoringWorkflowConfig {
  webhookSecret: string;
  openaiApiKey: string;
  kintoneBaseUrl: string;
  opportunityAppId: number;
  opportunityApiToken: string;
  dailyAdviceAppId: number;
  dailyAdviceApiToken: string;
  meetingLogAppId: number;
  meetingLogApiToken: string;
  assigneeAppId: number;
  assigneeApiToken: string;
  salesScoreAppId: number;
  salesScoreApiToken: string;
}

const SCORE_SYSTEM_PROMPT = `あなたは営業マネージャーのアシスタントです。営業担当者の活動データから、行動スコア(0〜100)と
成果スコア(0〜100)を算出し、育成につながる短いコメントを生成してください。厳しすぎない、
前向きな表現を心がけてください。

回答は必ず次のJSON形式のみで返してください(説明文やコードブロックは不要):
{
  "behavior_score": 0から100の整数(日々のアクション実行状況を踏まえた行動評価),
  "outcome_score": 0から100の整数(案件の成果を踏まえた評価),
  "ai_comment": "200〜300字程度の日本語コメント"
}`;

function offsetPositions(startX: number, y: number, count: number, gap = 220): [number, number][] {
  return Array.from({ length: count }, (_, i) => [startX + i * gap, y]);
}

export function buildSalesScoringWorkflow(config: SalesScoringWorkflowConfig) {
  const positions = offsetPositions(0, 0, 16);
  let p = 0;
  const nextPos = () => positions[p++];

  const opportunityHeader = () => [{ name: 'X-Cybozu-API-Token', value: config.opportunityApiToken }];
  const dailyAdviceHeader = () => [{ name: 'X-Cybozu-API-Token', value: config.dailyAdviceApiToken }];
  const meetingLogHeader = () => [{ name: 'X-Cybozu-API-Token', value: config.meetingLogApiToken }];
  const assigneeHeader = () => [{ name: 'X-Cybozu-API-Token', value: config.assigneeApiToken }];
  const salesScoreHeader = () => [{ name: 'X-Cybozu-API-Token', value: config.salesScoreApiToken }];
  const openaiHeaders = () => [
    { name: 'Authorization', value: `Bearer ${config.openaiApiKey}` },
    { name: 'Content-Type', value: 'application/json' },
  ];

  const nodes = [
    {
      id: 'webhook',
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: nextPos(),
      parameters: { httpMethod: 'POST', path: SALES_SCORING_PATH, responseMode: 'responseNode' },
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
      // Scoring every active assignee (each involving several kintone reads + a GPT-4o call) can
      // take longer than a webhook caller should block on — same "respond now, keep working"
      // pattern as meeting-log-workflow.ts. Unlike Salesforce's version (capped at 50 reps per run
      // by Apex's @future callout governor limit), n8n has no such ceiling: every active assignee
      // is scored within this one execution via n8n's normal per-item node iteration.
      id: 'respond_started',
      name: 'Respond Started',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: [positions[2][0] + 220, positions[2][1] - 200] as [number, number],
      parameters: {
        respondWith: 'json',
        responseBody: '={{ { started: true } }}',
      },
    },
    {
      id: 'fetch_active_assignees',
      name: 'Fetch Active Assignees',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'GET',
        url: `${config.kintoneBaseUrl}/k/v1/records.json`,
        sendHeaders: true,
        headerParameters: { parameters: assigneeHeader() },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'app', value: String(config.assigneeAppId) },
            { name: 'query', value: 'status in ("有効") limit 100' },
          ],
        },
        options: {},
      },
    },
    {
      id: 'split_assignees',
      name: 'Split Assignees',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
const records = $json.records || [];
return records.map((r) => ({ json: {
  assigneeCode: (r.assignee_code && r.assignee_code.value) || '',
  assigneeName: (r.assignee_name && r.assignee_name.value) || '',
} }));
`.trim(),
      },
    },
    {
      id: 'fetch_deals',
      name: 'Fetch Deals',
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
            {
              name: 'query',
              // Matches by assigneeCode, not assigneeName: daily-advice-workflow.ts writes
              // exhibition_案件's owner field as the assignee's *code* (it's what the chat's
              // "今日のやること" lookup joins on via kintone.getLoginUser().code), and for a real
              // login whose display name differs from its code (e.g. a shared service account),
              // matching by name here would silently find zero deals.
              value: '={{ "owner = \\"" + $json.assigneeCode.replace(/"/g, "") + "\\" limit 100" }}',
            },
          ],
        },
        options: {},
      },
    },
    {
      id: 'build_deal_context',
      name: 'Build Deal Context',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        // Code nodes default to "run once for all items", which silently collapses the 3-item
        // per-assignee fan-out from "Split Assignees" down to a single execution over item[0]
        // only. This code assumes $json is "the current item", so it must run once per item.
        mode: 'runOnceForEachItem',
        jsCode: `
const deals = $json.records || [];
const dealCount = deals.length;
const closedWonCount = deals.filter((d) => d.stage && d.stage.value === '成約').length;
const dealIds = deals.map((d) => d['$id'] && d['$id'].value).filter(Boolean);
return { json: {
  assigneeCode: $('Split Assignees').item.json.assigneeCode,
  assigneeName: $('Split Assignees').item.json.assigneeName,
  dealCount,
  closedWonCount,
  dealIdsQuery: dealIds.length ? dealIds.map((id) => '"' + id + '"').join(',') : '',
} };
`.trim(),
      },
    },
    {
      id: 'fetch_daily_advices',
      name: 'Fetch Daily Advices',
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
                // $('Verify Secret').first() (not the legacy $node[...] accessor) sidesteps n8n's
                // paired-item validation — "Verify Secret" only ever emits one global item, but
                // this branch may be running as item index 1/2 of the per-assignee fan-out, and
                // the legacy accessor's implicit pairedItem check throws on that index mismatch.
                '={{ "advice_date >= \\"" + $(\'Verify Secret\').first().json.periodStart + "\\" and advice_date <= \\"" + $(\'Verify Secret\').first().json.periodEnd + "\\" and assignee_code = \\"" + $json.assigneeCode.replace(/"/g, "") + "\\" limit 100" }}',
            },
          ],
        },
        options: {},
      },
    },
    {
      id: 'fetch_meeting_logs',
      name: 'Fetch Meeting Logs',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'GET',
        url: `${config.kintoneBaseUrl}/k/v1/records.json`,
        sendHeaders: true,
        headerParameters: { parameters: meetingLogHeader() },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'app', value: String(config.meetingLogAppId) },
            {
              name: 'query',
              value:
                '={{ $(\'Build Deal Context\').item.json.dealIdsQuery ? ("deal_record_id in (" + $(\'Build Deal Context\').item.json.dealIdsQuery + ") limit 100") : "id = 0" }}',
            },
          ],
        },
        options: {},
      },
    },
    {
      id: 'aggregate_metrics',
      name: 'Aggregate Metrics',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        mode: 'runOnceForEachItem',
        jsCode: `
const context = $('Build Deal Context').item.json;
const dailyAdvices = $('Fetch Daily Advices').item.json.records || [];
const meetingLogs = $json.records || [];

// Deterministic (no AI) execution-rate calc mirroring Salesforce-asset's original formula:
// executed actions score 1.0; unexecuted actions decay the longer they go unaddressed.
const today = new Date();
let scoreSum = 0;
let actionCount = 0;
const neglectedActions = [];
for (const advice of dailyAdvices) {
  const adviceDate = new Date((advice.advice_date && advice.advice_date.value) || today);
  const daysElapsed = Math.floor((today.getTime() - adviceDate.getTime()) / (1000 * 60 * 60 * 24));
  let parsed;
  try {
    parsed = JSON.parse((advice.advice_json && advice.advice_json.value) || '{}');
  } catch (e) {
    parsed = {};
  }
  for (const action of parsed.actions || []) {
    let score;
    if (action.executed) {
      score = 1.0;
    } else {
      let penalty;
      if (daysElapsed <= 3) penalty = 0;
      else if (daysElapsed === 4) penalty = 0.2;
      else if (daysElapsed === 5) penalty = 0.4;
      else if (daysElapsed === 6) penalty = 0.6;
      else if (daysElapsed === 7) penalty = 0.8;
      else penalty = 1.0;
      score = 1 - penalty;
      if (neglectedActions.length < 10) neglectedActions.push(action.action || '');
    }
    scoreSum += score;
    actionCount++;
  }
}
const execRate = actionCount > 0 ? Math.round((scoreSum / actionCount) * 100) : 0;

const sentimentScores = meetingLogs
  .map((m) => Number(m.sentiment_score && m.sentiment_score.value))
  .filter((n) => !Number.isNaN(n));
const avgSentiment = sentimentScores.length
  ? Math.round((sentimentScores.reduce((a, b) => a + b, 0) / sentimentScores.length) * 10) / 10
  : null;

return { json: {
  assigneeCode: context.assigneeCode,
  assigneeName: context.assigneeName,
  dealCount: context.dealCount,
  closedWonCount: context.closedWonCount,
  execRate,
  meetingLogCount: meetingLogs.length,
  avgSentiment,
  neglectedActions,
} };
`.trim(),
      },
    },
    {
      id: 'generate_score',
      name: 'Generate Behavior/Outcome Score',
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
        jsonBody: `={{ JSON.stringify({ model: "gpt-4o", response_format: { type: "json_object" }, messages: [ { role: "system", content: ${JSON.stringify(SCORE_SYSTEM_PROMPT)} }, { role: "user", content: JSON.stringify($json) } ] }) }}`,
        options: {},
      },
    },
    {
      id: 'calculate_total_and_rank',
      name: 'Calculate Total & Rank',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        mode: 'runOnceForEachItem',
        jsCode: `
const metrics = $('Aggregate Metrics').item.json;
const FALLBACK = { behavior_score: 0, outcome_score: 0, ai_comment: '' };
let parsed;
try {
  parsed = JSON.parse($json.choices[0].message.content);
} catch (e) {
  parsed = FALLBACK;
}
if (!parsed || typeof parsed !== 'object') parsed = FALLBACK;

const behaviorScore = parsed.behavior_score != null ? parsed.behavior_score : FALLBACK.behavior_score;
const outcomeScore = parsed.outcome_score != null ? parsed.outcome_score : FALLBACK.outcome_score;
const totalScore = Math.round(metrics.execRate * 0.4 + behaviorScore * 0.3 + outcomeScore * 0.3);

let rank;
if (totalScore >= 85) rank = 'S';
else if (totalScore >= 70) rank = 'A';
else if (totalScore >= 55) rank = 'B';
else if (totalScore >= 40) rank = 'C';
else rank = 'D';

return { json: {
  assigneeCode: metrics.assigneeCode,
  assigneeName: metrics.assigneeName,
  execRate: metrics.execRate,
  behaviorScore,
  outcomeScore,
  totalScore,
  rank,
  aiComment: parsed.ai_comment || FALLBACK.ai_comment,
  detailJson: JSON.stringify(metrics),
  periodStart: $('Verify Secret').first().json.periodStart,
  periodEnd: $('Verify Secret').first().json.periodEnd,
} };
`.trim(),
      },
    },
    {
      id: 'check_existing_score',
      name: 'Check Existing Score',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'GET',
        url: `${config.kintoneBaseUrl}/k/v1/records.json`,
        sendHeaders: true,
        headerParameters: { parameters: salesScoreHeader() },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'app', value: String(config.salesScoreAppId) },
            {
              name: 'query',
              value:
                '={{ "assignee_code = \\"" + $json.assigneeCode.replace(/"/g, "") + "\\" and period_start = \\"" + $json.periodStart + "\\" and period_end = \\"" + $json.periodEnd + "\\" limit 1" }}',
            },
          ],
        },
        options: {},
      },
    },
    {
      id: 'score_exists_if',
      name: 'Score Exists?',
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
      id: 'update_sales_score',
      name: 'Update Sales Score',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [positions[13][0] + 220, positions[13][1] - 100] as [number, number],
      parameters: {
        method: 'PUT',
        url: `${config.kintoneBaseUrl}/k/v1/record.json`,
        sendHeaders: true,
        headerParameters: {
          parameters: [...salesScoreHeader(), { name: 'Content-Type', value: 'application/json' }],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ app: ${config.salesScoreAppId}, id: Number($json.records[0].$id.value), record: { exec_rate: { value: $('Calculate Total & Rank').item.json.execRate }, behavior_score: { value: $('Calculate Total & Rank').item.json.behaviorScore }, outcome_score: { value: $('Calculate Total & Rank').item.json.outcomeScore }, total_score: { value: $('Calculate Total & Rank').item.json.totalScore }, score_rank: { value: $('Calculate Total & Rank').item.json.rank }, ai_comment: { value: $('Calculate Total & Rank').item.json.aiComment }, detail_json: { value: $('Calculate Total & Rank').item.json.detailJson }, status: { value: "完了" }, generated_at: { value: new Date().toISOString() } } }) }}`,
        options: {},
      },
    },
    {
      id: 'create_sales_score',
      name: 'Create Sales Score',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [positions[13][0] + 220, positions[13][1] + 100] as [number, number],
      parameters: {
        method: 'POST',
        url: `${config.kintoneBaseUrl}/k/v1/record.json`,
        sendHeaders: true,
        headerParameters: {
          parameters: [...salesScoreHeader(), { name: 'Content-Type', value: 'application/json' }],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ app: ${config.salesScoreAppId}, record: { assignee_code: { value: $('Calculate Total & Rank').item.json.assigneeCode }, assignee_name: { value: $('Calculate Total & Rank').item.json.assigneeName }, period_start: { value: $('Calculate Total & Rank').item.json.periodStart }, period_end: { value: $('Calculate Total & Rank').item.json.periodEnd }, exec_rate: { value: $('Calculate Total & Rank').item.json.execRate }, behavior_score: { value: $('Calculate Total & Rank').item.json.behaviorScore }, outcome_score: { value: $('Calculate Total & Rank').item.json.outcomeScore }, total_score: { value: $('Calculate Total & Rank').item.json.totalScore }, score_rank: { value: $('Calculate Total & Rank').item.json.rank }, ai_comment: { value: $('Calculate Total & Rank').item.json.aiComment }, detail_json: { value: $('Calculate Total & Rank').item.json.detailJson }, status: { value: "完了" }, generated_at: { value: new Date().toISOString() } } }) }}`,
        options: {},
      },
    },
  ];

  const connections = {
    Webhook: { main: [[{ node: 'Verify Secret', type: 'main', index: 0 }]] },
    'Verify Secret': { main: [[{ node: 'Secret Valid?', type: 'main', index: 0 }]] },
    'Secret Valid?': {
      main: [
        [
          { node: 'Respond Started', type: 'main', index: 0 },
          { node: 'Fetch Active Assignees', type: 'main', index: 0 },
        ],
        [{ node: 'Respond Unauthorized', type: 'main', index: 0 }],
      ],
    },
    'Fetch Active Assignees': { main: [[{ node: 'Split Assignees', type: 'main', index: 0 }]] },
    'Split Assignees': { main: [[{ node: 'Fetch Deals', type: 'main', index: 0 }]] },
    'Fetch Deals': { main: [[{ node: 'Build Deal Context', type: 'main', index: 0 }]] },
    'Build Deal Context': { main: [[{ node: 'Fetch Daily Advices', type: 'main', index: 0 }]] },
    'Fetch Daily Advices': { main: [[{ node: 'Fetch Meeting Logs', type: 'main', index: 0 }]] },
    'Fetch Meeting Logs': { main: [[{ node: 'Aggregate Metrics', type: 'main', index: 0 }]] },
    'Aggregate Metrics': { main: [[{ node: 'Generate Behavior/Outcome Score', type: 'main', index: 0 }]] },
    'Generate Behavior/Outcome Score': {
      main: [[{ node: 'Calculate Total & Rank', type: 'main', index: 0 }]],
    },
    'Calculate Total & Rank': { main: [[{ node: 'Check Existing Score', type: 'main', index: 0 }]] },
    'Check Existing Score': { main: [[{ node: 'Score Exists?', type: 'main', index: 0 }]] },
    'Score Exists?': {
      main: [
        [{ node: 'Update Sales Score', type: 'main', index: 0 }],
        [{ node: 'Create Sales Score', type: 'main', index: 0 }],
      ],
    },
  };

  return { name: SALES_SCORING_WORKFLOW_NAME, nodes, connections };
}
