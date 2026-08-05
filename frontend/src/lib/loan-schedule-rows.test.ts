import { describe, it, expect } from 'vitest';
import { datesFollowingAGap } from './loan-schedule-rows';

describe('datesFollowingAGap', () => {
  it('returns empty when fewer than three dates', () => {
    expect(datesFollowingAGap([])).toEqual(new Set());
    expect(datesFollowingAGap(['2025-01-15'])).toEqual(new Set());
    expect(datesFollowingAGap(['2025-01-15', '2025-02-15'])).toEqual(new Set());
  });

  it('flags a gap when only three payments exist and the third is six months late', () => {
    // Two intervals: 31 days (Jan->Feb) and 181 days (Feb->Aug).
    // The lower median of [31, 181] is 31; threshold = 31 * 1.8 = 55.8.
    // 181 > 55.8, so the August date is a gap.
    // With the upper median (the bug), sorted[1] = 181, threshold = 325.8,
    // 181 < 325.8 -- the gap is missed entirely.
    const result = datesFollowingAGap(['2025-01-15', '2025-02-15', '2025-08-15']);
    expect(result.has('2025-08-15')).toBe(true);
    expect(result.size).toBe(1);
  });

  it('does not flag a gap when the three payments are all one month apart', () => {
    const result = datesFollowingAGap(['2025-01-15', '2025-02-15', '2025-03-15']);
    expect(result.size).toBe(0);
  });

  it('flags both large gaps when an even number of intervals has two outliers', () => {
    // Four intervals: [181, 31, 31, 181].
    // Sorted: [31, 31, 181, 181].
    // Lower median = sorted[1] = 31; threshold = 55.8 -- both 181-day gaps are flagged.
    // Upper median (the bug) = sorted[2] = 181; threshold = 325.8 -- neither gap is flagged.
    const dates = ['2025-01-15', '2025-07-15', '2025-08-15', '2025-09-15', '2026-03-15'];
    const result = datesFollowingAGap(dates);
    expect(result.has('2025-07-15')).toBe(true);
    expect(result.has('2026-03-15')).toBe(true);
    expect(result.has('2025-08-15')).toBe(false);
    expect(result.has('2025-09-15')).toBe(false);
  });

  it('flags a single large gap among many regular monthly payments', () => {
    const dates = [
      '2024-01-15', '2024-02-15', '2024-03-15', '2024-04-15',
      '2024-05-15', '2024-06-15',
      '2024-12-15', // six-month gap before this
      '2025-01-15', '2025-02-15',
    ];
    const result = datesFollowingAGap(dates);
    expect(result.has('2024-12-15')).toBe(true);
    expect(result.has('2025-01-15')).toBe(false);
  });

  it('deduplicates payment dates before deriving the cadence', () => {
    // Duplicate '2025-01-15' entries produce 0-day gaps that, when there are
    // enough of them, push the median to 0 and cause the function to return an
    // empty set even though a genuine gap exists. Deduplication removes the
    // 0-day gaps, restoring correct detection.
    const result = datesFollowingAGap([
      '2025-01-15', '2025-01-15', '2025-01-15', '2025-01-15',
      '2025-02-15',
      '2025-08-15',
    ]);
    expect(result.has('2025-08-15')).toBe(true);
  });
});
