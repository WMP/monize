import { useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { AccountType } from '@/types/account';

// Map each account-type enum to the matching translation key under the
// `accounts.form.type.*` namespace (the labels already used by the edit form).
const ACCOUNT_TYPE_KEY: Record<AccountType, string> = {
  CHEQUING: 'form.type.chequing',
  SAVINGS: 'form.type.savings',
  CREDIT_CARD: 'form.type.creditCard',
  INVESTMENT: 'form.type.investment',
  LOAN: 'form.type.loan',
  MORTGAGE: 'form.type.mortgage',
  CASH: 'form.type.cash',
  LINE_OF_CREDIT: 'form.type.lineOfCredit',
  ASSET: 'form.type.asset',
  OTHER: 'form.type.other',
};

/**
 * Returns a localized `formatAccountType(type)` function backed by the
 * `accounts.form.type.*` messages, so list/summary views show the same
 * translated labels as the edit form. Falls back to the raw enum value for
 * any unknown type.
 */
export function useAccountTypeLabel(): (type: AccountType) => string {
  const t = useTranslations('accounts');

  const labels = useMemo(() => {
    const entries = (Object.keys(ACCOUNT_TYPE_KEY) as AccountType[]).map(
      (type) => [type, t(ACCOUNT_TYPE_KEY[type])] as const,
    );
    return Object.fromEntries(entries) as Record<AccountType, string>;
  }, [t]);

  return useCallback(
    (type: AccountType): string => labels[type] || type,
    [labels],
  );
}
