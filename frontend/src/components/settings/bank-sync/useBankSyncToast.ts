'use client';

import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { useLocale, useTranslations } from 'next-intl';
import {
  groupRefusalReasons,
  totalRefused,
  totalSyncResults,
} from '@/lib/bank-sync-summary';
import type { BankSyncResult } from '@/types/bank-sync';

/**
 * The toast a finished sync earns: how many rows were imported, skipped as
 * already imported, and refused, with each refusal reason named.
 *
 * A refusal is a bank row that is NOT in the ledger, so a sync that refused
 * something is reported as an error toast rather than a success -- the reader
 * has to know a row is missing and why. Counts are ICU plurals in the catalog,
 * and the reasons are joined by `Intl.ListFormat` in the reader's locale, so no
 * separator or conjunction is written here.
 */
export function useBankSyncToast() {
  const t = useTranslations('settings.bankSync.sync');
  const locale = useLocale();

  return useCallback(
    (results: readonly BankSyncResult[]) => {
      const totals = totalSyncResults(results);
      const refusedCount = totalRefused(totals.refused);
      const summary = t('summary', {
        imported: totals.imported,
        skipped: totals.skipped,
        refused: refusedCount,
      });

      if (refusedCount === 0) {
        toast.success(summary);
        return;
      }

      let listFormat: Intl.ListFormat;
      try {
        listFormat = new Intl.ListFormat(locale, {
          style: 'long',
          type: 'conjunction',
        });
      } catch {
        listFormat = new Intl.ListFormat(undefined, {
          style: 'long',
          type: 'conjunction',
        });
      }
      const reasons = listFormat.format(
        groupRefusalReasons(totals.refused).map(({ reason, count }) =>
          t(`reason.${reason}`, { count }),
        ),
      );
      toast.error(t('summaryWithReasons', { summary, reasons }), {
        duration: 8000,
      });
    },
    [t, locale],
  );
}
