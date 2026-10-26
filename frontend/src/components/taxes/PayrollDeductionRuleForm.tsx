'use client';

import { MutableRefObject, useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Controller, useForm, useWatch } from 'react-hook-form';
import '@/lib/zodConfig';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Combobox } from '@/components/ui/Combobox';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { DateInput } from '@/components/ui/DateInput';
import { FormActions } from '@/components/ui/FormActions';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { Select } from '@/components/ui/Select';
import { useFormDirtyNotify } from '@/hooks/useFormDirtyNotify';
import { useFormSubmitRef } from '@/hooks/useFormSubmitRef';
import { useFinancialToday } from '@/hooks/useFinancialToday';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { getCategorySelectOptions } from '@/lib/categoryUtils';
import { createLogger } from '@/lib/logger';
import { payrollDeductionsApi } from '@/lib/payroll-deductions';
import type { Category } from '@/types/category';
import {
  PAYROLL_RESET_PERIODS,
  type CreatePayrollDeductionRuleData,
  type PayrollDeductionRule,
} from '@/types/payroll-deduction';
import type { ScheduledTransaction } from '@/types/scheduled-transaction';

const logger = createLogger('PayrollDeductionRuleForm');

/**
 * The bills a rule can name: active, and neither an investment nor a
 * transfer, since only a category line can be capped (spec decision 5).
 */
export function payrollBillOptions(scheduled: ScheduledTransaction[]): ScheduledTransaction[] {
  return scheduled.filter((st) => st.isActive && !st.isInvestment && !st.isTransfer);
}

/** The magnitude of the bill's deduction line for `categoryId`, or `null`. */
export function billLineAmount(
  bill: ScheduledTransaction | undefined,
  categoryId: string,
): number | null {
  const line = bill?.splits?.find((s) => s.categoryId === categoryId && Number(s.amount) < 0);
  return line ? Math.abs(Number(line.amount)) : null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function buildSchema(
  t: (key: string) => string,
  hasLine: (billId: string, categoryId: string) => boolean,
) {
  return z
    .object({
      scheduledTransactionId: z.string().min(1, t('form.validation.billRequired')),
      categoryId: z.string().min(1, t('form.validation.categoryRequired')),
      yearlyMaximum: z.number({ message: t('form.validation.yearlyMaximumRequired') }).min(0),
      resetPeriod: z.enum(PAYROLL_RESET_PERIODS),
      resetDate: z.string().regex(DATE_PATTERN, t('form.validation.resetDateRequired')),
      expectedPerPaycheque: z.number().min(0).optional(),
    })
    .superRefine((values, ctx) => {
      // The bill's own line is the expected amount; otherwise the user says.
      if (
        values.scheduledTransactionId &&
        values.categoryId &&
        !hasLine(values.scheduledTransactionId, values.categoryId) &&
        values.expectedPerPaycheque === undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['expectedPerPaycheque'],
          message: t('form.validation.expectedRequired'),
        });
      }
    });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface PayrollDeductionRuleFormProps {
  rule?: PayrollDeductionRule;
  scheduledTransactions: ScheduledTransaction[];
  categories: Category[];
  onSubmit: (data: CreatePayrollDeductionRuleData) => Promise<void>;
  onCancel: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
  submitRef?: MutableRefObject<(() => void) | null>;
}

/**
 * One payroll deduction rule (docs/specs/payroll-deductions.md section 3).
 * The expected-per-paycheque field appears only when the chosen bill has no
 * deduction line for the chosen category; when it does, the line's own figure
 * is shown and nothing is stored.
 */
export function PayrollDeductionRuleForm({
  rule,
  scheduledTransactions,
  categories,
  onSubmit,
  onCancel,
  onDirtyChange,
  submitRef,
}: PayrollDeductionRuleFormProps) {
  const t = useTranslations('taxes.payroll');
  const { formatCurrency } = useNumberFormat();
  const today = useFinancialToday();
  const bills = useMemo(() => payrollBillOptions(scheduledTransactions), [scheduledTransactions]);
  const billsById = useMemo(() => new Map(bills.map((b) => [b.id, b])), [bills]);
  const hasLine = useCallback(
    (billId: string, categoryId: string) => billLineAmount(billsById.get(billId), categoryId) !== null,
    [billsById],
  );
  const schema = useMemo(() => buildSchema(t, hasLine), [t, hasLine]);
  const [suggestedFromRecent, setSuggestedFromRecent] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: rule
      ? {
          scheduledTransactionId: rule.scheduledTransactionId,
          categoryId: rule.categoryId,
          yearlyMaximum: Number(rule.yearlyMaximum),
          resetPeriod: rule.resetPeriod,
          resetDate: rule.resetDate,
          expectedPerPaycheque:
            rule.expectedSource === 'entered' && rule.expectedPerPaycheque !== null
              ? Number(rule.expectedPerPaycheque)
              : undefined,
        }
      : {
          scheduledTransactionId: bills.length === 1 ? bills[0].id : '',
          categoryId: '',
          yearlyMaximum: undefined,
          resetPeriod: 'YEARLY',
          resetDate: `${today.slice(0, 4)}-01-01`,
          expectedPerPaycheque: undefined,
        },
  });

  useFormDirtyNotify(isDirty, onDirtyChange);
  useFormSubmitRef(submitRef, handleSubmit, onSubmit);

  const billId = useWatch({ control, name: 'scheduledTransactionId' });
  const categoryId = useWatch({ control, name: 'categoryId' });
  const resetDate = useWatch({ control, name: 'resetDate' });
  const bill = billsById.get(billId);
  const lineAmount = billLineAmount(bill, categoryId);
  const currencyCode = bill?.currencyCode;

  const billOptions = useMemo(
    () => [
      { value: '', label: t('form.billPlaceholder') },
      ...bills.map((b) => ({ value: b.id, label: b.name })),
    ],
    [bills, t],
  );
  const categoryOptions = useMemo(() => getCategorySelectOptions(categories), [categories]);

  // A category picked on a bill without a line for it: ask the server what the
  // ledger suggests, and prefill only while the field is still empty. Done in
  // the change handler, not an effect, so nothing is written during a render.
  const handleCategoryChange = (value: string) => {
    setValue('categoryId', value, { shouldDirty: true, shouldValidate: true });
    setSuggestedFromRecent(false);
    if (!value || !billId || billLineAmount(billsById.get(billId), value) !== null) return;
    payrollDeductionsApi
      .suggest(billId, value)
      .then((suggestion) => {
        if (suggestion.expectedSource === 'recent' && suggestion.expectedPerPaycheque !== null) {
          setValue('expectedPerPaycheque', suggestion.expectedPerPaycheque, { shouldDirty: true });
          setSuggestedFromRecent(true);
        }
      })
      .catch((error) => logger.error(error));
  };

  const submit = async (values: FormValues) => {
    await onSubmit({
      scheduledTransactionId: values.scheduledTransactionId,
      categoryId: values.categoryId,
      yearlyMaximum: values.yearlyMaximum,
      resetPeriod: values.resetPeriod,
      resetDate: values.resetDate,
      expectedPerPaycheque: lineAmount === null ? (values.expectedPerPaycheque ?? null) : null,
    });
  };

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4">
      <div>
        <div className="flex items-center gap-1">
          <Select
            label={t('form.billLabel')}
            options={billOptions}
            error={errors.scheduledTransactionId?.message}
            {...register('scheduledTransactionId')}
          />
          <InfoTooltip text={t('form.billHelp')} placement="bottom" />
        </div>
      </div>

      <Controller
        control={control}
        name="categoryId"
        render={({ field }) => (
          <Combobox
            label={t('form.categoryLabel')}
            placeholder={t('form.categoryPlaceholder')}
            options={categoryOptions}
            value={field.value}
            onChange={handleCategoryChange}
            error={errors.categoryId?.message}
            valueIsId
            usePortal
          />
        )}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex items-end gap-1">
          <Controller
            control={control}
            name="yearlyMaximum"
            render={({ field }) => (
              <CurrencyInput
                id="payroll-yearly-maximum"
                label={t('form.yearlyMaximumLabel')}
                allowNegative={false}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                ref={field.ref}
                error={errors.yearlyMaximum?.message}
              />
            )}
          />
          <InfoTooltip text={t('form.yearlyMaximumHelp')} placement="bottom" align="right" />
        </div>
        <Select
          label={t('form.resetPeriodLabel')}
          options={PAYROLL_RESET_PERIODS.map((p) => ({ value: p, label: t(`form.periods.${p}`) }))}
          error={errors.resetPeriod?.message}
          {...register('resetPeriod')}
        />
      </div>

      <div className="flex items-end gap-1">
        <DateInput
          label={t('form.resetDateLabel')}
          value={resetDate}
          onDateChange={(date) => setValue('resetDate', date, { shouldDirty: true, shouldValidate: true })}
          error={errors.resetDate?.message}
        />
        <InfoTooltip text={t('form.resetDateHelp')} placement="bottom" align="right" />
      </div>

      {billId && categoryId && lineAmount !== null && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('form.expectedFromLine', { amount: formatCurrency(lineAmount, currencyCode) })}
        </p>
      )}
      {billId && categoryId && lineAmount === null && (
        <div>
          <div className="flex items-end gap-1">
            <Controller
              control={control}
              name="expectedPerPaycheque"
              render={({ field }) => (
                <CurrencyInput
                  id="payroll-expected-per-paycheque"
                  label={t('form.expectedLabel')}
                  allowNegative={false}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                  error={errors.expectedPerPaycheque?.message}
                />
              )}
            />
            <InfoTooltip text={t('form.expectedHelp')} placement="bottom" align="right" />
          </div>
          {suggestedFromRecent && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('form.expectedSuggested')}</p>
          )}
        </div>
      )}

      <FormActions onCancel={onCancel} isSubmitting={isSubmitting} />
    </form>
  );
}
