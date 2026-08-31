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

export default defineConfig(({ command }) => {
  if (command === 'serve') {
    // RELVA BI (要件定義書 §7) — `npm run dev` は dev/playground をViteの開発サーバーで動かす
    // だけの「UIループ」。ここで描くのは hardcoded な BiResult フィクスチャのみで、kintoneも
    // __XXX__ ビルド定数も一切参照しない。.env が未設定でも起動できるよう、loadEnv()/define は
    // この分岐に入れず、既存の `vite build`(build:customize)の側にだけ残す。
    return {
      root: 'dev/playground',
    };
  }

  const env = loadEnv();

  return {
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
      // echarts/zrender は内部の開発用チェックで process.env.NODE_ENV を参照している(229箇所)。
      // vite の library モードビルドはアプリモードと違い process.env.NODE_ENV を自動置換しない
      // ため、そのままだとブラウザに `process` が存在せず "Uncaught ReferenceError: process is
      // not defined" でチャットウィジェット全体(BIダッシュボードに限らず)がクラッシュする
      // ——本番の空間ポータルで実際に発生した回帰。ここで文字列リテラルに静的置換することで
      // ビルド後のバンドルから process への参照そのものを消す。
      'process.env.NODE_ENV': JSON.stringify('production'),
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
      __MEETING_LOG_APP_ID__: JSON.stringify(String(requireAppId(env, 'kintoneAppIdMeetingLog'))),
      __MEETING_LOG_WEBHOOK_URL__: JSON.stringify(
        requireEnvValue('N8N_MEETING_LOG_WEBHOOK_URL', env.n8nMeetingLogWebhookUrl),
      ),
      __ASSIGNEE_APP_ID__: JSON.stringify(String(requireAppId(env, 'kintoneAppIdAssignee'))),
      __SALES_SCORE_APP_ID__: JSON.stringify(String(requireAppId(env, 'kintoneAppIdSalesScore'))),
      __SALES_SCORING_WEBHOOK_URL__: JSON.stringify(
        requireEnvValue('N8N_SALES_SCORING_WEBHOOK_URL', env.n8nSalesScoringWebhookUrl),
      ),
      __PROPOSAL_WEBHOOK_URL__: JSON.stringify(
        requireEnvValue('N8N_PROPOSAL_WEBHOOK_URL', env.n8nProposalWebhookUrl),
      ),
    },
  };
});
