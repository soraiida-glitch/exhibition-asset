import { describe, expect, it } from 'vitest';
import { buildDefaultDashboardCards } from '../dashboard-default';
import { runAggregate } from '../aggregate';
import type { KintoneRecordFields } from '../aggregate';

const OPPS: KintoneRecordFields[] = [
  { stage: { value: '成約' }, amount: { value: '1000000' }, owner: { value: '飯田' }, industry: { value: 'IT・ソフトウェア' }, close_date: { value: '2026-05-01' } },
  { stage: { value: '失注' }, amount: { value: '500000' }, owner: { value: '佐藤' }, industry: { value: '製造' }, loss_reason: { value: '価格' }, close_date: { value: '2026-06-01' } },
];
const LEADS: KintoneRecordFields[] = [
  { status: { value: '未対応' }, source: { value: '名刺' } },
  { status: { value: '対応中' }, source: { value: '紹介' } },
];

describe('buildDefaultDashboardCards (RELVA BI 追加要件定義書 §5)', () => {
  const cards = buildDefaultDashboardCards();

  it('defines exactly the 6 prescribed cards, all pinned, in display order', () => {
    expect(cards).toHaveLength(6);
    expect(cards.every((c) => c.pinned)).toBe(true);
    expect(cards.map((c) => c.template)).toEqual(['T1', 'T1', 'T4', 'T2', 'T2', 'T5']);
  });

  it('every default card aggregates successfully against a representative dataset (no runtime {ok:false})', () => {
    const input = { opportunityRecords: OPPS, leadRecords: LEADS };
    for (const card of cards) {
      const result = runAggregate(input, {
        template: card.template,
        metric: card.params.metric!,
        dimension: card.params.dimension,
        dimensionB: card.params.dimensionB,
        entity: card.params.entity,
        filters: (card.params.filters ?? []).map((f) => ({ field: f.field, op: f.op, value: f.value })),
      });
      expect(result.ok, `card "${card.title}" failed: ${!result.ok ? result.message : ''}`).toBe(true);
    }
  });

  it('the "対応待ちリード" card correctly targets leads and counts only 未対応', () => {
    const card = cards.find((c) => c.title === '対応待ちリード')!;
    const result = runAggregate(
      { opportunityRecords: OPPS, leadRecords: LEADS },
      {
        template: card.template,
        metric: card.params.metric!,
        entity: card.params.entity,
        filters: card.params.filters!.map((f) => ({ field: f.field, op: f.op, value: f.value })),
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.data as { value: number }).value).toBe(1);
  });
});
