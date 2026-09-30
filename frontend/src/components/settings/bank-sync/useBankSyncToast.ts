'use client';

import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { useLocale, useTranslations } from 'next-intl';
import {
  groupRefusalReasons,
  isBankSyncFailure,
  syncedResults,
  totalRefused,
  totalSyncResults,
} from '@/lib/bank-sync-summary';
import type { BankSyncAccount, BankSyncConnectionEntry } from '@/types/bank-sync';

/** The fields of a bank account the toast needs to name it. */
type NamedBankAccount = Pick<BankSyncAccount, 'id' | 'displayName' | 'identifierMasked'>;

/**
 * The toast a finished sync earns: how many rows were imported, skipped as
 * already imported, and refused, with each refusal reason named, and which
 * accounts could not be synced at all.
 *
 * A refusal is a bank row that is NOT in the ledger, and a failed account is a
 * whole account that was not read, so a sync that had either is reported as an
 * error toast rather than a success -- the reader has to know something is
 * missing and where. A partial failure still summarises what the other accounts
 * did, because their rows are already imported. A failed account is named by its
 * display name, else its masked number, else a generic label, and carries the
 * server's own sentence about why. Counts are ICU plurals in the catalog, and
 * lists are joined by `Intl.ListFormat` in the reader's locale, so no separator
 * or conjunction is written here.
 */
export function useBankSyncToast() {
  const t = useTranslations('settings.bankSync.sync');
  const tAccount = useTranslations('settings.bankSync.account');
  const locale = useLocale();

  return useCallback(
    (entries: readonly BankSyncConnectionEntry[], accounts: readonly NamedBankAccount[] = []) => {
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

      const results = syncedResults(entries);
      const failures = entries.filter(isBankSyncFailure);
      const totals = totalSyncResults(results);
      const refusedCount = totalRefused(totals.refused);
      const summary = t('summary', {
        imported: totals.imported,
        skipped: totals.skipped,
        refused: refusedCount,
      });
      const summaryText =
        refusedCount === 0
          ? summary
          : t('summaryWithReasons', {
              summary,
              reasons: listFormat.format(
                groupRefusalReasons(totals.refused).map(({ reason, count }) =>
                  t(`reason.${reason}`, { count }),
                ),
              ),
            });

      if (failures.length === 0) {
        if (refusedCount === 0) {
          toast.success(summary);
        } else {
          toast.error(summaryText, { duration: 8000 });
        }
        return;
      }

      const failedList = listFormat.format(
        failures.map((failure) => {
          const bankAccount = accounts.find((candidate) => candidate.id === failure.bankAccountId);
          return t('failedAccountItem', {
            account:
              bankAccount?.displayName ||
              bankAccount?.identifierMasked ||
              tAccount('unnamed'),
            message: failure.error.message,
          });
        }),
      );
      toast.error(
        results.length === 0
          ? t('allFailed', { accounts: failedList })
          : t('partialFailure', { summary: summaryText, accounts: failedList }),
        { duration: 10000 },
      );
    },
    [t, tAccount, locale],
  );
}
