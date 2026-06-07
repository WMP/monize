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
  Budget,
  UpdateBudgetData,
} from '@/types/budget';

const BUDGET_TYPES = ['MONTHLY', 'ANNUAL', 'PAY_PERIOD'] as const;
const STRATEGIES = ['FIXED', 'ROLLOVER', 'ZERO_BASED', 'FIFTY_THIRTY_TWENTY'] as const;

function createBudgetFormSchema(t: (key: string) => string) {
  return z.object({
    name: z.string().min(1, t('form.nameRequired')).max(255, t('form.nameMaxLength')),
    description: z.string().max(1000, t('form.descriptionMaxLength')).optional().or(z.literal('')),
    budgetType: z.enum(BUDGET_TYPES),
    strategy: z.enum(STRATEGIES),
    baseIncome: z.number().min(0).optional(),
    isActive: z.boolean(),
  });
}

type BudgetFormData = z.infer<ReturnType<typeof createBudgetFormSchema>>;

interface BudgetFormProps {
  budget: Budget;
  onSave: (data: UpdateBudgetData) => Promise<void>;
  onCancel: () => void;
  isSaving?: boolean;
}

const TYPE_OPTIONS: Array<{ value: (typeof BUDGET_TYPES)[number]; labelKey: string }> = [
  { value: 'MONTHLY', labelKey: 'form.typeMonthly' },
  { value: 'ANNUAL', labelKey: 'form.typeAnnual' },
  { value: 'PAY_PERIOD', labelKey: 'form.typePayPeriod' },
];

const STRATEGY_OPTIONS: Array<{ value: (typeof STRATEGIES)[number]; labelKey: string }> = [
  { value: 'FIXED', labelKey: 'form.strategyFixed' },
  { value: 'ROLLOVER', labelKey: 'form.strategyRollover' },
  { value: 'ZERO_BASED', labelKey: 'form.strategyZeroBased' },
  { value: 'FIFTY_THIRTY_TWENTY', labelKey: 'form.strategyFiftyThirtyTwenty' },
];

export function BudgetForm({
  budget,
  onSave,
  onCancel,
  isSaving = false,
}: BudgetFormProps) {
  const t = useTranslations('budgets');
  const budgetFormSchema = useMemo(() => createBudgetFormSchema(t), [t]);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<BudgetFormData>({
    resolver: zodResolver(budgetFormSchema),
    defaultValues: {
      name: budget.name,
      description: budget.description ?? '',
      budgetType: budget.budgetType,
      strategy: budget.strategy,
      baseIncome: budget.baseIncome !== null ? budget.baseIncome : undefined,
      isActive: budget.isActive,
    },
  });

  const onSubmit = async (formData: BudgetFormData) => {
    const data: UpdateBudgetData = {
      name: formData.name.trim(),
      description: formData.description?.trim() || undefined,
      budgetType: formData.budgetType,
      strategy: formData.strategy,
      baseIncome: formData.baseIncome ?? undefined,
    };

    await onSave(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Input
        label={t('form.budgetName')}
        {...register('name')}
        error={errors.name?.message}
        required
        maxLength={255}
      />

      <Input
        label={t('form.descriptionOptional')}
        {...register('description')}
        error={errors.description?.message}
        placeholder={t('form.descriptionPlaceholder')}
      />

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('form.budgetType')}
        </label>
        <select
          {...register('budgetType')}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
        >
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>
        {errors.budgetType && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.budgetType.message}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('form.strategy')}
        </label>
        <select
          {...register('strategy')}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
        >
          {STRATEGY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </select>
        {errors.strategy && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.strategy.message}</p>
        )}
      </div>

      <Controller
        name="baseIncome"
        control={control}
        render={({ field }) => (
          <CurrencyInput
            label={t('form.baseIncomeOptional')}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            allowNegative={false}
            prefix={getCurrencySymbol(budget.currencyCode)}
            placeholder={t('form.baseIncomePlaceholder')}
          />
        )}
      />

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="isActive"
          {...register('isActive')}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <label
          htmlFor="isActive"
          className="text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          {t('form.active')}
        </label>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('form.cancel')}
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? t('form.saving') : t('form.saveChanges')}
        </Button>
      </div>
    </form>
  );
}
