'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { usePreferencesStore } from '@/store/preferencesStore';
import { getReportCatalogEntry, type Report } from '@/components/reports/report-catalog';

interface FavouriteReportsWidgetProps {
  isLoading?: boolean;
}

export function FavouriteReportsWidget({ isLoading }: FavouriteReportsWidgetProps) {
  const t = useTranslations('dashboard');
  const tReports = useTranslations('reports');
  const router = useRouter();
  const preferences = usePreferencesStore((s) => s.preferences);

  // Only built-in report ids live in favouriteReportIds (custom/investment
  // report favourites are tracked separately). Keep only ids that still map to
  // a catalog entry with a translated name so a removed report cannot break
  // the widget.
  const favourites = useMemo(() => {
    const ids = preferences?.favouriteReportIds ?? [];
    return ids
      .map((id) => getReportCatalogEntry(id))
      .filter(
        (entry): entry is Report =>
          !!entry && tReports.has(`page.names.${entry.id}` as never),
      );
  }, [preferences?.favouriteReportIds, tReports]);

  const sectionTitle = t('favouriteReports.title');

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-3 sm:p-6 lg:min-h-[390px]">
        <div className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {sectionTitle}
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
          <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-3 sm:p-6 lg:min-h-[390px]">
      <button
        onClick={() => router.push('/reports')}
        className="text-lg font-semibold text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors mb-4"
      >
        {sectionTitle}
      </button>

      {favourites.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-sm">
          {t.rich('favouriteReports.empty', {
            reportsLink: (chunks) => (
              <button
                onClick={() => router.push('/reports')}
                className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
              >
                {chunks}
              </button>
            ),
          })}
        </p>
      ) : (
        <ul className="space-y-1">
          {favourites.map((report) => {
            const colorClass = report.color || 'bg-purple-500';
            return (
              <li key={report.id}>
                <button
                  onClick={() => router.push(`/reports/${report.id}`)}
                  className="w-full flex items-center gap-3 rounded-md px-2 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                  <span
                    className={`${colorClass} bg-opacity-20 dark:bg-opacity-30 rounded-md p-1.5 flex-shrink-0 flex items-center justify-center`}
                  >
                    <span className="text-gray-700 dark:text-gray-200 [&>svg]:h-5 [&>svg]:w-5">
                      {report.icon}
                    </span>
                  </span>
                  <span className="truncate font-medium">
                    {tReports(`page.names.${report.id}` as never)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
