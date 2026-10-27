'use client';

import { MutableRefObject, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import '@/lib/zodConfig';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { DateInput } from '@/components/ui/DateInput';
import { FormActions } from '@/components/ui/FormActions';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { Select } from '@/components/ui/Select';
import { useFormDirtyNotify } from '@/hooks/useFormDirtyNotify';
import { useFormSubmitRef } from '@/hooks/useFormSubmitRef';
import { useFinancialToday } from '@/hooks/useFinancialToday';
import { getCategorySelectOptions } from '@/lib/categoryUtils';
import { createLogger } from '@/lib/logger';
import { payrollDeductionsApi } from '@/lib/payroll-deductions';
import type { Category } from '@/types/category';
import {
  PAYROLL_BATCH_MAX_LINES,
  PAYROLL_RESET_PERIODS,
  type CreatePayrollDeductionRulesData,
  type PayrollDeductionRule,
} from '@/types/payroll-deduction';
import type { ScheduledTransaction } from '@/types/scheduled-transaction';
import {
  PayrollDeductionLineFields,
  type PayrollDeductionFormValues,
} from './PayrollDeductionLineFields';

const logger = createLogger('PayrollDeductionRuleForm');

/**
 * The bills a rule can name: active, a net income (a paycheque pays in more
 * than it takes out), and neither an investment nor a transfer, since only a
 * category line can be capped (spec decision 5).
 */
export function payrollBillOptions(scheduled: ScheduledTransaction[]): ScheduledTransaction[] {
  return scheduled.filter(
    (st) => st.isActive && !st.isInvestment && !st.isTransfer && Number(st.amount) > 0,
  );
}

/**
 * The categories a rule on `bill` can name: those on its deduction lines, a
 * split line with a category and a non-positive amount. The gross line is not
 * a deduction, and a transfer line has no category to cap. A zero line counts:
 * it is a deduction the bill stopped collecting, which a rule may resume.
 */
export function billDeductionCategoryIds(bill: ScheduledTransaction | undefined): string[] {
  const ids = (bill?.splits ?? [])
    .filter((s) => s.categoryId && !s.transferAccountId && Number(s.amount) <= 0)
    .map((s) => s.categoryId as string);
  return Array.from(new Set(ids));
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
      resetPeriod: z.enum(PAYROLL_RESET_PERIODS),
      resetDate: z.string().regex(DATE_PATTERN, t('form.validation.resetDateRequired')),
      lines: z
        .array(
          z.object({
            categoryId: z.string().min(1, t('form.validation.categoryRequired')),
            yearlyMaximum: z.number({ message: t('form.validation.yearlyMaximumRequired') }).min(0),
            expectedPerPaycheque: z.number().min(0).optional(),
            /** Set when the expected figure was prefilled from the ledger. */
            suggested: z.boolean().optional(),
            maximumSuggested: z.boolean().optional(),
          }),
        )
        .min(1)
        .max(PAYROLL_BATCH_MAX_LINES),
    })
    .superRefine((values, ctx) => {
      const seen = new Set<string>();
      values.lines.forEach((line, index) => {
        if (line.categoryId && seen.has(line.categoryId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['lines', index, 'categoryId'],
            message: t('form.validation.categoryDuplicate'),
          });
        }
        seen.add(line.categoryId);
        // The bill's own line is the expected amount; otherwise the user says.
        if (
          values.scheduledTransactionId &&
          line.categoryId &&
          !hasLine(values.scheduledTransactionId, line.categoryId) &&
          line.expectedPerPaycheque === undefined
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['lines', index, 'expectedPerPaycheque'],
            message: t('form.validation.expectedRequired'),
          });
        }
      });
    });
}

// The resolver's typing holds the schema's output to this shape.
type FormValues = PayrollDeductionFormValues;

/** A fresh row: no category and an empty maximum, which the schema refuses. */
const emptyLine = (): FormValues['lines'][number] => ({
  categoryId: '',
  yearlyMaximum: undefined as unknown as number,
  expectedPerPaycheque: undefined,
  suggested: false,
  maximumSuggested: false,
});

interface PayrollDeductionRuleFormProps {
  /** The rule being edited; the form then holds exactly one line. */
  rule?: PayrollDeductionRule;
  scheduledTransactions: ScheduledTransaction[];
  categories: Category[];
  /** The user's current rules; a category already ruled on the bill is not offered again. */
  existingRules?: PayrollDeductionRule[];
  onSubmit: (data: CreatePayrollDeductionRulesData) => Promise<void>;
  onCancel: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
  submitRef?: MutableRefObject<(() => void) | null>;
}

/**
 * The deduction rules of one payroll bill (docs/specs/payroll-deductions.md
 * section 3). The bill and the reset are shared; each category row carries its
 * own maximum. A row's expected-per-paycheque field appears only when the
 * bill's line for the category is not a deduction; when it is, the line's own
 * figure is shown and nothing is stored.
 */
export function PayrollDeductionRuleForm({
  rule,
  scheduledTransactions,
  categories,
  existingRules = [],
  onSubmit,
  onCancel,
  onDirtyChange,
  submitRef,
}: PayrollDeductionRuleFormProps) {
  const t = useTranslations('taxes.payroll');
  const today = useFinancialToday();
  const bills = useMemo(() => payrollBillOptions(scheduledTransactions), [scheduledTransactions]);
  const billsById = useMemo(() => new Map(bills.map((b) => [b.id, b])), [bills]);
  const hasLine = useCallback(
    (billId: string, categoryId: string) => billLineAmount(billsById.get(billId), categoryId) !== null,
    [billsById],
  );
  const schema = useMemo(() => buildSchema(t, hasLine), [t, hasLine]);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    getValues,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: rule
      ? {
          scheduledTransactionId: rule.scheduledTransactionId,
          resetPeriod: rule.resetPeriod,
          resetDate: rule.resetDate,
          lines: [
            {
              categoryId: rule.categoryId,
              yearlyMaximum: Number(rule.yearlyMaximum),
              expectedPerPaycheque:
                rule.expectedSource === 'entered' && rule.expectedPerPaycheque !== null
                  ? Number(rule.expectedPerPaycheque)
                  : undefined,
              suggested: false,
              maximumSuggested: false,
            },
          ],
        }
      : {
          scheduledTransactionId: bills.length === 1 ? bills[0].id : '',
          resetPeriod: 'YEARLY',
          // The next 1 January: the count resets at the turn of the year.
          resetDate: `${Number(today.slice(0, 4)) + 1}-01-01`,
          lines: [emptyLine()],
        },
  });
  const { fields, append, remove, replace } = useFieldArray({ control, name: 'lines' });

  useFormDirtyNotify(isDirty, onDirtyChange);
  useFormSubmitRef(submitRef, handleSubmit, onSubmit);

  const billId = useWatch({ control, name: 'scheduledTransactionId' });
  const lines = useWatch({ control, name: 'lines' });
  const resetDate = useWatch({ control, name: 'resetDate' });
  const bill = billsById.get(billId);

  const billOptions = useMemo(
    () => [
      { value: '', label: t('form.billPlaceholder') },
      ...bills.map((b) => ({ value: b.id, label: b.name })),
    ],
    [bills, t],
  );

  // Only the bill's deduction lines are offered, less the ones another row or
  // an existing rule already names (one rule per bill and category).
  const deductionIds = useMemo(() => billDeductionCategoryIds(bill), [bill]);
  const ruledIds = useMemo(
    () =>
      new Set(
        existingRules
          .filter((r) => r.scheduledTransactionId === billId && r.id !== rule?.id)
          .map((r) => r.categoryId),
      ),
    [existingRules, billId, rule?.id],
  );
  const allCategoryOptions = useMemo(() => getCategorySelectOptions(categories), [categories]);
  const optionsForRow = useCallback(
    (index: number) => {
      const taken = new Set(
        (lines ?? []).flatMap((line, i) => (i === index || !line.categoryId ? [] : [line.categoryId])),
      );
      const own = lines?.[index]?.categoryId;
      const offered = new Set(
        deductionIds.filter((id) => (id === own || !ruledIds.has(id)) && !taken.has(id)),
      );
      if (own) offered.add(own);
      return allCategoryOptions.filter((o) => offered.has(o.value));
    },
    [lines, deductionIds, ruledIds, allCategoryOptions],
  );
  const unruledCount = deductionIds.filter((id) => !ruledIds.has(id)).length;
  const canAddRow = !rule && fields.length < Math.min(unruledCount, PAYROLL_BATCH_MAX_LINES);

  // A new bill means new lines: the rows start over.
  const handleBillChange = () => {
    if (!rule) replace([emptyLine()]);
  };

  // Ask the server what the ledger says about the category: the maximum it
  // has already collected up to, and, when the bill's line is not a
  // deduction, the amount it usually deducts. Each prefills only while its
  // box is still empty. Done in the change handler, not an effect, so nothing
  // is written during a render.
  const handleCategoryChange = (index: number, value: string) => {
    setValue(`lines.${index}.categoryId`, value, { shouldDirty: true, shouldValidate: true });
    setValue(`lines.${index}.suggested`, false);
    setValue(`lines.${index}.maximumSuggested`, false);
    // A second paycheque deducting to a category another bill already caps
    // shares that maximum (the forecast pools the room), so an empty box
    // starts from the rule entered first.
    const sibling = existingRules.find(
      (r) => r.categoryId === value && r.scheduledTransactionId !== billId && r.id !== rule?.id,
    );
    if (sibling && getValues(`lines.${index}.yearlyMaximum`) === undefined) {
      setValue(`lines.${index}.yearlyMaximum`, Number(sibling.yearlyMaximum), {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
    if (!value || !billId) return;
    const hasLine = billLineAmount(billsById.get(billId), value) !== null;
    payrollDeductionsApi
      .suggest(billId, value, getValues('resetDate') || undefined)
      .then((suggestion) => {
        if (
          suggestion.yearlyMaximum !== null &&
          getValues(`lines.${index}.yearlyMaximum`) === undefined
        ) {
          setValue(`lines.${index}.yearlyMaximum`, suggestion.yearlyMaximum, {
            shouldDirty: true,
            shouldValidate: true,
          });
          setValue(`lines.${index}.maximumSuggested`, true);
        }
        if (
          !hasLine &&
          suggestion.expectedSource === 'ledger' &&
          suggestion.expectedPerPaycheque !== null
        ) {
          setValue(`lines.${index}.expectedPerPaycheque`, suggestion.expectedPerPaycheque, {
            shouldDirty: true,
          });
          setValue(`lines.${index}.suggested`, true);
        }
      })
      .catch((error) => logger.error(error));
  };

  const submit = async (values: FormValues) => {
    await onSubmit({
      scheduledTransactionId: values.scheduledTransactionId,
      resetPeriod: values.resetPeriod,
      resetDate: values.resetDate,
      lines: values.lines.map((line) => ({
        categoryId: line.categoryId,
        yearlyMaximum: line.yearlyMaximum,
        expectedPerPaycheque:
          billLineAmount(bill, line.categoryId) === null ? (line.expectedPerPaycheque ?? null) : null,
      })),
    });
  };

  return (
    <form onSubmit={handleSubmit(submit)} className="space-y-4">
      <div>
        <div className="flex items-center mb-1">
          <label htmlFor="payroll-bill" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('form.billLabel')}
          </label>
          <InfoTooltip text={t('form.billHelp')} placement="bottom" usePortal />
        </div>
        <Select
          id="payroll-bill"
          options={billOptions}
          error={errors.scheduledTransactionId?.message}
          {...register('scheduledTransactionId', { onChange: handleBillChange })}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label={t('form.resetPeriodLabel')}
          options={PAYROLL_RESET_PERIODS.map((p) => ({ value: p, label: t(`form.periods.${p}`) }))}
          error={errors.resetPeriod?.message}
          {...register('resetPeriod')}
        />
        <div>
          <div className="flex items-center mb-1">
            <label htmlFor="payroll-reset-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('form.resetDateLabel')}
            </label>
            <InfoTooltip text={t('form.resetDateHelp')} placement="bottom" usePortal />
          </div>
          <DateInput
            id="payroll-reset-date"
            value={resetDate}
            onDateChange={(date) => setValue('resetDate', date, { shouldDirty: true, shouldValidate: true })}
            error={errors.resetDate?.message}
          />
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('form.categoriesLegend')}
        </legend>
        {bill && deductionIds.length === 0 && (
          <p className="text-sm text-amber-600 dark:text-amber-400">{t('form.noDeductionLines')}</p>
        )}
        {bill && deductionIds.length > 0 && unruledCount === 0 && !rule && (
          <p className="text-sm text-amber-600 dark:text-amber-400">{t('form.allLinesRuled')}</p>
        )}
        {fields.map((field, index) => (
          <PayrollDeductionLineFields
            key={field.id}
            index={index}
            control={control}
            errors={errors.lines?.[index]}
            categoryOptions={optionsForRow(index)}
            lineAmount={billLineAmount(bill, lines?.[index]?.categoryId ?? '')}
            currencyCode={bill?.currencyCode}
            suggested={lines?.[index]?.suggested === true}
            maximumSuggested={lines?.[index]?.maximumSuggested === true}
            onCategoryChange={(value) => handleCategoryChange(index, value)}
            onRemove={!rule && fields.length > 1 ? () => remove(index) : undefined}
          />
        ))}
        {canAddRow && (
          <button
            type="button"
            onClick={() => append(emptyLine())}
            className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 focus-visible:outline-2 focus-visible:outline-blue-500 rounded"
          >
            {t('form.addCategory')}
          </button>
        )}
      </fieldset>

      <FormActions onCancel={onCancel} isSubmitting={isSubmitting} />
    </form>
  );
}
