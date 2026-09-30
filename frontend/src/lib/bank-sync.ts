import apiClient from './api';
import { dedupe, invalidateBalanceCaches, invalidateCache } from './apiCache';
import { isUnknownSyncOutcome } from './bank-sync-outcome';
import type {
  BankInstitution,
  BankSyncAccount,
  BankSyncAuthorizationStart,
  BankSyncCallbackPayload,
  BankSyncConnection,
  BankSyncConnectionEntry,
  BankSyncCredentialsTestResult,
  BankSyncResult,
  BankSyncStatus,
  CreateBankSyncConnection,
  SaveBankSyncCredentials,
  UpdateBankSyncAccount,
  UpdateBankSyncConnection,
} from '@/types/bank-sync';

/**
 * A sync reads every page of the bank's booked rows before it writes, so it
 * outlasts the client's 10s default. The server's own lease is 30 minutes, so a
 * sync can still be running when this gives up: see `isUnknownSyncOutcome`.
 */
const SYNC_TIMEOUT_MS = 120_000;

/** True when any account of the answer wrote a transaction row. */
function wroteRows(entries: readonly BankSyncConnectionEntry[]): boolean {
  return entries.some((entry) => 'imported' in entry && entry.imported > 0);
}

/**
 * The bank sync client.
 *
 * Every write drops the `bank-sync:` prefix, so the settings page never shows a
 * connection list that predates its own action. The two sync routes also write
 * transaction rows, so they drop the balance caches -- but only when a row was
 * actually written (`imported > 0`): a sync that found nothing new moved no
 * balance, and dropping the account and portfolio caches costs a fresh
 * valuation to redraw the same numbers (`docs/frontend/api-and-cache.md`, "A
 * write that wrote nothing is not a write"). A sync that FAILED still drops
 * `bank-sync:`, because the server records the failure on the bank account row.
 */
export const bankSyncApi = {
  getStatus: async (): Promise<BankSyncStatus> =>
    dedupe(
      'bank-sync:status',
      async () => (await apiClient.get<BankSyncStatus>('/bank-sync/status')).data,
      30_000,
    ),

  /** Answers with the status, so the caller needs no second read. */
  saveCredentials: async (
    data: SaveBankSyncCredentials,
  ): Promise<BankSyncStatus> => {
    const response = await apiClient.put<BankSyncStatus>(
      '/bank-sync/credentials',
      data,
    );
    invalidateCache('bank-sync:');
    return response.data;
  },

  deleteCredentials: async (): Promise<void> => {
    await apiClient.delete('/bank-sync/credentials');
    invalidateCache('bank-sync:');
  },

  /**
   * Ask the provider whether the stored application works. Costs a real
   * request and changes nothing stored, so it drops no cache.
   */
  testCredentials: async (): Promise<BankSyncCredentialsTestResult> =>
    (
      await apiClient.post<BankSyncCredentialsTestResult>(
        '/bank-sync/credentials/test',
      )
    ).data,

  listInstitutions: async (country: string): Promise<BankInstitution[]> =>
    dedupe(
      `bank-sync:institutions:${country}`,
      async () =>
        (
          await apiClient.get<BankInstitution[]>('/bank-sync/institutions', {
            params: { country },
          })
        ).data,
      5 * 60_000,
    ),

  listConnections: async (): Promise<BankSyncConnection[]> =>
    dedupe(
      'bank-sync:connections',
      async () =>
        (await apiClient.get<BankSyncConnection[]>('/bank-sync/connections'))
          .data,
      30_000,
    ),

  createConnection: async (
    data: CreateBankSyncConnection,
  ): Promise<BankSyncAuthorizationStart> => {
    const response = await apiClient.post<BankSyncAuthorizationStart>(
      '/bank-sync/connections',
      data,
    );
    invalidateCache('bank-sync:');
    return response.data;
  },

  reauthorize: async (id: string): Promise<BankSyncAuthorizationStart> => {
    const response = await apiClient.post<BankSyncAuthorizationStart>(
      `/bank-sync/connections/${id}/reauthorize`,
    );
    invalidateCache('bank-sync:');
    return response.data;
  },

  completeCallback: async (
    payload: BankSyncCallbackPayload,
  ): Promise<BankSyncConnection> => {
    try {
      const response = await apiClient.post<BankSyncConnection>(
        '/bank-sync/callback',
        payload,
      );
      return response.data;
    } finally {
      // Refused or not, the callback may have moved the row (an error at the
      // bank marks it failed), so the list is read again either way.
      invalidateCache('bank-sync:');
    }
  },

  updateConnection: async (
    id: string,
    data: UpdateBankSyncConnection,
  ): Promise<BankSyncConnection> => {
    const response = await apiClient.patch<BankSyncConnection>(
      `/bank-sync/connections/${id}`,
      data,
    );
    invalidateCache('bank-sync:');
    return response.data;
  },

  deleteConnection: async (id: string): Promise<void> => {
    await apiClient.delete(`/bank-sync/connections/${id}`);
    invalidateCache('bank-sync:');
  },

  updateAccount: async (
    id: string,
    data: UpdateBankSyncAccount,
  ): Promise<BankSyncAccount> => {
    const response = await apiClient.patch<BankSyncAccount>(
      `/bank-sync/accounts/${id}`,
      data,
    );
    invalidateCache('bank-sync:');
    return response.data;
  },

  syncAccount: async (id: string): Promise<BankSyncResult> => {
    try {
      const response = await apiClient.post<BankSyncResult>(
        `/bank-sync/accounts/${id}/sync`,
        undefined,
        { timeout: SYNC_TIMEOUT_MS },
      );
      if (wroteRows([response.data])) invalidateBalanceCaches();
      return response.data;
    } catch (error) {
      if (isUnknownSyncOutcome(error)) invalidateBalanceCaches();
      throw error;
    } finally {
      invalidateCache('bank-sync:');
    }
  },

  /**
   * One entry per linked account: its result, or `{ bankAccountId, error }` for
   * an account that could not be synced. Rejects only when the connection
   * itself is unusable before any account was attempted.
   */
  syncConnection: async (id: string): Promise<BankSyncConnectionEntry[]> => {
    try {
      const response = await apiClient.post<BankSyncConnectionEntry[]>(
        `/bank-sync/connections/${id}/sync`,
        undefined,
        { timeout: SYNC_TIMEOUT_MS },
      );
      if (wroteRows(response.data)) invalidateBalanceCaches();
      return response.data;
    } catch (error) {
      if (isUnknownSyncOutcome(error)) invalidateBalanceCaches();
      throw error;
    } finally {
      invalidateCache('bank-sync:');
    }
  },
};
