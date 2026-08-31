import fs from 'node:fs';
import path from 'node:path';
import { loadEnv, patchEnvFile } from '../config/env';
import { KintoneAdminClient } from '../lib/kintone-client';
import {
  ACCOUNT_FIELDS,
  ASSIGNEE_FIELDS,
  DAILY_ADVICE_FIELDS,
  LEAD_FIELDS,
  LOSS_REASON_OPTIONS,
  MEETING_LOG_FIELDS,
  ROLEPLAY_SESSION_FIELDS,
  SALES_SCORE_FIELDS,
  buildOpportunityFields,
  dropdownOptions,
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

  console.log('Ensuring exhibition_案件.closing_advice field exists (phase 4) ...');
  await kintone.ensureFields(opportunityAppId, {
    closing_advice: {
      type: 'MULTI_LINE_TEXT',
      code: 'closing_advice',
      label: 'クロージングアドバイス(JSON)',
    },
  });

  console.log('Ensuring exhibition_案件.customer_issue / meeting_notes fields exist (phase 5) ...');
  await kintone.ensureFields(opportunityAppId, {
    customer_issue: {
      type: 'MULTI_LINE_TEXT',
      code: 'customer_issue',
      label: '顧客の課題',
    },
    meeting_notes: {
      type: 'MULTI_LINE_TEXT',
      code: 'meeting_notes',
      label: '商談メモ',
    },
  });

  console.log('4/8 Creating exhibition_デイリーアドバイス ...');
  const dailyAdviceAppId = await kintone.createAndDeployApp(
    'exhibition_デイリーアドバイス',
    DAILY_ADVICE_FIELDS,
  );
  console.log(`   -> live app id ${dailyAdviceAppId}`);

  console.log('5/8 Creating exhibition_ロールプレイセッション ...');
  const roleplaySessionAppId = await kintone.createAndDeployApp(
    'exhibition_ロールプレイセッション',
    ROLEPLAY_SESSION_FIELDS,
  );
  console.log(`   -> live app id ${roleplaySessionAppId}`);

  console.log('Ensuring exhibition_案件.proposal_url / proposal_status / proposal_generated_at fields exist (phase 6) ...');
  await kintone.ensureFields(opportunityAppId, {
    proposal_url: {
      type: 'LINK',
      code: 'proposal_url',
      label: '提案書URL (Box)',
      protocol: 'WEB',
    },
    proposal_status: {
      type: 'DROP_DOWN',
      code: 'proposal_status',
      label: '提案書ステータス',
      options: {
        未生成: { label: '未生成', index: '0' },
        生成中: { label: '生成中', index: '1' },
        完了: { label: '完了', index: '2' },
        エラー: { label: 'エラー', index: '3' },
      },
      defaultValue: '未生成',
    },
    proposal_generated_at: {
      type: 'DATETIME',
      code: 'proposal_generated_at',
      label: '提案書生成日時',
    },
  });

  console.log('Ensuring exhibition_案件.loss_reason / industry fields exist (RELVA BI 要件定義書 §2) ...');
  await kintone.ensureFields(opportunityAppId, {
    loss_reason: {
      type: 'DROP_DOWN',
      code: 'loss_reason',
      label: '失注理由',
      options: dropdownOptions(LOSS_REASON_OPTIONS),
    },
    industry: {
      type: 'SINGLE_LINE_TEXT',
      code: 'industry',
      label: '業種(取引先より自動転記)',
    },
  });

  console.log('Updating exhibition_案件.account LOOKUP to copy industry (RELVA BI 要件定義書 §2 変更②) ...');
  await kintone.updateFields(opportunityAppId, {
    account: {
      type: 'SINGLE_LINE_TEXT',
      code: 'account',
      label: '取引先',
      lookup: {
        relatedApp: { app: accountAppId },
        relatedKeyField: 'company_name',
        lookupPickerFields: ['company_name', 'industry', 'contact_name'],
        fieldMappings: [{ field: 'industry', relatedField: 'industry' }],
      },
    },
  });
  console.log(
    '   -> NOTE: existing records need a backfill for `industry` to populate. Run: npm run backfill:industry',
  );

  console.log('6/8 Creating exhibition_商談ログ ...');
  const meetingLogAppId = await kintone.createAndDeployApp(
    'exhibition_商談ログ',
    MEETING_LOG_FIELDS,
  );
  console.log(`   -> live app id ${meetingLogAppId}`);

  console.log('7/8 Creating exhibition_担当者 ...');
  const assigneeAppId = await kintone.createAndDeployApp('exhibition_担当者', ASSIGNEE_FIELDS);
  console.log(`   -> live app id ${assigneeAppId}`);

  console.log('8/8 Creating exhibition_営業評価 ...');
  const salesScoreAppId = await kintone.createAndDeployApp(
    'exhibition_営業評価',
    SALES_SCORE_FIELDS,
  );
  console.log(`   -> live app id ${salesScoreAppId}`);

  const appIds = {
    account: accountAppId,
    opportunity: opportunityAppId,
    lead: leadAppId,
    dailyAdvice: dailyAdviceAppId,
    roleplaySession: roleplaySessionAppId,
    meetingLog: meetingLogAppId,
    assignee: assigneeAppId,
    salesScore: salesScoreAppId,
  };
  fs.writeFileSync(APP_IDS_PATH, JSON.stringify(appIds, null, 2));
  console.log(`Wrote ${APP_IDS_PATH}`);

  patchEnvFile({
    KINTONE_APP_ID_ACCOUNT: String(accountAppId),
    KINTONE_APP_ID_OPPORTUNITY: String(opportunityAppId),
    KINTONE_APP_ID_LEAD: String(leadAppId),
    KINTONE_APP_ID_DAILY_ADVICE: String(dailyAdviceAppId),
    KINTONE_APP_ID_ROLEPLAY_SESSION: String(roleplaySessionAppId),
    KINTONE_APP_ID_MEETING_LOG: String(meetingLogAppId),
    KINTONE_APP_ID_ASSIGNEE: String(assigneeAppId),
    KINTONE_APP_ID_SALES_SCORE: String(salesScoreAppId),
  });
  console.log('Wrote KINTONE_APP_ID_* into .env');

  console.log(`
========================================================================
次の手動ステップ（kintone REST APIでは自動化できません）:

kintone管理画面 → 各アプリの設定 → APIトークン → 追加 を、以下の8アプリで実行:
  - exhibition_取引先              (app id ${accountAppId})
  - exhibition_案件                (app id ${opportunityAppId})
  - exhibition_リード              (app id ${leadAppId})
  - exhibition_デイリーアドバイス    (app id ${dailyAdviceAppId})
  - exhibition_ロールプレイセッション (app id ${roleplaySessionAppId})
  - exhibition_商談ログ            (app id ${meetingLogAppId})
  - exhibition_担当者              (app id ${assigneeAppId})
  - exhibition_営業評価            (app id ${salesScoreAppId})

必要な権限: レコードの閲覧 / レコードの追加 / レコードの編集

発行したトークンを .env の以下に貼り付けてください:
  KINTONE_API_TOKEN_ACCOUNT=...
  KINTONE_API_TOKEN_OPPORTUNITY=...
  KINTONE_API_TOKEN_LEAD=...
  KINTONE_API_TOKEN_DAILY_ADVICE=...
  KINTONE_API_TOKEN_ROLEPLAY_SESSION=...
  KINTONE_API_TOKEN_MEETING_LOG=...
  KINTONE_API_TOKEN_ASSIGNEE=...
  KINTONE_API_TOKEN_SALES_SCORE=...

exhibition_担当者アプリには、スコアリング対象にしたい担当者(担当者コード・担当者名)を
手動でレコード登録してください(専用の登録フォームはありません、kintoneの通常のレコード
追加UIをお使いください)。
========================================================================
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
