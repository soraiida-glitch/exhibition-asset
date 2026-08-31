import { describe, expect, it } from 'vitest';
import {
  aggregateByDimension,
  aggregateCrossTab,
  aggregateEmbeddable,
  aggregateFunnel,
  applyFilters,
  buildBiResult,
  buildFactSheet,
  buildInterpretation,
  computeMetric,
  runAggregate,
} from '../aggregate';
import type { KintoneRecordFields } from '../aggregate';
import { DIMENSIONS } from '../dimensions';
import { fiscalEmbeddable, resolvePeriodPreset } from '../fiscal';
import { OPPORTUNITY_STAGE_OPTIONS } from '../../apps/schema';

function opp(fields: {
  stage: string;
  amount: number;
  owner?: string;
  industry?: string;
  loss_reason?: string;
  account?: string;
  close_date?: string;
}): KintoneRecordFields {
  return {
    stage: { value: fields.stage },
    amount: { type: 'NUMBER', value: String(fields.amount) },
    owner: { value: fields.owner ?? '' },
    industry: { value: fields.industry ?? '' },
    loss_reason: { value: fields.loss_reason ?? '' },
    account: { value: fields.account ?? '' },
    close_date: { value: fields.close_date ?? '' },
  };
}

function lead(fields: { status: string; source: string }): KintoneRecordFields {
  return {
    status: { value: fields.status },
    source: { value: fields.source },
  };
}

// 8件: フェーズ混在・失注理由あり・close_date 空を1件含む fixture(要件定義書 §9 の数値精度ゲート用)。
const OPPORTUNITIES: KintoneRecordFields[] = [
  opp({ stage: '成約', amount: 1_000_000, owner: '佐藤', industry: 'IT・ソフトウェア', account: 'テック商事', close_date: '2026-05-10' }),
  opp({ stage: '成約', amount: 2_000_000, owner: '佐藤', industry: '製造', account: '山田製作所', close_date: '2026-06-20' }),
  opp({ stage: '失注', amount: 500_000, owner: '鈴木', industry: 'IT・ソフトウェア', loss_reason: '価格', account: 'テック商事', close_date: '2026-04-15' }),
  opp({ stage: '失注', amount: 300_000, owner: '鈴木', industry: '製造', loss_reason: '競合', account: '山田製作所', close_date: '2026-07-01' }),
  opp({ stage: '失注', amount: 800_000, owner: '佐藤', industry: 'IT・ソフトウェア', loss_reason: '価格', account: 'テック商事', close_date: '2025-12-01' }),
  opp({ stage: '交渉中', amount: 1_500_000, owner: '鈴木', industry: '小売・流通', account: '大阪商店', close_date: '2026-08-01' }),
  opp({ stage: '提案中', amount: 400_000, owner: '佐藤', industry: '製造', account: '山田製作所', close_date: '2026-09-01' }),
  // close_date が空 — 期間フィルタでは常に除外される(§3)。
  opp({ stage: '初期接触', amount: 100_000, owner: '鈴木', industry: 'サービス', account: '新規商事', close_date: '' }),
];

describe('computeMetric', () => {
  it('counts and sums all records unconditionally', () => {
    expect(computeMetric(OPPORTUNITIES, 'count')).toBe(8);
    expect(computeMetric(OPPORTUNITIES, 'amount_sum')).toBe(
      1_000_000 + 2_000_000 + 500_000 + 300_000 + 800_000 + 1_500_000 + 400_000 + 100_000,
    );
  });

  it('computes amount_avg over all records', () => {
    const avg = computeMetric(OPPORTUNITIES, 'amount_avg');
    expect(avg).toBeCloseTo((1_000_000 + 2_000_000 + 500_000 + 300_000 + 800_000 + 1_500_000 + 400_000 + 100_000) / 8);
  });

  it('computes won_amount/won_count from stage=成約 only', () => {
    expect(computeMetric(OPPORTUNITIES, 'won_count')).toBe(2);
    expect(computeMetric(OPPORTUNITIES, 'won_amount')).toBe(3_000_000);
  });

  it('computes lost_count from stage=失注 only', () => {
    expect(computeMetric(OPPORTUNITIES, 'lost_count')).toBe(3);
  });

  it('computes win_rate with a closed-only denominator (成約+失注), excluding in-progress deals', () => {
    // 成約2件、失注3件、進行中3件(交渉中・提案中・初期接触) → 分母は 2+3=5、進行中は含めない
    expect(computeMetric(OPPORTUNITIES, 'win_rate')).toBeCloseTo(2 / 5);
  });

  it('returns 0 for an empty record set instead of NaN', () => {
    expect(computeMetric([], 'amount_avg')).toBe(0);
    expect(computeMetric([], 'win_rate')).toBe(0);
  });
});

describe('applyFilters', () => {
  it('excludes records with an empty close_date when a period (range) filter is applied', () => {
    const filtered = applyFilters(OPPORTUNITIES, [
      { field: 'close_date', op: 'range', value: { start: '2026-04-01', end: '2027-03-31' } },
    ]);
    // 空の close_date の1件と、期間外の1件(2025-12-01)が除外される
    expect(filtered).toHaveLength(6);
    expect(filtered.every((r) => (r.close_date?.value as string) !== '')).toBe(true);
  });

  it('supports stage in (...) filtering', () => {
    const filtered = applyFilters(OPPORTUNITIES, [{ field: 'stage', op: 'in', value: ['成約', '失注'] }]);
    expect(filtered).toHaveLength(5);
  });
});

describe('aggregateByDimension', () => {
  it('seeds every known stage option so zero-count stages still appear, in option order', () => {
    const series = aggregateByDimension(OPPORTUNITIES, 'count', 'stage', OPPORTUNITY_STAGE_OPTIONS);
    expect(series.map((s) => s.key)).toEqual(OPPORTUNITY_STAGE_OPTIONS);
    expect(series.find((s) => s.key === '見積提出')?.value).toBe(0);
    expect(series.find((s) => s.key === '失注')?.value).toBe(3);
  });

  it('sorts descending by value when no category list is given (ranking view)', () => {
    const series = aggregateByDimension(OPPORTUNITIES, 'amount_sum', 'owner');
    const values = series.map((s) => s.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it('supports the loss_reason dimension, meaningful once pre-filtered to stage=失注', () => {
    const lost = applyFilters(OPPORTUNITIES, [{ field: 'stage', op: '=', value: '失注' }]);
    const series = aggregateByDimension(lost, 'count', 'loss_reason');
    expect(series.find((s) => s.key === '価格')?.value).toBe(2);
    expect(series.find((s) => s.key === '競合')?.value).toBe(1);
  });
});

describe('aggregateFunnel', () => {
  it('walks stage order and reports a count per stage', () => {
    const steps = aggregateFunnel(OPPORTUNITIES, 'count', OPPORTUNITY_STAGE_OPTIONS, 'stage');
    expect(steps.map((s) => s.stage)).toEqual(OPPORTUNITY_STAGE_OPTIONS);
    expect(steps.find((s) => s.stage === '成約')?.value).toBe(2);
  });

  it('is reusable for a non-opportunity funnel via a different stageField (lead funnel)', () => {
    const leads = [
      lead({ status: '未対応', source: '名刺' }),
      lead({ status: '対応中', source: '名刺' }),
      lead({ status: '変換済み', source: '紹介' }),
    ];
    const steps = aggregateFunnel(leads, 'count', ['未対応', '対応中', '変換済み'], 'status');
    expect(steps).toEqual([
      { stage: '未対応', value: 1 },
      { stage: '対応中', value: 1 },
      { stage: '変換済み', value: 1 },
    ]);
  });
});

describe('aggregateCrossTab', () => {
  it('cross-tabs loss_reason x industry on stage=失注-filtered records (the flagship T5 case)', () => {
    const lost = applyFilters(OPPORTUNITIES, [{ field: 'stage', op: '=', value: '失注' }]);
    const cross = aggregateCrossTab(lost, 'count', 'loss_reason', undefined, 'industry', undefined);

    expect(cross.rows.sort()).toEqual(['価格', '競合'].sort());
    expect(cross.cols.sort()).toEqual(['IT・ソフトウェア', '製造'].sort());
    const cell = cross.matrix.find((m) => m.row === '価格' && m.col === 'IT・ソフトウェア');
    expect(cell?.value).toBe(2);
  });
});

describe('buildInterpretation', () => {
  it('deterministically states metric + dimension + filters without any LLM involvement', () => {
    const text = buildInterpretation('won_amount', 'owner', undefined, ['今期(2026-04-01〜2027-03-31)']);
    expect(text).toBe('今期(2026-04-01〜2027-03-31)で受注額を担当者別に集計しました。');
  });

  it('renders a cross-tab subject when both dimensions are given', () => {
    const text = buildInterpretation('count', 'loss_reason', 'industry', []);
    expect(text).toBe('件数を失注理由×業種別に集計しました。');
  });
});

describe('runAggregate', () => {
  const input = { opportunityRecords: OPPORTUNITIES, leadRecords: [] };

  it('T1: returns a single KPI value', () => {
    const result = runAggregate(input, { template: 'T1', metric: 'won_amount', filters: [] });
    expect(result).toEqual({ ok: true, template: 'T1', data: { value: 3_000_000 } });
  });

  it('T2: returns a per-dimension series', () => {
    const result = runAggregate(input, { template: 'T2', metric: 'count', dimension: 'stage', filters: [] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { series: { key: string; value: number }[] };
      expect(data.series.map((s) => s.key)).toEqual(OPPORTUNITY_STAGE_OPTIONS);
    }
  });

  it('T5: cross-tabs two compatible dimensions', () => {
    const result = runAggregate(input, {
      template: 'T5',
      metric: 'count',
      dimension: 'loss_reason',
      dimensionB: 'industry',
      filters: [{ field: 'stage', op: '=', value: '失注' }],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a lead-targeted dimension combined with an amount metric', () => {
    const result = runAggregate(input, {
      template: 'T2',
      metric: 'amount_sum',
      dimension: 'lead_source',
      filters: [],
    });
    expect(result).toEqual({ ok: false, message: 'リードの分析では件数のみ集計できます' });
  });

  it('rejects cross-tabbing an opportunity dimension against a lead dimension', () => {
    const result = runAggregate(input, {
      template: 'T5',
      metric: 'count',
      dimension: 'stage',
      dimensionB: 'lead_source',
      filters: [],
    });
    expect(result.ok).toBe(false);
  });
});

describe('DIMENSION_FIELD_MAP drift guard', () => {
  it('stays in sync with src/semantic/dimensions.ts (aggregate.ts intentionally duplicates it to stay import-free/embeddable)', () => {
    const input = { opportunityRecords: OPPORTUNITIES, leadRecords: [lead({ status: '未対応', source: '名刺' })] };

    for (const [code, def] of Object.entries(DIMENSIONS)) {
      // aggregate.ts's copy is exercised indirectly: T2 aggregation must succeed for every real
      // dimension code and must read the same field dimensions.ts declares.
      const compatibleMetric = def.targetApp === 'lead' ? 'count' : 'amount_sum';
      const result = runAggregate(input, {
        template: 'T2',
        metric: compatibleMetric,
        dimension: code as never,
        filters: [],
      });
      expect(result.ok, `dimension ${code} should be supported by runAggregate`).toBe(true);
    }
  });
});

describe('buildFactSheet (narrateとquery/refineの両方で共用する表示整形)', () => {
  it('formats T1 in 万円 notation, never the raw yen figure (regression: LLM once mis-converted this itself)', () => {
    const factSheet = buildFactSheet('T1', 'won_amount', '受注額', { value: 8_150_000 });
    expect(factSheet).toBe('受注額: 約815万円');
    expect(factSheet).not.toMatch(/8,150,000|8150000/);
  });

  it('formats T2 series with each key/value pair', () => {
    const factSheet = buildFactSheet('T2', 'count', '担当者別', {
      series: [
        { key: '飯田', value: 12 },
        { key: '佐藤', value: 8 },
      ],
    });
    expect(factSheet).toBe('飯田: 12件、佐藤: 8件');
  });

  it('formats T5 matrix, skipping zero-value cells', () => {
    const factSheet = buildFactSheet('T5', 'count', '失注理由×業種', {
      matrix: [
        { row: '価格', col: '製造', value: 5 },
        { row: '価格', col: 'IT', value: 0 },
      ],
    });
    expect(factSheet).toBe('価格×製造: 5件');
  });

  it('formats win_rate as a percentage with one decimal, not a 0-1 fraction', () => {
    const factSheet = buildFactSheet('T1', 'win_rate', '受注率', { value: 50 });
    expect(factSheet).toBe('受注率: 50.0%');
  });
});

// RELVA BI 追加要件定義書 — Aggregate BI(n8n)とdashboard.ts(初期ダッシュボード)の両方が呼ぶ
// 唯一の「意味論コード → 表示確定済みBiResult」変換。period解決は引数注入(resolvePeriod)で
// 受け取る設計であることを含めて検証する(このファイル自体は実行時importを持たない)。
describe('buildBiResult (Aggregate BI・dashboard.ts共通の唯一の変換経路)', () => {
  const today = new Date(2026, 7, 30); // 2026-08-30 -> 今期 2026-04-01〜2027-03-31
  const input = { opportunityRecords: OPPORTUNITIES, leadRecords: [] };

  it('builds a T1 biResult with a period filter label and a matching factSheet', () => {
    const outcome = buildBiResult(input, { template: 'T1', metric: 'won_amount', period: 'current_fiscal_year' }, today, resolvePeriodPreset);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.biResult.template).toBe('T1');
    expect(outcome.biResult.filtersApplied[0]).toEqual({ label: '期間', value: '今期(2026-04-01〜2027-03-31)' });
    expect(outcome.factSheet).toContain('万円');
  });

  it('builds a T2 biResult, appending the dimension label to the title', () => {
    const outcome = buildBiResult(input, { template: 'T2', metric: 'count', dimension: 'owner', period: 'all' }, today, resolvePeriodPreset);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.biResult.title).toBe('件数(担当者別)');
    expect(outcome.biResult.filtersApplied).toEqual([]); // period:allは絞り込みを一切かけない
  });

  it('propagates a structured error from runAggregate instead of throwing (e.g. invalid dimension/metric combo)', () => {
    const outcome = buildBiResult(
      input,
      { template: 'T2', metric: 'amount_sum', dimension: 'lead_source', period: 'all' },
      today,
      resolvePeriodPreset,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.message).toMatch(/件数のみ/);
  });

  it('is callable standalone when embedded via aggregateEmbeddable() + fiscalEmbeddable() together (the exact concatenation Aggregate BI uses)', () => {
    const embeddable = `${aggregateEmbeddable()}\n${fiscalEmbeddable()}`;
    // 埋め込み文字列の中では resolvePeriodPreset がスコープ内に既にあるので(fiscalEmbeddable()
    // 経由)、外からは3引数の関数として呼べる——4引数版(buildBiResultそのもの)とは型が異なる。
    const isolatedBuild = new Function(
      `${embeddable}\nreturn buildBiResult(arguments[0], arguments[1], arguments[2], resolvePeriodPreset);`,
    ) as (
      input: Parameters<typeof buildBiResult>[0],
      plan: Parameters<typeof buildBiResult>[1],
      today: Date,
    ) => ReturnType<typeof buildBiResult>;

    const plan = { template: 'T1' as const, metric: 'won_amount' as const, period: 'current_fiscal_year' as const };
    expect(isolatedBuild(input, plan, today)).toEqual(buildBiResult(input, plan, today, resolvePeriodPreset));
  });
});

describe('aggregateEmbeddable', () => {
  it('is self-contained (no imports/require) and starts with the __name shim', () => {
    const embeddable = aggregateEmbeddable();
    expect(embeddable).not.toContain('require(');
    expect(embeddable).not.toContain('import ');
    expect(embeddable.startsWith('function __name(fn)')).toBe(true);
  });

  it('actually executes standalone in an isolated Function scope, matching the imported implementation', () => {
    const embeddable = aggregateEmbeddable();
    const isolatedRun = new Function(
      `${embeddable}\nreturn runAggregate(arguments[0], arguments[1]);`,
    ) as typeof runAggregate;

    const input = { opportunityRecords: OPPORTUNITIES, leadRecords: [] };
    const params = { template: 'T1' as const, metric: 'won_amount' as const, filters: [] };

    expect(isolatedRun(input, params)).toEqual(runAggregate(input, params));
  });
});
