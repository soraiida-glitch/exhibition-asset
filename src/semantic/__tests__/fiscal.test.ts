import { describe, expect, it } from 'vitest';
import { currentFiscalYearRange, fiscalEmbeddable, DEFAULT_FISCAL_YEAR_START_MONTH } from '../fiscal';

describe('currentFiscalYearRange', () => {
  it('defaults to a April-start fiscal year (要件定義書 §12 未決事項②、確定)', () => {
    expect(DEFAULT_FISCAL_YEAR_START_MONTH).toBe(4);
  });

  it('resolves a date in the middle of the fiscal year (August) to Apr-Mar', () => {
    expect(currentFiscalYearRange(new Date(2026, 7, 30))).toEqual({
      start: '2026-04-01',
      end: '2027-03-31',
    });
  });

  it('resolves a date before the fiscal year start month (February) to the previous April', () => {
    expect(currentFiscalYearRange(new Date(2026, 1, 15))).toEqual({
      start: '2025-04-01',
      end: '2026-03-31',
    });
  });

  it('resolves exactly on the start month boundary', () => {
    expect(currentFiscalYearRange(new Date(2026, 3, 1))).toEqual({
      start: '2026-04-01',
      end: '2027-03-31',
    });
  });

  it('supports a calendar-year (January-start) override', () => {
    expect(currentFiscalYearRange(new Date(2026, 5, 1), 1)).toEqual({
      start: '2026-01-01',
      end: '2026-12-31',
    });
  });
});

describe('fiscalEmbeddable', () => {
  it('executes standalone and matches the imported implementation', () => {
    const embeddable = fiscalEmbeddable();
    const isolatedFn = new Function(`${embeddable}\nreturn currentFiscalYearRange(arguments[0]);`) as (
      d: Date,
    ) => ReturnType<typeof currentFiscalYearRange>;

    const today = new Date(2026, 7, 30);
    expect(isolatedFn(today)).toEqual(currentFiscalYearRange(today));
  });
});
