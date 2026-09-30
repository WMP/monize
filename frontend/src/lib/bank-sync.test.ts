import { describe, it, expect, vi, beforeEach } from 'vitest';
import apiClient from './api';
import { bankSyncApi } from './bank-sync';
import { clearAllCache, getCached, setCache } from './apiCache';
import type { BankSyncResult } from '@/types/bank-sync';

vi.mock('./api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

function result(imported: number, bankAccountId = 'ba-1'): BankSyncResult {
  return {
    bankAccountId,
    imported,
    skipped: 0,
    refused: {},
    pending: 0,
    beforeCutoff: 0,
    bankBalance: null,
  };
}

/** Fill the caches a sync could wrongly leave alone or wrongly drop. */
function seedCaches() {
  setCache('bank-sync:connections', ['stale']);
  setCache('bank-sync:status', { stale: true });
  setCache('accounts:all:false', ['stale']);
  setCache('investments:summary', ['stale']);
  setCache('budgets:dashboard', ['stale']);
  setCache('payees:all', ['stale']);
}

describe('bankSyncApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllCache();
  });

  describe('reads', () => {
    it('getStatus fetches /bank-sync/status and caches the answer', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: { redirectUrl: 'u' } });
      await bankSyncApi.getStatus();
      await bankSyncApi.getStatus();
      expect(apiClient.get).toHaveBeenCalledTimes(1);
      expect(apiClient.get).toHaveBeenCalledWith('/bank-sync/status');
    });

    it('listInstitutions sends the country and caches per country', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] });
      await bankSyncApi.listInstitutions('PL');
      await bankSyncApi.listInstitutions('PL');
      await bankSyncApi.listInstitutions('DE');
      expect(apiClient.get).toHaveBeenCalledTimes(2);
      expect(apiClient.get).toHaveBeenCalledWith('/bank-sync/institutions', {
        params: { country: 'PL' },
      });
      expect(apiClient.get).toHaveBeenCalledWith('/bank-sync/institutions', {
        params: { country: 'DE' },
      });
    });

    it('listConnections fetches /bank-sync/connections', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [{ id: 'c1' }] });
      const connections = await bankSyncApi.listConnections();
      expect(apiClient.get).toHaveBeenCalledWith('/bank-sync/connections');
      expect(connections).toHaveLength(1);
    });

    it('does not cache a failed read', async () => {
      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('down'));
      await expect(bankSyncApi.listConnections()).rejects.toThrow('down');
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });
      await expect(bankSyncApi.listConnections()).resolves.toEqual([]);
      expect(apiClient.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('writes use the routes of the contract and drop bank-sync only', () => {
    it.each([
      [
        'saveCredentials PUTs /bank-sync/credentials',
        () => bankSyncApi.saveCredentials({ applicationId: 'app', privateKey: 'k' }),
        'put',
        ['/bank-sync/credentials', { applicationId: 'app', privateKey: 'k' }],
      ],
      [
        'deleteCredentials DELETEs /bank-sync/credentials',
        () => bankSyncApi.deleteCredentials(),
        'delete',
        ['/bank-sync/credentials'],
      ],
      [
        'createConnection POSTs /bank-sync/connections',
        () =>
          bankSyncApi.createConnection({
            institutionName: 'Bank',
            country: 'PL',
            psuType: 'personal',
          }),
        'post',
        [
          '/bank-sync/connections',
          { institutionName: 'Bank', country: 'PL', psuType: 'personal' },
        ],
      ],
      [
        'reauthorize POSTs the reauthorize route',
        () => bankSyncApi.reauthorize('c1'),
        'post',
        ['/bank-sync/connections/c1/reauthorize'],
      ],
      [
        'completeCallback POSTs /bank-sync/callback',
        () => bankSyncApi.completeCallback({ state: 's', code: 'c' }),
        'post',
        ['/bank-sync/callback', { state: 's', code: 'c' }],
      ],
      [
        'updateConnection PATCHes the connection',
        () => bankSyncApi.updateConnection('c1', { autoSync: true }),
        'patch',
        ['/bank-sync/connections/c1', { autoSync: true }],
      ],
      [
        'deleteConnection DELETEs the connection',
        () => bankSyncApi.deleteConnection('c1'),
        'delete',
        ['/bank-sync/connections/c1'],
      ],
      [
        'updateAccount PATCHes the bank account',
        () =>
          bankSyncApi.updateAccount('ba-1', {
            accountId: 'a1',
            syncFromDate: '2026-01-01',
          }),
        'patch',
        ['/bank-sync/accounts/ba-1', { accountId: 'a1', syncFromDate: '2026-01-01' }],
      ],
    ] as const)('%s', async (_name, call, method, args) => {
      vi.mocked(apiClient[method]).mockResolvedValue({ data: {} });
      seedCaches();
      await call();
      expect(apiClient[method]).toHaveBeenCalledWith(...args);
      expect(getCached('bank-sync:connections')).toBeUndefined();
      expect(getCached('bank-sync:status')).toBeUndefined();
      // Not a write of transaction rows: the balance caches stay.
      expect(getCached('accounts:all:false')).toBeDefined();
      expect(getCached('investments:summary')).toBeDefined();
      expect(getCached('budgets:dashboard')).toBeDefined();
      expect(getCached('payees:all')).toBeDefined();
    });

    it('testCredentials POSTs the test route and changes no cache', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { ok: true, applicationName: 'App', redirectUrls: [] },
      });
      seedCaches();
      const answer = await bankSyncApi.testCredentials();
      expect(apiClient.post).toHaveBeenCalledWith('/bank-sync/credentials/test');
      expect(answer.ok).toBe(true);
      expect(getCached('bank-sync:connections')).toBeDefined();
    });

    it('a callback the server refused still drops bank-sync', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('400'));
      seedCaches();
      await expect(bankSyncApi.completeCallback({ state: 's', error: 'x' })).rejects.toThrow();
      expect(getCached('bank-sync:connections')).toBeUndefined();
    });
  });

  describe('syncAccount', () => {
    it('POSTs the sync route with a long timeout', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: result(0) });
      await bankSyncApi.syncAccount('ba-1');
      expect(apiClient.post).toHaveBeenCalledWith(
        '/bank-sync/accounts/ba-1/sync',
        undefined,
        { timeout: 120_000 },
      );
    });

    it('drops the balance caches when rows were imported', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: result(3) });
      seedCaches();
      await bankSyncApi.syncAccount('ba-1');
      expect(getCached('accounts:all:false')).toBeUndefined();
      expect(getCached('investments:summary')).toBeUndefined();
      expect(getCached('budgets:dashboard')).toBeUndefined();
      expect(getCached('bank-sync:connections')).toBeUndefined();
      // Reference data is not a balance.
      expect(getCached('payees:all')).toBeDefined();
    });

    it('keeps the balance caches when nothing was imported', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: result(0) });
      seedCaches();
      await bankSyncApi.syncAccount('ba-1');
      expect(getCached('accounts:all:false')).toBeDefined();
      expect(getCached('investments:summary')).toBeDefined();
      expect(getCached('budgets:dashboard')).toBeDefined();
      // The sync outcome is written to the row, so the connections are re-read.
      expect(getCached('bank-sync:connections')).toBeUndefined();
    });

    it('drops bank-sync but not the balances when the sync failed', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('409'));
      seedCaches();
      await expect(bankSyncApi.syncAccount('ba-1')).rejects.toThrow('409');
      expect(getCached('bank-sync:connections')).toBeUndefined();
      expect(getCached('accounts:all:false')).toBeDefined();
    });
  });

  describe('syncConnection', () => {
    it('POSTs the connection sync route and returns one result per account', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: [result(0, 'ba-1'), result(0, 'ba-2')],
      });
      const results = await bankSyncApi.syncConnection('c1');
      expect(apiClient.post).toHaveBeenCalledWith(
        '/bank-sync/connections/c1/sync',
        undefined,
        { timeout: 120_000 },
      );
      expect(results).toHaveLength(2);
    });

    it('drops the balance caches when any account imported rows', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: [result(0, 'ba-1'), result(2, 'ba-2')],
      });
      seedCaches();
      await bankSyncApi.syncConnection('c1');
      expect(getCached('accounts:all:false')).toBeUndefined();
    });

    it('keeps the balance caches when no account imported anything', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: [result(0, 'ba-1'), result(0, 'ba-2')],
      });
      seedCaches();
      await bankSyncApi.syncConnection('c1');
      expect(getCached('accounts:all:false')).toBeDefined();
      expect(getCached('bank-sync:connections')).toBeUndefined();
    });
  });
});
