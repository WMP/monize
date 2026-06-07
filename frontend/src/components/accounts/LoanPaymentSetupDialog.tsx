'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DateInput } from '@/components/ui/DateInput';
import { Select } from '@/components/ui/Select';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { Combobox } from '@/components/ui/Combobox';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Account, DetectedLoanPayment, SetupLoanPaymentsData } from '@/types/account';
import { Payee } from '@/types/payee';
import { Category } from '@/types/category';
import { accountsApi } from '@/lib/accounts';
import { categoriesApi } from '@/lib/categories';
import { payeesApi } from '@/lib/payees';
import { getCategorySelectOptions } from '@/lib/categoryUtils';
import { getCurrencySymbol } from '@/lib/format';
import { buildAccountDropdownOptions } from '@/lib/account-utils';
import { createLogger } from '@/lib/logger';
import toast from 'react-hot-toast';

const logger = createLogger('LoanPaymentSetupDialog');

const paymentFrequencyOptions = [
  { value: 'WEEKLY', labelKey: 'loanPaymentSetup.frequency.weekly' },
  { value: 'BIWEEKLY', labelKey: 'loanPaymentSetup.frequency.biweekly' },
  { value: 'SEMIMONTHLY', labelKey: 'loanPaymentSetup.frequency.semimonthly' },
  { value: 'MONTHLY', labelKey: 'loanPaymentSetup.frequency.monthly' },
  { value: 'QUARTERLY', labelKey: 'loanPaymentSetup.frequency.quarterly' },
  { value: 'YEARLY', labelKey: 'loanPaymentSetup.frequency.yearly' },
];

interface LoanPaymentSetupDialogProps {
  isOpen: boolean;
  onClose: () => void;
  loanAccount: { accountId: string; accountName: string; accountType: string; currencyCode?: string };
  accounts: Account[];
  onSetupComplete?: () => void;
}

export function LoanPaymentSetupDialog({
  isOpen,
  onClose,
  loanAccount,
  accounts,
  onSetupComplete,
}: LoanPaymentSetupDialogProps) {
  const t = useTranslations('accounts');
  const [isDetecting, setIsDetecting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [detected, setDetected] = useState<DetectedLoanPayment | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);

  // Form state
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentFrequency, setPaymentFrequency] = useState('MONTHLY');
  const [sourceAccountId, setSourceAccountId] = useState('');
  const [nextDueDate, setNextDueDate] = useState('');
  const [interestRate, setInterestRate] = useState<number | undefined>(undefined);
  const [interestCategoryId, setInterestCategoryId] = useState('');
  const [selectedPayeeId, setSelectedPayeeId] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [autoPost, setAutoPost] = useState(false);

  // Extra principal
  const [includeExtraPrincipal, setIncludeExtraPrincipal] = useState(false);
  const [extraPrincipal, setExtraPrincipal] = useState<number>(0);

  // Use detected split ratio from imported transactions
  const [useDetectedSplit, setUseDetectedSplit] = useState(false);

  // Mortgage-specific
  const isMortgage = loanAccount.accountType === 'MORTGAGE';
  const currencySymbol = getCurrencySymbol(loanAccount.currencyCode || 'USD');
  const [isCanadianMortgage, setIsCanadianMortgage] = useState(false);
  const [isVariableRate, setIsVariableRate] = useState(false);
  const [amortizationMonths, setAmortizationMonths] = useState<number | undefined>(undefined);
  const [termMonths, setTermMonths] = useState<number | undefined>(undefined);

  const sourceAccountOptions = buildAccountDropdownOptions(
    accounts,
    (a) =>
      a.id !== loanAccount.accountId &&
      !a.isClosed &&
      ['CHEQUING', 'SAVINGS', 'CASH'].includes(a.accountType),
    (a) => a.name,
  );

  const categoryOptions = getCategorySelectOptions(categories);

  const payeeOptions = payees.map((p) => ({
    value: p.id,
    label: p.name,
  }));

  const hasDetectedSplit =
    detected?.lastPrincipalAmount != null && detected?.lastInterestAmount != null;

  // Total payment including extra principal
  const totalPaymentAmount = paymentAmount + (includeExtraPrincipal ? extraPrincipal : 0);

  // Detect payment pattern on open
  useEffect(() => {
    if (!isOpen) return;

    const detect = async () => {
      setIsDetecting(true);
      try {
        const [result, cats, payeeList] = await Promise.all([
          accountsApi.detectLoanPayments(loanAccount.accountId),
          categoriesApi.getAll(),
          payeesApi.getAll('active'),
        ]);
        setCategories(cats);
        setPayees(payeeList);

        if (result) {
          setDetected(result);
          setPaymentAmount(result.paymentAmount);
          setPaymentFrequency(result.paymentFrequency);
          setSourceAccountId(result.sourceAccountId || '');
          setNextDueDate(result.suggestedNextDueDate);
          setInterestRate(result.estimatedInterestRate ?? undefined);
          setInterestCategoryId(result.interestCategoryId || '');

          // Pre-fill extra principal if detected
          if (result.averageExtraPrincipal > 0) {
            setExtraPrincipal(result.averageExtraPrincipal);
            setIncludeExtraPrincipal(true);
          }

          // Enable detected split by default for mortgages when split data is available
          if (
            result.lastPrincipalAmount != null &&
            result.lastInterestAmount != null &&
            loanAccount.accountType === 'MORTGAGE'
          ) {
            setUseDetectedSplit(true);
          }
        } else {
          setDetected(null);
          setPaymentAmount(0);
          setPaymentFrequency('MONTHLY');
          setNextDueDate('');
          setInterestRate(undefined);
          setInterestCategoryId('');
          setSourceAccountId(sourceAccountOptions[0]?.value || '');
          setExtraPrincipal(0);
          setIncludeExtraPrincipal(false);
          setUseDetectedSplit(false);
        }
      } catch (error) {
        logger.error('Failed to detect payment pattern:', error);
        setDetected(null);
      } finally {
        setIsDetecting(false);
      }
    };

    detect();
  }, [isOpen, loanAccount.accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePayeeChange = useCallback((payeeId: string, name: string) => {
    setSelectedPayeeId(payeeId);
    setPayeeName(name);
  }, []);

  const handlePayeeCreate = useCallback(async (name: string) => {
    if (!name.trim()) return;
    try {
      const newPayee = await payeesApi.create({ name: name.trim() });
      setPayees((prev) => [...prev, newPayee]);
      setSelectedPayeeId(newPayee.id);
      setPayeeName(newPayee.name);
      toast.success(t('loanPaymentSetup.payeeCreated', { name }));
    } catch (error: any) {
      const message = error?.response?.data?.message || t('loanPaymentSetup.createPayeeFailed');
      toast.error(message);
    }
  }, [t]);

  const handleSubmit = useCallback(async () => {
    if (!totalPaymentAmount || !sourceAccountId || !nextDueDate) {
      toast.error(t('loanPaymentSetup.requiredFields'));
      return;
    }

    setIsSubmitting(true);
    try {
      const data: SetupLoanPaymentsData = {
        paymentAmount: totalPaymentAmount,
        paymentFrequency,
        sourceAccountId,
        nextDueDate,
        interestRate,
        interestCategoryId: interestCategoryId || undefined,
        payeeId: selectedPayeeId || undefined,
        payeeName: payeeName || undefined,
        autoPost,
      };

      if (includeExtraPrincipal && extraPrincipal > 0) {
        data.extraPrincipal = extraPrincipal;
      }

      if (useDetectedSplit && detected?.lastInterestAmount != null) {
        data.detectedInterestAmount = detected.lastInterestAmount;
      }

      if (isMortgage) {
        data.isCanadianMortgage = isCanadianMortgage;
        data.isVariableRate = isVariableRate;
        data.amortizationMonths = amortizationMonths;
        data.termMonths = termMonths;
      }

      await accountsApi.setupLoanPayments(loanAccount.accountId, data);
      toast.success(t('loanPaymentSetup.setupSuccess', { name: loanAccount.accountName }));
      onSetupComplete?.();
      onClose();
    } catch (error: any) {
      const message = error?.response?.data?.message || t('loanPaymentSetup.setupFailed');
      toast.error(message);
      logger.error('Failed to set up loan payments:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    totalPaymentAmount, paymentFrequency, sourceAccountId, nextDueDate,
    interestRate, interestCategoryId, selectedPayeeId, payeeName, autoPost,
    includeExtraPrincipal, extraPrincipal, useDetectedSplit, detected,
    isMortgage, isCanadianMortgage, isVariableRate, amortizationMonths, termMonths,
    loanAccount, onSetupComplete, onClose, t,
  ]);

  const confidenceLabel = detected
    ? detected.confidence >= 0.7
      ? t('loanPaymentSetup.confidenceHigh')
      : detected.confidence >= 0.4
        ? t('loanPaymentSetup.confidenceMedium')
        : t('loanPaymentSetup.confidenceLow')
    : null;

  const accountLabel = isMortgage ? t('loanPaymentSetup.accountMortgage') : t('loanPaymentSetup.accountLoan');

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="lg">
      <div className="p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
          {t('loanPaymentSetup.setUpPayments', { account: accountLabel })}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          {loanAccount.accountName}
        </p>

        {isDetecting ? (
          <div className="flex flex-col items-center py-8">
            <LoadingSpinner />
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              {t('loanPaymentSetup.analyzing')}
            </p>
          </div>
        ) : (
          <>
            {detected && detected.paymentCount > 0 && (
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 mb-4">
                <p className="text-sm text-blue-800 dark:text-blue-300">
                  {t('loanPaymentSetup.detectedPayments', { count: detected.paymentCount, from: detected.firstPaymentDate, to: detected.lastPaymentDate })}
                  {confidenceLabel && (
                    <span className="ml-1">
                      {t('loanPaymentSetup.confidenceLabel')}<strong>{confidenceLabel}</strong>
                    </span>
                  )}
                </p>
                {hasDetectedSplit && (
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                    {t('loanPaymentSetup.lastPaymentSplit', {
                      principal: `${currencySymbol}${detected.lastPrincipalAmount?.toFixed(2)}`,
                      interest: `${currencySymbol}${detected.lastInterestAmount?.toFixed(2)}`,
                    })}
                  </p>
                )}
                {detected.extraPrincipalCount > 0 && (
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                    {detected.extraPrincipalCount !== 1
                      ? t('loanPaymentSetup.extraPrincipalDetectedOther', { count: detected.extraPrincipalCount, avg: `${currencySymbol}${detected.averageExtraPrincipal.toFixed(2)}` })
                      : t('loanPaymentSetup.extraPrincipalDetectedOne', { count: detected.extraPrincipalCount, avg: `${currencySymbol}${detected.averageExtraPrincipal.toFixed(2)}` })}
                  </p>
                )}
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                  {t('loanPaymentSetup.reviewAndAdjust')}
                </p>
              </div>
            )}

            <div className="space-y-4">
              {/* Payment Amount */}
              <div>
                <CurrencyInput
                  label={t('loanPaymentSetup.regularPaymentAmount')}
                  value={paymentAmount || undefined}
                  onChange={(val) => setPaymentAmount(val ?? 0)}
                  prefix={currencySymbol}
                />
              </div>

              {/* Extra Principal */}
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 space-y-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={includeExtraPrincipal}
                    onChange={(e) => setIncludeExtraPrincipal(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('loanPaymentSetup.includeExtraPrincipal')}
                  </span>
                </label>
                {includeExtraPrincipal && (
                  <div className="ml-6">
                    <CurrencyInput
                      label={t('loanPaymentSetup.extraPrincipalPerPayment')}
                      value={extraPrincipal || undefined}
                      onChange={(val) => setExtraPrincipal(val ?? 0)}
                      prefix={currencySymbol}
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t('loanPaymentSetup.totalPayment', { amount: `${currencySymbol}${totalPaymentAmount.toFixed(2)}` })}
                    </p>
                  </div>
                )}
              </div>

              {/* Use Detected Split Ratio */}
              {hasDetectedSplit && (
                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={useDetectedSplit}
                      onChange={(e) => setUseDetectedSplit(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('loanPaymentSetup.useDetectedSplit')}
                    </span>
                  </label>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">
                    {useDetectedSplit
                      ? t('loanPaymentSetup.useDetectedSplitOn', { interest: `${currencySymbol}${detected!.lastInterestAmount!.toFixed(2)}` })
                      : t('loanPaymentSetup.useDetectedSplitOff')}
                  </p>
                </div>
              )}

              {/* Payment Frequency */}
              <div>
                <Select
                  label={t('loanPaymentSetup.paymentFrequency')}
                  value={paymentFrequency}
                  onChange={(e) => setPaymentFrequency(e.target.value)}
                  options={paymentFrequencyOptions.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
                />
              </div>

              {/* Source Account */}
              <div>
                <Select
                  label={t('loanPaymentSetup.paymentFromAccount')}
                  value={sourceAccountId}
                  onChange={(e) => setSourceAccountId(e.target.value)}
                  options={[
                    { value: '', label: t('loanPaymentSetup.selectAccount') },
                    ...sourceAccountOptions,
                  ]}
                />
              </div>

              {/* Next Due Date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('loanPaymentSetup.nextPaymentDate')}
                </label>
                <DateInput
                  value={nextDueDate}
                  onDateChange={(date) => setNextDueDate(date)}
                  onChange={() => {}}
                />
              </div>

              {/* Interest Rate */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('loanPaymentSetup.annualInterestRate')}
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={interestRate ?? ''}
                  onChange={(e) =>
                    setInterestRate(e.target.value ? Number(e.target.value) : undefined)
                  }
                  placeholder={t('loanPaymentSetup.interestRatePlaceholder')}
                />
                {detected?.estimatedInterestRate && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t('loanPaymentSetup.estimatedFromHistory', { rate: detected.estimatedInterestRate })}
                  </p>
                )}
              </div>

              {/* Interest Category */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('loanPaymentSetup.interestExpenseCategory')}
                </label>
                <Combobox
                  value={interestCategoryId}
                  onChange={(val) => setInterestCategoryId(val)}
                  options={categoryOptions}
                  placeholder={t('loanPaymentSetup.selectCategory')}
                />
                {detected?.interestCategoryName && !interestCategoryId && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t('loanPaymentSetup.detectedCategory', { name: detected.interestCategoryName })}
                  </p>
                )}
              </div>

              {/* Payee */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('loanPaymentSetup.payeeLender')}
                </label>
                <Combobox
                  value={selectedPayeeId}
                  onChange={handlePayeeChange}
                  onCreateNew={handlePayeeCreate}
                  options={payeeOptions}
                  placeholder={t('loanPaymentSetup.selectOrCreatePayee')}
                  allowCustomValue={true}
                />
              </div>

              {/* Mortgage-specific fields */}
              {isMortgage && (
                <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
                    {t('loanPaymentSetup.mortgageDetails')}
                  </h3>

                  <div className="space-y-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isCanadianMortgage}
                        onChange={(e) => setIsCanadianMortgage(e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        {t('loanPaymentSetup.canadianMortgage')}
                      </span>
                    </label>

                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isVariableRate}
                        onChange={(e) => setIsVariableRate(e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        {t('loanPaymentSetup.variableRate')}
                      </span>
                    </label>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          {t('loanPaymentSetup.amortizationMonths')}
                        </label>
                        <Input
                          type="number"
                          min="1"
                          max="600"
                          value={amortizationMonths ?? ''}
                          onChange={(e) =>
                            setAmortizationMonths(
                              e.target.value ? Number(e.target.value) : undefined,
                            )
                          }
                          placeholder={t('loanPaymentSetup.amortizationPlaceholder')}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                          {t('loanPaymentSetup.termMonths')}
                        </label>
                        <Input
                          type="number"
                          min="1"
                          max="600"
                          value={termMonths ?? ''}
                          onChange={(e) =>
                            setTermMonths(
                              e.target.value ? Number(e.target.value) : undefined,
                            )
                          }
                          placeholder={t('loanPaymentSetup.termPlaceholder')}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Auto-post */}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={autoPost}
                  onChange={(e) => setAutoPost(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {t('loanPaymentSetup.autoPost')}
                </span>
              </label>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
              <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
                {t('loanPaymentSetup.skip')}
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || !totalPaymentAmount || !sourceAccountId || !nextDueDate}
              >
                {isSubmitting ? t('loanPaymentSetup.settingUp') : t('loanPaymentSetup.setUpPaymentsButton')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
