import { describe, expect, it } from 'vitest';
import {
  COMPARISON_PERIOD_LABELS,
  currentFiscalYearRange,
  fiscalEmbeddable,
  resolveComparisonRange,
  resolvePeriodPreset,
  DEFAULT_FISCAL_YEAR_START_MONTH,
} from '../fiscal';

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

  it('also exposes resolvePeriodPreset standalone (Aggregate BI/dashboard共通の期間解決)', () => {
    const embeddable = fiscalEmbeddable();
    const isolatedFn = new Function(`${embeddable}\nreturn resolvePeriodPreset(arguments[0], arguments[1]);`) as (
      preset: string,
      d: Date,
    ) => ReturnType<typeof resolvePeriodPreset>;

    const today = new Date(2026, 7, 30);
    expect(isolatedFn('current_fiscal_year', today)).toEqual(resolvePeriodPreset('current_fiscal_year', today));
  });

  it('also exposes resolveComparisonRange/COMPARISON_PERIOD_LABELS standalone (BI Narrative の比較コメント用)', () => {
    const embeddable = fiscalEmbeddable();
    const isolatedFn = new Function(
      `${embeddable}\nreturn [resolveComparisonRange(arguments[0], arguments[1]), COMPARISON_PERIOD_LABELS[arguments[0]]];`,
    ) as (preset: string, d: Date) => [ReturnType<typeof resolveComparisonRange>, string];

    const today = new Date(2026, 7, 30);
    const [range, label] = isolatedFn('current_fiscal_year', today);
    expect(range).toEqual(resolveComparisonRange('current_fiscal_year', today));
    expect(label).toBe(COMPARISON_PERIOD_LABELS.current_fiscal_year);
  });
});

describe('resolvePeriodPreset (RELVA BI 追加要件定義書 §1: LLMに日付計算をさせない唯一の変換ポイント)', () => {
  const today = new Date(2026, 7, 30); // 2026-08-30

  it('resolves current_fiscal_year to the same range as currentFiscalYearRange', () => {
    expect(resolvePeriodPreset('current_fiscal_year', today)).toEqual(currentFiscalYearRange(today));
  });

  it('resolves current_month to the calendar month containing today', () => {
    expect(resolvePeriodPreset('current_month', today)).toEqual({ start: '2026-08-01', end: '2026-08-31' });
  });

  it('resolves last_month, correctly rolling back across a year boundary', () => {
    expect(resolvePeriodPreset('last_month', new Date(2026, 0, 15))).toEqual({ start: '2025-12-01', end: '2025-12-31' });
  });

  it('resolves all to null (no date-range filter at all)', () => {
    expect(resolvePeriodPreset('all', today)).toBeNull();
  });
});

describe('resolveComparisonRange (RELVA_BI_開発方針報告書 §3.5: AIアドバイスの「過去データとの比較」用の期間解決)', () => {
  const today = new Date(2026, 7, 30); // 2026-08-30

  it('resolves current_fiscal_year to the previous fiscal year (今期 -> 前期)', () => {
    expect(resolveComparisonRange('current_fiscal_year', today)).toEqual({ start: '2025-04-01', end: '2026-03-31' });
  });

  it('resolves current_month to the previous calendar month (今月 -> 先月)', () => {
    expect(resolveComparisonRange('current_month', today)).toEqual({ start: '2026-07-01', end: '2026-07-31' });
  });

  it('resolves last_month to the month before that (先月 -> 先々月)', () => {
    expect(resolveComparisonRange('last_month', today)).toEqual({ start: '2026-06-01', end: '2026-06-30' });
  });

  it('correctly rolls back across a year boundary', () => {
    expect(resolveComparisonRange('current_month', new Date(2026, 0, 15))).toEqual({ start: '2025-12-01', end: '2025-12-31' });
    expect(resolveComparisonRange('last_month', new Date(2026, 1, 15))).toEqual({ start: '2025-12-01', end: '2025-12-31' });
  });

  it('resolves all to null (no single "one period before" for all-time)', () => {
    expect(resolveComparisonRange('all', today)).toBeNull();
  });

  it('exposes a Japanese label for every non-null preset', () => {
    expect(COMPARISON_PERIOD_LABELS.current_fiscal_year).toBe('前期');
    expect(COMPARISON_PERIOD_LABELS.current_month).toBe('先月');
    expect(COMPARISON_PERIOD_LABELS.last_month).toBe('先々月');
  });
});
