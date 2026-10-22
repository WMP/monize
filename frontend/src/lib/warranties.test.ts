import { describe, it, expect, vi, beforeEach } from 'vitest';
import apiClient from './api';
import { dedupe, invalidateCache } from './apiCache';
import { expiresBeforePurchase, warrantiesApi, warrantyTermEndDate } from './warranties';

vi.mock('./api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('./apiCache', () => ({
  dedupe: vi.fn((_key: string, fn: () => unknown) => fn()),
  invalidateCache: vi.fn(),
}));

describe('warrantiesApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list sends the query the server reads and keys the cache on it', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { data: [], pagination: { page: 2, limit: 50, total: 0, totalPages: 0, hasMore: false } },
    });
    await warrantiesApi.list({
      status: 'expiring',
      q: '  laptop ',
      transactionId: 'tx-1',
      archived: false,
      sort: 'name',
      page: 2,
      limit: 50,
    });
    const query = {
      status: 'expiring',
      q: 'laptop',
      transactionId: 'tx-1',
      archived: 'false',
      sort: 'name',
      page: '2',
      limit: '50',
    };
    expect(apiClient.get).toHaveBeenCalledWith('/warranties', { params: query });
    expect(vi.mocked(dedupe).mock.calls[0][0]).toBe(
      'warranties:list:status=expiring&q=laptop&transactionId=tx-1&archived=false&sort=name&page=2&limit=50',
    );
  });

  it('list leaves out a blank search and unset filters', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { data: [], pagination: {} } });
    await warrantiesApi.list({ q: '   ' });
    expect(apiClient.get).toHaveBeenCalledWith('/warranties', { params: {} });
  });

  it('summary reads /warranties/summary through the cache', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { total: 3 } });
    const result = await warrantiesApi.summary();
    expect(apiClient.get).toHaveBeenCalledWith('/warranties/summary');
    expect(vi.mocked(dedupe).mock.calls[0][0]).toBe('warranties:summary');
    expect(result).toEqual({ total: 3 });
  });

  it('getById reads /warranties/:id through the cache', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { id: 'w-1' } });
    await warrantiesApi.getById('w-1');
    expect(apiClient.get).toHaveBeenCalledWith('/warranties/w-1');
    expect(vi.mocked(dedupe).mock.calls[0][0]).toBe('warranties:one:w-1');
  });

  it('create posts and drops every cached warranty read', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { id: 'w-1' } });
    const data = { name: 'Laptop', purchaseDate: '2026-10-01', isLifetime: true };
    await warrantiesApi.create(data);
    expect(apiClient.post).toHaveBeenCalledWith('/warranties', data);
    expect(invalidateCache).toHaveBeenCalledWith('warranties:');
  });

  it('update patches /warranties/:id and drops the cache', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({ data: { id: 'w-1' } });
    await warrantiesApi.update('w-1', { name: 'New' });
    expect(apiClient.patch).toHaveBeenCalledWith('/warranties/w-1', { name: 'New' });
    expect(invalidateCache).toHaveBeenCalledWith('warranties:');
  });

  it('delete removes /warranties/:id and drops the cache', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({ data: {} });
    await warrantiesApi.delete('w-1');
    expect(apiClient.delete).toHaveBeenCalledWith('/warranties/w-1');
    expect(invalidateCache).toHaveBeenCalledWith('warranties:');
  });

  it('archive and unarchive post to their routes and drop the cache', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { id: 'w-1' } });
    await warrantiesApi.archive('w-1');
    expect(apiClient.post).toHaveBeenCalledWith('/warranties/w-1/archive');
    await warrantiesApi.unarchive('w-1');
    expect(apiClient.post).toHaveBeenCalledWith('/warranties/w-1/unarchive');
    expect(invalidateCache).toHaveBeenCalledTimes(2);
  });

  it('does not invalidate before the write succeeds', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('500'));
    await expect(warrantiesApi.create({ name: 'X', purchaseDate: '2026-10-01', isLifetime: true })).rejects.toThrow();
    expect(invalidateCache).not.toHaveBeenCalled();
  });
});

describe('warrantyTermEndDate', () => {
  it('adds years', () => {
    expect(warrantyTermEndDate('2026-10-01', { years: 2 })).toBe('2028-10-01');
  });

  it('adds months across a year end', () => {
    expect(warrantyTermEndDate('2026-11-15', { months: 3 })).toBe('2027-02-15');
  });

  it('adds days', () => {
    expect(warrantyTermEndDate('2026-12-20', { days: 15 })).toBe('2027-01-04');
  });

  it('clamps to the end of a shorter month (design example 2)', () => {
    expect(warrantyTermEndDate('2026-01-31', { months: 18 })).toBe('2027-07-31');
    expect(warrantyTermEndDate('2026-01-31', { months: 1 })).toBe('2026-02-28');
    expect(warrantyTermEndDate('2028-01-31', { months: 1 })).toBe('2028-02-29');
  });

  it('applies years and months before days', () => {
    expect(warrantyTermEndDate('2026-01-31', { months: 1, days: 1 })).toBe('2026-03-01');
  });

  it('treats absent and null parts as zero', () => {
    expect(warrantyTermEndDate('2026-10-01', { years: null, months: 6, days: undefined })).toBe('2027-04-01');
  });

  it('answers nothing for a zero term', () => {
    expect(warrantyTermEndDate('2026-10-01', {})).toBeNull();
    expect(warrantyTermEndDate('2026-10-01', { years: 0, months: 0, days: 0 })).toBeNull();
  });

  it('answers nothing for a negative or fractional part', () => {
    expect(warrantyTermEndDate('2026-10-01', { years: -1 })).toBeNull();
    expect(warrantyTermEndDate('2026-10-01', { months: 1.5 })).toBeNull();
  });

  it('answers nothing for an unreadable purchase date', () => {
    expect(warrantyTermEndDate('', { years: 1 })).toBeNull();
    expect(warrantyTermEndDate('2026-02-30', { years: 1 })).toBeNull();
  });
});

describe('expiresBeforePurchase', () => {
  it('refuses an end before the purchase', () => {
    expect(expiresBeforePurchase('2026-09-30', '2026-10-01')).toBe(true);
  });

  it('accepts an end on or after the purchase', () => {
    expect(expiresBeforePurchase('2026-10-01', '2026-10-01')).toBe(false);
    expect(expiresBeforePurchase('2027-01-01', '2026-10-01')).toBe(false);
  });

  it('has nothing to say while either date is unreadable', () => {
    expect(expiresBeforePurchase('', '2026-10-01')).toBe(false);
    expect(expiresBeforePurchase('2026-09-30', '')).toBe(false);
  });
});
