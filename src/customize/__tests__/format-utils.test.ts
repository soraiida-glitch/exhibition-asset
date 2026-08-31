import { describe, expect, it } from 'vitest';
import { formatMetricNumber } from '../format-utils';

describe('formatMetricNumber', () => {
  it('rounds yen amounts to 万円 notation, matching the dashboards\' existing formatYen() convention', () => {
    expect(formatMetricNumber(8_150_000, '円')).toBe('¥815万');
    expect(formatMetricNumber(1_000_000, '円')).toBe('¥100万');
  });

  it('keeps count/percent values as plain localized numbers with the unit suffixed', () => {
    expect(formatMetricNumber(42, '件')).toBe('42件');
    expect(formatMetricNumber(50, '%')).toBe('50%');
  });

  it('never produces a raw comma-grouped yen figure long enough to overflow a narrow chart label (regression: bars used to clip)', () => {
    const display = formatMetricNumber(10_830_000, '円');
    expect(display.length).toBeLessThan(String(10_830_000).length);
    expect(display).not.toContain('10,830,000');
  });
});
