'use client';

import { useMemo } from 'react';
import { builtInReportsApi } from '@/lib/built-in-reports';
import { useReportData } from '@/hooks/useReportData';
import { fundingWindow, type FundingWindow } from '@/lib/tagged-funding';
import type { IncomeVsExpensesResponse } from '@/types/built-in-reports';

export interface TaggedFundingParams {
  /** False = no request at all (spec F1). */
  enabled: boolean;
  tagKey: string;
  tagValue: string;
  startDate: string | undefined;
  endDate: string;
  /** The page's account scope; empty = every account. */
  accountIds: string[];
}

export interface TaggedFunding {
  status: 'off' | 'loading' | 'error' | 'ready';
  response: IncomeVsExpensesResponse | null;
  /** The chosen value's window figures; null until `status` is `ready`. */
  window: FundingWindow | null;
  reload: () => void;
}

/**
 * The one funding fetch of the other reports (spec section 11.1, F3): Income vs
 * Expenses by month for the page's window and account scope, broken down by the
 * chosen tag key. Makes no request while `enabled` is false.
 */
export function useTaggedFunding({
  enabled,
  tagKey,
  tagValue,
  startDate,
  endDate,
  accountIds,
}: TaggedFundingParams): TaggedFunding {
  const accountIdsKey = accountIds.join(',');
  const { data, isLoading, error, reload } = useReportData(
    () =>
      enabled
        ? builtInReportsApi.getIncomeVsExpenses({
            startDate,
            endDate,
            bucket: 'month',
            tagKey,
            ...(accountIds.length > 0 ? { accountIds } : {}),
          })
        : Promise.resolve(null),
    [enabled, tagKey, startDate, endDate, accountIdsKey],
  );

  const window = useMemo(
    () => (enabled && data ? fundingWindow(data, tagValue) : null),
    [enabled, data, tagValue],
  );
  const status: TaggedFunding['status'] = !enabled
    ? 'off'
    : error
      ? 'error'
      : isLoading || !data
        ? 'loading'
        : 'ready';
  return { status, response: enabled ? data : null, window, reload };
}
