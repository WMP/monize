import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@/test/render';
import { useTaggedFunding } from './useTaggedFunding';

const mockGetIncomeVsExpenses = vi.fn();
vi.mock('@/lib/built-in-reports', () => ({
  builtInReportsApi: {
    getIncomeVsExpenses: (...args: unknown[]) => mockGetIncomeVsExpenses(...args),
  },
}));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const base = {
  tagKey: 'scope',
  tagValue: 'household',
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  accountIds: [] as string[],
};
const totals = { income: 3279, expenses: 8486, net: 0, knownIncome: 3279, knownExpenses: 8486, knownNet: 0 };

describe('useTaggedFunding', () => {
  beforeEach(() => vi.clearAllMocks());

  it('makes no request while disabled', async () => {
    const { result } = renderHook(() => useTaggedFunding({ ...base, enabled: false }));
    await act(async () => {});
    expect(mockGetIncomeVsExpenses).not.toHaveBeenCalled();
    expect(result.current.status).toBe('off');
    expect(result.current.window).toBeNull();
  });

  it('asks for month buckets by the key, with the account scope when there is one', async () => {
    mockGetIncomeVsExpenses.mockResolvedValue({
      data: [], totals, currency: 'CAD', missingCurrencies: [], excludedCount: 0,
      tagKey: 'scope',
      buckets: [{ value: 'household', isUntagged: false, data: [], totals, taggedInflows: 4516, taggedOutflows: 0, missingCurrencies: [], excludedCount: 0 }],
    });
    const { result } = renderHook(() =>
      useTaggedFunding({ ...base, enabled: true, accountIds: ['a1'] }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockGetIncomeVsExpenses).toHaveBeenCalledWith({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      bucket: 'month',
      tagKey: 'scope',
      accountIds: ['a1'],
    });
    expect(result.current.window?.taggedInflows).toBe(4516);
    expect(result.current.window?.knownIncome).toBe(3279);
  });

  it('reports a failed request as an error, not as missing data', async () => {
    mockGetIncomeVsExpenses.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useTaggedFunding({ ...base, enabled: true }));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.window).toBeNull();
  });
});
