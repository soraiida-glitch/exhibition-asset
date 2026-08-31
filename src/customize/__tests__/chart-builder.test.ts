import { describe, expect, it } from 'vitest';
import { builderFieldsFor, dimensionOptionsFor, metricOptionsFor } from '../chart-builder';

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
