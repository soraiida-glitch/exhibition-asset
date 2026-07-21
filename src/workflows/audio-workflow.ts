export const AUDIO_WORKFLOW_NAME = '[kintone] 音声処理';
export const TRANSCRIBE_PATH = 'exhibition-transcribe';
export const TTS_PATH = 'exhibition-tts';

export interface AudioWorkflowConfig {
  webhookSecret: string;
  openaiApiKey: string;
}

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

/**
 * kintone_crm_requirements.md specifies a Whisper+Blob voice pipeline (not roll-playing's actual
 * browser-native Web Speech API). This is this project's first use of n8n's binary-data helpers
 * (`prepareBinaryData` / `getBinaryDataBuffer`) and the httpRequest node's multipart/binary-response
 * options — verified live against the real n8n instance after deploy, per this project's usual
 * "implement from best-known API shape, then test against the real instance" approach.
 */
export function buildAudioWorkflow(config: AudioWorkflowConfig) {
  const openaiHeader = () => [{ name: 'Authorization', value: `Bearer ${config.openaiApiKey}` }];

  // ---- Transcribe chain: base64 audio in -> Whisper multipart upload -> transcript text out ----
  const transcribePositions = offsetPositions(0, 0, 7);
  const transcribeNodes = [
    {
      id: 'webhook_transcribe',
      name: 'Webhook Transcribe',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: transcribePositions[0],
      parameters: { httpMethod: 'POST', path: TRANSCRIBE_PATH, responseMode: 'responseNode' },
    },
    verifySecretNode(
      'verify_secret_transcribe',
      'Verify Secret Transcribe',
      config.webhookSecret,
      transcribePositions[1],
    ),
    secretValidIfNode('secret_valid_transcribe', 'Secret Valid? Transcribe', transcribePositions[2]),
    respondUnauthorizedNode(
      'respond_unauthorized_transcribe',
      'Respond Unauthorized Transcribe',
      [transcribePositions[2][0] + 220, transcribePositions[2][1] + 200],
    ),
    {
      id: 'prepare_audio_binary',
      name: 'Prepare Audio Binary',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: transcribePositions[3],
      parameters: {
        jsCode: `
const body = $input.item.json;
const base64 = body.audio_base64 || '';
const mimeType = body.audio_type || 'audio/webm';
const buffer = Buffer.from(base64, 'base64');
const binaryData = await this.helpers.prepareBinaryData(buffer, 'audio.webm', mimeType);
return [{ json: {}, binary: { data: binaryData } }];
`.trim(),
      },
    },
    {
      id: 'whisper_transcribe',
      name: 'Whisper Transcribe',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: transcribePositions[4],
      parameters: {
        method: 'POST',
        url: 'https://api.openai.com/v1/audio/transcriptions',
        sendHeaders: true,
        headerParameters: { parameters: openaiHeader() },
        sendBody: true,
        contentType: 'multipart-form-data',
        bodyParameters: {
          parameters: [
            { parameterType: 'formData', name: 'model', value: 'whisper-1' },
            { parameterType: 'formData', name: 'response_format', value: 'verbose_json' },
            { parameterType: 'formBinaryData', name: 'file', inputDataFieldName: 'data' },
          ],
        },
        options: {},
      },
    },
    {
      id: 'parse_transcript',
      name: 'Parse Transcript',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: transcribePositions[5],
      parameters: {
        jsCode: `
// Whisper hallucinates plausible-sounding text (often "you", "Thank you.", etc. — an artifact of
// its YouTube-caption training data) for near-silent clips instead of returning empty text.
// verbose_json's per-segment no_speech_prob lets us detect that and discard it, on top of the
// requirements doc's short-recording guard (which only catches clips that are too brief, not
// clips that are long enough but contain only room noise).
const segments = Array.isArray($json.segments) ? $json.segments : [];
const avgNoSpeechProb = segments.length
  ? segments.reduce((sum, s) => sum + (s.no_speech_prob || 0), 0) / segments.length
  : 0;
const text = ($json.text || '').trim();
const isLikelySilence = !text || avgNoSpeechProb > 0.6;
return [{ json: { text: isLikelySilence ? '' : text } }];
`.trim(),
      },
    },
    {
      id: 'respond_transcribe',
      name: 'Respond Transcribe',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: transcribePositions[6],
      parameters: {
        respondWith: 'json',
        responseBody: '={{ { text: $json.text } }}',
      },
    },
  ];

  const transcribeConnections = {
    'Webhook Transcribe': { main: [[{ node: 'Verify Secret Transcribe', type: 'main', index: 0 }]] },
    'Verify Secret Transcribe': {
      main: [[{ node: 'Secret Valid? Transcribe', type: 'main', index: 0 }]],
    },
    'Secret Valid? Transcribe': {
      main: [
        [{ node: 'Prepare Audio Binary', type: 'main', index: 0 }],
        [{ node: 'Respond Unauthorized Transcribe', type: 'main', index: 0 }],
      ],
    },
    'Prepare Audio Binary': { main: [[{ node: 'Whisper Transcribe', type: 'main', index: 0 }]] },
    'Whisper Transcribe': { main: [[{ node: 'Parse Transcript', type: 'main', index: 0 }]] },
    'Parse Transcript': { main: [[{ node: 'Respond Transcribe', type: 'main', index: 0 }]] },
  };

  // ---- TTS chain: text in -> OpenAI TTS binary mp3 -> base64 audio out ----
  const ttsPositions = offsetPositions(0, 400, 6);
  const ttsNodes = [
    {
      id: 'webhook_tts',
      name: 'Webhook TTS',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: ttsPositions[0],
      parameters: { httpMethod: 'POST', path: TTS_PATH, responseMode: 'responseNode' },
    },
    verifySecretNode('verify_secret_tts', 'Verify Secret TTS', config.webhookSecret, ttsPositions[1]),
    secretValidIfNode('secret_valid_tts', 'Secret Valid? TTS', ttsPositions[2]),
    respondUnauthorizedNode(
      'respond_unauthorized_tts',
      'Respond Unauthorized TTS',
      [ttsPositions[2][0] + 220, ttsPositions[2][1] + 200],
    ),
    {
      id: 'generate_speech',
      name: 'Generate Speech',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: ttsPositions[3],
      parameters: {
        method: 'POST',
        url: 'https://api.openai.com/v1/audio/speech',
        sendHeaders: true,
        headerParameters: {
          parameters: [...openaiHeader(), { name: 'Content-Type', value: 'application/json' }],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
          '={{ JSON.stringify({ model: "tts-1", voice: "alloy", input: $json.text || "", response_format: "mp3" }) }}',
        options: {
          response: {
            response: {
              responseFormat: 'file',
              outputPropertyName: 'data',
            },
          },
        },
      },
    },
    {
      id: 'encode_audio_base64',
      name: 'Encode Audio Base64',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: ttsPositions[4],
      parameters: {
        jsCode: `
const buffer = await this.helpers.getBinaryDataBuffer(0, 'data');
return [{ json: { audio_base64: buffer.toString('base64') } }];
`.trim(),
      },
    },
    {
      id: 'respond_tts',
      name: 'Respond TTS',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.1,
      position: ttsPositions[5],
      parameters: {
        respondWith: 'json',
        responseBody: '={{ { audio_base64: $json.audio_base64 } }}',
      },
    },
  ];

  const ttsConnections = {
    'Webhook TTS': { main: [[{ node: 'Verify Secret TTS', type: 'main', index: 0 }]] },
    'Verify Secret TTS': { main: [[{ node: 'Secret Valid? TTS', type: 'main', index: 0 }]] },
    'Secret Valid? TTS': {
      main: [
        [{ node: 'Generate Speech', type: 'main', index: 0 }],
        [{ node: 'Respond Unauthorized TTS', type: 'main', index: 0 }],
      ],
    },
    'Generate Speech': { main: [[{ node: 'Encode Audio Base64', type: 'main', index: 0 }]] },
    'Encode Audio Base64': { main: [[{ node: 'Respond TTS', type: 'main', index: 0 }]] },
  };

  return {
    name: AUDIO_WORKFLOW_NAME,
    nodes: [...transcribeNodes, ...ttsNodes],
    connections: { ...transcribeConnections, ...ttsConnections },
  };
}
