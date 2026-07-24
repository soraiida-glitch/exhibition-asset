export const MEETING_LOG_WORKFLOW_NAME = '[kintone] 商談ログ分析';
export const MEETING_LOG_PATH = 'exhibition-meeting-log';

export interface MeetingLogWorkflowConfig {
  webhookSecret: string;
  openaiApiKey: string;
  kintoneBaseUrl: string;
  meetingLogAppId: number;
  meetingLogApiToken: string;
}

const EXTRACT_SYSTEM_PROMPT = `あなたは商談分析のエキスパートです。与えられた商談の文字起こしを分析し、
要約・ネクストアクション・感情分析・キーワード・トピックを抽出してください。

回答は必ず次のJSON形式のみで返してください(説明文やコードブロックは不要):
{
  "summary": "商談内容の要約(200字程度)",
  "next_actions": ["次に取るべき具体的なアクション"],
  "sentiment_score": 1.0から10.0の数値(顧客の反応の好感度、10が最も好意的),
  "sentiment_label": "ポジティブ" | "ニュートラル" | "ネガティブ",
  "keywords": ["商談で出てきた重要なキーワード"],
  "topics": ["話題になったトピック"]
}`;

function offsetPositions(startX: number, y: number, count: number, gap = 220): [number, number][] {
  return Array.from({ length: count }, (_, i) => [startX + i * gap, y]);
}

export function buildMeetingLogWorkflow(config: MeetingLogWorkflowConfig) {
  const positions = offsetPositions(0, 0, 12);
  let p = 0;
  const nextPos = () => positions[p++];

  const kintoneHeader = () => [{ name: 'X-Cybozu-API-Token', value: config.meetingLogApiToken }];
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
      parameters: { httpMethod: 'POST', path: MEETING_LOG_PATH, responseMode: 'responseNode' },
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
      // Meeting recordings can run long enough that Whisper transcription + GPT-4o extraction
      // wouldn't reliably finish inside a synchronous webhook wait, unlike this project's other
      // AI workflows (short text/voice-clip payloads). Responding here — right after auth passes,
      // before the slow chain runs — lets the frontend poll exhibition_商談ログ's status instead
      // of blocking on the HTTP response; n8n keeps executing the parallel branch afterward.
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
      id: 'fetch_meeting_log_record',
      name: 'Fetch Meeting Log Record',
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
            { name: 'app', value: String(config.meetingLogAppId) },
            { name: 'id', value: '={{ $json.meetingLogRecordId }}' },
          ],
        },
        options: {},
      },
    },
    {
      id: 'extract_file_key',
      name: 'Extract File Key',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
// The fileKey issued by kintone's upload API (/k/v1/file.json POST) is a one-time-use token that
// is consumed the moment it's attached to a record — a fresh fileKey is assigned on the record
// itself, and that's the one that must be used to download the file's content afterward.
const attachments = ($json.record && $json.record.audio_file && $json.record.audio_file.value) || [];
const fileKey = attachments[0] && attachments[0].fileKey;
if (!fileKey) {
  throw new Error('exhibition_商談ログ record has no audio_file attachment');
}
return [{ json: { ...$node["Verify Secret"].json, fileKey } }];
`.trim(),
      },
    },
    {
      id: 'fetch_file',
      name: 'Fetch File',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'GET',
        url: `${config.kintoneBaseUrl}/k/v1/file.json`,
        sendHeaders: true,
        headerParameters: { parameters: kintoneHeader() },
        sendQuery: true,
        queryParameters: {
          parameters: [{ name: 'fileKey', value: '={{ $json.fileKey }}' }],
        },
        options: {
          response: {
            response: {
              responseFormat: 'file',
              outputPropertyName: 'audio',
            },
          },
        },
      },
    },
    {
      id: 'whisper_transcribe',
      name: 'Whisper Transcribe',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: nextPos(),
      parameters: {
        method: 'POST',
        url: 'https://api.openai.com/v1/audio/transcriptions',
        sendHeaders: true,
        headerParameters: { parameters: [{ name: 'Authorization', value: `Bearer ${config.openaiApiKey}` }] },
        sendBody: true,
        contentType: 'multipart-form-data',
        bodyParameters: {
          parameters: [
            { parameterType: 'formData', name: 'model', value: 'whisper-1' },
            { parameterType: 'formBinaryData', name: 'file', inputDataFieldName: 'audio' },
          ],
        },
        options: {},
      },
    },
    {
      id: 'extract_meeting_info',
      name: 'Extract Meeting Info',
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
        jsonBody: `={{ JSON.stringify({ model: "gpt-4o", response_format: { type: "json_object" }, messages: [ { role: "system", content: ${JSON.stringify(EXTRACT_SYSTEM_PROMPT)} }, { role: "user", content: $json.text || "" } ] }) }}`,
        options: {},
      },
    },
    {
      id: 'parse_extraction',
      name: 'Parse Extraction',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: nextPos(),
      parameters: {
        jsCode: `
const original = $node["Verify Secret"].json;
const FALLBACK = { summary: "解析に失敗しました", next_actions: [], sentiment_score: 5, sentiment_label: "ニュートラル", keywords: [], topics: [] };
let parsed;
try {
  parsed = JSON.parse($json.choices[0].message.content);
} catch (e) {
  parsed = FALLBACK;
}
if (!parsed || typeof parsed !== 'object') parsed = FALLBACK;
return [{ json: {
  meetingLogRecordId: original.meetingLogRecordId,
  transcript: $node["Whisper Transcribe"].json.text || '',
  summary: parsed.summary || FALLBACK.summary,
  nextActions: (parsed.next_actions || []).join("\\n"),
  sentimentScore: parsed.sentiment_score != null ? parsed.sentiment_score : FALLBACK.sentiment_score,
  sentimentLabel: parsed.sentiment_label || FALLBACK.sentiment_label,
  keywords: (parsed.keywords || []).join("\\n"),
  topics: (parsed.topics || []).join("\\n"),
} }];
`.trim(),
      },
    },
    {
      id: 'update_meeting_log',
      name: 'Update Meeting Log',
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
        jsonBody: `={{ JSON.stringify({ app: ${config.meetingLogAppId}, id: Number($json.meetingLogRecordId), record: { transcript: { value: $json.transcript }, summary: { value: $json.summary }, next_actions: { value: $json.nextActions }, sentiment_score: { value: $json.sentimentScore }, sentiment_label: { value: $json.sentimentLabel }, keywords: { value: $json.keywords }, topics: { value: $json.topics }, status: { value: "完了" } } }) }}`,
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
          { node: 'Fetch Meeting Log Record', type: 'main', index: 0 },
        ],
        [{ node: 'Respond Unauthorized', type: 'main', index: 0 }],
      ],
    },
    'Fetch Meeting Log Record': { main: [[{ node: 'Extract File Key', type: 'main', index: 0 }]] },
    'Extract File Key': { main: [[{ node: 'Fetch File', type: 'main', index: 0 }]] },
    'Fetch File': { main: [[{ node: 'Whisper Transcribe', type: 'main', index: 0 }]] },
    'Whisper Transcribe': { main: [[{ node: 'Extract Meeting Info', type: 'main', index: 0 }]] },
    'Extract Meeting Info': { main: [[{ node: 'Parse Extraction', type: 'main', index: 0 }]] },
    'Parse Extraction': { main: [[{ node: 'Update Meeting Log', type: 'main', index: 0 }]] },
  };

  return { name: MEETING_LOG_WORKFLOW_NAME, nodes, connections };
}
