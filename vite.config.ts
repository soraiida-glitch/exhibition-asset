import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { loadEnv, requireAppId } from './src/config/env';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function requireEnvValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set. Fill it in .env first (run "npm run setup:agent" too).`);
  }
  return value;
}

const env = loadEnv();

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/customize/chat.ts'),
      formats: ['iife'],
      name: 'ExhibitionChat',
      fileName: () => 'chat.js',
    },
    outDir: 'dist/customize',
    emptyOutDir: true,
  },
  define: {
    __WEBHOOK_URL__: JSON.stringify(requireEnvValue('N8N_KINTONE_AGENT_WEBHOOK_URL', env.n8nAgentWebhookUrl)),
    __WEBHOOK_SECRET__: JSON.stringify(requireEnvValue('N8N_WEBHOOK_SECRET', env.n8nWebhookSecret)),
    __ACCOUNT_APP_ID__: JSON.stringify(String(requireAppId(env, 'kintoneAppIdAccount'))),
    __OPPORTUNITY_APP_ID__: JSON.stringify(String(requireAppId(env, 'kintoneAppIdOpportunity'))),
    __LEAD_APP_ID__: JSON.stringify(String(requireAppId(env, 'kintoneAppIdLead'))),
    __MEISHI_WEBHOOK_URL__: JSON.stringify(
      requireEnvValue('N8N_MEISHI_WEBHOOK_URL', env.n8nMeishiWebhookUrl),
    ),
    __CLOSING_ADVICE_WEBHOOK_URL__: JSON.stringify(
      requireEnvValue('N8N_CLOSING_ADVICE_WEBHOOK_URL', env.n8nClosingAdviceWebhookUrl),
    ),
    __DAILY_ADVICE_APP_ID__: JSON.stringify(String(requireAppId(env, 'kintoneAppIdDailyAdvice'))),
    __ROLEPLAY_START_WEBHOOK_URL__: JSON.stringify(
      requireEnvValue('N8N_ROLEPLAY_START_WEBHOOK_URL', env.n8nRoleplayStartWebhookUrl),
    ),
    __ROLEPLAY_CHAT_WEBHOOK_URL__: JSON.stringify(
      requireEnvValue('N8N_ROLEPLAY_CHAT_WEBHOOK_URL', env.n8nRoleplayChatWebhookUrl),
    ),
    __ROLEPLAY_FEEDBACK_WEBHOOK_URL__: JSON.stringify(
      requireEnvValue('N8N_ROLEPLAY_FEEDBACK_WEBHOOK_URL', env.n8nRoleplayFeedbackWebhookUrl),
    ),
    __TRANSCRIBE_WEBHOOK_URL__: JSON.stringify(
      requireEnvValue('N8N_TRANSCRIBE_WEBHOOK_URL', env.n8nTranscribeWebhookUrl),
    ),
    __TTS_WEBHOOK_URL__: JSON.stringify(requireEnvValue('N8N_TTS_WEBHOOK_URL', env.n8nTtsWebhookUrl)),
  },
});
