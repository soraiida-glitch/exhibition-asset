import { describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_COUNT,
  HIGH_WIN_INDUSTRY,
  LEAD_COUNT,
  LEAD_STATUS_COUNTS,
  LOSS_HEATMAP_INDUSTRY,
  LOSS_HEATMAP_REASON,
  LOSS_REASON_COUNTS,
  OPPORTUNITY_COUNT,
  OWNERS,
  STAGE_COUNTS,
  buildAccounts,
  buildLeads,
  buildOpportunities,
  validateLeads,
  validateOpportunities,
} from '../seed-demo-data';

// 要件定義書 §8-4: 投入前の検算をローカルの生成結果に対しても実行する — kintoneへ実際に
// 投入する前に、分布の振り付け(§8-3)が確定値どおりであることをここで固定する。

describe('seed-demo-data generation (fixed seed, reproducible)', () => {
  const accounts = buildAccounts();
  const opportunities = buildOpportunities(accounts);
  const leads = buildLeads();

  it('produces the exact prescribed record counts', () => {
    expect(accounts).toHaveLength(ACCOUNT_COUNT);
    expect(opportunities).toHaveLength(OPPORTUNITY_COUNT);
    expect(leads).toHaveLength(LEAD_COUNT);
  });

  it('passes the §8-4 structural validation without throwing', () => {
    expect(() => validateOpportunities(opportunities)).not.toThrow();
    expect(() => validateLeads(leads)).not.toThrow();
  });

  it('matches the exact stage distribution from §8-3', () => {
    const counts: Record<string, number> = {};
    for (const o of opportunities) counts[o.stage] = (counts[o.stage] ?? 0) + 1;
    expect(counts).toEqual(STAGE_COUNTS);
  });

  it('matches the exact loss_reason distribution from §8-3 (no missing values on lost deals)', () => {
    const lost = opportunities.filter((o) => o.stage === '失注');
    expect(lost).toHaveLength(40);
    expect(lost.every((o) => !!o.loss_reason)).toBe(true);

    const counts: Record<string, number> = {};
    for (const o of lost) counts[o.loss_reason!] = (counts[o.loss_reason!] ?? 0) + 1;
    expect(counts).toEqual(LOSS_REASON_COUNTS);
  });

  it('matches the exact lead status distribution from §8-3', () => {
    const counts: Record<string, number> = {};
    for (const l of leads) counts[l.status] = (counts[l.status] ?? 0) + 1;
    expect(counts).toEqual(LEAD_STATUS_COUNTS);
  });

  it('every non-lost/won opportunity still has a required close_date', () => {
    // §8-4: 全stageでclose_dateを持たせる方針(成約/失注は必須、それ以外も予定日として設定)。
    expect(opportunities.every((o) => !!o.close_date)).toBe(true);
  });

  it('every owner is one of the 6 prescribed reps', () => {
    expect(opportunities.every((o) => (OWNERS as readonly string[]).includes(o.owner))).toBe(true);
  });

  it('highlights loss_reason=価格 concentrated on 製造 accounts for the flagship T5 heatmap story', () => {
    const lostByReasonIndustry = opportunities.filter((o) => o.stage === '失注' && o.loss_reason === LOSS_HEATMAP_REASON);
    const accountIndustry = new Map(accounts.map((a) => [a.company_name, a.industry]));
    const manufacturingCount = lostByReasonIndustry.filter((o) => accountIndustry.get(o.account) === LOSS_HEATMAP_INDUSTRY).length;
    // 5件を製造業種に寄せる設計 — 全16件中5件以上が製造(ランダムなら1〜2件程度のはず)。
    expect(manufacturingCount).toBeGreaterThanOrEqual(5);
  });

  it('produces a clear, non-flat owner ranking by total amount (weighted selection, not uniform)', () => {
    const totals: Record<string, number> = {};
    for (const o of opportunities) totals[o.owner] = (totals[o.owner] ?? 0) + o.amount;
    const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    // 重み付け選択どおり、飯田がトップに来ることを確認(完全ランダムなら偶然に左右される)。
    expect(ranked[0][0]).toBe('飯田');
    // トップと最下位に明確な差があること(横並びの平板なデータになっていないか)。
    expect(ranked[0][1]).toBeGreaterThan(ranked[ranked.length - 1][1] * 1.5);
  });

  it('gives 金融・保険 a higher win rate than 製造 (industry win-rate bias)', () => {
    const accountIndustry = new Map(accounts.map((a) => [a.company_name, a.industry]));
    function winRate(industry: string): number {
      const deals = opportunities.filter(
        (o) => accountIndustry.get(o.account) === industry && (o.stage === '成約' || o.stage === '失注'),
      );
      const won = deals.filter((o) => o.stage === '成約').length;
      return deals.length > 0 ? won / deals.length : 0;
    }
    expect(winRate(HIGH_WIN_INDUSTRY)).toBeGreaterThan(winRate(LOSS_HEATMAP_INDUSTRY));
  });

  it('marks exactly 5 stalled 交渉中 deals with a close_date already in the past relative to the fiscal year', () => {
    const negotiating = opportunities.filter((o) => o.stage === '交渉中');
    const stalled = negotiating.filter((o) => o.close_date === '2026-07-10');
    expect(stalled).toHaveLength(5);
  });

  it('is deterministic across separate runs (fresh process = fresh PRNG stream = identical output)', async () => {
    // rand はモジュールスコープの継続的なストリーム(mulberry32(SEED)を1回だけ生成)なので、
    // 同一プロセス内で builder を2回呼ぶと当然ズレる(2回目は続きの乱数を消費するため)。
    // 「シード固定で再現可能」が保証するのは"次に npm run seed:demo を実行しても同じ結果になる"
    // ことであり、それは Vitest のモジュールキャッシュを外して再import することで検証する。
    vi.resetModules();
    const fresh = await import('../seed-demo-data');
    const accounts2 = fresh.buildAccounts();
    const opportunities2 = fresh.buildOpportunities(accounts2);
    expect(accounts2).toEqual(accounts);
    expect(opportunities2).toEqual(opportunities);
  });
});

describe('validateOpportunities / validateLeads (negative cases)', () => {
  it('throws when a lost deal is missing loss_reason', () => {
    const bad = buildOpportunities(buildAccounts()).map((o, i) => (i === 0 ? { ...o, stage: '失注', loss_reason: undefined } : o));
    expect(() => validateOpportunities(bad)).toThrow(/loss_reason/);
  });

  it('throws when the stage distribution no longer matches §8-3', () => {
    const opps = buildOpportunities(buildAccounts());
    const differentStage = opps[0].stage === '初期接触' ? '交渉中' : '初期接触';
    const tampered = opps.map((o, i) => (i === 0 ? { ...o, stage: differentStage } : o));
    expect(() => validateOpportunities(tampered)).toThrow(/件数が/);
  });
});
