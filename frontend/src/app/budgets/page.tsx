'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import { useOnUndoRedo } from '@/hooks/useOnUndoRedo';
import { Button } from '@/components/ui/Button';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { BudgetWizard } from '@/components/budgets/BudgetWizard';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { budgetsApi } from '@/lib/budgets';
import { accountsApi } from '@/lib/accounts';
import { useExchangeRates } from '@/hooks/useExchangeRates';
import { getErrorMessage } from '@/lib/errors';
import type { Budget } from '@/types/budget';
import type { Account } from '@/types/account';

export default function BudgetsPage() {
  return (
    <ProtectedRoute>
      <BudgetsContent />
    </ProtectedRoute>
  );
}

function BudgetsContent() {
  const t = useTranslations('budgets');
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  const { defaultCurrency } = useExchangeRates();
  const router = useRouter();

  const loadBudgets = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await budgetsApi.getAll();
      setBudgets(data);
    } catch (error) {
      // A 403 here means a delegate hit /budgets without the section
      // grant; DelegateSectionGuard already shows the single, consistent
      // "no access" message and redirects, so don't double-toast.
      const status =
        typeof error === 'object' && error && 'response' in error
          ? (error as { response?: { status?: number } }).response?.status
          : undefined;
      if (status !== 403) {
        toast.error(getErrorMessage(error, t('page.loadFailed')));
      }
    } finally {
      setIsLoading(false);
    }
    // `t` is intentionally omitted: the next-intl mock returns a new function
    // each render, which would otherwise re-trigger the load effect in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadBudgets();
    accountsApi.getAll().then(setAccounts).catch(() => {});
  }, [loadBudgets]);

  useOnUndoRedo(loadBudgets);

  const handleWizardComplete = () => {
    setShowWizard(false);
    loadBudgets();
  };

  if (showWizard) {
    return (
      <PageLayout>
        <main className="px-4 sm:px-6 lg:px-12 pt-6 pb-8">
          <PageHeader
            title={t('page.createTitle')}
            subtitle={t('page.createSubtitle')}
          />
          <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
            <BudgetWizard
              onComplete={handleWizardComplete}
              onCancel={() => setShowWizard(false)}
              defaultCurrency={defaultCurrency}
              accounts={accounts}
            />
          </div>
        </main>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <main className="px-4 sm:px-6 lg:px-12 pt-6 pb-8">
        <PageHeader
          title={t('page.title')}
          subtitle={t('page.subtitle')}
          helpUrl="https://github.com/kenlasko/monize/wiki/Budgets"
          actions={
            <Button onClick={() => setShowWizard(true)}>
              {t('page.newBudget')}
            </Button>
          }
        />

        {isLoading ? (
          <LoadingSpinner />
        ) : budgets.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-12 text-center">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
              {t('page.emptyTitle')}
            </h3>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              {t('page.emptyDescription')}
            </p>
            <Button onClick={() => setShowWizard(true)}>
              {t('page.createFirst')}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {budgets.map((budget) => (
              <div
                key={budget.id}
                className="bg-white dark:bg-gray-800 shadow rounded-lg p-6 hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => router.push(`/budgets/${budget.id}`)}
                role="link"
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {budget.name}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {t(`labels.strategy.${budget.strategy}`)} - {t(`labels.budgetType.${budget.budgetType}`)}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${
                      budget.isActive
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                    }`}
                  >
                    {budget.isActive ? t('page.active') : t('page.inactive')}
                  </span>
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                  <div>
                    {t('page.categories', { count: budget.categories?.length ?? 0 })}
                  </div>
                  <div>{t('page.started', { date: budget.periodStart })}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </PageLayout>
  );
}
