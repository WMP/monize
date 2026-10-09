'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ExclamationTriangleIcon, InboxIcon } from '@heroicons/react/24/outline';
import { AiReviewRow } from '@/components/ai-review/AiReviewRow';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SEGMENTED_GROUP_CLASS, segmentClass } from '@/components/ui/segmented-control';
import { TABLE_BODY_CLASS, TABLE_CLASS, Th } from '@/components/ui/Table';
import { TOUR_ANCHORS, tourAnchor } from '@/lib/tours/anchors';
import { useAiReviewInbox } from '@/hooks/useAiReviewInbox';
import {
  AI_REVIEW_KIND_FILTERS,
  AI_REVIEW_STATUSES,
  parseKindFilter,
  reviewItemLabel,
  type AiReviewFilter,
  type AiReviewItem,
  type AiReviewKindFilter,
} from '@/types/ai-review';

const FILTERS: readonly AiReviewFilter[] = ['open', ...AI_REVIEW_STATUSES];

/**
 * The review inbox: the requests rules (and, later, the user) have queued for
 * an AI, filtered by status. `items === null` is loading or failed, never an
 * empty list; only a loaded, empty answer shows the explanation.
 */
export function AiReviewInbox() {
  const t = useTranslations('aiReview');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const {
    filter,
    setFilter,
    kind,
    setKind,
    shownItems,
    approvable,
    selected,
    toggleSelected,
    clearSelection,
    batching,
    summary,
    clearSummary,
    approveBatch,
    items,
    loadFailed,
    retry,
    cards,
    dismissing,
    approve,
    dismiss,
  } = useAiReviewInbox(parseKindFilter(searchParams.get('kind')));
  const [dismissTarget, setDismissTarget] = useState<AiReviewItem | null>(null);
  const [bulkTarget, setBulkTarget] = useState<readonly AiReviewItem[] | null>(null);

  // The kind filter lives in the URL (?kind=) so a link, a reload and the back button keep it.
  const chooseKind = (next: AiReviewKindFilter) => {
    setKind(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'all') params.delete('kind');
    else params.set('kind', next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const confirmBulk = () => {
    const target = bulkTarget;
    setBulkTarget(null);
    if (target) void approveBatch(target);
  };

  const allApprovableSelected = approvable.length > 0 && selected.length === approvable.length;
  const toggleAll = () => {
    if (allApprovableSelected) clearSelection();
    else approvable.filter((item) => !selected.includes(item)).forEach((item) => toggleSelected(item.id));
  };
  const selectable = approvable.length > 0;
  const nameOf = (id: string) => {
    const item = items?.find((candidate) => candidate.id === id);
    return (item ? reviewItemLabel(item) : null) ?? t('bulk.unknownRequest');
  };

  const confirmDismiss = () => {
    const target = dismissTarget;
    setDismissTarget(null);
    if (target) void dismiss(target);
  };

  let body;
  if (items === null && loadFailed) {
    body = (
      <div role="alert">
        <EmptyState
          icon={<ExclamationTriangleIcon />}
          title={t('error.title')}
          description={t('error.body')}
          action={<Button onClick={retry}>{t('error.retry')}</Button>}
        />
      </div>
    );
  } else if (shownItems === null) {
    body = <LoadingSpinner text={t('loading')} />;
  } else if (shownItems.length === 0) {
    const narrowed = kind !== 'all' || filter !== 'open';
    body = (
      <EmptyState
        icon={<InboxIcon />}
        title={narrowed ? t('empty.filteredTitle') : t('empty.title')}
        description={narrowed ? t('empty.filteredBody') : t('empty.body')}
      />
    );
  } else {
    body = (
      <div className="overflow-x-auto">
        <table className={TABLE_CLASS}>
          <thead>
            <tr>
              {selectable && (
                <Th className="w-10 px-2 sm:px-4">
                  <input
                    type="checkbox"
                    checked={allApprovableSelected}
                    onChange={toggleAll}
                    aria-label={t('bulk.selectAll')}
                    className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus-visible:ring-blue-500 dark:border-gray-600"
                  />
                </Th>
              )}
              <Th className="px-2 sm:px-4">{t('columns.date')}</Th>
              <Th className="px-2 sm:px-4">{t('columns.request')}</Th>
              <Th align="right" className="px-2 sm:px-4">
                {t('columns.amount')}
              </Th>
              <Th className="px-2 sm:px-4">{t('columns.status')}</Th>
            </tr>
          </thead>
          <tbody className={TABLE_BODY_CLASS}>
            {shownItems.map((item) => (
              <AiReviewRow
                key={item.id}
                item={item}
                card={cards[item.id]}
                dismissing={dismissing.has(item.id)}
                selectable={selectable}
                selected={selected.includes(item)}
                onToggleSelected={(row) => toggleSelected(row.id)}
                onApprove={approve}
                onDismiss={setDismissTarget}
              />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-4" {...tourAnchor(TOUR_ANCHORS.aiReviewInbox)}>
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label={t('filter.label')} className={`${SEGMENTED_GROUP_CLASS} max-w-full flex-wrap`}>
          {FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={filter === option}
              onClick={() => setFilter(option)}
              className={segmentClass(filter === option)}
            >
              {t(`filter.${option}`)}
            </button>
          ))}
        </div>
        <div role="group" aria-label={t('kindFilter.label')} className={`${SEGMENTED_GROUP_CLASS} max-w-full flex-wrap`}>
          {AI_REVIEW_KIND_FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              onClick={() => chooseKind(option)}
              className={segmentClass(kind === option)}
            >
              {t(`kindFilter.${option}`)}
            </button>
          ))}
        </div>
      </div>
      {approvable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => setBulkTarget(selected)}
            disabled={selected.length === 0 || batching}
            isLoading={batching}
          >
            {t('bulk.approveSelected', { count: selected.length })}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setBulkTarget(approvable)} disabled={batching}>
            {t('bulk.approveAllShown', { count: approvable.length })}
          </Button>
        </div>
      )}
      {summary && (
        <div
          role="status"
          className={`rounded-lg border px-3 py-2 ${
            summary.failed > 0
              ? 'border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-900/20'
              : 'border-green-200 bg-green-50 dark:border-green-900/60 dark:bg-green-900/20'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t('bulk.summary', { approved: summary.approved, failed: summary.failed })}
            </p>
            <Button variant="outline" size="sm" onClick={clearSummary}>
              {t('bulk.closeSummary')}
            </Button>
          </div>
          {summary.failures.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
              {summary.failures.map((failure) => (
                <li key={failure.id}>{t('bulk.failure', { name: nameOf(failure.id), reason: failure.error ?? t('bulk.noReason') })}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <Card>{body}</Card>
      <ConfirmDialog
        isOpen={bulkTarget !== null}
        title={t('bulk.dialog.title', { count: bulkTarget?.length ?? 0 })}
        message={t('bulk.dialog.message')}
        confirmLabel={t('bulk.dialog.confirm', { count: bulkTarget?.length ?? 0 })}
        variant="warning"
        onConfirm={confirmBulk}
        onCancel={() => setBulkTarget(null)}
      />
      <ConfirmDialog
        isOpen={dismissTarget !== null}
        title={t('dismissDialog.title')}
        message={t('dismissDialog.message')}
        confirmLabel={t('dismissDialog.confirm')}
        variant="warning"
        onConfirm={confirmDismiss}
        onCancel={() => setDismissTarget(null)}
      />
    </div>
  );
}
