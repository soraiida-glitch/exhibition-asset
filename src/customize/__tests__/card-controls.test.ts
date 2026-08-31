import { describe, expect, it } from 'vitest';
import { computeChipGroups } from '../card-controls';
import type { ChatCardState } from '../../semantic/cards';

function card(overrides: Partial<ChatCardState>): ChatCardState {
  return {
    template: 'T2',
    params: { metric: 'amount_sum', dimension: 'owner', period: { preset: 'current_fiscal_year' } },
    title: 't',
    ...overrides,
  };
}

function labelsOf(groups: ReturnType<typeof computeChipGroups>, groupLabel: string): string[] {
  return groups.find((g) => g.label === groupLabel)?.chips.map((c) => c.label) ?? [];
}

describe('computeChipGroups (RELVA BI 追加要件定義書 §3-1: ガードレール内のワンクリックチップ)', () => {
  it('never offers the currently-active period as a chip', () => {
    const groups = computeChipGroups(card({ params: { metric: 'count', period: { preset: 'current_fiscal_year' } } }));
    expect(labelsOf(groups, '期間')).toEqual(['今月', '先月', '全期間']);
  });

  it('offers dimension chips only for the same target app as the current dimension (never a cross-app combo)', () => {
    // owner は案件側 -> 案件側の次元(業種/フェーズ/失注理由/取引先/提案書ステータス)だけが候補、
    // リード側(流入経路/リードステータス)は絶対に出ない。
    const groups = computeChipGroups(card({ params: { metric: 'amount_sum', dimension: 'owner' } }));
    const dimChips = labelsOf(groups, '切り口');
    expect(dimChips).toContain('業種');
    expect(dimChips).not.toContain('担当者'); // 現在アクティブなので除外
    expect(dimChips).not.toContain('流入経路');
    expect(dimChips).not.toContain('リードステータス');
  });

  it('offers only lead-side dimensions when the current dimension already targets leads', () => {
    const groups = computeChipGroups(card({ params: { metric: 'count', dimension: 'lead_source' } }));
    const dimChips = labelsOf(groups, '切り口');
    expect(dimChips).toEqual(['リードステータス']);
  });

  it('never offers a metric chip when the current dimension is lead-side (count is the only valid metric there)', () => {
    const groups = computeChipGroups(card({ params: { metric: 'count', dimension: 'lead_source' } }));
    expect(groups.find((g) => g.label === '指標')).toBeUndefined();
  });

  it('offers metric chips (excluding the current one) for opportunity-side dimensions', () => {
    const groups = computeChipGroups(card({ params: { metric: 'amount_sum', dimension: 'owner' } }));
    const metricChips = labelsOf(groups, '指標');
    expect(metricChips).toContain('件数');
    expect(metricChips).not.toContain('金額合計'); // 現在アクティブなので除外
  });

  it('offers topN/sort chips for T2 (both allowed per cards.ts ALLOWED_PARAM_KEYS)', () => {
    const groups = computeChipGroups(card({ template: 'T2', params: { metric: 'count', dimension: 'stage' } }));
    expect(labelsOf(groups, '件数')).toEqual(['上位5件', '上位10件']);
    expect(labelsOf(groups, '並び順')).toEqual(['多い順', '少ない順']);
  });

  it('never offers dimension/topN/sort chips for T1 (not in ALLOWED_PARAM_KEYS), but does offer metric+period (which are)', () => {
    const groups = computeChipGroups({ template: 'T1', params: { metric: 'won_amount', period: { preset: 'current_fiscal_year' } }, title: 't' });
    expect(groups.find((g) => g.label === '切り口')).toBeUndefined(); // T1にdimensionは無い
    expect(groups.find((g) => g.label === '件数')).toBeUndefined(); // T1にtopNは無い
    expect(groups.find((g) => g.label === '並び順')).toBeUndefined(); // T1にsortは無い
    // T1は metric と period を持つ(cards.ts の ALLOWED_PARAM_KEYS.T1 参照)——
    // 「今期の受注額は?」→「今期の件数は?」のような指標切り替えは正当なリファイン。
    expect(labelsOf(groups, '期間').length).toBeGreaterThan(0);
    expect(labelsOf(groups, '指標')).toContain('件数');
  });

  it('never offers topN/sort chips for T4 (pipeline is always the full funnel)', () => {
    const groups = computeChipGroups({ template: 'T4', params: { metric: 'count', period: { preset: 'current_fiscal_year' } }, title: 't' });
    expect(groups.find((g) => g.label === '件数')).toBeUndefined();
    expect(groups.find((g) => g.label === '並び順')).toBeUndefined();
  });

  it('offers dimension chips for both axes candidates on T5 (dimension key allowed), never mixing target apps', () => {
    const groups = computeChipGroups({
      template: 'T5',
      params: { metric: 'count', dimension: 'loss_reason', dimensionB: 'industry' },
      title: 't',
    });
    const dimChips = labelsOf(groups, '切り口');
    // dimension(loss_reasonの対象=案件)側の候補だけを見るため、リード系は絶対に出ない。
    expect(dimChips).not.toContain('流入経路');
    expect(dimChips).not.toContain('リードステータス');
  });
});
