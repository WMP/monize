'use client';

import { useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import '@/lib/zodConfig';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { CurrencyInput } from '@/components/ui/CurrencyInput';
import { getCurrencySymbol } from '@/lib/format';
import type {
  BudgetCategory,
  UpdateBudgetCategoryData,
} from '@/types/budget';

const ROLLOVER_TYPES = ['NONE', 'MONTHLY', 'QUARTERLY', 'ANNUAL'] as const;
const CATEGORY_GROUPS = ['', 'NEED', 'WANT', 'SAVING'] as const;

function createBudgetCategoryFormSchema(t: (key: string) => string) {
  return z.object({
    amount: z.number().min(0, t('categoryForm.amountMin')),
    rolloverType: z.enum(ROLLOVER_TYPES),
    rolloverCap: z.string().max(20).optional().or(z.literal('')),
    flexGroup: z.string().max(100).optional().or(z.literal('')),
    categoryGroup: z.enum(CATEGORY_GROUPS),
    alertWarnPercent: z.string().regex(/^\d*$/, t('categoryForm.mustBeNumber')),
    alertCriticalPercent: z.string().regex(/^\d*$/, t('categoryForm.mustBeNumber')),
    notes: z.string().max(1000).optional().or(z.literal('')),
  });
}

type BudgetCategoryFormData = z.infer<ReturnType<typeof createBudgetCategoryFormSchema>>;

interface BudgetCategoryFormProps {
  category: BudgetCategory;
  currencyCode: string;
  onSave: (data: UpdateBudgetCategoryData) => Promise<void>;
  onCancel: () => void;
  isSaving?: boolean;
}

const ROLLOVER_OPTIONS: Array<{ value: (typeof ROLLOVER_TYPES)[number]; labelKey: string }> = [
  { value: 'NONE', labelKey: 'categoryForm.rolloverNone' },
  { value: 'MONTHLY', labelKey: 'categoryForm.rolloverMonthly' },
  { value: 'QUARTERLY', labelKey: 'categoryForm.rolloverQuarterly' },
  { value: 'ANNUAL', labelKey: 'categoryForm.rolloverAnnual' },
];

const GROUP_OPTIONS: Array<{ value: (typeof CATEGORY_GROUPS)[number]; labelKey: string }> = [
  { value: '', labelKey: 'categoryForm.groupNone' },
  { value: 'NEED', labelKey: 'categoryForm.groupNeed' },
  { value: 'WANT', labelKey: 'categoryForm.groupWant' },
  { value: 'SAVING', labelKey: 'categoryForm.groupSaving' },
];

export function BudgetCategoryForm({
  category,
  currencyCode,
  onSave,
  onCancel,
  isSaving = false,
}: BudgetCategoryFormProps) {
  const t = useTranslations('budgets');
  const budgetCategoryFormSchema = useMemo(
    () => createBudgetCategoryFormSchema(t),
    [t],
  );
  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<BudgetCategoryFormData>({
    resolver: zodResolver(budgetCategoryFormSchema),
    defaultValues: {
      amount: category.amount,
      rolloverType: category.rolloverType,
      rolloverCap: category.rolloverCap !== null ? String(category.rolloverCap) : '',
      flexGroup: category.flexGroup ?? '',
      categoryGroup: category.categoryGroup ?? '',
      alertWarnPercent: String(category.alertWarnPercent),
      alertCriticalPercent: String(category.alertCriticalPercent),
      notes: category.notes ?? '',
    },
  });

  // eslint-disable-next-line react-hooks/incompatible-library
  const watchedRolloverType = watch('rolloverType');

  const onSubmit = async (formData: BudgetCategoryFormData) => {
    const data: UpdateBudgetCategoryData = {
      amount: formData.amount,
      rolloverType: formData.rolloverType,
      rolloverCap: formData.rolloverCap ? parseFloat(formData.rolloverCap) : undefined,
      flexGroup: formData.flexGroup || undefined,
      categoryGroup: formData.categoryGroup || undefined,
      alertWarnPercent: parseInt(formData.alertWarnPercent) || 80,
      alertCriticalPercent: parseInt(formData.alertCriticalPercent) || 95,
      notes: formData.notes || undefined,
    };

    await onSave(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t('categoryForm.edit', {
          name: category.category?.parent
            ? `${category.category.parent.name}: ${category.category.name}`
            : category.category?.name ?? t('categoryForm.editFallback'),
        })}
      </h3>

      <Controller
        name="amount"
        control={control}
        render={({ field }) => (
          <CurrencyInput
            label={t('categoryForm.budgetAmount')}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            allowNegative={false}
            prefix={getCurrencySymbol(currencyCode)}
            required
            error={errors.amount?.message}
          />
        )}
      />

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('categoryForm.rolloverType')}
        </label>
        <select
          {...register('rolloverType')}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
        >
          {ROLLOVER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {watchedRolloverType !== 'NONE' && (
        <Input
          label={t('categoryForm.rolloverCapOptional')}
          type="number"
          {...register('rolloverCap')}
          error={errors.rolloverCap?.message}
          min="0"
          step="0.01"
          placeholder={t('categoryForm.rolloverCapPlaceholder')}
        />
      )}

      <Input
        label={t('categoryForm.flexGroupOptional')}
        {...register('flexGroup')}
        error={errors.flexGroup?.message}
        placeholder={t('categoryForm.flexGroupPlaceholder')}
      />

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('categoryForm.categoryGroup')}
        </label>
        <select
          {...register('categoryGroup')}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
        >
          {GROUP_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Input
          label={t('categoryForm.warningAt')}
          type="number"
          {...register('alertWarnPercent')}
          error={errors.alertWarnPercent?.message}
          min="0"
          max="100"
        />
        <Input
          label={t('categoryForm.criticalAt')}
          type="number"
          {...register('alertCriticalPercent')}
          error={errors.alertCriticalPercent?.message}
          min="0"
          max="100"
        />
      </div>

      <Input
        label={t('categoryForm.notesOptional')}
        {...register('notes')}
        error={errors.notes?.message}
        placeholder={t('categoryForm.notesPlaceholder')}
      />

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('categoryForm.cancel')}
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? t('categoryForm.saving') : t('categoryForm.save')}
        </Button>
      </div>
    </form>
  );
}
