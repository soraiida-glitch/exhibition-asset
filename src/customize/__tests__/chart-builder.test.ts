import { describe, expect, it } from 'vitest';
import { buildComboOutcome, builderFieldsFor, dimensionOptionsFor, fieldsForVisual, isComboVisual, metricOptionsFor, resolveVisual } from '../chart-builder';
import type { KintoneRecordFields } from '../../semantic/aggregate';

function opp(fields: { stage: string; amount: number; owner?: string; close_date?: string }): KintoneRecordFields {
  return {
    stage: { value: fields.stage },
    amount: { type: 'NUMBER', value: String(fields.amount) },
    owner: { value: fields.owner ?? '' },
    close_date: { value: fields.close_date ?? '' },
  };
}

describe('builderFieldsFor (RELVA BI 追加要件定義書 §3・§6: グラフビルダーの表示欄はALLOWED_PARAM_KEYSと同じ表を参照する)', () => {
  it('T1 shows entity/metric but not dimension/dimensionB/topN/sort/comboMetric', () => {
    const fields = builderFieldsFor('T1');
    expect(fields).toEqual({ entity: true, dimension: false, dimensionB: false, metric: true, topN: false, sort: false, comboMetric: false });
  });

  it('T2 shows dimension/metric/topN/sort but not entity/dimensionB/comboMetric', () => {
    const fields = builderFieldsFor('T2');
    expect(fields).toEqual({ entity: false, dimension: true, dimensionB: false, metric: true, topN: true, sort: true, comboMetric: false });
  });

  it('T4 shows only metric (pipeline is always the full stage funnel, no axis to choose)', () => {
    const fields = builderFieldsFor('T4');
    expect(fields).toEqual({ entity: false, dimension: false, dimensionB: false, metric: true, topN: false, sort: false, comboMetric: false });
  });

  it('T5 shows dimension and dimensionB (the one template needing 2 axes) plus metric', () => {
    const fields = builderFieldsFor('T5');
    expect(fields).toEqual({ entity: false, dimension: true, dimensionB: true, metric: true, topN: false, sort: false, comboMetric: false });
  });

  it('T8 shows entity/topN/sort but not metric (record list has no metric) or dimension', () => {
    const fields = builderFieldsFor('T8');
    expect(fields).toEqual({ entity: true, dimension: false, dimensionB: false, metric: false, topN: true, sort: true, comboMetric: false });
  });
});

describe('dimensionOptionsFor (never lets an opportunity-side and lead-side axis mix)', () => {
  it('returns all dimensions when no targetApp filter is given', () => {
    const codes = dimensionOptionsFor().map((d) => d.code);
    expect(codes).toContain('owner');
    expect(codes).toContain('lead_source');
  });

  it('returns only opportunity-side dimensions when filtered', () => {
    const codes = dimensionOptionsFor('opportunity').map((d) => d.code);
    expect(codes).toContain('owner');
    expect(codes).toContain('proposal_status');
    expect(codes).not.toContain('lead_source');
    expect(codes).not.toContain('lead_status');
  });

  it('returns only lead-side dimensions when filtered', () => {
    const codes = dimensionOptionsFor('lead').map((d) => d.code);
    expect(codes).toEqual(['lead_source', 'lead_status']);
  });
});

describe('fieldsForVisual (ユーザー要望で追加した「棒グラフの種類」「月別推移」対応)', () => {
  it('bar_h/bar_v/donut (T2の見た目バリエーション) show the same fields as plain T2', () => {
    expect(fieldsForVisual('bar_h')).toEqual(builderFieldsFor('T2'));
    expect(fieldsForVisual('bar_v')).toEqual(builderFieldsFor('T2'));
    expect(fieldsForVisual('donut')).toEqual(builderFieldsFor('T2'));
  });

  it('trend_line (月別推移) hides dimension/entity/sort — it buckets close_date by month, not by a category', () => {
    const fields = fieldsForVisual('trend_line');
    expect(fields.dimension).toBe(false);
    expect(fields.entity).toBe(false);
    expect(fields.sort).toBe(false);
    expect(fields.metric).toBe(true); // 指標(Y軸)は必要
  });

  it('the 4 crosstab bar variants (grouped/stacked x horizontal/vertical) show the same fields as the heatmap (all T5)', () => {
    const heatmapFields = fieldsForVisual('crosstab_heatmap');
    expect(fieldsForVisual('crosstab_grouped_h')).toEqual(heatmapFields);
    expect(fieldsForVisual('crosstab_grouped_v')).toEqual(heatmapFields);
    expect(fieldsForVisual('crosstab_stacked_h')).toEqual(heatmapFields);
    expect(fieldsForVisual('crosstab_stacked_v')).toEqual(heatmapFields);
    expect(heatmapFields.dimension).toBe(true);
    expect(heatmapFields.dimensionB).toBe(true);
  });

  it('gauge (T1のもう1つの見た目) shows the same fields as kpi (both plain T1)', () => {
    expect(fieldsForVisual('gauge')).toEqual(fieldsForVisual('kpi'));
  });

  it('area (T2のカテゴリ別見た目) shows the same fields as bar_h/bar_v/donut', () => {
    expect(fieldsForVisual('area')).toEqual(fieldsForVisual('bar_h'));
  });

  it('trend_area (月別推移のもう1つの見た目) hides dimension/entity/sort just like trend_line', () => {
    expect(fieldsForVisual('trend_area')).toEqual(fieldsForVisual('trend_line'));
  });

  it('scatter hides metric/topN/sort (Y軸は金額に固定・切り口だけ選ぶ) but keeps dimension', () => {
    const fields = fieldsForVisual('scatter');
    expect(fields.metric).toBe(false);
    expect(fields.topN).toBe(false);
    expect(fields.sort).toBe(false);
    expect(fields.dimension).toBe(true);
  });

  it('combo_bar_line shows comboMetric (第2の指標) but hides topN/sort (2系列の対応が崩れるため)', () => {
    const fields = fieldsForVisual('combo_bar_line');
    expect(fields.comboMetric).toBe(true);
    expect(fields.metric).toBe(true);
    expect(fields.topN).toBe(false);
    expect(fields.sort).toBe(false);
  });

  it('no other visual shows comboMetric', () => {
    const nonCombo: Parameters<typeof fieldsForVisual>[0][] = [
      'kpi', 'gauge', 'bar_h', 'bar_v', 'donut', 'area', 'scatter', 'trend_line', 'trend_area',
      'funnel', 'crosstab_heatmap', 'crosstab_grouped_h', 'crosstab_grouped_v', 'crosstab_stacked_h', 'crosstab_stacked_v', 'record_list',
    ];
    for (const v of nonCombo) expect(fieldsForVisual(v).comboMetric).toBe(false);
  });
});

describe('isComboVisual', () => {
  it('is true only for combo_bar_line', () => {
    expect(isComboVisual('combo_bar_line')).toBe(true);
    expect(isComboVisual('bar_h')).toBe(false);
    expect(isComboVisual('trend_line')).toBe(false);
  });
});

describe('resolveVisual (ピン留めカードを開き直した時に選んだ見た目を復元する)', () => {
  it('returns the stored visual when it is valid for the template', () => {
    expect(resolveVisual('T2', 'bar_v')).toBe('bar_v');
    expect(resolveVisual('T5', 'crosstab_stacked_h')).toBe('crosstab_stacked_h');
  });

  it('restores gauge/scatter/combo_bar_line the same way as any other visual', () => {
    expect(resolveVisual('T1', 'gauge')).toBe('gauge');
    expect(resolveVisual('T2', 'scatter')).toBe('scatter');
    expect(resolveVisual('T2', 'combo_bar_line')).toBe('combo_bar_line');
  });

  it('falls back to a sensible default when visual is missing (e.g. the 6 default cards, which never set it)', () => {
    expect(resolveVisual('T1', undefined)).toBe('kpi');
    expect(resolveVisual('T4', undefined)).toBe('funnel');
    expect(resolveVisual('T8', undefined)).toBe('record_list');
  });

  it('falls back to a sensible default when visual belongs to a different template (defensive, should not normally happen)', () => {
    expect(resolveVisual('T2', 'crosstab_heatmap')).not.toBe('crosstab_heatmap');
    expect(resolveVisual('T5', 'bar_h')).not.toBe('bar_h');
  });
});

describe('metricOptionsFor (a lead-side dimension only supports count, matching runAggregate)', () => {
  it('returns every metric when no dimension is selected', () => {
    const codes = metricOptionsFor().map((m) => m.code);
    expect(codes.length).toBeGreaterThan(1);
    expect(codes).toContain('amount_sum');
  });

  it('returns every metric for an opportunity-side dimension', () => {
    const codes = metricOptionsFor('owner').map((m) => m.code);
    expect(codes).toContain('amount_sum');
    expect(codes).toContain('win_rate');
  });

  it('returns only count for a lead-side dimension', () => {
    const codes = metricOptionsFor('lead_source').map((m) => m.code);
    expect(codes).toEqual(['count']);
  });
});

describe('buildComboOutcome (棒+折れ線の2指標コンボ——buildBiResultを指標ごとに2回呼ぶ組み立て)', () => {
  const today = new Date(2026, 7, 30); // 2026-08-30 -> 今期 2026-04-01〜2027-03-31
  const datasets = {
    opportunityRecords: [
      opp({ stage: '成約', amount: 1_000_000, owner: '佐藤', close_date: '2026-05-10' }),
      opp({ stage: '失注', amount: 500_000, owner: '鈴木', close_date: '2026-06-01' }),
      opp({ stage: '成約', amount: 2_000_000, owner: '佐藤', close_date: '2026-07-01' }),
    ],
    leadRecords: [] as KintoneRecordFields[],
  };

  it('combines 2 independently-aggregated metrics (bar=amount_sum, line=count) over the same dimension', () => {
    const outcome = buildComboOutcome(
      datasets,
      { dimension: 'owner', metric: 'amount_sum', comboMetric: 'count', period: { preset: 'current_fiscal_year' } },
      today,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.bar.metricLabel).toBe('金額合計');
    expect(outcome.result.line.metricLabel).toBe('件数');
    expect(outcome.result.bar.series).toEqual([
      { key: '佐藤', value: 3_000_000 },
      { key: '鈴木', value: 500_000 },
    ]);
    expect(outcome.result.line.series).toEqual([
      { key: '佐藤', value: 2 },
      { key: '鈴木', value: 1 },
    ]);
    // narrate/factSheet用の代表データは1本目(棒=amount_sum)の集計結果そのもの。
    expect(outcome.result.primaryData).toEqual({
      metric: { code: 'amount_sum', label: '金額合計', unit: '円' },
      dimension: { code: 'owner', label: '担当者' },
      series: outcome.result.bar.series,
    });
  });

  it('fails when either metric is missing (both are required for a 2-series combo)', () => {
    expect(buildComboOutcome(datasets, { dimension: 'owner', metric: 'amount_sum', period: { preset: 'current_fiscal_year' } }, today).ok).toBe(false);
    expect(buildComboOutcome(datasets, { dimension: 'owner', comboMetric: 'count', period: { preset: 'current_fiscal_year' } }, today).ok).toBe(false);
  });
});
