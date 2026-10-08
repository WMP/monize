'use client';

import { useMemo } from 'react';
import { accountsApi } from '@/lib/accounts';
import { useReportData } from '@/hooks/useReportData';
import { usePersistedAccountFilter } from '@/hooks/usePersistedAccountFilter';
import type { Account } from '@/types/account';

// An investment account's cash legs are excluded from these reports by
// linkage, so the picker does not offer one (Income vs Expenses, Cash Flow).
export const nonInvestmentAccounts = (a: Account) => a.accountType !== 'INVESTMENT';

export interface ReportAccountScope {
  offeredAccounts: Account[];
  selectedAccountIds: string[];
  setSelectedAccountIds: (ids: string[]) => void;
  /** Stable key of the selection, for a fetch's dependency list. */
  accountIdsKey: string;
}

/**
 * The account filter of a report: the non-investment accounts, and the
 * persisted selection (empty means every account, the report as it always was).
 */
export function useReportAccountScope(storageKey: string): ReportAccountScope {
  const { data } = useReportData(() => accountsApi.getAll(), []);
  const offeredAccounts = useMemo(
    () => (data ?? []).filter(nonInvestmentAccounts),
    [data],
  );
  const [selectedAccountIds, setSelectedAccountIds] = usePersistedAccountFilter(
    storageKey,
    offeredAccounts,
  );
  return {
    offeredAccounts,
    selectedAccountIds,
    setSelectedAccountIds,
    accountIdsKey: selectedAccountIds.join(','),
  };
}
