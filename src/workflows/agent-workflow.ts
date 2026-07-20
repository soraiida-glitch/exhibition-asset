import {
  ACCOUNT_INDUSTRY_OPTIONS,
  ACCOUNT_STATUS_OPTIONS,
  OPPORTUNITY_STAGE_OPTIONS,
} from '../apps/schema';

export const AGENT_WORKFLOW_NAME = '[kintone] 秘書AIエージェント';
export const AGENT_WEBHOOK_PATH = 'exhibition-agent-chat';

export interface AgentWorkflowConfig {
  webhookSecret: string;
  openaiApiKey: string;
  kintoneBaseUrl: string;
  accountAppId: number;
  accountApiToken: string;
  opportunityAppId: number;
  opportunityApiToken: string;
  leadAppId: number;
  leadApiToken: string;
  conversationLogAppId: number;
  conversationLogApiToken: string;
  dailyAdviceAppId: number;
  dailyAdviceApiToken: string;
}

const PLANNER_SYSTEM_PROMPT = `あなたはCRMチャットの検索プランナーです。ユーザーの発言と直近の会話履歴から、
kintoneのレコード検索に使うキーワードを1つ抽出してください。会社名・案件名・人名などの
固有名詞を優先します。固有名詞が見つからない場合は空文字を返してください。

必ず次のJSON形式のみで回答してください(説明文は不要):
{"searchTerm": "抽出したキーワード", "intent": "search" | "edit" | "chat"}

- intent: レコードの検索・参照が必要なら "search"、既存レコードの編集や新規登録の依頼なら "edit"、
  それ以外の一般的な会話なら "chat"`;

const MAIN_SYSTEM_PROMPT = `あなたはkintone上のCRM「exhibition-asset」の営業秘書AIです。
以下のkintone検索結果(exhibition_取引先/exhibition_案件/exhibition_リードの一部レコード、
および本日分のexhibition_デイリーアドバイス——n8nのCronが日次生成済み)と会話履歴を参考に、
ユーザーの質問に日本語で簡潔に答えてください。「今日やることを教えて」のような質問には
デイリーアドバイスのadvice_json(actions配列)を優先度順に整理して答えてください。

回答は必ず次のJSON形式のみで返してください(説明文やコードブロックは不要):
{
  "answer": "回答本文(Markdown可)",
  "referencedRecords": [{"label": "表示名", "recordId": "レコードID", "appName": "取引先|案件|リード"}],
  "action": "show_form_account" | "show_form_edit_account" | "show_form_opportunity" | "show_form_edit_opportunity" | null,
  "prefill": { "_recordId": "編集時のみ設定", "...": "フィールドコード: 値" }
}

prefillのキーは必ず以下のフィールドコード(英数字)を使ってください。日本語のラベルや
独自のキー名を使わないこと。値が不明なフィールドは省略してください。

- action が show_form_account / show_form_edit_account の場合、使えるフィールドコードは:
  company_name(会社名、自由入力), industry(業種、以下の選択肢から一字一句そのまま選ぶこと: ${ACCOUNT_INDUSTRY_OPTIONS.join(' / ')} — 当てはまらない場合はフィールドを省略), contact_name(担当者名、自由入力), phone(電話番号、自由入力),
  email(メールアドレス、自由入力), status(ステータス、以下の選択肢から一字一句そのまま選ぶこと: ${ACCOUNT_STATUS_OPTIONS.join(' / ')} — 不明ならフィールドを省略), memo(メモ、自由入力)
- action が show_form_opportunity / show_form_edit_opportunity の場合、使えるフィールドコードは:
  deal_name(案件名、自由入力), account(取引先の会社名、自由入力), amount(金額、自由入力), stage(フェーズ、以下の選択肢から一字一句そのまま選ぶこと: ${OPPORTUNITY_STAGE_OPTIONS.join(' / ')} — 不明ならフィールドを省略),
  close_date(クロージング予定日、YYYY-MM-DD形式), owner(担当者、自由入力), description(概要、自由入力)
- industry/status/stageは選択肢に一致しない値を絶対に入れないこと(kintoneがエラーになります)。
  ユーザーの発言が選択肢のどれにも当てはまらない場合は、そのフィールド自体をprefillに含めないこと。

- ユーザーが新規の取引先・案件登録を依頼したら action に "show_form_account" または
  "show_form_opportunity" を設定し、聞き取れた内容を上記フィールドコードで prefill に入れてください。
- ユーザーが既存レコードの編集(検索結果に含まれるレコード)を依頼したら action に
  "show_form_edit_account" または "show_form_edit_opportunity" を設定し、prefill._recordId に
  対象のレコードID、他のフィールドは既存値+変更後の値を上記フィールドコードで入れてください。
- 上記以外の質問には action を null にしてください。
- リード(exhibition_リード)の編集・登録フォームは未対応です。リードについては検索結果を
  回答本文で説明するのみにしてください。`;

function offsetPositions(startX: number, y: number, count: number, gap = 220): [number, number][] {
  return Array.from({ length: count }, (_, i) => [startX + i * gap, y]);
}

export function buildAgentWorkflow(config: AgentWorkflowConfig) {
  const positions = offsetPositions(0, 300, 15);
  let p = 0;
  const nextPos = () => positions[p++];

  const kintoneHeader = (token: string) => [{ name: 'X-Cybozu-API-Token', value: token }];
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
      parameters: {
        httpMethod: 'POST',
        path: AGENT_WEBHOOK_PATH,
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
      id: 'query_planner',
      name: 'Query Planner',
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
        jsonBody: `={{ JSON.stringify({ model: "gpt-4o-mini", response_format: { type: "json_object" }, messages: [ { role: "system", content: ${JSON.stringify(PLANNER_SYSTEM_PROMPT)} }, { role: "user", content: JSON.stringify({ message: $json.body.message, history: ($json.body.history || []).slice(-6) }) } ] }) }}`,
        options: {},
      },
    },
    {
      id: 'parse_query_plan',
      name: 'Parse Query Plan',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
const original = $node["Verify Secret"].json.body || {};
let plan;
try {
  plan = JSON.parse($json.choices[0].message.content);
} catch (e) {
  plan = { searchTerm: original.message || '', intent: 'chat' };
}
return [{ json: { ...original, plan } }];
`.trim(),
      },
    },
    {
      id: 'search_account',
      name: 'Search Account',
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
              value:
                '={{ $json.plan.searchTerm ? ("company_name like \\"" + $json.plan.searchTerm.replace(/"/g, "") + "\\" or contact_name like \\"" + $json.plan.searchTerm.replace(/"/g, "") + "\\" limit 5") : "limit 5" }}',
            },
          ],
        },
        options: {},
      },
    },
    {
      id: 'search_opportunity',
      name: 'Search Opportunity',
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
                '={{ $node["Parse Query Plan"].json.plan.searchTerm ? ("deal_name like \\"" + $node["Parse Query Plan"].json.plan.searchTerm.replace(/"/g, "") + "\\" or account like \\"" + $node["Parse Query Plan"].json.plan.searchTerm.replace(/"/g, "") + "\\" limit 5") : "limit 5" }}',
            },
          ],
        },
        options: {},
      },
    },
    {
      id: 'search_lead',
      name: 'Search Lead',
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
                '={{ $node["Parse Query Plan"].json.plan.searchTerm ? ("lead_name like \\"" + $node["Parse Query Plan"].json.plan.searchTerm.replace(/"/g, "") + "\\" or company_name like \\"" + $node["Parse Query Plan"].json.plan.searchTerm.replace(/"/g, "") + "\\" limit 5") : "limit 5" }}',
            },
          ],
        },
        options: {},
      },
    },
    {
      id: 'search_daily_advice',
      name: 'Search Daily Advice',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'GET',
        url: `${config.kintoneBaseUrl}/k/v1/records.json`,
        sendHeaders: true,
        headerParameters: { parameters: kintoneHeader(config.dailyAdviceApiToken) },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'app', value: String(config.dailyAdviceAppId) },
            {
              name: 'query',
              value:
                '={{ "advice_date = \\"" + new Date().toISOString().slice(0, 10) + "\\" and assignee_code = \\"" + ($node["Parse Query Plan"].json.userCode || "").replace(/"/g, "") + "\\" limit 1" }}',
            },
          ],
        },
        options: {},
      },
    },
    {
      id: 'merge_search_results',
      name: 'Merge Search Results',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
const original = $node["Parse Query Plan"].json;
return [{ json: {
  ...original,
  kintoneContext: {
    accountRecords: ($node["Search Account"].json.records || []),
    opportunityRecords: ($node["Search Opportunity"].json.records || []),
    leadRecords: ($node["Search Lead"].json.records || []),
    dailyAdviceRecords: ($node["Search Daily Advice"].json.records || []),
  },
} }];
`.trim(),
      },
    },
    {
      id: 'main_ai',
      name: 'Main AI',
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
        jsonBody: `={{ JSON.stringify({ model: "gpt-4o", response_format: { type: "json_object" }, messages: [ { role: "system", content: ${JSON.stringify(MAIN_SYSTEM_PROMPT)} }, { role: "user", content: JSON.stringify({ message: $json.message, history: ($json.history || []).slice(-12), lastKintoneContext: $json.lastKintoneContext || null, kintoneContext: $json.kintoneContext }) } ] }) }}`,
        options: {},
      },
    },
    {
      id: 'format_response',
      name: 'Format Response',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
const original = $node["Merge Search Results"].json;
const ALLOWED_ACTIONS = ["show_form_account", "show_form_edit_account", "show_form_opportunity", "show_form_edit_opportunity"];
let parsed;
try {
  parsed = JSON.parse($json.choices[0].message.content);
} catch (e) {
  const raw = ($json.choices && $json.choices[0] && $json.choices[0].message && $json.choices[0].message.content) || "";
  parsed = { answer: raw || "申し訳ございません、応答の生成に失敗しました。" };
}
if (parsed.action && ALLOWED_ACTIONS.indexOf(parsed.action) === -1) {
  delete parsed.action;
  delete parsed.prefill;
}
return [{ json: {
  response: parsed,
  sessionId: original.sessionId || "",
  userName: original.userName || "",
  message: original.message || "",
} }];
`.trim(),
      },
    },
    {
      id: 'log_conversation',
      name: 'Log Conversation',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      onError: 'continueRegularOutput',
      parameters: {
        method: 'POST',
        url: `${config.kintoneBaseUrl}/k/v1/record.json`,
        sendHeaders: true,
        headerParameters: {
          parameters: [
            ...kintoneHeader(config.conversationLogApiToken),
            { name: 'Content-Type', value: 'application/json' },
          ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ app: ${config.conversationLogAppId}, record: { session_id: { value: $json.sessionId }, user_name: { value: $json.userName }, message: { value: $json.message }, ai_answer: { value: $json.response && $json.response.answer || "" }, status: { value: "完了" } } }) }}`,
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
        responseBody: '={{ $node["Format Response"].json.response }}',
      },
    },
  ];

  const connections = {
    Webhook: { main: [[{ node: 'Verify Secret', type: 'main', index: 0 }]] },
    'Verify Secret': { main: [[{ node: 'Secret Valid?', type: 'main', index: 0 }]] },
    'Secret Valid?': {
      main: [
        [{ node: 'Query Planner', type: 'main', index: 0 }],
        [{ node: 'Respond Unauthorized', type: 'main', index: 0 }],
      ],
    },
    'Query Planner': { main: [[{ node: 'Parse Query Plan', type: 'main', index: 0 }]] },
    'Parse Query Plan': { main: [[{ node: 'Search Account', type: 'main', index: 0 }]] },
    'Search Account': { main: [[{ node: 'Search Opportunity', type: 'main', index: 0 }]] },
    'Search Opportunity': { main: [[{ node: 'Search Lead', type: 'main', index: 0 }]] },
    'Search Lead': { main: [[{ node: 'Search Daily Advice', type: 'main', index: 0 }]] },
    'Search Daily Advice': { main: [[{ node: 'Merge Search Results', type: 'main', index: 0 }]] },
    'Merge Search Results': { main: [[{ node: 'Main AI', type: 'main', index: 0 }]] },
    'Main AI': { main: [[{ node: 'Format Response', type: 'main', index: 0 }]] },
    'Format Response': { main: [[{ node: 'Log Conversation', type: 'main', index: 0 }]] },
    'Log Conversation': { main: [[{ node: 'Respond to Webhook', type: 'main', index: 0 }]] },
  };

  return { name: AGENT_WORKFLOW_NAME, nodes, connections };
}
