import { describe, expect, it } from 'vitest';
import { builderFieldsFor, dimensionOptionsFor, fieldsForVisual, metricOptionsFor, resolveVisual } from '../chart-builder';

describe('builderFieldsFor (RELVA BI 追加要件定義書 §3・§6: グラフビルダーの表示欄はALLOWED_PARAM_KEYSと同じ表を参照する)', () => {
  it('T1 shows entity/metric but not dimension/dimensionB/topN/sort', () => {
    const fields = builderFieldsFor('T1');
    expect(fields).toEqual({ entity: true, dimension: false, dimensionB: false, metric: true, topN: false, sort: false });
  });

  it('T2 shows dimension/metric/topN/sort but not entity/dimensionB', () => {
    const fields = builderFieldsFor('T2');
    expect(fields).toEqual({ entity: false, dimension: true, dimensionB: false, metric: true, topN: true, sort: true });
  });

  it('T4 shows only metric (pipeline is always the full stage funnel, no axis to choose)', () => {
    const fields = builderFieldsFor('T4');
    expect(fields).toEqual({ entity: false, dimension: false, dimensionB: false, metric: true, topN: false, sort: false });
  });

  it('T5 shows dimension and dimensionB (the one template needing 2 axes) plus metric', () => {
    const fields = builderFieldsFor('T5');
    expect(fields).toEqual({ entity: false, dimension: true, dimensionB: true, metric: true, topN: false, sort: false });
  });

  it('T8 shows entity/topN/sort but not metric (record list has no metric) or dimension', () => {
    const fields = builderFieldsFor('T8');
    expect(fields).toEqual({ entity: true, dimension: false, dimensionB: false, metric: false, topN: true, sort: true });
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
});

describe('resolveVisual (ピン留めカードを開き直した時に選んだ見た目を復元する)', () => {
  it('returns the stored visual when it is valid for the template', () => {
    expect(resolveVisual('T2', 'bar_v')).toBe('bar_v');
    expect(resolveVisual('T5', 'crosstab_stacked_h')).toBe('crosstab_stacked_h');
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
