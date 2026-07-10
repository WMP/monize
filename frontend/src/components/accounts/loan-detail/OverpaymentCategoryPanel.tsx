'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import { accountsApi } from '@/lib/accounts';
import { categoriesApi } from '@/lib/categories';
import type { Category } from '@/types/category';
import { createLogger } from '@/lib/logger';

const logger = createLogger('OverpaymentCategoryPanel');

interface OverpaymentCategoryPanelProps {
  accountId: string;
  value: string | null;
  /** Called with the newly selected category id (or null) after a successful save */
  onChange: (categoryId: string | null) => void;
}

/**
 * Per-loan "Overpayment / Extra Principal" category setting. Tagging a
 * standalone overpayment with the chosen category lets the schedule recognize
 * it as 100% principal (interest 0) and flag it, instead of treating it as a
 * regular installment.
 */
export function OverpaymentCategoryPanel({
  accountId,
  value,
  onChange,
}: OverpaymentCategoryPanelProps) {
  const t = useTranslations('accounts');
  const [categories, setCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    categoriesApi
      .getAll()
      .then((all) => {
        if (!cancelled) {
          // Overpayments are expense-side; offer expense categories only.
          setCategories(all.filter((category) => !category.isIncome));
        }
      })
      .catch((error) => {
        logger.debug('Categories unavailable:', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = async (nextValue: string) => {
    const nextId = nextValue || null;
    setSaving(true);
    try {
      await accountsApi.update(accountId, { overpaymentCategoryId: nextId });
      onChange(nextId);
    } catch (error) {
      logger.error('Failed to save overpayment category:', error);
      toast.error(t('loanDetail.overpaymentCategory.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {t('loanDetail.overpaymentCategory.title')}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-3">
        {t('loanDetail.overpaymentCategory.description')}
      </p>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {t('loanDetail.overpaymentCategory.label')}
      </label>
      <select
        value={value ?? ''}
        disabled={saving}
        onChange={(event) => handleChange(event.target.value)}
        className="rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 min-w-[240px] disabled:opacity-50"
      >
        <option value="">{t('loanDetail.overpaymentCategory.none')}</option>
        {categories
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
      </select>
    </div>
  );
}
