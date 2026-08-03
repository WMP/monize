'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/Input';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Combobox } from '@/components/ui/Combobox';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Category } from '@/types/category';
import { Account } from '@/types/account';
import { Tag } from '@/types/tag';
import { CreateSplitData, InvestmentSplitDetails } from '@/types/transaction';
import { buildCategoryTree } from '@/lib/categoryUtils';
import { roundToDecimals, getCurrencySymbol, formatAmountWithCommas, getDecimalPlacesForCurrency, sumMoney, roundMoney, moneyEquals, moneyFractionDigits } from '@/lib/format';
import { buildAccountDropdownOptions } from '@/lib/account-utils';
import { oppositeSignCategorySplits } from '@/lib/split-validation';
import { InvestmentSplitFields } from './InvestmentSplitFields';

export type SplitType = 'category' | 'transfer' | 'investment';

export interface SplitRow extends CreateSplitData {
  id: string; // Temporary ID for React keys
  splitType: SplitType;
}

interface SplitEditorProps {
  splits: SplitRow[];
  onChange: (splits: SplitRow[]) => void;
  categories: Category[];
  tags?: Tag[];
  accounts?: Account[];
  sourceAccountId?: string;
  /** When the parent account is INVESTMENT_CASH, the investment split kind is enabled. */
  parentAccountSubType?: string | null;
  transactionAmount: number;
  disabled?: boolean;
  onTransactionAmountChange?: (amount: number) => void;
  currencyCode?: string;
  /**
   * When provided, deleting one of the final two splits is allowed: it converts
   * the transaction back to a regular one using the remaining split's category.
   * The remaining split must be a category split for this to be offered.
   */
  onConvertToRegular?: (categoryId: string | undefined) => void;
  /**
   * Foreign-currency editing. When both are set (and the display currency
   * differs from the account currency), a two-pill toggle lets the user view
   * and edit split amounts in `displayCurrencyCode` instead of the account
   * currency. `displayRate` is account-currency units per 1 unit of the display
   * currency. Amounts are always stored in the account currency (splits sum to
   * the account-currency transaction amount); the foreign values are converted
   * on edit, so distribution and balancing stay exact in the account currency.
   */
  displayCurrencyCode?: string;
  displayRate?: number;
}

export function SplitEditor({
  splits,
  onChange,
  categories,
  tags = [],
  accounts = [],
  sourceAccountId = '',
  parentAccountSubType,
  transactionAmount,
  disabled = false,
  onTransactionAmountChange,
  currencyCode = 'CAD',
  onConvertToRegular,
  displayCurrencyCode,
  displayRate,
}: SplitEditorProps) {
  const t = useTranslations('transactions');
  const investmentSplitsEnabled = parentAccountSubType === 'INVESTMENT_CASH';
  const currencySymbol = getCurrencySymbol(currencyCode);
  const decimals = getDecimalPlacesForCurrency(currencyCode);
  const [localSplits, setLocalSplits] = useState<SplitRow[]>(splits);

  // Foreign-currency editing toggle. Available only when a display currency and
  // a positive rate are supplied and the two currencies differ. Amounts are
  // always stored in the account currency; the toggle only changes the currency
  // the amounts are shown and entered in.
  const canToggleCurrency =
    !!displayCurrencyCode &&
    !!displayRate &&
    displayRate > 0 &&
    displayCurrencyCode.toUpperCase() !== currencyCode.toUpperCase();
  const [showForeignAmounts, setShowForeignAmounts] = useState(false);
  const foreignActive = canToggleCurrency && showForeignAmounts;
  const rate = displayRate ?? 1;
  const activeSymbol = foreignActive
    ? getCurrencySymbol(displayCurrencyCode as string)
    : currencySymbol;
  const activeDecimals = foreignActive
    ? getDecimalPlacesForCurrency(displayCurrencyCode as string)
    : decimals;
  // Precision the editor distributes and stores at, in the *account* currency:
  // that currency's own places, widened to the full money precision only when the
  // parent or one of the children actually carries a third or fourth decimal.
  // Keeping it narrow in the ordinary case preserves the familiar
  // 33.33/33.33/33.34 distribution; widening it is what lets a 10.0048 parent
  // balance at all, since cents can never sum to it.
  const storeDecimals = moneyFractionDigits(
    [...splits.map((s) => Number(s.amount) || 0), Number(transactionAmount)],
    decimals,
  );
  /** Round to the precision this editor stores at. */
  const roundStored = (value: number) => roundToDecimals(value, storeDecimals);

  // Convert a stored account-currency amount to the currency currently shown.
  const toDisplayAmount = (accountAmount: number) =>
    foreignActive ? roundToDecimals(accountAmount / rate, activeDecimals) : accountAmount;
  // Convert an amount typed in the currently shown currency back to the stored
  // account currency (always rounded to cents, matching the rest of the editor).
  // The field has already delivered a value at the precision it displays, so
  // this only converts; rounding to cents here is what used to discard a
  // four-decimal amount the moment its row was touched.
  const fromDisplayAmount = (displayAmount: number) =>
    foreignActive ? roundMoney(displayAmount * rate) : roundMoney(displayAmount);
  // React keys for rows the user adds. A `Date.now()`/`Math.random()` id inside
  // the new-row literal is an impure call the React Compiler may hoist into
  // render once every other field of that literal is a render value -- which
  // `react-hooks/purity` flags. A ref counter is unique among the rows on screen,
  // which is all a key has to be, and it stays in the event path.
  const nextAddedRowId = useRef(0);

  // Index of the split pending removal that would convert the transaction back
  // to a regular one (only set while the confirmation dialog is open).
  const [convertPendingIndex, setConvertPendingIndex] = useState<number | null>(null);

  // Always show Type column since a transaction will always have an account
  const supportsTransfers = true;

  // Memoize category options to avoid rebuilding on every render
  const categoryOptions = useMemo(() => buildCategoryTree(categories).map(({ category }) => {
    const parentCategory = category.parentId
      ? categories.find(c => c.id === category.parentId)
      : null;
    return {
      value: category.id,
      label: parentCategory ? `${parentCategory.name}: ${category.name}` : category.name,
    };
  }), [categories]);

  // Memoize tag options for multiselect
  const tagOptions = useMemo(() =>
    [...tags]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .map(tag => ({ value: tag.id, label: tag.name })),
    [tags]
  );

  // Memoize account options (excluding source account, asset accounts, investment accounts, and closed accounts)
  const accountOptions = useMemo(() => {
    if (!supportsTransfers) return [];
    const selectedTransferAccountIds = new Set(
      splits.filter(s => s.splitType === 'transfer' && s.transferAccountId).map(s => s.transferAccountId!)
    );
    return buildAccountDropdownOptions(
      accounts,
      (a) =>
        a.id !== sourceAccountId &&
        a.accountSubType !== 'INVESTMENT_BROKERAGE' &&
        (!a.isClosed || selectedTransferAccountIds.has(a.id)),
      (a) => `${a.name}${a.isClosed ? ' (Closed)' : ''}`,
    );
  }, [accounts, sourceAccountId, supportsTransfers, splits]);

  // Sync with parent when splits prop changes
  useEffect(() => {
    setLocalSplits(splits);
  }, [splits]);

  // Accumulate in integer ten-thousandths, exactly as the backend's `sumMoney`
  // does, so the two agree on the sum before they are compared.
  const splitsTotal = sumMoney(localSplits.map((s) => Number(s.amount) || 0));
  const remaining = roundMoney(Number(transactionAmount) - splitsTotal);
  // Balance is always judged in the account currency so distribution and the
  // balanced/remaining indicators stay exact regardless of the display currency.
  //
  // The rule is the backend's, not a tolerance of our own: `validateSplitAmountSum`
  // requires the 4dp sum of the children to equal the 4dp parent exactly. A
  // `< 0.01` band called a 10.0048 parent balanced against 5.00 + 5.00 and the
  // API then rejected the save; it also let an existing four-decimal split be
  // silently normalised, because the digits that decided it were never shown.
  const isBalanced = moneyEquals(splitsTotal, Number(transactionAmount));
  // Category children that reverse part of the parent's direction. Balanced
  // arithmetic hides these: -150 and +50 sum to -100 and record 50 of income
  // inside an expense. Transfer and investment splits define their own
  // direction and are exempt.
  const oppositeSignIndexes = useMemo(
    () => oppositeSignCategorySplits(localSplits, Number(transactionAmount)),
    [localSplits, transactionAmount],
  );
  const hasOppositeSign = oppositeSignIndexes.length > 0;
  const parentIsIncome = roundMoney(Number(transactionAmount)) > 0;
  // Widen the shown precision when any value on screen carries a third or
  // fourth decimal. Two places would render 5.0024 as "5.00" twice against a
  // 10.00 parent -- balanced to look at, rejected by the API -- and the next
  // blur would round the remainder away where the user could never see it.
  const amountDecimals = moneyFractionDigits(
    [
      ...localSplits.map((s) => Number(s.amount) || 0),
      Number(transactionAmount),
    ],
    activeDecimals,
  );
  // Footer figures rendered in whichever currency the amounts are shown in.
  const displaySplitsTotal = toDisplayAmount(splitsTotal);
  const displayRemaining = toDisplayAmount(remaining);
  const displayTransactionAmount = toDisplayAmount(Number(transactionAmount));

  const handleSplitChange = (index: number, field: keyof SplitRow, value: any) => {
    const newSplits = [...localSplits];

    // If changing split type, clear the other-kind fields
    if (field === 'splitType') {
      if (value === 'category') {
        newSplits[index] = {
          ...newSplits[index],
          splitType: 'category',
          transferAccountId: undefined,
          investment: undefined,
        };
      } else if (value === 'transfer') {
        newSplits[index] = {
          ...newSplits[index],
          splitType: 'transfer',
          categoryId: undefined,
          investment: undefined,
        };
      } else {
        newSplits[index] = {
          ...newSplits[index],
          splitType: 'investment',
          categoryId: undefined,
          transferAccountId: undefined,
          investment: newSplits[index].investment ?? { action: 'BUY' },
        };
      }
      setLocalSplits(newSplits);
      onChange(newSplits);
      return;
    }

    if (field === 'investment') {
      // Caller updated the investment payload; set both `investment` and the
      // computed cash impact passed as `_amount` via the value object.
      const { investment, amount } = value as {
        investment: InvestmentSplitDetails;
        amount: number;
      };
      newSplits[index] = {
        ...newSplits[index],
        investment,
        amount,
      };
      setLocalSplits(newSplits);
      onChange(newSplits);
      return;
    }

    // If changing category, adjust the amount sign based on income/expense
    if (field === 'categoryId' && value) {
      const category = categories.find(c => c.id === value);
      if (category) {
        const currentAmount = Number(newSplits[index].amount) || 0;
        if (currentAmount !== 0) {
          const absAmount = Math.abs(currentAmount);
          const newAmount = category.isIncome ? absAmount : -absAmount;
          if (newAmount !== currentAmount) {
            newSplits[index] = { ...newSplits[index], amount: newAmount };
          }
        }

        // When the first split's category is set, adjust the transaction total sign
        // to match (analogous to how normal transactions infer sign from category)
        if (index === 0 && onTransactionAmountChange && transactionAmount !== 0) {
          const absTotal = Math.abs(transactionAmount);
          const newTotal = category.isIncome ? absTotal : -absTotal;
          if (newTotal !== transactionAmount) {
            onTransactionAmountChange(newTotal);
            // Flip uncategorized splits to keep them consistent with the new sign
            for (let i = 0; i < newSplits.length; i++) {
              if (i !== index && !newSplits[i].categoryId) {
                const amt = Number(newSplits[i].amount) || 0;
                if (amt !== 0) {
                  newSplits[i] = { ...newSplits[i], amount: -amt };
                }
              }
            }
          }
        }
      }
    }

    // If changing amount, adjust sign based on selected category
    // But respect explicit sign changes (same pattern as handleAmountChange)
    if (field === 'amount') {
      const categoryId = newSplits[index].categoryId;
      if (categoryId) {
        const category = categories.find(c => c.id === categoryId);
        if (category) {
          const newAmount = Number(value) || 0;
          if (newAmount !== 0) {
            // Check if user is just changing the sign (same absolute value)
            const currentAmount = Number(newSplits[index].amount) || 0;
            const isJustSignChange = Math.abs(currentAmount) === Math.abs(newAmount) && Math.abs(currentAmount) !== 0;

            if (!isJustSignChange) {
              const absAmount = Math.abs(newAmount);
              value = category.isIncome ? absAmount : -absAmount;
            }
          }
        }
      }
    }

    newSplits[index] = { ...newSplits[index], [field]: value };
    setLocalSplits(newSplits);
    onChange(newSplits);
  };

  const addSplit = () => {
    nextAddedRowId.current += 1;
    const newSplit: SplitRow = {
      id: `added-${nextAddedRowId.current}`,
      splitType: 'category',
      categoryId: undefined,
      transferAccountId: undefined,
      amount: remaining, // Pre-fill with what is unassigned, at storage precision
      memo: '',
    };
    const newSplits = [...localSplits, newSplit];
    setLocalSplits(newSplits);
    onChange(newSplits);
  };

  // Whether removing the row at `index` is allowed. Above two splits removal is
  // always allowed. At exactly two splits, removal is only offered when it can
  // convert the transaction back to a regular one -- i.e. the parent provided
  // `onConvertToRegular` and the split that would remain is a category split.
  const canRemoveRow = (index: number) => {
    if (localSplits.length > 2) return true;
    if (localSplits.length === 2 && onConvertToRegular) {
      const remaining = localSplits[index === 0 ? 1 : 0];
      return remaining?.splitType === 'category';
    }
    return false;
  };

  const removeSplit = (index: number) => {
    if (localSplits.length > 2) {
      const newSplits = localSplits.filter((_, i) => i !== index);
      setLocalSplits(newSplits);
      onChange(newSplits);
      return;
    }
    // At two splits, deleting one converts back to a regular transaction.
    if (canRemoveRow(index)) {
      setConvertPendingIndex(index);
    }
  };

  const confirmConvertToRegular = () => {
    if (convertPendingIndex === null) return;
    const remaining = localSplits[convertPendingIndex === 0 ? 1 : 0];
    setConvertPendingIndex(null);
    onConvertToRegular?.(remaining?.categoryId);
  };

  const distributeEvenly = () => {
    if (localSplits.length === 0) return;

    const totalAmount = roundStored(Number(transactionAmount));
    const amountPerSplit = roundStored(totalAmount / localSplits.length);

    // Distribute evenly, putting the remainder on the last row for an exact sum.
    // `sumMoney` accumulates in integer ten-thousandths, so "the others" is the
    // figure the backend will also compute rather than a re-multiplied estimate.
    const newSplits = localSplits.map((split, index) => {
      if (index === localSplits.length - 1) {
        const otherSplitsTotal = sumMoney(
          Array.from({ length: localSplits.length - 1 }, () => amountPerSplit),
        );
        return { ...split, amount: roundStored(totalAmount - otherSplitsTotal) };
      }
      return { ...split, amount: amountPerSplit };
    });

    setLocalSplits(newSplits);
    onChange(newSplits);
  };

  // Add unassigned amount to a specific split
  const addRemainingToSplit = (index: number) => {
    if (isBalanced) return; // Nothing unassigned

    const newSplits = [...localSplits];
    const currentAmount = Number(newSplits[index].amount) || 0;
    newSplits[index] = { ...newSplits[index], amount: roundStored(currentAmount + remaining) };
    setLocalSplits(newSplits);
    onChange(newSplits);
  };

  // Distribute the remaining amount proportionally across the splits based on
  // their current amounts.
  const distributeProportionally = () => {
    if (localSplits.length === 0 || isBalanced) return;

    const absTotal = sumMoney(localSplits.map((s) => Math.abs(Number(s.amount) || 0)));
    const lastSplit = localSplits[localSplits.length - 1];

    // If all splits are zero, fall back to equal distribution. "Zero" is judged
    // at storage precision: a set of 0.0001 rows is not empty.
    if (roundStored(absTotal) === 0) {
      const perSplit = roundStored(remaining / localSplits.length);
      const newSplits = localSplits.map((split, index) => {
        const currentAmount = Number(split.amount) || 0;
        if (index === localSplits.length - 1) {
          const distributed = sumMoney(
            Array.from({ length: localSplits.length - 1 }, () => perSplit),
          );
          const lastPortion = roundStored(remaining - distributed);
          return { ...split, amount: roundStored(currentAmount + lastPortion) };
        }
        return { ...split, amount: roundStored(currentAmount + perSplit) };
      });
      setLocalSplits(newSplits);
      onChange(newSplits);
      return;
    }

    const portions: number[] = [];
    const newSplits = localSplits.map((split) => {
      const currentAmount = Number(split.amount) || 0;
      const proportion = Math.abs(currentAmount) / absTotal;

      if (split === lastSplit) {
        // Last split absorbs the rounding remainder.
        const lastPortion = roundStored(remaining - sumMoney(portions));
        return { ...split, amount: roundStored(currentAmount + lastPortion) };
      }

      const portion = roundStored(remaining * proportion);
      portions.push(portion);
      return { ...split, amount: roundStored(currentAmount + portion) };
    });

    setLocalSplits(newSplits);
    onChange(newSplits);
  };

  // Set the transaction total to the sum of splits
  const setTotalToSplitsSum = () => {
    if (onTransactionAmountChange && splitsTotal !== 0) {
      onTransactionAmountChange(Math.round(splitsTotal * 100) / 100);
    }
  };

  /**
   * Named the rows rather than only flagging the total: "one of these reverses
   * the transaction" is not actionable without saying which.
   */
  const oppositeSignNotice = hasOppositeSign ? (
    <div
      role="alert"
      className="mb-2 rounded-md border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300"
    >
      {parentIsIncome
        ? t('splitEditor.oppositeSignIncome', {
            rows: oppositeSignIndexes.map((index) => index + 1).join(', '),
          })
        : t('splitEditor.oppositeSignExpense', {
            rows: oppositeSignIndexes.map((index) => index + 1).join(', '),
          })}
    </div>
  ) : null;

  /**
   * Transfer rows whose target account holds a different currency.
   *
   * A split carries one amount, in the parent's currency, and no conversion --
   * the counterpart leg used to be written at par, so 100.00 CAD out arrived as
   * 100.00 USD in. The rate for the parent's date decides it now, which the user
   * has to be told, because the number they typed is not the number that lands.
   */
  const crossCurrencyTransferRows = useMemo(() => {
    return localSplits
      .map((split, index) => {
        if (split.splitType !== 'transfer' || !split.transferAccountId) return null;
        const target = accounts.find((a) => a.id === split.transferAccountId);
        if (!target || target.currencyCode === currencyCode) return null;
        return { row: index + 1, to: target.currencyCode };
      })
      .filter((entry): entry is { row: number; to: string } => entry !== null);
  }, [localSplits, accounts, currencyCode]);

  const crossCurrencyNotice =
    crossCurrencyTransferRows.length > 0 ? (
      <div
        role="status"
        className="mb-2 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
      >
        {t('splitEditor.crossCurrencyTransfer', {
          rows: crossCurrencyTransferRows.map((entry) => entry.row).join(', '),
          from: currencyCode,
          to: [...new Set(crossCurrencyTransferRows.map((e) => e.to))].join(', '),
        })}
      </div>
    ) : null;

  return (
    <div className="space-y-4">
      {oppositeSignNotice}
      {crossCurrencyNotice}
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('splitEditor.header')}</h4>
          {canToggleCurrency && (
            <div
              className="inline-flex overflow-hidden rounded-md border border-gray-300 dark:border-gray-600 text-xs"
              role="group"
              title={t('splitEditor.currencyToggle.title')}
            >
              <button
                type="button"
                onClick={() => setShowForeignAmounts(false)}
                aria-pressed={!foreignActive}
                aria-label={t('splitEditor.currencyToggle.ariaAmountsIn', { code: currencyCode })}
                className={`px-2 py-1 font-medium transition-colors ${
                  !foreignActive
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {currencyCode}
              </button>
              <button
                type="button"
                onClick={() => setShowForeignAmounts(true)}
                aria-pressed={foreignActive}
                aria-label={t('splitEditor.currencyToggle.ariaAmountsIn', { code: displayCurrencyCode as string })}
                className={`px-2 py-1 font-medium transition-colors ${
                  foreignActive
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {displayCurrencyCode}
              </button>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={distributeProportionally}
            disabled={disabled || localSplits.length === 0 || isBalanced}
            title={t('splitEditor.distributeProportionallyTitle')}
          >
            {t('splitEditor.distributeProportionally')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={distributeEvenly}
            disabled={disabled || localSplits.length === 0}
          >
            {t('splitEditor.distributeEvenly')}
          </Button>
        </div>
      </div>

      {/* Splits — Mobile Card Layout */}
      <div className="md:hidden border dark:border-gray-700 rounded-lg overflow-visible">
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {localSplits.map((split, index) => {
            const currentCategory = split.categoryId
              ? categories.find(c => c.id === split.categoryId)
              : null;

            return (
              <div key={split.id} className="p-3 space-y-2 bg-white dark:bg-gray-900">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                    {t('splitEditor.splitLabel', { number: index + 1 })}
                  </span>
                  <div className="flex space-x-1">
                    <button
                      type="button"
                      onClick={() => addRemainingToSplit(index)}
                      disabled={disabled || isBalanced}
                      className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      title={isBalanced ? t('splitEditor.noUnassigned') : t('splitEditor.addRemaining')}
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSplit(index)}
                      disabled={disabled || !canRemoveRow(index)}
                      className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      title={!canRemoveRow(index) ? t('splitEditor.removeMinimum') : localSplits.length <= 2 ? t('splitEditor.removeAndConvert') : t('splitEditor.removeSplit')}
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
                {supportsTransfers && (
                  <Select
                    options={[
                      { value: 'category', label: t('splitEditor.splitTypes.category') },
                      { value: 'transfer', label: t('splitEditor.splitTypes.transfer') },
                      ...(investmentSplitsEnabled
                        ? [{ value: 'investment', label: t('splitEditor.splitTypes.investment') }]
                        : []),
                    ]}
                    value={split.splitType}
                    onChange={(e) => handleSplitChange(index, 'splitType', e.target.value)}
                    disabled={disabled}
                    className="w-full"
                  />
                )}
                {split.splitType === 'investment' ? (
                  <InvestmentSplitFields
                    value={split.investment}
                    onChange={(investment, amount) =>
                      handleSplitChange(index, 'investment', { investment, amount })
                    }
                    disabled={disabled}
                    currencyCode={currencyCode}
                  />
                ) : split.splitType === 'category' || !supportsTransfers ? (
                  <Combobox
                    placeholder={t('splitEditor.selectCategory')}
                    options={categoryOptions}
                    value={split.categoryId || ''}
                    initialDisplayValue={currentCategory?.name || ''}
                    onChange={(categoryId) =>
                      handleSplitChange(index, 'categoryId', categoryId || undefined)
                    }
                    disabled={disabled}
                  />
                ) : (
                  <Select
                    options={[
                      { value: '', label: t('splitEditor.selectAccount') },
                      ...accountOptions,
                    ]}
                    value={split.transferAccountId || ''}
                    onChange={(e) =>
                      handleSplitChange(index, 'transferAccountId', e.target.value || undefined)
                    }
                    disabled={disabled}
                    className="w-full"
                  />
                )}
                <div className="grid grid-cols-2 gap-2">
                  <CurrencyInput
                    prefix={activeSymbol}
                    value={toDisplayAmount(split.amount)}
                    decimalPlaces={amountDecimals}
                    onChange={(value) => handleSplitChange(index, 'amount', fromDisplayAmount(value ?? 0))}
                    allowSignToggle
                    disabled={disabled}
                    className="w-full"
                  />
                  <Input
                    type="text"
                    value={split.memo || ''}
                    onChange={(e) => handleSplitChange(index, 'memo', e.target.value)}
                    placeholder={t('splitEditor.mobileMemoPlaceholder')}
                    disabled={disabled}
                    className="w-full"
                  />
                </div>
                {tagOptions.length > 0 && (
                  <MultiSelect
                    options={tagOptions}
                    value={split.tagIds || []}
                    onChange={(values) => handleSplitChange(index, 'tagIds', values)}
                    placeholder={t('splitEditor.tagsPlaceholder')}
                    disabled={disabled}
                  />
                )}
              </div>
            );
          })}
        </div>
        {/* Add Split + Total */}
        <div className="bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={addSplit}
            disabled={disabled}
            className="w-full px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-1"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            <span>{t('splitEditor.addSplit')}</span>
          </button>
          <div className="px-3 py-2 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between flex-wrap gap-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('splitEditor.total')}</span>
                <span className={`font-medium ${isBalanced ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {activeSymbol}{formatAmountWithCommas(displaySplitsTotal, amountDecimals)}
                </span>
                {isBalanced ? (
                  hasOppositeSign ? (
                    <span className="text-xs text-red-600 dark:text-red-400">
                      {t('splitEditor.oppositeSignShort')}
                    </span>
                  ) : (
                    <span className="text-xs text-green-600 dark:text-green-400">{t('splitEditor.balanced')}</span>
                  )
                ) : (
                  <span className="text-xs text-red-600 dark:text-red-400">
                    {t('splitEditor.remaining', { symbol: activeSymbol, amount: formatAmountWithCommas(displayRemaining, amountDecimals) })}
                  </span>
                )}
              </div>
              {!isBalanced && onTransactionAmountChange && splitsTotal !== 0 && (
                <button
                  type="button"
                  onClick={setTotalToSplitsSum}
                  disabled={disabled}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline disabled:opacity-50 whitespace-nowrap"
                >
                  {t('splitEditor.setTotal', { symbol: activeSymbol, amount: formatAmountWithCommas(displaySplitsTotal, amountDecimals) })}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Splits — Desktop Table Layout */}
      <div className="hidden md:block border dark:border-gray-700 rounded-lg overflow-visible">
        <table className="w-full table-fixed divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800 rounded-t-lg">
            <tr>
              {supportsTransfers && (
                <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase" style={{ width: '14%' }}>
                  {t('splitEditor.columns.type')}
                </th>
              )}
              <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase" style={{ width: supportsTransfers ? '32%' : '45%' }}>
                {supportsTransfers ? t('splitEditor.columns.categoryAccount') : t('splitEditor.columns.category')}
              </th>
              <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase" style={{ width: supportsTransfers ? '20%' : '13%' }}>
                {t('splitEditor.columns.amount')}
              </th>
              <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase" style={{ width: '17%' }}>
                {t('splitEditor.columns.memo')}
              </th>
              {tagOptions.length > 0 && (
                <th className="px-1 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase" style={{ width: '15%' }}>
                  {t('splitEditor.columns.tags')}
                </th>
              )}
              <th className="px-1 py-2" style={{ width: '5%' }}></th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
            {localSplits.map((split, index) => {
              // Find current category name for initial display
              const currentCategory = split.categoryId
                ? categories.find(c => c.id === split.categoryId)
                : null;

              return (
              <tr key={split.id}>
                {supportsTransfers && (
                  <td className="px-1 py-2">
                    <Select
                      options={[
                        { value: 'category', label: t('splitEditor.splitTypes.category') },
                        { value: 'transfer', label: t('splitEditor.splitTypes.transfer') },
                        ...(investmentSplitsEnabled
                          ? [{ value: 'investment', label: t('splitEditor.splitTypes.investment') }]
                          : []),
                      ]}
                      value={split.splitType}
                      onChange={(e) => handleSplitChange(index, 'splitType', e.target.value)}
                      disabled={disabled}
                      className="w-full"
                    />
                  </td>
                )}
                <td className="px-1 py-2">
                  {split.splitType === 'investment' ? (
                    <InvestmentSplitFields
                      value={split.investment}
                      onChange={(investment, amount) =>
                        handleSplitChange(index, 'investment', { investment, amount })
                      }
                      disabled={disabled}
                      currencyCode={currencyCode}
                    />
                  ) : split.splitType === 'category' || !supportsTransfers ? (
                    <Combobox
                      placeholder={t('splitEditor.selectCategory')}
                      options={categoryOptions}
                      value={split.categoryId || ''}
                      initialDisplayValue={currentCategory?.name || ''}
                      onChange={(categoryId) =>
                        handleSplitChange(index, 'categoryId', categoryId || undefined)
                      }
                      disabled={disabled}
                    />
                  ) : (
                    <Select
                      options={[
                        { value: '', label: t('splitEditor.selectAccount') },
                        ...accountOptions,
                      ]}
                      value={split.transferAccountId || ''}
                      onChange={(e) =>
                        handleSplitChange(index, 'transferAccountId', e.target.value || undefined)
                      }
                      disabled={disabled}
                      className="w-full"
                    />
                  )}
                </td>
                <td className="px-1 py-2">
                  <CurrencyInput
                    prefix={activeSymbol}
                    value={toDisplayAmount(split.amount)}
                    decimalPlaces={amountDecimals}
                    onChange={(value) => handleSplitChange(index, 'amount', fromDisplayAmount(value ?? 0))}
                    allowSignToggle
                    disabled={disabled}
                    className="w-full"
                  />
                </td>
                <td className="px-1 py-2">
                  <Input
                    type="text"
                    value={split.memo || ''}
                    onChange={(e) => handleSplitChange(index, 'memo', e.target.value)}
                    placeholder={t('splitEditor.memoPlaceholder')}
                    disabled={disabled}
                    className="w-full"
                  />
                </td>
                {tagOptions.length > 0 && (
                  <td className="px-1 py-2">
                    <MultiSelect
                      options={tagOptions}
                      value={split.tagIds || []}
                      onChange={(values) => handleSplitChange(index, 'tagIds', values)}
                      placeholder={t('splitEditor.tagsPlaceholder')}
                      disabled={disabled}
                    />
                  </td>
                )}
                <td className="px-1 py-2">
                  <div className="flex space-x-1 justify-end">
                    <button
                      type="button"
                      onClick={() => addRemainingToSplit(index)}
                      disabled={disabled || isBalanced}
                      className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      title={isBalanced ? t('splitEditor.noUnassigned') : t('splitEditor.addRemaining')}
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSplit(index)}
                      disabled={disabled || !canRemoveRow(index)}
                      className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      title={!canRemoveRow(index) ? t('splitEditor.removeMinimum') : localSplits.length <= 2 ? t('splitEditor.removeAndConvert') : t('splitEditor.removeSplit')}
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            );
            })}
          </tbody>
          <tfoot className="bg-gray-50 dark:bg-gray-800">
            {/* Add Split Button Row */}
            <tr className="border-t border-gray-200 dark:border-gray-700">
              <td colSpan={(supportsTransfers ? 5 : 4) + (tagOptions.length > 0 ? 1 : 0)} className="p-0">
                <button
                  type="button"
                  onClick={addSplit}
                  disabled={disabled}
                  className="w-full px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-1"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  <span>{t('splitEditor.addSplit')}</span>
                </button>
              </td>
            </tr>
            {/* Total Row */}
            <tr className="border-t border-gray-200 dark:border-gray-700">
              <td colSpan={(supportsTransfers ? 5 : 4) + (tagOptions.length > 0 ? 1 : 0)} className="px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('splitEditor.total')}</span>
                    <span
                      className={`font-medium ${
                        isBalanced ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {activeSymbol}{formatAmountWithCommas(displaySplitsTotal, amountDecimals)}
                    </span>
                    {isBalanced ? (
                      hasOppositeSign ? (
                        <span className="text-xs text-red-600 dark:text-red-400">
                          {t('splitEditor.oppositeSignShort')}
                        </span>
                      ) : (
                        <span className="text-xs text-green-600 dark:text-green-400">{t('splitEditor.balanced')}</span>
                      )
                    ) : (
                      <span className="text-xs text-red-600 dark:text-red-400 whitespace-nowrap">
                        {t('splitEditor.needAmount', { symbol: activeSymbol, amount: formatAmountWithCommas(displayTransactionAmount, amountDecimals), remaining: formatAmountWithCommas(displayRemaining, amountDecimals) })}
                      </span>
                    )}
                  </div>
                  {!isBalanced && onTransactionAmountChange && splitsTotal !== 0 && (
                    <button
                      type="button"
                      onClick={setTotalToSplitsSum}
                      disabled={disabled}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline disabled:opacity-50 whitespace-nowrap"
                    >
                      {t('splitEditor.setTotal', { symbol: activeSymbol, amount: formatAmountWithCommas(displaySplitsTotal, amountDecimals) })}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <ConfirmDialog
        isOpen={convertPendingIndex !== null}
        variant="warning"
        title={t('splitEditor.convertConfirm.title')}
        message={t('splitEditor.convertConfirm.message')}
        confirmLabel={t('splitEditor.convertConfirm.confirm')}
        onConfirm={confirmConvertToRegular}
        onCancel={() => setConvertPendingIndex(null)}
        pushHistory
      />
    </div>
  );
}

// Helper function to generate temporary IDs for new splits
export function createEmptySplits(transactionAmount: number): SplitRow[] {
  const halfAmount = Math.round((Number(transactionAmount) / 2) * 100) / 100;
  const otherHalf = Math.round((Number(transactionAmount) - halfAmount) * 100) / 100;

  return [
    {
      id: `temp-${Date.now()}-1`,
      splitType: 'category',
      categoryId: undefined,
      transferAccountId: undefined,
      amount: halfAmount,
      memo: '',
    },
    {
      id: `temp-${Date.now()}-2`,
      splitType: 'category',
      categoryId: undefined,
      transferAccountId: undefined,
      amount: otherHalf,
      memo: '',
    },
  ];
}

// Convert API splits to SplitRow format. Accepts both transaction splits (with
// `investmentTransaction` relation) and scheduled-transaction splits (with the
// investment payload denormalized as `investment*` columns on the row itself).
export function toSplitRows(splits: {
  id?: string;
  kind?: 'category' | 'transfer' | 'investment';
  categoryId?: string | null;
  transferAccountId?: string | null;
  amount: number;
  memo?: string | null;
  tags?: { id: string }[];
  investmentTransaction?: {
    action: string;
    securityId: string | null;
    quantity: number | null;
    price: number | null;
    commission: number;
    exchangeRate: number;
  } | null;
  // Scheduled-transaction-split shape
  investmentAction?: string | null;
  investmentSecurityId?: string | null;
  investmentQuantity?: number | null;
  investmentPrice?: number | null;
  investmentCommission?: number | null;
  investmentExchangeRate?: number | null;
  // Override JSON shape
  splitKind?: 'category' | 'transfer' | 'investment';
  investment?: {
    action: string;
    securityId?: string;
    quantity?: number;
    price?: number;
    commission?: number;
    exchangeRate?: number;
  };
}[]): SplitRow[] {
  return splits.map((split, index) => {
    const kind: SplitType =
      split.kind === 'investment' ||
      split.splitKind === 'investment' ||
      split.investmentTransaction ||
      split.investmentAction ||
      split.investment
        ? 'investment'
        : split.transferAccountId
          ? 'transfer'
          : 'category';
    let investment: InvestmentSplitDetails | undefined;
    if (split.investmentTransaction) {
      investment = {
        action: split.investmentTransaction.action as InvestmentSplitDetails['action'],
        securityId: split.investmentTransaction.securityId ?? undefined,
        quantity: Number(split.investmentTransaction.quantity ?? 0),
        price: Number(split.investmentTransaction.price ?? 0),
        commission: Number(split.investmentTransaction.commission ?? 0),
        exchangeRate: Number(split.investmentTransaction.exchangeRate ?? 1),
      };
    } else if (split.investmentAction) {
      investment = {
        action: split.investmentAction as InvestmentSplitDetails['action'],
        securityId: split.investmentSecurityId ?? undefined,
        quantity: Number(split.investmentQuantity ?? 0),
        price: Number(split.investmentPrice ?? 0),
        commission: Number(split.investmentCommission ?? 0),
        exchangeRate: Number(split.investmentExchangeRate ?? 1),
      };
    } else if (split.investment) {
      investment = {
        action: split.investment.action as InvestmentSplitDetails['action'],
        securityId: split.investment.securityId,
        quantity: split.investment.quantity,
        price: split.investment.price,
        commission: split.investment.commission,
        exchangeRate: split.investment.exchangeRate,
      };
    }
    return {
      id: split.id || `temp-${Date.now()}-${index}`,
      splitType: kind,
      categoryId: split.categoryId || undefined,
      transferAccountId: split.transferAccountId || undefined,
      investment,
      amount: Number(split.amount),
      memo: split.memo || '',
      tagIds: split.tags?.map(t => t.id) || [],
    };
  });
}

// Convert SplitRow to API format (removes temporary id and splitType)
export function toCreateSplitData(splits: SplitRow[]): CreateSplitData[] {
  return splits.map((split) => ({
    splitKind: split.splitType,
    categoryId: split.splitType === 'category' ? split.categoryId : undefined,
    transferAccountId: split.splitType === 'transfer' ? split.transferAccountId : undefined,
    investment: split.splitType === 'investment' ? split.investment : undefined,
    amount: split.amount,
    memo: split.memo || undefined,
    tagIds: split.tagIds && split.tagIds.length > 0 ? split.tagIds : undefined,
  }));
}
