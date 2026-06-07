'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';

interface BulkSelectionBannerProps {
  selectionCount: number;
  isAllOnPageSelected: boolean;
  selectAllMatching: boolean;
  totalMatching: number;
  onSelectAllMatching: () => void;
  onClearSelection: () => void;
  onBulkUpdate: () => void;
  onBulkDelete: () => void;
}

export function BulkSelectionBanner({
  selectionCount,
  isAllOnPageSelected,
  selectAllMatching,
  totalMatching,
  onSelectAllMatching,
  onClearSelection,
  onBulkUpdate,
  onBulkDelete,
}: BulkSelectionBannerProps) {
  const t = useTranslations('transactions');
  if (selectionCount === 0) return null;

  return (
    <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3 mb-4 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-sm text-blue-800 dark:text-blue-200">
        <span className="font-medium">
          {t('bulkBanner.selected', { count: selectionCount, plural: selectionCount !== 1 ? 's' : '' })}
        </span>
        {isAllOnPageSelected && !selectAllMatching && totalMatching > selectionCount && (
          <button
            onClick={onSelectAllMatching}
            className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline"
          >
            {t('bulkBanner.selectAllMatching', { total: totalMatching })}
          </button>
        )}
        {selectAllMatching && (
          <span className="text-blue-600 dark:text-blue-400">
            {t('bulkBanner.allMatching')}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onClearSelection}
          className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
        >
          {t('bulkBanner.clearSelection')}
        </button>
        <Button onClick={onBulkUpdate} size="sm">
          {t('bulkBanner.bulkUpdate')}
        </Button>
        <Button onClick={onBulkDelete} size="sm" variant="danger">
          {t('bulkBanner.delete')}
        </Button>
      </div>
    </div>
  );
}
