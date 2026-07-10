'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import { Cog6ToothIcon } from '@heroicons/react/24/outline';
import { Combobox } from '@/components/ui/Combobox';
import { accountsApi } from '@/lib/accounts';
import { categoriesApi } from '@/lib/categories';
import { buildCategoryTree } from '@/lib/categoryUtils';
import { useClickOutside } from '@/hooks/useClickOutside';
import type { Category } from '@/types/category';
import { createLogger } from '@/lib/logger';

const logger = createLogger('OverpaymentSettingsControl');

interface OverpaymentSettingsControlProps {
  accountId: string;
  categoryValue: string | null;
  memoValue: string | null;
  /** Called with the newly selected category id (or null) after a successful save */
  onCategoryChange: (categoryId: string | null) => void;
  /** Called with the newly saved memo text (or null) after a successful save */
  onMemoChange: (memo: string | null) => void;
}

/**
 * Gear-menu settings for how a loan recognizes standalone overpayments (extra
 * principal). A payment matching the chosen category or the memo text counts as
 * 100% principal (interest 0) and is flagged, instead of being treated as a
 * regular installment. Either match works on its own, so a user can tag
 * overpayments by category, by memo, or both. Uses the same category Combobox
 * as the transaction form.
 */
export function OverpaymentSettingsControl({
  accountId,
  categoryValue,
  memoValue,
  onCategoryChange,
  onMemoChange,
}: OverpaymentSettingsControlProps) {
  const t = useTranslations('accounts');
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);
  const [memoDraft, setMemoDraft] = useState(memoValue ?? '');
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Keep the memo input in sync when the saved value changes upstream
  // (info-from-previous-render pattern -- no setState in effect).
  const [trackedMemo, setTrackedMemo] = useState(memoValue);
  if (trackedMemo !== memoValue) {
    setTrackedMemo(memoValue);
    setMemoDraft(memoValue ?? '');
  }

  useClickOutside(wrapperRef, () => setOpen(false), {
    enabled: open,
    onEscape: () => setOpen(false),
  });

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

  // Hierarchical "Parent: Child" labels, matching the transaction form's picker.
  const categoryOptions = useMemo(
    () =>
      buildCategoryTree(categories).map(({ category }) => {
        const parent = category.parentId
          ? categories.find((c) => c.id === category.parentId)
          : null;
        return {
          value: category.id,
          label: parent ? `${parent.name}: ${category.name}` : category.name,
        };
      }),
    [categories],
  );

  const currentLabel =
    categoryOptions.find((option) => option.value === categoryValue)?.label ?? '';

  const handleCategoryChange = async (categoryId: string) => {
    const nextId = categoryId || null;
    if (nextId === categoryValue) return;
    setSaving(true);
    try {
      await accountsApi.update(accountId, { overpaymentCategoryId: nextId });
      onCategoryChange(nextId);
    } catch (error) {
      logger.error('Failed to save overpayment category:', error);
      toast.error(t('loanDetail.overpaymentCategory.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleMemoSave = async () => {
    const nextMemo = memoDraft.trim() || null;
    if (nextMemo === (memoValue ?? null)) return;
    setSaving(true);
    try {
      await accountsApi.update(accountId, { overpaymentMemo: nextMemo });
      onMemoChange(nextMemo);
    } catch (error) {
      logger.error('Failed to save overpayment memo:', error);
      toast.error(t('loanDetail.overpaymentCategory.saveError'));
      // Restore the last saved value so the input reflects reality.
      setMemoDraft(memoValue ?? '');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={t('loanDetail.overpaymentCategory.title')}
        aria-expanded={open}
        className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <Cog6ToothIcon className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-72 z-20 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg dark:shadow-gray-700/50 p-4">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('loanDetail.overpaymentCategory.title')}
          </h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-3">
            {t('loanDetail.overpaymentCategory.description')}
          </p>
          <Combobox
            label={t('loanDetail.overpaymentCategory.label')}
            placeholder={t('loanDetail.overpaymentCategory.placeholder')}
            options={categoryOptions}
            value={categoryValue ?? ''}
            initialDisplayValue={currentLabel}
            onChange={handleCategoryChange}
            disabled={saving}
          />
          <div className="mt-3">
            <label
              htmlFor="overpayment-memo"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
            >
              {t('loanDetail.overpaymentCategory.memoLabel')}
            </label>
            <input
              id="overpayment-memo"
              type="text"
              value={memoDraft}
              onChange={(e) => setMemoDraft(e.target.value)}
              onBlur={handleMemoSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleMemoSave();
                }
              }}
              maxLength={255}
              disabled={saving}
              placeholder={t('loanDetail.overpaymentCategory.memoPlaceholder')}
              className="block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm text-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('loanDetail.overpaymentCategory.memoHelp')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
