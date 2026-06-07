'use client';

import { useTranslations } from 'next-intl';

// Labels and queries are resolved at render time via t(item.labelKey) /
// t(item.queryKey) so the suggestions follow the active locale. The keys
// point into the `ai` message namespace.
const SUGGESTED_QUERIES = [
  { labelKey: 'suggested.monthlySpending.label', queryKey: 'suggested.monthlySpending.query' },
  { labelKey: 'suggested.topCategories.label', queryKey: 'suggested.topCategories.query' },
  { labelKey: 'suggested.accountBalances.label', queryKey: 'suggested.accountBalances.query' },
  { labelKey: 'suggested.compareMonths.label', queryKey: 'suggested.compareMonths.query' },
  { labelKey: 'suggested.netWorthTrend.label', queryKey: 'suggested.netWorthTrend.query' },
  { labelKey: 'suggested.savingsRate.label', queryKey: 'suggested.savingsRate.query' },
];

interface SuggestedQueriesProps {
  onSelect: (query: string) => void;
  disabled?: boolean;
}

export function SuggestedQueries({ onSelect, disabled = false }: SuggestedQueriesProps) {
  const t = useTranslations('ai');
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <div className="mb-2">
        <svg
          className="w-12 h-12 text-blue-500 dark:text-blue-400 mx-auto"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.625 9.75a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"
          />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
        {t('suggested.heading')}
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 text-center max-w-md">
        {t('suggested.intro')}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
        {SUGGESTED_QUERIES.map((suggestion) => (
          <button
            key={suggestion.labelKey}
            onClick={() => onSelect(t(suggestion.queryKey))}
            disabled={disabled}
            className="text-left px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-gray-200 dark:disabled:hover:border-gray-700 disabled:hover:bg-transparent"
          >
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {t(suggestion.labelKey)}
            </span>
            <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {t(suggestion.queryKey)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
