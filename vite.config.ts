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
  },
});
