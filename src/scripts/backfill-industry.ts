import { loadEnv, requireAppId } from '../config/env';
import { KintoneAdminClient } from '../lib/kintone-client';

// RELVA BI (要件定義書 §2 変更②): exhibition_案件.account の LOOKUP に fieldMappings
// (industry <- 取引先.industry) を追加しても、それが効くのは「レコード保存時」のみ —
// 既存レコードには反映されない。kintone の LOOKUP フィールドは、その項目の現在値を
// そのまま送り直すだけ(値が実際に変わらなくても)で関連レコードへの再参照・再コピーが
// 走る、という挙動を利用してバックフィルする。
//
// 案件アプリ専用のAPIトークンでこれを行うと、取引先アプリへの閲覧権限を持たないため
// GAIA_LO04 ("... or you do not have permission to view the app or the field") で失敗する
// (実際に本番実行時に確認済み)。管理者アカウント(username/password)はアプリ横断で
// 参照権限を持つため、KintoneAdminClient 経由で行う。

const VERIFY_SAMPLE_SIZE = 3;

interface OpportunityRecord {
  $id: { value: string };
  account?: { value: string };
  industry?: { value: string };
}

async function main() {
  const env = loadEnv();
  const appId = requireAppId(env, 'kintoneAppIdOpportunity');
  const kintone = new KintoneAdminClient({
    subdomain: env.kintoneSubdomain,
    username: env.kintoneAdminUser,
    password: env.kintoneAdminPassword,
  });

  console.log('Fetching exhibition_案件 records ...');
  const records = await kintone.getAllRecords<OpportunityRecord>(appId);
  console.log(`   -> ${records.length} records`);

  const targets = records.filter((r) => r.account?.value);
  const skipped = records.length - targets.length;
  if (skipped > 0) {
    console.log(`   -> skipping ${skipped} record(s) with no 取引先 (nothing to backfill)`);
  }

  if (targets.length === 0) {
    console.log('Nothing to backfill. Done.');
    return;
  }

  console.log(`Backfilling industry on ${targets.length} record(s) ...`);
  await kintone.updateAllRecords(
    appId,
    targets.map((r) => ({
      id: r.$id.value,
      // Resending the LOOKUP field's own current value re-triggers kintone's copy of
      // fieldMappings-mapped fields (here: industry) from the related 取引先 record —
      // this is a no-op on `account` itself, only `industry` actually changes.
      record: { account: { value: r.account!.value } },
    })),
  );
  console.log(`   -> updated ${targets.length} record(s)`);

  console.log('Verifying a sample of updated records ...');
  const sample = targets.slice(0, VERIFY_SAMPLE_SIZE);
  let verifiedOk = 0;
  for (const r of sample) {
    const refreshed = await kintone.getRecord<OpportunityRecord>(appId, r.$id.value);
    const industry = refreshed.industry?.value;
    if (industry) {
      verifiedOk += 1;
      console.log(`   -> record ${r.$id.value}: industry="${industry}" OK`);
    } else {
      console.warn(
        `   -> record ${r.$id.value}: industry is still empty after backfill. ` +
          'Check that the referenced 取引先 record actually has an industry value set, ' +
          'and that exhibition_案件.account.lookup.fieldMappings deployed correctly.',
      );
    }
  }

  if (verifiedOk === 0 && sample.length > 0) {
    throw new Error(
      'Backfill verification failed: none of the sampled records picked up an industry value. ' +
        'The fieldMappings-resend approach may not be working as expected on this tenant — investigate before trusting the rest of the backfill.',
    );
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
