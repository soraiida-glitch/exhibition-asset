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

export function fiscalEmbeddable(): string {
  return `function __name(fn) { return fn; }\nconst DEFAULT_FISCAL_YEAR_START_MONTH = ${DEFAULT_FISCAL_YEAR_START_MONTH};\n${currentFiscalYearRange.toString()}`;
}
