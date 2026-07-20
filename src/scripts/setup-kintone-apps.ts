import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, patchEnvFile } from '../config/env';
import { KintoneAdminClient } from '../lib/kintone-client';
import {
  ACCOUNT_FIELDS,
  CONVERSATION_LOG_FIELDS,
  LEAD_FIELDS,
  buildOpportunityFields,
} from '../apps/schema';

const APP_IDS_PATH = path.resolve(process.cwd(), 'app-ids.json');

async function main() {
  const env = loadEnv();
  const kintone = new KintoneAdminClient({
    subdomain: env.kintoneSubdomain,
    username: env.kintoneAdminUser,
    password: env.kintoneAdminPassword,
  });

  console.log('1/3 Creating exhibition_取引先 ...');
  const accountAppId = await kintone.createAndDeployApp('exhibition_取引先', ACCOUNT_FIELDS);
  console.log(`   -> live app id ${accountAppId}`);

  console.log('2/3 Creating exhibition_リード ...');
  const leadAppId = await kintone.createAndDeployApp('exhibition_リード', LEAD_FIELDS);
  console.log(`   -> live app id ${leadAppId}`);

  console.log('3/3 Creating exhibition_案件 (LOOKUP -> exhibition_取引先) ...');
  const opportunityAppId = await kintone.createAndDeployApp(
    'exhibition_案件',
    buildOpportunityFields(accountAppId),
  );
  console.log(`   -> live app id ${opportunityAppId}`);

  console.log('Verifying the account LOOKUP field deployed correctly ...');
  const opportunityFields = await kintone.getFormFields(opportunityAppId);
  const accountField = opportunityFields.account as
    | { type?: string; lookup?: { relatedApp?: { app?: string } } }
    | undefined;
  if (
    accountField?.type !== 'SINGLE_LINE_TEXT' ||
    String(accountField?.lookup?.relatedApp?.app) !== String(accountAppId)
  ) {
    throw new Error(
      `exhibition_案件.account did not deploy as the expected LOOKUP into app ${accountAppId}: ${JSON.stringify(accountField)}`,
    );
  }
  console.log('   -> OK: account field is a working LOOKUP into exhibition_取引先.company_name');

  console.log('4/4 Creating exhibition_秘書AI会話ログ ...');
  const conversationLogAppId = await kintone.createAndDeployApp(
    'exhibition_秘書AI会話ログ',
    CONVERSATION_LOG_FIELDS,
  );
  console.log(`   -> live app id ${conversationLogAppId}`);

  const appIds = {
    account: accountAppId,
    opportunity: opportunityAppId,
    lead: leadAppId,
    conversationLog: conversationLogAppId,
  };
  fs.writeFileSync(APP_IDS_PATH, JSON.stringify(appIds, null, 2));
  console.log(`Wrote ${APP_IDS_PATH}`);

  patchEnvFile({
    KINTONE_APP_ID_ACCOUNT: String(accountAppId),
    KINTONE_APP_ID_OPPORTUNITY: String(opportunityAppId),
    KINTONE_APP_ID_LEAD: String(leadAppId),
    KINTONE_APP_ID_CONVERSATION_LOG: String(conversationLogAppId),
  });
  console.log('Wrote KINTONE_APP_ID_* into .env');

  console.log(`
========================================================================
次の手動ステップ（kintone REST APIでは自動化できません）:

kintone管理画面 → 各アプリの設定 → APIトークン → 追加 を、以下の4アプリで実行:
  - exhibition_取引先        (app id ${accountAppId})
  - exhibition_案件          (app id ${opportunityAppId})
  - exhibition_リード        (app id ${leadAppId})
  - exhibition_秘書AI会話ログ (app id ${conversationLogAppId})

必要な権限: レコードの閲覧 / レコードの追加 / レコードの編集

発行したトークンを .env の以下に貼り付けてください:
  KINTONE_API_TOKEN_ACCOUNT=...
  KINTONE_API_TOKEN_OPPORTUNITY=...
  KINTONE_API_TOKEN_LEAD=...
  KINTONE_API_TOKEN_CONVERSATION_LOG=...
========================================================================
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
