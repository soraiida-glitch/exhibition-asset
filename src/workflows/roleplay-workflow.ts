import { recordToTextEmbeddable } from '../lib/record-to-text';

export const ROLEPLAY_WORKFLOW_NAME = '[kintone] ロールプレイ';
export const ROLEPLAY_START_PATH = 'exhibition-roleplay-start';
export const ROLEPLAY_CHAT_PATH = 'exhibition-roleplay-chat';
export const ROLEPLAY_FEEDBACK_PATH = 'exhibition-roleplay-feedback';

export interface RoleplayWorkflowConfig {
  webhookSecret: string;
  openaiApiKey: string;
  kintoneBaseUrl: string;
  opportunityAppId: number;
  opportunityApiToken: string;
  roleplaySessionAppId: number;
  roleplaySessionApiToken: string;
}

const PERSONA_SYSTEM_PROMPT = `あなたは営業ロールプレイ練習用の「顧客ペルソナ生成AI」です。与えられた案件情報から、
商談相手となる架空の顧客ペルソナと、ロールプレイ冒頭で顧客役が発する最初の一言(openingMessage)を
同時に生成してください。

回答は必ず次のJSON形式のみで返してください(説明文やコードブロックは不要):
{
  "persona": {
    "persona_name": "顧客担当者の名前(日本人名)",
    "company": "会社名",
    "title": "役職",
    "decision_authority": "決裁権限の有無・範囲",
    "main_issues": ["顧客が抱えている課題"],
    "expectations": ["提案に期待していること"],
    "concerns": ["懸念・不安要素"],
    "personality": "性格・話し方の特徴",
    "objections": ["商談中に出しそうな反論・断り文句"]
  },
  "openingMessage": "顧客役として発する最初の一言(挨拶+軽い状況説明程度、詳しい課題は自分から話さない)"
}

案件情報に含まれる「顧客の課題」「商談メモ」があれば必ず反映し、なければ案件名・取引先・フェーズ
などから自然なペルソナを補完してください。`;

const CHAT_SYSTEM_PROMPT = `あなたは営業ロールプレイ練習における「顧客役」のAIです。与えられた顧客ペルソナを
一貫して演じ、営業担当者(ユーザー)からの発言に顧客として自然に応答してください。

- 最初から自分の課題や予算をすべて話さず、営業担当者の質問に応じて徐々に開示してください。
- ペルソナの personality や concerns、objections を反映した、リアルな顧客らしい反応をしてください。
- 相手が的確な提案をしたら前向きな反応も示し、そうでなければ懸念や反論を出してください。
- 顧客役として1〜3文程度で簡潔に応答してください。ナレーションやカッコ書きの動作説明は不要です。

回答は必ず次のJSON形式のみで返してください(説明文やコードブロックは不要):
{"reply": "顧客役としての応答"}`;

const FEEDBACK_SYSTEM_PROMPT = `あなたは営業ロールプレイ練習を評価するAIコーチです。顧客ペルソナと商談の会話ログ全体を
読み、営業担当者(トレーニー)のパフォーマンスを評価してください。厳しすぎず、育成につながる
表現を使ってください。

回答は必ず次のJSON形式のみで返してください(説明文やコードブロックは不要):
{
  "totalScore": 0から100の整数,
  "hearingScore": 0から100の整数(ヒアリング力),
  "issueScore": 0から100の整数(課題理解力),
  "proposalScore": 0から100の整数(提案力),
  "objectionScore": 0から100の整数(反論対応力),
  "closingScore": 0から100の整数(クロージング力),
  "goodPoints": ["良かった点"],
  "improvementPoints": ["改善点"],
  "nextTrainingTheme": "次回練習すべきテーマを1文で"
}`;

function offsetPositions(startX: number, y: number, count: number, gap = 220): [number, number][] {
  return Array.from({ length: count }, (_, i) => [startX + i * gap, y]);
}

function verifySecretNode(id: string, name: string, webhookSecret: string, position: [number, number]) {
  return {
    id,
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    parameters: {
      jsCode: `
const expected = ${JSON.stringify(webhookSecret)};
const headers = $input.item.json.headers || {};
const provided = headers['x-webhook-secret'];
const body = $input.item.json.body || {};
return [{ json: { ...body, valid: provided === expected } }];
`.trim(),
    },
  };
}

function secretValidIfNode(id: string, name: string, position: [number, number]) {
  return {
    id,
    name,
    type: 'n8n-nodes-base.if',
    typeVersion: 1,
    position,
    parameters: {
      conditions: {
        boolean: [{ value1: '={{$json.valid}}', value2: true }],
      },
    },
  };
}

function respondUnauthorizedNode(id: string, name: string, position: [number, number]) {
  return {
    id,
    name,
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.1,
    position,
    parameters: {
      respondWith: 'json',
      responseBody: '={{ { "error": "invalid webhook secret" } }}',
      options: { responseCode: 401 },
    },
  };
}

export function buildRoleplayWorkflow(config: RoleplayWorkflowConfig) {
  const openaiHeaders = () => [
    { name: 'Authorization', value: `Bearer ${config.openaiApiKey}` },
    { name: 'Content-Type', value: 'application/json' },
  ];
  const opportunityHeader = () => [{ name: 'X-Cybozu-API-Token', value: config.opportunityApiToken }];
  const roleplaySessionHeader = () => [
    { name: 'X-Cybozu-API-Token', value: config.roleplaySessionApiToken },
  ];

  // ---- Start chain: fetch the deal, generate persona + opening line, no kintone write ----
  const startPositions = offsetPositions(0, 0, 8);
  const startNodes = [
    {
      id: 'webhook_start',
      name: 'Webhook Start',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: startPositions[0],
      parameters: { httpMethod: 'POST', path: ROLEPLAY_START_PATH, responseMode: 'responseNode' },
    },
    verifySecretNode('verify_secret_start', 'Verify Secret Start', config.webhookSecret, startPositions[1]),
    secretValidIfNode('secret_valid_start', 'Secret Valid? Start', startPositions[2]),
    respondUnauthorizedNode(
      'respond_unauthorized_start',
      'Respond Unauthorized Start',
      [startPositions[2][0] + 220, startPositions[2][1] + 200],
    ),
    {
      id: 'fetch_deal',
      name: 'Fetch Deal',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: startPositions[3],
      parameters: {
        method: 'GET',
        url: `${config.kintoneBaseUrl}/k/v1/record.json`,
        sendHeaders: true,
        headerParameters: { parameters: opportunityHeader() },
        sendQuery: true,
        queryParameters: {
          parameters: [
            { name: 'app', value: String(config.opportunityAppId) },
            { name: 'id', value: '={{ $node["Verify Secret Start"].json.recordId }}' },
          ],
        },
        options: {},
      },
    },
    {
      id: 'build_deal_text_start',
      name: 'Build Deal Text Start',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: startPositions[4],
      parameters: {
        jsCode: `
${recordToTextEmbeddable()}

const record = $json.record;
const dealText = recordToText('案件', record);
return [{ json: {
  dealText,
  recordId: $node["Verify Secret Start"].json.recordId,
  dealName: (record.deal_name && record.deal_name.value) || '',
  traineeName: $node["Verify Secret Start"].json.traineeName || '',
} }];
`.trim(),
      },
    },
    {
      id: 'generate_persona',
      name: 'Generate Persona & Opening',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: startPositions[5],
      parameters: {
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions',
        sendHeaders: true,
        headerParameters: { parameters: openaiHeaders() },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ model: "gpt-4o", response_format: { type: "json_object" }, messages: [ { role: "system", content: ${JSON.stringify(PERSONA_SYSTEM_PROMPT)} }, { role: "user", content: $json.dealText } ] }) }}`,
        options: {},
      },
    },
    {
      id: 'parse_persona',
      name: 'Parse Persona',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: startPositions[6],
      parameters: {
        jsCode: `
const original = $node["Build Deal Text Start"].json;
const FALLBACK = { persona: { persona_name: "顧客", company: "", title: "", decision_authority: "", main_issues: [], expectations: [], concerns: [], personality: "", objections: [] }, openingMessage: "本日はお時間をいただきありがとうございます。" };
let parsed;
try {
  parsed = JSON.parse($json.choices[0].message.content);
} catch (e) {
  parsed = FALLBACK;
}
// JSON.parse coerces null/non-string content to the string "null" and returns null without
// throwing (OpenAI can return message.content: null, e.g. on a content-filtered response) — the
// catch block above never fires for that case, so this guard is required too.
if (!parsed || typeof parsed !== 'object') parsed = FALLBACK;
return [{ json: {
  persona: parsed.persona || FALLBACK.persona,
  openingMessage: parsed.openingMessage || FALLBACK.openingMessage,
  recordId: original.recordId,
  dealName: original.dealName,
  traineeName: original.traineeName,
} }];
`.trim(),
      },
    },
    {
      id: 'respond_start',
      name: 'Respond Start',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: startPositions[7],
      parameters: {
        respondWith: 'json',
        responseBody: '={{ { persona: $json.persona, openingMessage: $json.openingMessage } }}',
      },
    },
  ];

  const startConnections = {
    'Webhook Start': { main: [[{ node: 'Verify Secret Start', type: 'main', index: 0 }]] },
    'Verify Secret Start': { main: [[{ node: 'Secret Valid? Start', type: 'main', index: 0 }]] },
    'Secret Valid? Start': {
      main: [
        [{ node: 'Fetch Deal', type: 'main', index: 0 }],
        [{ node: 'Respond Unauthorized Start', type: 'main', index: 0 }],
      ],
    },
    'Fetch Deal': { main: [[{ node: 'Build Deal Text Start', type: 'main', index: 0 }]] },
    'Build Deal Text Start': { main: [[{ node: 'Generate Persona & Opening', type: 'main', index: 0 }]] },
    'Generate Persona & Opening': { main: [[{ node: 'Parse Persona', type: 'main', index: 0 }]] },
    'Parse Persona': { main: [[{ node: 'Respond Start', type: 'main', index: 0 }]] },
  };

  // ---- Chat chain: fully stateless — client resends persona + full history each turn ----
  const chatPositions = offsetPositions(0, 400, 6);
  const chatNodes = [
    {
      id: 'webhook_chat',
      name: 'Webhook Chat',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: chatPositions[0],
      parameters: { httpMethod: 'POST', path: ROLEPLAY_CHAT_PATH, responseMode: 'responseNode' },
    },
    verifySecretNode('verify_secret_chat', 'Verify Secret Chat', config.webhookSecret, chatPositions[1]),
    secretValidIfNode('secret_valid_chat', 'Secret Valid? Chat', chatPositions[2]),
    respondUnauthorizedNode(
      'respond_unauthorized_chat',
      'Respond Unauthorized Chat',
      [chatPositions[2][0] + 220, chatPositions[2][1] + 200],
    ),
    {
      id: 'generate_reply',
      name: 'Generate Reply',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: chatPositions[3],
      parameters: {
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions',
        sendHeaders: true,
        headerParameters: { parameters: openaiHeaders() },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ model: "gpt-4o-mini", response_format: { type: "json_object" }, messages: [ { role: "system", content: ${JSON.stringify(CHAT_SYSTEM_PROMPT)} + "\\n\\n顧客ペルソナ: " + JSON.stringify($json.persona || {}) }, ...(($json.history || []).slice(-20).map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content }))), { role: "user", content: $json.userMessage || "" } ] }) }}`,
        options: {},
      },
    },
    {
      id: 'parse_reply',
      name: 'Parse Reply',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: chatPositions[4],
      parameters: {
        jsCode: `
const original = $node["Verify Secret Chat"].json;
const FALLBACK = { reply: "すみません、少し考えがまとまりませんでした。もう一度お願いできますか。" };
let parsed;
try {
  parsed = JSON.parse($json.choices[0].message.content);
} catch (e) {
  parsed = FALLBACK;
}
if (!parsed || typeof parsed !== 'object') parsed = FALLBACK;
const turnCount = ((original.history || []).length) + 1;
const userWantsToFinish = /終了|フィードバック/.test(String(original.userMessage || ''));
const shouldFinish = userWantsToFinish || turnCount >= 20;
return [{ json: { reply: parsed.reply || "", shouldFinish } }];
`.trim(),
      },
    },
    {
      id: 'respond_chat',
      name: 'Respond Chat',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: chatPositions[5],
      parameters: {
        respondWith: 'json',
        responseBody: '={{ { reply: $json.reply, shouldFinish: $json.shouldFinish } }}',
      },
    },
  ];

  const chatConnections = {
    'Webhook Chat': { main: [[{ node: 'Verify Secret Chat', type: 'main', index: 0 }]] },
    'Verify Secret Chat': { main: [[{ node: 'Secret Valid? Chat', type: 'main', index: 0 }]] },
    'Secret Valid? Chat': {
      main: [
        [{ node: 'Generate Reply', type: 'main', index: 0 }],
        [{ node: 'Respond Unauthorized Chat', type: 'main', index: 0 }],
      ],
    },
    'Generate Reply': { main: [[{ node: 'Parse Reply', type: 'main', index: 0 }]] },
    'Parse Reply': { main: [[{ node: 'Respond Chat', type: 'main', index: 0 }]] },
  };

  // ---- Feedback chain: score the transcript, persist one session record ----
  const feedbackPositions = offsetPositions(0, 800, 7);
  const feedbackNodes = [
    {
      id: 'webhook_feedback',
      name: 'Webhook Feedback',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: feedbackPositions[0],
      parameters: { httpMethod: 'POST', path: ROLEPLAY_FEEDBACK_PATH, responseMode: 'responseNode' },
    },
    verifySecretNode(
      'verify_secret_feedback',
      'Verify Secret Feedback',
      config.webhookSecret,
      feedbackPositions[1],
    ),
    secretValidIfNode('secret_valid_feedback', 'Secret Valid? Feedback', feedbackPositions[2]),
    respondUnauthorizedNode(
      'respond_unauthorized_feedback',
      'Respond Unauthorized Feedback',
      [feedbackPositions[2][0] + 220, feedbackPositions[2][1] + 200],
    ),
    {
      id: 'generate_feedback',
      name: 'Generate Feedback',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: feedbackPositions[3],
      parameters: {
        method: 'POST',
        url: 'https://api.openai.com/v1/chat/completions',
        sendHeaders: true,
        headerParameters: { parameters: openaiHeaders() },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ model: "gpt-4o", response_format: { type: "json_object" }, messages: [ { role: "system", content: ${JSON.stringify(FEEDBACK_SYSTEM_PROMPT)} }, { role: "user", content: JSON.stringify({ persona: $json.persona, history: $json.history || [] }) } ] }) }}`,
        options: {},
      },
    },
    {
      id: 'parse_feedback',
      name: 'Parse Feedback',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: feedbackPositions[4],
      parameters: {
        jsCode: `
const original = $node["Verify Secret Feedback"].json;
const FALLBACK = { totalScore: 0, hearingScore: 0, issueScore: 0, proposalScore: 0, objectionScore: 0, closingScore: 0, goodPoints: [], improvementPoints: [], nextTrainingTheme: "" };
let parsed;
try {
  parsed = JSON.parse($json.choices[0].message.content);
} catch (e) {
  parsed = FALLBACK;
}
if (!parsed || typeof parsed !== 'object') parsed = FALLBACK;
const feedback = { ...FALLBACK, ...parsed };
const conversationLog = (original.history || []).map((h) => (h.role === 'user' ? '営業: ' : '顧客: ') + h.content).join('\\n');
return [{ json: {
  feedback,
  conversationLog,
  recordId: original.recordId || '',
  dealName: original.dealName || '',
  traineeName: original.traineeName || '',
  persona: original.persona || {},
} }];
`.trim(),
      },
    },
    {
      id: 'save_session',
      name: 'Save Session',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: feedbackPositions[5],
      parameters: {
        method: 'POST',
        url: `${config.kintoneBaseUrl}/k/v1/record.json`,
        sendHeaders: true,
        headerParameters: {
          parameters: [...roleplaySessionHeader(), { name: 'Content-Type', value: 'application/json' }],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ app: ${config.roleplaySessionAppId}, record: { deal_record_id: { value: $json.recordId }, deal_name: { value: $json.dealName }, trainee_name: { value: $json.traineeName }, roleplay_datetime: { value: new Date().toISOString() }, ai_persona: { value: JSON.stringify($json.persona) }, conversation_log: { value: $json.conversationLog }, feedback: { value: JSON.stringify($json.feedback) }, total_score: { value: $json.feedback.totalScore }, hearing_score: { value: $json.feedback.hearingScore }, issue_score: { value: $json.feedback.issueScore }, proposal_score: { value: $json.feedback.proposalScore }, objection_score: { value: $json.feedback.objectionScore }, closing_score: { value: $json.feedback.closingScore }, good_points: { value: (($json.feedback.goodPoints || []).join("\\n")) }, improvement_points: { value: (($json.feedback.improvementPoints || []).join("\\n")) }, next_training_theme: { value: $json.feedback.nextTrainingTheme } } }) }}`,
        options: {},
      },
    },
    {
      id: 'respond_feedback',
      name: 'Respond Feedback',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: feedbackPositions[6],
      parameters: {
        respondWith: 'json',
        responseBody: '={{ $node["Parse Feedback"].json.feedback }}',
      },
    },
  ];

  const feedbackConnections = {
    'Webhook Feedback': { main: [[{ node: 'Verify Secret Feedback', type: 'main', index: 0 }]] },
    'Verify Secret Feedback': { main: [[{ node: 'Secret Valid? Feedback', type: 'main', index: 0 }]] },
    'Secret Valid? Feedback': {
      main: [
        [{ node: 'Generate Feedback', type: 'main', index: 0 }],
        [{ node: 'Respond Unauthorized Feedback', type: 'main', index: 0 }],
      ],
    },
    'Generate Feedback': { main: [[{ node: 'Parse Feedback', type: 'main', index: 0 }]] },
    'Parse Feedback': { main: [[{ node: 'Save Session', type: 'main', index: 0 }]] },
    'Save Session': { main: [[{ node: 'Respond Feedback', type: 'main', index: 0 }]] },
  };

  return {
    name: ROLEPLAY_WORKFLOW_NAME,
    nodes: [...startNodes, ...chatNodes, ...feedbackNodes],
    connections: { ...startConnections, ...chatConnections, ...feedbackConnections },
  };
}
