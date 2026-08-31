/**
 * RELVA BI (要件定義書 §3) — 会計年度の解決。4月始まり(ユーザー確認済み・確定)。
 *
 * `Date.now()`/`new Date()` を内部で呼ばない純関数として設計 — 呼び出し側が `today` を
 * 明示的に渡すことで、テストで決定的に検証でき、n8n Code node にも安全に埋め込める
 * (record-to-text.ts と同じ自己完結パターン)。
 */

export const DEFAULT_FISCAL_YEAR_START_MONTH = 4;

export interface FiscalYearRange {
  /** YYYY-MM-DD, inclusive */
  start: string;
  /** YYYY-MM-DD, inclusive */
  end: string;
}

export function currentFiscalYearRange(
  today: Date,
  startMonth: number = DEFAULT_FISCAL_YEAR_START_MONTH,
): FiscalYearRange {
  const y = today.getFullYear();
  const m = today.getMonth() + 1;
  const fyStartYear = m >= startMonth ? y : y - 1;
  const pad = (n: number) => String(n).padStart(2, '0');

  const start = `${fyStartYear}-${pad(startMonth)}-01`;

  const endYear = startMonth === 1 ? fyStartYear : fyStartYear + 1;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const lastDay = new Date(endYear, endMonth, 0).getDate(); // day 0 of next month = last day of endMonth
  const end = `${endYear}-${pad(endMonth)}-${pad(lastDay)}`;

  return { start, end };
}

export type PeriodPreset = 'current_fiscal_year' | 'current_month' | 'last_month' | 'all';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function monthRange(year: number, month: number): FiscalYearRange {
  const lastDay = new Date(year, month, 0).getDate();
  return { start: `${year}-${pad2(month)}-01`, end: `${year}-${pad2(month)}-${pad2(lastDay)}` };
}

/**
 * period(相対的な期間表現)を、呼び出し時点の `today` を基準に絶対的な日付レンジへ解決する。
 * "all" は null(期間による絞り込みなし)を返す。ルーターLLMには日付計算をさせない(RELVA BI
 * 要件定義書 §1 の絶対原則)ための唯一の変換ポイント——n8n の Aggregate BI とダッシュボード
 * (src/customize/dashboard.ts)の両方がこの1関数だけを呼び、独自に日付計算を重複実装しない。
 */
export function resolvePeriodPreset(preset: PeriodPreset, today: Date): FiscalYearRange | null {
  if (preset === 'all') return null;
  if (preset === 'current_month') return monthRange(today.getFullYear(), today.getMonth() + 1);
  if (preset === 'last_month') {
    const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return monthRange(prev.getFullYear(), prev.getMonth() + 1);
  }
  return currentFiscalYearRange(today);
}

export function fiscalEmbeddable(): string {
  const shim = 'function __name(fn) { return fn; }';
  const consts = [`const DEFAULT_FISCAL_YEAR_START_MONTH = ${DEFAULT_FISCAL_YEAR_START_MONTH};`];
  const fns = [currentFiscalYearRange, pad2, monthRange, resolvePeriodPreset].map((fn) => fn.toString());
  return [shim, ...consts, ...fns].join('\n');
}
