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
  n8nWebhookSecret?: string;
  n8nAgentWebhookUrl?: string;
  n8nMeishiWebhookUrl?: string;
  n8nContactFormSecret?: string;
  n8nContactFormWebhookUrl?: string;
  n8nSyncWebhookUrl?: string;
  n8nClosingAdviceWebhookUrl?: string;
  pineconeApiKey?: string;
  pineconeIndexName?: string;
  pineconeHost?: string;
  pineconeNamespace?: string;
  kintoneAppIdAccount?: number;
  kintoneAppIdOpportunity?: number;
  kintoneAppIdLead?: number;
  kintoneAppIdConversationLog?: number;
  kintoneAppIdDailyAdvice?: number;
  kintoneApiTokenAccount?: string;
  kintoneApiTokenOpportunity?: string;
  kintoneApiTokenLead?: string;
  kintoneApiTokenConversationLog?: string;
  kintoneApiTokenDailyAdvice?: string;
}

type AppIdKey =
  | 'kintoneAppIdAccount'
  | 'kintoneAppIdOpportunity'
  | 'kintoneAppIdLead'
  | 'kintoneAppIdConversationLog'
  | 'kintoneAppIdDailyAdvice';

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
    n8nWebhookSecret: process.env.N8N_WEBHOOK_SECRET || undefined,
    n8nAgentWebhookUrl: process.env.N8N_KINTONE_AGENT_WEBHOOK_URL || undefined,
    n8nMeishiWebhookUrl: process.env.N8N_MEISHI_WEBHOOK_URL || undefined,
    n8nContactFormSecret: process.env.N8N_CONTACT_FORM_SECRET || undefined,
    n8nContactFormWebhookUrl: process.env.N8N_CONTACT_FORM_WEBHOOK_URL || undefined,
    n8nSyncWebhookUrl: process.env.N8N_SYNC_WEBHOOK_URL || undefined,
    n8nClosingAdviceWebhookUrl: process.env.N8N_CLOSING_ADVICE_WEBHOOK_URL || undefined,
    pineconeApiKey: process.env.PINECONE_API_KEY || undefined,
    pineconeIndexName: process.env.PINECONE_INDEX_NAME || undefined,
    pineconeHost: process.env.PINECONE_HOST || undefined,
    pineconeNamespace: process.env.PINECONE_NAMESPACE || undefined,
    kintoneAppIdAccount: parseOptionalAppId('KINTONE_APP_ID_ACCOUNT'),
    kintoneAppIdOpportunity: parseOptionalAppId('KINTONE_APP_ID_OPPORTUNITY'),
    kintoneAppIdLead: parseOptionalAppId('KINTONE_APP_ID_LEAD'),
    kintoneAppIdConversationLog: parseOptionalAppId('KINTONE_APP_ID_CONVERSATION_LOG'),
    kintoneAppIdDailyAdvice: parseOptionalAppId('KINTONE_APP_ID_DAILY_ADVICE'),
    kintoneApiTokenAccount: process.env.KINTONE_API_TOKEN_ACCOUNT || undefined,
    kintoneApiTokenOpportunity: process.env.KINTONE_API_TOKEN_OPPORTUNITY || undefined,
    kintoneApiTokenLead: process.env.KINTONE_API_TOKEN_LEAD || undefined,
    kintoneApiTokenConversationLog: process.env.KINTONE_API_TOKEN_CONVERSATION_LOG || undefined,
    kintoneApiTokenDailyAdvice: process.env.KINTONE_API_TOKEN_DAILY_ADVICE || undefined,
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
