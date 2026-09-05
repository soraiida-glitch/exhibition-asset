import fs from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

loadDotenv();

export interface AppEnv {
  kintoneSubdomain: string;
  kintoneAdminUser: string;
  kintoneAdminPassword: string;
  n8nInstanceUrl: string;
  n8nApiKey: string;
  openaiApiKey?: string;
  /** RELVA_BI_開発方針報告書_v2.docx §3.5 — AIによるインサイト・アドバイス(BI Narrative)専用。 */
  anthropicApiKey?: string;
  tavilyApiKey?: string;
  n8nWebhookSecret?: string;
  n8nAgentWebhookUrl?: string;
  n8nMeishiWebhookUrl?: string;
  n8nContactFormSecret?: string;
  n8nContactFormWebhookUrl?: string;
  n8nSyncWebhookUrl?: string;
  n8nClosingAdviceWebhookUrl?: string;
  n8nRoleplayStartWebhookUrl?: string;
  n8nRoleplayChatWebhookUrl?: string;
  n8nRoleplayFeedbackWebhookUrl?: string;
  n8nTranscribeWebhookUrl?: string;
  n8nTtsWebhookUrl?: string;
  n8nMeetingLogWebhookUrl?: string;
  n8nSalesScoringWebhookUrl?: string;
  n8nProposalWebhookUrl?: string;
  boxClientId?: string;
  boxClientSecret?: string;
  boxEnterpriseId?: string;
  boxFolderId?: string;
  pineconeApiKey?: string;
  pineconeIndexName?: string;
  pineconeHost?: string;
  pineconeNamespace?: string;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  kintoneAppIdAccount?: number;
  kintoneAppIdOpportunity?: number;
  kintoneAppIdLead?: number;
  kintoneAppIdDailyAdvice?: number;
  kintoneAppIdRoleplaySession?: number;
  kintoneAppIdMeetingLog?: number;
  kintoneAppIdAssignee?: number;
  kintoneAppIdSalesScore?: number;
  kintoneApiTokenAccount?: string;
  kintoneApiTokenOpportunity?: string;
  kintoneApiTokenLead?: string;
  kintoneApiTokenDailyAdvice?: string;
  kintoneApiTokenRoleplaySession?: string;
  kintoneApiTokenMeetingLog?: string;
  kintoneApiTokenAssignee?: string;
  kintoneApiTokenSalesScore?: string;
}

type AppIdKey =
  | 'kintoneAppIdAccount'
  | 'kintoneAppIdOpportunity'
  | 'kintoneAppIdLead'
  | 'kintoneAppIdDailyAdvice'
  | 'kintoneAppIdRoleplaySession'
  | 'kintoneAppIdMeetingLog'
  | 'kintoneAppIdAssignee'
  | 'kintoneAppIdSalesScore';

const REQUIRED_KEYS = [
  'KINTONE_SUBDOMAIN',
  'KINTONE_ADMIN_USER',
  'KINTONE_ADMIN_PASSWORD',
  'N8N_INSTANCE_URL',
  'N8N_API_KEY',
] as const;

function parseOptionalAppId(key: string): number | undefined {
  const raw = process.env[key];
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function loadEnv(): AppEnv {
  const missing = REQUIRED_KEYS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. Copy .env.example to .env and fill in the values.`,
    );
  }

  return {
    kintoneSubdomain: process.env.KINTONE_SUBDOMAIN!,
    kintoneAdminUser: process.env.KINTONE_ADMIN_USER!,
    kintoneAdminPassword: process.env.KINTONE_ADMIN_PASSWORD!,
    n8nInstanceUrl: process.env.N8N_INSTANCE_URL!,
    n8nApiKey: process.env.N8N_API_KEY!,
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    tavilyApiKey: process.env.TAVILY_API_KEY || undefined,
    n8nWebhookSecret: process.env.N8N_WEBHOOK_SECRET || undefined,
    n8nAgentWebhookUrl: process.env.N8N_KINTONE_AGENT_WEBHOOK_URL || undefined,
    n8nMeishiWebhookUrl: process.env.N8N_MEISHI_WEBHOOK_URL || undefined,
    n8nContactFormSecret: process.env.N8N_CONTACT_FORM_SECRET || undefined,
    n8nContactFormWebhookUrl: process.env.N8N_CONTACT_FORM_WEBHOOK_URL || undefined,
    n8nSyncWebhookUrl: process.env.N8N_SYNC_WEBHOOK_URL || undefined,
    n8nClosingAdviceWebhookUrl: process.env.N8N_CLOSING_ADVICE_WEBHOOK_URL || undefined,
    n8nRoleplayStartWebhookUrl: process.env.N8N_ROLEPLAY_START_WEBHOOK_URL || undefined,
    n8nRoleplayChatWebhookUrl: process.env.N8N_ROLEPLAY_CHAT_WEBHOOK_URL || undefined,
    n8nRoleplayFeedbackWebhookUrl: process.env.N8N_ROLEPLAY_FEEDBACK_WEBHOOK_URL || undefined,
    n8nTranscribeWebhookUrl: process.env.N8N_TRANSCRIBE_WEBHOOK_URL || undefined,
    n8nTtsWebhookUrl: process.env.N8N_TTS_WEBHOOK_URL || undefined,
    n8nMeetingLogWebhookUrl: process.env.N8N_MEETING_LOG_WEBHOOK_URL || undefined,
    n8nSalesScoringWebhookUrl: process.env.N8N_SALES_SCORING_WEBHOOK_URL || undefined,
    n8nProposalWebhookUrl: process.env.N8N_PROPOSAL_WEBHOOK_URL || undefined,
    boxClientId: process.env.BOX_CLIENT_ID || undefined,
    boxClientSecret: process.env.BOX_CLIENT_SECRET || undefined,
    boxEnterpriseId: process.env.BOX_ENTERPRISE_ID || undefined,
    boxFolderId: process.env.BOX_FOLDER_ID || undefined,
    pineconeApiKey: process.env.PINECONE_API_KEY || undefined,
    pineconeIndexName: process.env.PINECONE_INDEX_NAME || undefined,
    pineconeHost: process.env.PINECONE_HOST || undefined,
    pineconeNamespace: process.env.PINECONE_NAMESPACE || undefined,
    supabaseUrl: process.env.SUPABASE_URL || undefined,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || undefined,
    kintoneAppIdAccount: parseOptionalAppId('KINTONE_APP_ID_ACCOUNT'),
    kintoneAppIdOpportunity: parseOptionalAppId('KINTONE_APP_ID_OPPORTUNITY'),
    kintoneAppIdLead: parseOptionalAppId('KINTONE_APP_ID_LEAD'),
    kintoneAppIdDailyAdvice: parseOptionalAppId('KINTONE_APP_ID_DAILY_ADVICE'),
    kintoneAppIdRoleplaySession: parseOptionalAppId('KINTONE_APP_ID_ROLEPLAY_SESSION'),
    kintoneAppIdMeetingLog: parseOptionalAppId('KINTONE_APP_ID_MEETING_LOG'),
    kintoneAppIdAssignee: parseOptionalAppId('KINTONE_APP_ID_ASSIGNEE'),
    kintoneAppIdSalesScore: parseOptionalAppId('KINTONE_APP_ID_SALES_SCORE'),
    kintoneApiTokenAccount: process.env.KINTONE_API_TOKEN_ACCOUNT || undefined,
    kintoneApiTokenOpportunity: process.env.KINTONE_API_TOKEN_OPPORTUNITY || undefined,
    kintoneApiTokenLead: process.env.KINTONE_API_TOKEN_LEAD || undefined,
    kintoneApiTokenDailyAdvice: process.env.KINTONE_API_TOKEN_DAILY_ADVICE || undefined,
    kintoneApiTokenRoleplaySession: process.env.KINTONE_API_TOKEN_ROLEPLAY_SESSION || undefined,
    kintoneApiTokenMeetingLog: process.env.KINTONE_API_TOKEN_MEETING_LOG || undefined,
    kintoneApiTokenAssignee: process.env.KINTONE_API_TOKEN_ASSIGNEE || undefined,
    kintoneApiTokenSalesScore: process.env.KINTONE_API_TOKEN_SALES_SCORE || undefined,
  };
}

export function requireAppId(env: AppEnv, key: AppIdKey): number {
  const value = env[key];
  if (value === undefined) {
    throw new Error(`${key} is not set yet. Run "npm run setup:apps" first.`);
  }
  return value;
}

export function envFilePath(): string {
  return path.resolve(process.cwd(), '.env');
}

/** Patches KEY=value lines in .env in place, adding the key at the end if it doesn't exist yet. */
export function patchEnvFile(updates: Record<string, string>): void {
  const filePath = envFilePath();
  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';

  for (const [key, value] of Object.entries(updates)) {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    if (pattern.test(content)) {
      content = content.replace(pattern, `${key}=${value}`);
    } else {
      content = `${content.replace(/\n$/, '')}\n${key}=${value}\n`;
    }
  }

  fs.writeFileSync(filePath, content);
}
