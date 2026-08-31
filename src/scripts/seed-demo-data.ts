import { loadEnv, requireAppId } from '../config/env';
import { KintoneAdminClient } from '../lib/kintone-client';
import { ACCOUNT_INDUSTRY_OPTIONS, LOSS_REASON_OPTIONS } from '../apps/schema';

// RELVA BI 追加要件定義書 §8 — デモ用の「物語のある」サンプルデータを再現可能に生成する。
// ランダム増殖は禁止(横並びで平板になるため)——分布は §8-3 の確定値どおり、固定シードの
// 擬似乱数で「誰がどのカテゴリになるか」だけをシャッフルする。件数そのものは常に一致する。

// ---------- §8-1: 単一の真実源(デモ企業の前提) ----------
const SEED = 20260401;
export const OWNERS = ['飯田', '佐藤', '田中', '鈴木', '山本', '高橋'] as const;
const OWNER_WEIGHT: Record<(typeof OWNERS)[number], number> = {
  飯田: 1.8,
  佐藤: 1.5,
  田中: 1.25,
  鈴木: 1.0,
  山本: 0.75,
  高橋: 0.55,
};
const AMOUNT_MIN = 300_000;
const AMOUNT_MAX = 5_000_000;
const FY_START = '2026-04-01';
const FY_END = '2027-03-31';

export const ACCOUNT_COUNT = 50;
export const OPPORTUNITY_COUNT = 160;
export const LEAD_COUNT = 80;

// §8-3: 分布の振り付け(確定値)。合計が上の件数と一致することをコード側でも検算する。
export const STAGE_COUNTS: Record<string, number> = {
  初期接触: 22,
  ヒアリング: 20,
  提案中: 18,
  見積提出: 14,
  交渉中: 12,
  成約: 34,
  失注: 40,
};
export const LOSS_REASON_COUNTS: Record<string, number> = {
  価格: 16,
  競合: 9,
  タイミング: 7,
  予算凍結: 5,
  ニーズ不一致: 3,
};
export const LEAD_STATUS_COUNTS: Record<string, number> = {
  未対応: 18,
  対応中: 30,
  変換済み: 22,
  対象外: 10,
};

export const HIGH_WIN_INDUSTRY = '金融・保険';
export const LOSS_HEATMAP_INDUSTRY = '製造';
export const LOSS_HEATMAP_REASON = '価格';
const LOSS_HEATMAP_HIGHLIGHT_COUNT = 5;
const STALLED_COUNT = 5;
// 交渉中なのに close_date が過去 = 「停滞案件」のT8デモ用(更新日時はシードできないため代替指標)。
const STALLED_CLOSE_DATE = '2026-07-10';

// ---------- 固定シードの擬似乱数(mulberry32) — 再現可能性のため Math.random() は使わない ----------
function mulberry32(seed: number): () => number {
  let s = seed;
  return function rand() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);

function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** counts の合計件数ぶんラベルを積んでシャッフルした配列を返す。件数は必ず厳密に一致する。 */
function budgetArray(counts: Record<string, number>): string[] {
  const out: string[] = [];
  for (const [label, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) out.push(label);
  }
  return shuffle(out);
}

function weightedPick<T extends string>(weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = rand() * total;
  for (const [key, w] of entries) {
    r -= w;
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

function randomInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

/** 会計年度内のランダムな日付。直近月がやや厚くなるよう指数を掛けて後方に寄せる。 */
function randomDateInFiscalYear(): string {
  const start = new Date(FY_START).getTime();
  const end = new Date(FY_END).getTime();
  const t = start + Math.pow(rand(), 0.7) * (end - start);
  return new Date(t).toISOString().slice(0, 10);
}

// ---------- 名前生成(プレフィックス×業種テーマの組み合わせで一意な名前を作る) ----------
const COMPANY_PREFIXES = [
  'さくら', '大和', '東京', '中央', 'グリーン', 'コスモ', 'パシフィック', '北海道', '南海', 'みらい',
  'スカイ', 'ネクスト', 'クリスタル', 'アルファ', 'ベイ', 'グローバル', 'セントラル', '桜', '富士', '若葉',
];
const INDUSTRY_THEME: Record<string, string[]> = {
  'IT・ソフトウェア': ['ソリューションズ', 'テクノロジーズ', 'システムズ', 'ソフトウェア'],
  製造: ['精密工業', '製作所', 'マニュファクチャリング', 'エンジニアリング'],
  '小売・流通': ['リテール', '商事', '流通', 'ストアーズ'],
  '金融・保険': ['フィナンシャル', '保険サービス', 'キャピタル', 'アセットマネジメント'],
  '医療・ヘルスケア': ['メディカル', 'ヘルスケアパートナーズ', 'クリニックサポート', 'ライフサイエンス'],
  '建設・不動産': ['建設', '不動産', '建設コンサルタント', 'ハウジング'],
  サービス: ['サービス', '物流サービス', 'フーズ', 'ホスピタリティ'],
  その他: ['フードテック', 'エナジー', 'メディア', 'ラボ'],
};
const CORP_SUFFIX = ['株式会社', ''];

function makeUniqueName(used: Set<string>, base: string): string {
  let name = base;
  let i = 2;
  while (used.has(name)) {
    name = `${base}${i}`;
    i++;
  }
  used.add(name);
  return name;
}

function pickTheme(industry: string): string {
  const themes = INDUSTRY_THEME[industry];
  return themes[randomInt(0, themes.length - 1)];
}

function randomPhone(): string {
  return `0${randomInt(3, 9)}-${randomInt(1000, 9999)}-${randomInt(1000, 9999)}`;
}

// ---------- レコード生成 ----------
export interface AccountSeed {
  company_name: string;
  industry: string;
  contact_name: string;
  phone: string;
  email: string;
  status: string;
  memo: string;
}

export interface OpportunitySeed {
  deal_name: string;
  account: string;
  amount: number;
  stage: string;
  close_date: string;
  owner: string;
  description: string;
  customer_issue: string;
  loss_reason?: string;
}

export interface LeadSeed {
  lead_name: string;
  company_name: string;
  phone: string;
  email: string;
  source: string;
  status: string;
  memo: string;
}

const DEMO_MEMO = '展示会デモ用サンプルデータ(seed-demo-data.ts生成)';

export function buildAccounts(): AccountSeed[] {
  const used = new Set<string>();
  const accounts: AccountSeed[] = [];
  for (let i = 0; i < ACCOUNT_COUNT; i++) {
    const industry = ACCOUNT_INDUSTRY_OPTIONS[i % ACCOUNT_INDUSTRY_OPTIONS.length];
    const prefix = COMPANY_PREFIXES[randomInt(0, COMPANY_PREFIXES.length - 1)];
    const suffix = CORP_SUFFIX[randomInt(0, CORP_SUFFIX.length - 1)];
    const company_name = makeUniqueName(used, `${prefix}${pickTheme(industry)}${suffix}`);
    accounts.push({
      company_name,
      industry,
      contact_name: `担当${i + 1}`,
      phone: randomPhone(),
      email: `contact${i + 1}@example.com`,
      status: rand() < 0.15 ? '休眠' : rand() < 0.5 ? '見込み' : '取引中',
      memo: DEMO_MEMO,
    });
  }
  return accounts;
}

export function buildOpportunities(accounts: AccountSeed[]): OpportunitySeed[] {
  const stageAssignments = budgetArray(STAGE_COUNTS); // 160件、厳密に §8-3 の件数どおり
  const lossReasonPool = budgetArray(LOSS_REASON_COUNTS); // 40件

  const lostIndices = stageAssignments.map((s, idx) => (s === '失注' ? idx : -1)).filter((i) => i >= 0);
  const negotiatingIndices = stageAssignments.map((s, idx) => (s === '交渉中' ? idx : -1)).filter((i) => i >= 0);
  const stalledSet = new Set(shuffle(negotiatingIndices).slice(0, STALLED_COUNT));

  // 「製造×価格」をヒートマップで際立たせるため、価格ラベルの失注枠のうち先頭5件だけ、
  // 理由の値そのものは変えず(件数の厳密一致を崩さない)、口座選定だけ製造業種に寄せる。
  const priceSlotPositions = lossReasonPool
    .map((r, pos) => (r === LOSS_HEATMAP_REASON ? pos : -1))
    .filter((pos) => pos >= 0);
  const highlightPositions = new Set(priceSlotPositions.slice(0, Math.min(LOSS_HEATMAP_HIGHLIGHT_COUNT, priceSlotPositions.length)));

  const manufacturingAccounts = accounts.filter((a) => a.industry === LOSS_HEATMAP_INDUSTRY);
  const highWinAccounts = accounts.filter((a) => a.industry === HIGH_WIN_INDUSTRY);

  const usedDealNames = new Set<string>();
  const opportunities: OpportunitySeed[] = [];

  for (let i = 0; i < OPPORTUNITY_COUNT; i++) {
    const stage = stageAssignments[i];
    let account: AccountSeed;
    let loss_reason: string | undefined;

    if (stage === '失注') {
      const posInLost = lostIndices.indexOf(i);
      loss_reason = lossReasonPool[posInLost];
      account =
        highlightPositions.has(posInLost) && manufacturingAccounts.length > 0
          ? manufacturingAccounts[randomInt(0, manufacturingAccounts.length - 1)]
          : accounts[randomInt(0, accounts.length - 1)];
    } else if (stage === '成約' && highWinAccounts.length > 0 && rand() < 0.35) {
      // 金融・保険の受注率を高く見せるため、成約案件の一部を優先的に金融アカウントへ寄せる。
      account = highWinAccounts[randomInt(0, highWinAccounts.length - 1)];
    } else {
      account = accounts[randomInt(0, accounts.length - 1)];
    }

    const owner = weightedPick(OWNER_WEIGHT);
    const amount = randomInt(AMOUNT_MIN, AMOUNT_MAX);

    let close_date: string;
    if (stage === '交渉中' && stalledSet.has(i)) {
      close_date = STALLED_CLOSE_DATE;
    } else {
      close_date = randomDateInFiscalYear();
    }

    const theme = pickTheme(account.industry);
    const shortName = account.company_name.replace(/株式会社/g, '');
    const deal_name = makeUniqueName(usedDealNames, `${shortName}向け${theme}AI導入`);

    opportunities.push({
      deal_name,
      account: account.company_name,
      amount,
      stage,
      close_date,
      owner,
      description: `${account.company_name}への${theme}領域AI活用の提案。`,
      customer_issue: '業務効率化・省力化のためのAI活用を検討している。',
      loss_reason,
    });
  }

  return opportunities;
}

export function buildLeads(): LeadSeed[] {
  const statusAssignments = budgetArray(LEAD_STATUS_COUNTS); // 80件
  const sourceWeight = { 問い合わせフォーム: 2.5, 名刺: 1.5, 紹介: 1.0, その他: 0.6 };
  const used = new Set<string>();
  const leads: LeadSeed[] = [];

  for (let i = 0; i < LEAD_COUNT; i++) {
    const status = statusAssignments[i];
    const source = weightedPick(sourceWeight);
    const industry = ACCOUNT_INDUSTRY_OPTIONS[randomInt(0, ACCOUNT_INDUSTRY_OPTIONS.length - 1)];
    const prefix = COMPANY_PREFIXES[randomInt(0, COMPANY_PREFIXES.length - 1)];
    const company_name = makeUniqueName(used, `${prefix}${pickTheme(industry)}(見込み)`);

    leads.push({
      lead_name: `見込み客${i + 1}`,
      company_name,
      phone: randomPhone(),
      email: `lead${i + 1}@example.com`,
      source,
      status,
      memo: DEMO_MEMO,
    });
  }
  return leads;
}

// ---------- §8-4: データ品質ルールの検算(投入前の構造チェック) ----------
export function validateOpportunities(opportunities: OpportunitySeed[]): void {
  const errors: string[] = [];

  for (const o of opportunities) {
    if (o.stage === '失注' && !o.loss_reason) errors.push(`失注案件にloss_reasonが無い: ${o.deal_name}`);
    if (o.loss_reason && !LOSS_REASON_OPTIONS.includes(o.loss_reason)) {
      errors.push(`未知のloss_reason: ${o.loss_reason} (${o.deal_name})`);
    }
    if (!o.account) errors.push(`accountが無い: ${o.deal_name}`);
    if ((o.stage === '成約' || o.stage === '失注') && !o.close_date) {
      errors.push(`${o.stage}案件にclose_dateが無い: ${o.deal_name}`);
    }
    if (!o.amount) errors.push(`amountが無い: ${o.deal_name}`);
    if (!(OWNERS as readonly string[]).includes(o.owner)) errors.push(`想定外のowner: ${o.owner} (${o.deal_name})`);
  }

  const stageCounts: Record<string, number> = {};
  for (const o of opportunities) stageCounts[o.stage] = (stageCounts[o.stage] ?? 0) + 1;
  for (const [stage, expected] of Object.entries(STAGE_COUNTS)) {
    if (stageCounts[stage] !== expected) {
      errors.push(`stage=${stage}の件数が${stageCounts[stage] ?? 0}件(期待値${expected}件)`);
    }
  }

  const lossCounts: Record<string, number> = {};
  for (const o of opportunities) if (o.loss_reason) lossCounts[o.loss_reason] = (lossCounts[o.loss_reason] ?? 0) + 1;
  for (const [reason, expected] of Object.entries(LOSS_REASON_COUNTS)) {
    if (lossCounts[reason] !== expected) {
      errors.push(`loss_reason=${reason}の件数が${lossCounts[reason] ?? 0}件(期待値${expected}件)`);
    }
  }

  if (opportunities.length !== OPPORTUNITY_COUNT) {
    errors.push(`案件の総数が${opportunities.length}件(期待値${OPPORTUNITY_COUNT}件)`);
  }

  if (errors.length > 0) {
    throw new Error(`シードデータ(案件)の検算に失敗しました:\n- ${errors.join('\n- ')}`);
  }
}

export function validateLeads(leads: LeadSeed[]): void {
  const errors: string[] = [];
  if (leads.length !== LEAD_COUNT) errors.push(`リードの総数が${leads.length}件(期待値${LEAD_COUNT}件)`);

  const statusCounts: Record<string, number> = {};
  for (const l of leads) statusCounts[l.status] = (statusCounts[l.status] ?? 0) + 1;
  for (const [status, expected] of Object.entries(LEAD_STATUS_COUNTS)) {
    if (statusCounts[status] !== expected) {
      errors.push(`status=${status}の件数が${statusCounts[status] ?? 0}件(期待値${expected}件)`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`シードデータ(リード)の検算に失敗しました:\n- ${errors.join('\n- ')}`);
  }
}

// ---------- kintoneへの投入 ----------
function toRecord(obj: object): Record<string, { value: unknown }> {
  const record: Record<string, { value: unknown }> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) record[key] = { value };
  }
  return record;
}

async function insertBatched(
  kintone: KintoneAdminClient,
  appId: number,
  records: Array<Record<string, { value: unknown }>>,
  label: string,
): Promise<void> {
  const CHUNK = 100;
  let inserted = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    await kintone.addRecords(appId, chunk);
    inserted += chunk.length;
    console.log(`   ${label}: ${inserted}/${records.length}件投入`);
  }
}

async function main() {
  const env = loadEnv();
  const clear = process.argv.includes('--clear');

  const accountAppId = requireAppId(env, 'kintoneAppIdAccount');
  const opportunityAppId = requireAppId(env, 'kintoneAppIdOpportunity');
  const leadAppId = requireAppId(env, 'kintoneAppIdLead');

  const kintone = new KintoneAdminClient({
    subdomain: env.kintoneSubdomain,
    username: env.kintoneAdminUser,
    password: env.kintoneAdminPassword,
  });

  console.log('デモデータを生成中(固定シード、再現可能)...');
  const accounts = buildAccounts();
  const opportunities = buildOpportunities(accounts);
  const leads = buildLeads();

  console.log('投入前の検算を実行中...');
  validateOpportunities(opportunities);
  validateLeads(leads);
  console.log('   -> OK: 構造チェックすべて通過。');

  if (clear) {
    console.log('--clear: 既存レコードを削除中(取引先・案件・リード)...');
    const deletedOpp = await kintone.deleteAllRecords(opportunityAppId);
    const deletedLead = await kintone.deleteAllRecords(leadAppId);
    const deletedAccount = await kintone.deleteAllRecords(accountAppId);
    console.log(`   -> 削除: 取引先${deletedAccount}件 / 案件${deletedOpp}件 / リード${deletedLead}件`);
  }

  console.log(`取引先を投入中(${accounts.length}件)...`);
  await insertBatched(kintone, accountAppId, accounts.map(toRecord), '取引先');

  console.log(`案件を投入中(${opportunities.length}件)...`);
  await insertBatched(kintone, opportunityAppId, opportunities.map(toRecord), '案件');

  console.log(`リードを投入中(${leads.length}件)...`);
  await insertBatched(kintone, leadAppId, leads.map(toRecord), 'リード');

  console.log('投入後の検算(industry自動転記)を確認中...');
  const savedOpps = await kintone.getAllRecords<{ industry?: { value?: string }; deal_name: { value: string } }>(
    opportunityAppId,
  );
  const missingIndustry = savedOpps.filter((o) => !o.industry?.value);
  if (missingIndustry.length > 0) {
    throw new Error(
      `investigate: ${missingIndustry.length}件の案件でindustryが自動転記されていません: ${missingIndustry
        .slice(0, 5)
        .map((o) => o.deal_name.value)
        .join(', ')}`,
    );
  }
  console.log(`   -> OK: 全${savedOpps.length}件でindustryが自動転記されています。`);

  console.log('\n完了。');
  console.log(`  取引先: ${accounts.length}件 / 案件: ${opportunities.length}件 / リード: ${leads.length}件`);
}

// build*/validate* はテスト(src/scripts/__tests__/seed-demo-data.test.ts)から import して
// 使うため、main() はスクリプトとして直接実行された時だけ動かす(import時にkintoneへ
// 接続しようとしないよう、smoke-test-customize.ts と同じガードパターンを踏襲)。
if (process.argv[1] && process.argv[1].includes('seed-demo-data')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
