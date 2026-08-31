import { describe, expect, it } from 'vitest';
import { allowedParamKeys, cardsEmbeddable, createCard, generateCardId, refine } from '../cards';
import type { TemplateParams } from '../cards';

describe('refine (RELVA BI 追加要件定義書 §3・§6 ガードレール)', () => {
  it('merges an allowed key into the current params', () => {
    const current: TemplateParams = { metric: 'amount_sum', dimension: 'owner' };
    const next = refine('T2', current, { dimension: 'industry' });
    expect(next).toEqual({ metric: 'amount_sum', dimension: 'industry' });
  });

  it('silently drops keys not allowed for the template (never lets free-form keys through)', () => {
    const current: TemplateParams = { metric: 'count' };
    // T1 は dimension を持たない —— T1向けカードに dimension を注入しようとしても無視される。
    const next = refine('T1', current, { dimension: 'owner' } as TemplateParams);
    expect(next).toEqual({ metric: 'count' });
    expect(next.dimension).toBeUndefined();
  });

  it('T4 does not accept dimension/dimensionB (always a fixed stage breakdown)', () => {
    const current: TemplateParams = { metric: 'count' };
    const next = refine('T4', current, { dimension: 'owner', dimensionB: 'industry' } as TemplateParams);
    expect(next).toEqual({ metric: 'count' });
  });

  it('T5 accepts both dimension and dimensionB (the one template that needs 2 axes)', () => {
    const current: TemplateParams = { metric: 'count', dimension: 'loss_reason', dimensionB: 'industry' };
    const next = refine('T5', current, { dimension: 'owner' });
    expect(next).toEqual({ metric: 'count', dimension: 'owner', dimensionB: 'industry' });
  });

  it('does not mutate the original params object (returns a new one)', () => {
    const current: TemplateParams = { metric: 'count' };
    const next = refine('T2', current, { dimension: 'owner' });
    expect(current).toEqual({ metric: 'count' });
    expect(next).not.toBe(current);
  });

  it('supports the natural-language refine examples from §3-2 verbatim', () => {
    const current: TemplateParams = { metric: 'amount_sum', dimension: 'owner', period: { preset: 'current_fiscal_year' } };
    expect(refine('T2', current, { dimension: 'industry' }).dimension).toBe('industry'); // 「業種で見せて」
    expect(refine('T2', current, { period: { preset: 'last_month' } }).period).toEqual({ preset: 'last_month' }); // 「先月で」
    expect(refine('T2', current, { topN: 5 }).topN).toBe(5); // 「上位5件」
  });

  it('T1 accepts entity so "対応待ちリード" style cards can target leads without a dimension', () => {
    const current: TemplateParams = { metric: 'count' };
    const next = refine('T1', current, { entity: 'lead', filters: [{ field: 'status', op: '=', value: '未対応' }] });
    expect(next.entity).toBe('lead');
    expect(next.filters).toEqual([{ field: 'status', op: '=', value: '未対応' }]);
  });
});

describe('allowedParamKeys', () => {
  it('matches the §3-1 table for every template', () => {
    expect(allowedParamKeys('T1')).toEqual(expect.arrayContaining(['metric', 'period']));
    expect(allowedParamKeys('T2')).toEqual(expect.arrayContaining(['metric', 'dimension', 'filters', 'topN', 'sort']));
    expect(allowedParamKeys('T4')).toEqual(expect.arrayContaining(['metric', 'filters']));
    expect(allowedParamKeys('T4')).not.toContain('dimension');
    expect(allowedParamKeys('T5')).toEqual(expect.arrayContaining(['metric', 'dimension', 'dimensionB', 'filters']));
    expect(allowedParamKeys('T8')).toEqual(expect.arrayContaining(['filters', 'sort', 'topN']));
  });
});

describe('createCard / generateCardId', () => {
  it('creates a card with a unique id and pinned defaulting to false', () => {
    const card = createCard('T2', { metric: 'count', dimension: 'owner' });
    expect(card.template).toBe('T2');
    expect(card.pinned).toBe(false);
    expect(card.id).toMatch(/^card_/);
  });

  it('generates unique ids across repeated calls', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateCardId()));
    expect(ids.size).toBe(20);
  });
});

describe('cardsEmbeddable', () => {
  it('is self-contained and executes standalone, matching the imported refine()', () => {
    const embeddable = cardsEmbeddable();
    expect(embeddable).not.toContain('import ');
    expect(embeddable).not.toContain('require(');

    const isolatedRefine = new Function(`${embeddable}\nreturn refine(arguments[0], arguments[1], arguments[2]);`) as typeof refine;
    const current: TemplateParams = { metric: 'count', dimension: 'owner' };
    const patch: TemplateParams = { dimension: 'industry' };
    expect(isolatedRefine('T2', current, patch)).toEqual(refine('T2', current, patch));
    // ガードレールも埋め込み側でちゃんと効くことを確認(T1にdimensionを注入しても無視される)。
    expect(isolatedRefine('T1', { metric: 'count' }, { dimension: 'owner' } as TemplateParams)).toEqual({ metric: 'count' });
  });
});
