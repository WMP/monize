'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DateInput } from '@/components/ui/DateInput';
import { OverpaymentPlan } from '@/lib/loan-schedule';
import { accountsApi } from '@/lib/accounts';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { createLogger } from '@/lib/logger';

const logger = createLogger('OverpaymentSimulator');

const MAX_LUMP_SUMS = 50;

interface LumpSumFormRow {
  id: number;
  date: string;
  amount: string;
}

interface SimulatorFormState {
  recurringAmount: string;
  recurringStart: string;
  recurringEnd: string;
  lumpSums: LumpSumFormRow[];
}

const EMPTY_FORM: SimulatorFormState = {
  recurringAmount: '',
  recurringStart: '',
  recurringEnd: '',
  lumpSums: [],
};

interface OverpaymentSimulatorProps {
  accountId: string;
  onPlanChange: (plan: OverpaymentPlan | null) => void;
  /** Externally loaded plan (e.g. a saved scenario); applied when version changes */
  loadedPlan?: OverpaymentPlan | null;
  loadedPlanVersion?: number;
  /** Extra header content (e.g. a save-scenario button) */
  headerActions?: React.ReactNode;
}

function planToForm(plan: OverpaymentPlan | null): SimulatorFormState {
  if (!plan) return EMPTY_FORM;
  return {
    recurringAmount: plan.recurringExtra ? String(plan.recurringExtra.amount) : '',
    recurringStart: plan.recurringExtra?.startDate ?? '',
    recurringEnd: plan.recurringExtra?.endDate ?? '',
    lumpSums: (plan.lumpSums ?? []).map((lumpSum, index) => ({
      id: index,
      date: lumpSum.date,
      amount: String(lumpSum.amount),
    })),
  };
}

function formToPlan(form: SimulatorFormState): OverpaymentPlan | null {
  const recurringAmount = parseFloat(form.recurringAmount);
  const recurringExtra =
    Number.isFinite(recurringAmount) && recurringAmount > 0
      ? {
          amount: recurringAmount,
          ...(form.recurringStart ? { startDate: form.recurringStart } : {}),
          ...(form.recurringEnd ? { endDate: form.recurringEnd } : {}),
        }
      : undefined;

  const lumpSums = form.lumpSums
    .map((row) => ({ date: row.date, amount: parseFloat(row.amount) }))
    .filter((lumpSum) => lumpSum.date && Number.isFinite(lumpSum.amount) && lumpSum.amount > 0);

  if (!recurringExtra && lumpSums.length === 0) return null;
  return {
    ...(recurringExtra ? { recurringExtra } : {}),
    ...(lumpSums.length > 0 ? { lumpSums } : {}),
  };
}

/**
 * What-if inputs for the loan detail page: a recurring extra payment with an
 * optional date window plus one-off lump sums. Emits the resulting
 * OverpaymentPlan upward on every change; the page recomputes the scenario
 * schedule synchronously.
 */
export function OverpaymentSimulator({
  accountId,
  onPlanChange,
  loadedPlan = null,
  loadedPlanVersion = 0,
  headerActions,
}: OverpaymentSimulatorProps) {
  const t = useTranslations('accounts');
  const { formatCurrency } = useNumberFormat();

  const [form, setForm] = useState<SimulatorFormState>(EMPTY_FORM);
  const [nextLumpSumId, setNextLumpSumId] = useState(0);
  const [detectedExtra, setDetectedExtra] = useState<number | null>(null);

  // Apply an externally loaded plan when its version changes (info-from-
  // previous-render pattern; no setState in effect)
  const [appliedPlanVersion, setAppliedPlanVersion] = useState(loadedPlanVersion);
  if (loadedPlanVersion !== appliedPlanVersion) {
    setAppliedPlanVersion(loadedPlanVersion);
    const loadedForm = planToForm(loadedPlan);
    setForm(loadedForm);
    setNextLumpSumId(loadedForm.lumpSums.length);
  }

  // Suggest the historically detected extra principal as a starting point
  useEffect(() => {
    let cancelled = false;
    accountsApi
      .detectLoanPayments(accountId)
      .then((detected) => {
        if (!cancelled && detected && detected.averageExtraPrincipal > 0) {
          setDetectedExtra(detected.averageExtraPrincipal);
        }
      })
      .catch((error) => {
        // The hint is best-effort; the simulator works without it
        logger.debug('Loan payment detection unavailable:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const update = (next: SimulatorFormState) => {
    setForm(next);
    onPlanChange(formToPlan(next));
  };

  const addLumpSum = () => {
    if (form.lumpSums.length >= MAX_LUMP_SUMS) return;
    update({
      ...form,
      lumpSums: [...form.lumpSums, { id: nextLumpSumId, date: '', amount: '' }],
    });
    setNextLumpSumId(nextLumpSumId + 1);
  };

  const updateLumpSum = (id: number, patch: Partial<LumpSumFormRow>) => {
    update({
      ...form,
      lumpSums: form.lumpSums.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    });
  };

  const removeLumpSum = (id: number) => {
    update({ ...form, lumpSums: form.lumpSums.filter((row) => row.id !== id) });
  };

  const reset = () => {
    update(EMPTY_FORM);
  };

  const hasInput =
    form.recurringAmount !== '' || form.recurringStart !== '' || form.recurringEnd !== '' || form.lumpSums.length > 0;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('loanDetail.simulator.title')}
        </h3>
        <div className="flex items-center gap-2">
          {hasInput && (
            <Button variant="ghost" size="sm" onClick={reset}>
              {t('loanDetail.simulator.reset')}
            </Button>
          )}
          {headerActions}
        </div>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        {t('loanDetail.simulator.description')}
      </p>

      {detectedExtra !== null && !form.recurringAmount && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-sm text-blue-800 dark:text-blue-200">
          <span>
            {t('loanDetail.simulator.detectedExtraHint', {
              amount: formatCurrency(detectedExtra),
            })}
          </span>
          <button
            type="button"
            className="font-medium underline hover:no-underline"
            onClick={() => update({ ...form, recurringAmount: String(detectedExtra) })}
          >
            {t('loanDetail.simulator.applyDetected')}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Input
          type="number"
          min="0"
          step="10"
          prefix="$"
          label={t('loanDetail.simulator.recurringAmount')}
          value={form.recurringAmount}
          onChange={(e) => update({ ...form, recurringAmount: e.target.value })}
          placeholder="0"
        />
        <DateInput
          label={t('loanDetail.simulator.recurringStart')}
          value={form.recurringStart}
          onDateChange={(date) => update({ ...form, recurringStart: date })}
        />
        <DateInput
          label={t('loanDetail.simulator.recurringEnd')}
          value={form.recurringEnd}
          onDateChange={(date) => update({ ...form, recurringEnd: date })}
        />
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('loanDetail.simulator.lumpSums')}
          </h4>
          <Button
            variant="outline"
            size="sm"
            onClick={addLumpSum}
            disabled={form.lumpSums.length >= MAX_LUMP_SUMS}
          >
            {t('loanDetail.simulator.addLumpSum')}
          </Button>
        </div>

        {form.lumpSums.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t('loanDetail.simulator.noLumpSums')}
          </p>
        ) : (
          <div className="space-y-2">
            {form.lumpSums.map((row) => (
              <div key={row.id} className="flex flex-wrap items-end gap-2">
                <div className="w-40">
                  <DateInput
                    label={t('loanDetail.simulator.lumpSumDate')}
                    value={row.date}
                    onDateChange={(date) => updateLumpSum(row.id, { date })}
                  />
                </div>
                <div className="w-36">
                  <Input
                    type="number"
                    min="0"
                    step="100"
                    prefix="$"
                    label={t('loanDetail.simulator.lumpSumAmount')}
                    value={row.amount}
                    onChange={(e) => updateLumpSum(row.id, { amount: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeLumpSum(row.id)}
                  aria-label={t('loanDetail.simulator.removeLumpSum')}
                >
                  {t('loanDetail.simulator.removeLumpSum')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
