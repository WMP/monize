'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { Select } from '@/components/ui/Select';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { useRelativeTime } from '@/hooks/useRelativeTime';
import { buildAccountDropdownOptions, isInvestmentBrokerageAccount } from '@/lib/account-utils';
import { bankSyncApi } from '@/lib/bank-sync';
import { getErrorMessage } from '@/lib/errors';
import { sumMoney } from '@/lib/format';
import type { Account } from '@/types/account';
import type { BankSyncAccount } from '@/types/bank-sync';
import { BankSyncLinkDialog } from './BankSyncLinkDialog';
import { useBankSyncToast } from './useBankSyncToast';

/** An amount the API sent as a decimal string, or null when there is none. */
function parseAmount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

interface BankSyncAccountRowProps {
  bankAccount: BankSyncAccount;
  /** Only an active connection can be synced. */
  connectionActive: boolean;
  /** The user's Monize accounts, as the accounts endpoint answered. */
  accounts: Account[];
  /** Monize accounts another bank account is already linked to. */
  linkedElsewhere: ReadonlySet<string>;
  disabled?: boolean;
  /** Reload after a write, so the row shows what the server now holds. */
  onChanged: () => Promise<void> | void;
}

/**
 * One account the bank reported, and what it is mapped to in Monize.
 *
 * The picker offers only accounts the server would accept -- own, open, not a
 * brokerage account, not already linked, and of the bank account's currency
 * when that is known -- because a choice the server answers 400 to is a dead
 * end. Picking one asks for the cut-off date first (`BankSyncLinkDialog`), so
 * the link is never made with a date the user did not see.
 */
export function BankSyncAccountRow({
  bankAccount,
  connectionActive,
  accounts,
  linkedElsewhere,
  disabled = false,
  onChanged,
}: BankSyncAccountRowProps) {
  const t = useTranslations('settings.bankSync.account');
  const tLink = useTranslations('settings.bankSync.link');
  const tSync = useTranslations('settings.bankSync.sync');
  const { formatCurrency, formatNumber } = useNumberFormat();
  const { formatDate } = useDateFormat();
  const relativeTime = useRelativeTime();
  const notifySync = useBankSyncToast();
  const [dialog, setDialog] = useState<{ accountId: string; editing: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const linkedAccount = bankAccount.accountId
    ? accounts.find((account) => account.id === bankAccount.accountId)
    : undefined;

  const isEligible = (account: Account): boolean => {
    if (account.id === bankAccount.accountId) return true;
    return (
      !account.isJoint &&
      !account.isClosed &&
      !isInvestmentBrokerageAccount(account) &&
      !linkedElsewhere.has(account.id) &&
      (!bankAccount.currencyCode || account.currencyCode === bankAccount.currencyCode)
    );
  };
  const accountOptions = buildAccountDropdownOptions(
    accounts,
    isEligible,
    (account) => `${account.name} (${account.currencyCode})`,
  );
  const hasChoice = accountOptions.length > 0;

  const handleSelect = async (next: string) => {
    if (next === (bankAccount.accountId ?? '')) return;
    if (next !== '') {
      // The link is made from the dialog, once the cut-off date is chosen.
      setDialog({ accountId: next, editing: false });
      return;
    }
    setBusy(true);
    try {
      await bankSyncApi.updateAccount(bankAccount.id, { accountId: null });
      toast.success(t('unlinked'));
      await onChanged();
    } catch (error) {
      toast.error(getErrorMessage(error, t('unlinkFailed')));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveLink = async (syncFromDate: string | undefined) => {
    if (!dialog) return;
    try {
      await bankSyncApi.updateAccount(bankAccount.id, {
        accountId: dialog.accountId,
        ...(syncFromDate ? { syncFromDate } : {}),
      });
      toast.success(dialog.editing ? tLink('editSaved') : tLink('saved'));
      setDialog(null);
      await onChanged();
    } catch (error) {
      toast.error(getErrorMessage(error, tLink('saveFailed')));
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      notifySync([await bankSyncApi.syncAccount(bankAccount.id)]);
    } catch (error) {
      toast.error(getErrorMessage(error, t('syncFailed')));
    } finally {
      setSyncing(false);
      // The server records a failure on the row too, so read it either way.
      await onChanged();
    }
  };

  // Balances. Unknown is null and reads as unknown; a known zero is a number.
  const bankAmount = parseAmount(bankAccount.bankBalance);
  const bankCurrency = bankAccount.bankBalanceCurrency;
  const monizeAmount = linkedAccount ? parseAmount(linkedAccount.currentBalance) : null;
  const sameCurrency =
    linkedAccount !== undefined && bankCurrency !== null && bankCurrency === linkedAccount.currencyCode;
  const currenciesDiffer =
    linkedAccount !== undefined && bankCurrency !== null && bankCurrency !== linkedAccount.currencyCode;
  const difference =
    bankAmount !== null && monizeAmount !== null && sameCurrency
      ? sumMoney([bankAmount, -monizeAmount])
      : null;

  const formatBank = (amount: number) =>
    bankCurrency ? formatCurrency(amount, bankCurrency) : formatNumber(amount, 2);

  let bankBalanceText: string;
  if (bankAmount !== null) {
    bankBalanceText = bankAccount.bankBalanceDate
      ? t('bankBalanceAsOf', {
          amount: formatBank(bankAmount),
          date: formatDate(bankAccount.bankBalanceDate),
        })
      : formatBank(bankAmount);
  } else {
    // Null before the first sync is "not fetched yet", not "the bank has none".
    bankBalanceText = bankAccount.lastSyncedAt ? t('balanceNotReported') : t('balanceNotSynced');
  }

  const name = bankAccount.displayName || bankAccount.identifierMasked || t('unnamed');
  const lastCounts =
    bankAccount.lastImportedCount !== null &&
    bankAccount.lastSkippedCount !== null &&
    bankAccount.lastRefusedCount !== null
      ? tSync('summary', {
          imported: bankAccount.lastImportedCount,
          skipped: bankAccount.lastSkippedCount,
          refused: bankAccount.lastRefusedCount,
        })
      : null;
  const controlsDisabled = disabled || busy || syncing;

  return (
    <li className="border-t border-gray-200 py-4 first:border-t-0 dark:border-gray-700">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-gray-900 dark:text-gray-100">{name}</p>
            {bankAccount.currencyCode && <Badge>{bankAccount.currencyCode}</Badge>}
            <InfoTooltip text={t('deletedNote')} usePortal />
          </div>
          {bankAccount.displayName && bankAccount.identifierMasked && (
            <p className="font-mono text-xs text-gray-500 dark:text-gray-400">
              {bankAccount.identifierMasked}
            </p>
          )}
        </div>

        {bankAccount.accountId && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDialog({ accountId: bankAccount.accountId as string, editing: true })}
              disabled={controlsDisabled}
            >
              {t('changeCutoff')}
            </Button>
            {connectionActive && (
              <Button
                type="button"
                size="sm"
                onClick={handleSync}
                disabled={controlsDisabled}
              >
                {syncing ? t('syncing') : t('syncNow')}
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 max-w-md">
        <Select
          label={t('linkLabel')}
          id={`bank-sync-link-${bankAccount.id}`}
          value={bankAccount.accountId ?? ''}
          onChange={(event) => handleSelect(event.target.value)}
          disabled={controlsDisabled}
          options={[{ value: '', label: t('notLinked') }, ...accountOptions]}
        />
        {!hasChoice && !bankAccount.accountId && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('noEligibleAccounts')}
          </p>
        )}
      </div>

      {bankAccount.accountId && bankAccount.syncFromDate && (
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          {t('syncFrom', { date: formatDate(bankAccount.syncFromDate) })}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
        {bankAccount.lastSyncedAt ? (
          <>
            <span>{t('lastSynced', { time: relativeTime(bankAccount.lastSyncedAt) })}</span>
            {bankAccount.lastSyncStatus && (
              <Badge variant={bankAccount.lastSyncStatus === 'succeeded' ? 'green' : 'red'}>
                {bankAccount.lastSyncStatus === 'succeeded' ? t('lastSyncOk') : t('lastSyncFailed')}
              </Badge>
            )}
          </>
        ) : (
          <span>{t('neverSynced')}</span>
        )}
      </div>
      {lastCounts && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{lastCounts}</p>
      )}
      {bankAccount.lastSyncStatus === 'failed' && bankAccount.lastSyncError && (
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">
          {bankAccount.lastSyncError}
        </p>
      )}

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-gray-500 dark:text-gray-400">{t('bankBalance')}</dt>
        <dd className="text-gray-900 dark:text-gray-100">{bankBalanceText}</dd>
        {linkedAccount && monizeAmount !== null && (
          <>
            <dt className="text-gray-500 dark:text-gray-400">{t('monizeBalance')}</dt>
            <dd className="text-gray-900 dark:text-gray-100">
              {formatCurrency(monizeAmount, linkedAccount.currencyCode)}
            </dd>
          </>
        )}
        {difference !== null && linkedAccount && (
          <>
            <dt className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
              {t('difference')}
              <InfoTooltip text={t('differenceHelp')} usePortal />
            </dt>
            <dd className="text-gray-900 dark:text-gray-100">
              {formatCurrency(difference, linkedAccount.currencyCode)}
            </dd>
          </>
        )}
      </dl>
      {currenciesDiffer && bankAmount !== null && linkedAccount && bankCurrency && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t('differenceHidden', {
            bankCurrency,
            monizeCurrency: linkedAccount.currencyCode,
          })}
        </p>
      )}

      {dialog && (
        <BankSyncLinkDialog
          isOpen
          accountName={
            accounts.find((account) => account.id === dialog.accountId)?.name ?? name
          }
          editing={dialog.editing}
          initialDate={dialog.editing ? bankAccount.syncFromDate : null}
          onClose={() => setDialog(null)}
          onSave={handleSaveLink}
        />
      )}
    </li>
  );
}
