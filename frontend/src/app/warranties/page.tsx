'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import { PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { ListBottomPager } from '@/components/ui/ListBottomPager';
import { LIST_TOOLBAR_BUTTON_CLASS } from '@/components/ui/ListTopToolbar';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Modal } from '@/components/ui/Modal';
import { SummaryCard, SummaryIcons } from '@/components/ui/SummaryCard';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { UnsavedChangesDialog } from '@/components/ui/UnsavedChangesDialog';
import { WarrantyList } from '@/components/warranties/WarrantyList';
import type { WarrantyPrefill } from '@/components/warranties/WarrantyForm';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useFormModal } from '@/hooks/useFormModal';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { useOnAiAction } from '@/hooks/useOnAiAction';
import { useOnUndoRedo } from '@/hooks/useOnUndoRedo';
import { PAGE_SIZE } from '@/lib/constants';
import { getErrorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import { transactionsApi } from '@/lib/transactions';
import { isUuid } from '@/lib/uuid';
import { warrantiesApi } from '@/lib/warranties';
import { useAuthStore } from '@/store/authStore';
import type {
  CreateWarrantyData,
  Warranty,
  WarrantyListResult,
  WarrantySort,
  WarrantyStatusFilter,
  WarrantySummary,
} from '@/types/warranty';

const WarrantyForm = dynamic(
  () => import('@/components/warranties/WarrantyForm').then((m) => m.WarrantyForm),
  { ssr: false },
);

const logger = createLogger('Warranties');

const STATUS_FILTERS: readonly WarrantyStatusFilter[] = ['all', 'expiring', 'active', 'expired', 'lifetime'];

export default function WarrantiesPage() {
  return (
    <ProtectedRoute>
      {/* The page reads ?new= and ?transactionId= through useSearchParams. */}
      <Suspense fallback={null}>
        <WarrantiesContent />
      </Suspense>
    </ProtectedRoute>
  );
}

function WarrantiesContent() {
  const t = useTranslations('warranties');
  const tc = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { formatNumber } = useNumberFormat();
  // An acting delegate reads warranties; every write is the owner's.
  const readOnly = useAuthStore((s) => s.actingAsUserId) !== null;

  const urlTransactionParam = searchParams.get('transactionId');
  const urlTransactionId = isUuid(urlTransactionParam) ? urlTransactionParam : null;
  const urlNew = searchParams.get('new') === '1';

  const [status, setStatus] = useState<WarrantyStatusFilter>('all');
  const [searchInput, setSearchInput] = useState('');
  const q = useDebouncedValue(searchInput.trim(), 300);
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState<WarrantySort>('expiresOn');
  const [page, setPage] = useState(1);
  const [transactionFilter, setTransactionFilter] = useState<string | null>(urlTransactionId);

  // A new link (or the chip being dismissed by navigation) replaces the filter.
  const [syncedUrlTransactionId, setSyncedUrlTransactionId] = useState(urlTransactionId);
  if (syncedUrlTransactionId !== urlTransactionId) {
    setSyncedUrlTransactionId(urlTransactionId);
    setTransactionFilter(urlTransactionId);
    setPage(1);
  }
  // A settled search starts again from the first page.
  const [pagedQuery, setPagedQuery] = useState(q);
  if (pagedQuery !== q) {
    setPagedQuery(q);
    setPage(1);
  }

  // The request key is every selector that changes what the list means.
  const params = useMemo(
    () => ({
      status,
      q: q || undefined,
      archived,
      sort,
      page,
      limit: PAGE_SIZE,
      transactionId: transactionFilter ?? undefined,
    }),
    [status, q, archived, sort, page, transactionFilter],
  );
  const requestKey = JSON.stringify(params);
  const [list, setList] = useState<{ key: string; result: WarrantyListResult } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [summary, setSummary] = useState<WarrantySummary | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const latestRequest = useRef(0);

  useEffect(() => {
    const request = ++latestRequest.current;
    warrantiesApi
      .list(params)
      .then((result) => {
        // Only the newest request's answer lands: a slow answer to a filter
        // the reader has already left must not replace the current one.
        if (latestRequest.current !== request) return;
        setList({ key: requestKey, result });
        setFailedKey(null);
      })
      .catch((error) => {
        if (latestRequest.current !== request) return;
        logger.error(error);
        setFailedKey(requestKey);
      });
  }, [params, requestKey, reloadToken]);

  useEffect(() => {
    warrantiesApi
      .summary()
      .then(setSummary)
      .catch((error) => {
        logger.error(error);
        setSummary(null);
      });
  }, [reloadToken]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);
  useOnUndoRedo(reload);
  useOnAiAction(reload);

  const {
    showForm,
    editingItem,
    openCreate,
    openEdit,
    close,
    isEditing,
    modalProps,
    setFormDirty,
    unsavedChangesDialog,
    formSubmitRef,
  } = useFormModal<Warranty>();
  const [prefill, setPrefill] = useState<WarrantyPrefill | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Warranty | null>(null);

  const openNew = useCallback(() => {
    setPrefill(undefined);
    openCreate();
  }, [openCreate]);

  // `?new=1&transactionId=<id>`: open the form filled from that purchase, once
  // per link, then leave the list filtered to it.
  const handledNewFor = useRef<string | null>(null);
  useEffect(() => {
    if (readOnly || !urlNew || urlTransactionId === null || handledNewFor.current === urlTransactionId) return;
    const id = urlTransactionId;
    handledNewFor.current = id;
    transactionsApi
      .getById(id)
      .then((tx) => {
        setPrefill({
          name: tx.payeeName || tx.payee?.name || tx.description || '',
          vendorName: tx.payee?.name ?? tx.payeeName ?? null,
          payeeId: tx.payeeId,
          transactionId: tx.id,
          purchaseDate: tx.transactionDate,
          // The API sends a decimal as a string; a price is never negative.
          purchasePrice: Math.abs(Number(tx.amount)),
          currencyCode: tx.currencyCode,
        });
        openCreate();
      })
      .catch((error) => {
        logger.error(error);
        toast.error(t('page.toasts.prefillFailed'));
        setPrefill(undefined);
        openCreate();
      })
      .finally(() => router.replace(`/warranties?transactionId=${id}`));
  }, [readOnly, urlNew, urlTransactionId, openCreate, router, t]);

  const handleFormSubmit = async (data: CreateWarrantyData) => {
    try {
      if (editingItem) {
        await warrantiesApi.update(editingItem.id, data);
        toast.success(t('page.toasts.updated'));
      } else {
        await warrantiesApi.create(data);
        toast.success(t('page.toasts.created'));
      }
      close();
      reload();
    } catch (error) {
      toast.error(getErrorMessage(error, editingItem ? t('page.toasts.updateFailed') : t('page.toasts.createFailed')));
      throw error;
    }
  };

  const openDetail = useCallback(
    (warranty: Warranty) => router.push(`/warranties/${warranty.id}`),
    [router],
  );

  const handleArchive = useCallback(
    async (warranty: Warranty) => {
      try {
        await warrantiesApi.archive(warranty.id);
        toast.success(t('page.toasts.archived'));
        reload();
      } catch (error) {
        toast.error(getErrorMessage(error, t('page.toasts.archiveFailed')));
      }
    },
    [reload, t],
  );

  const handleUnarchive = useCallback(
    async (warranty: Warranty) => {
      try {
        await warrantiesApi.unarchive(warranty.id);
        toast.success(t('page.toasts.unarchived'));
        reload();
      } catch (error) {
        toast.error(getErrorMessage(error, t('page.toasts.unarchiveFailed')));
      }
    },
    [reload, t],
  );

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await warrantiesApi.delete(deleteTarget.id);
      toast.success(t('page.toasts.deleted'));
      reload();
    } catch (error) {
      toast.error(getErrorMessage(error, t('page.toasts.deleteFailed')));
    } finally {
      setDeleteTarget(null);
    }
  };

  const changeStatus = (next: WarrantyStatusFilter) => {
    setStatus(next);
    setPage(1);
  };

  const clearTransactionFilter = () => {
    setTransactionFilter(null);
    setPage(1);
    router.replace('/warranties');
  };

  const summaryValue = (count: number | undefined) =>
    count === undefined ? t('page.summary.unavailable') : formatNumber(count, 0);

  const filtered = status !== 'all' || q !== '' || transactionFilter !== null;
  const empty = useMemo(() => {
    if (archived) return { title: t('page.empty.archivedTitle') };
    if (filtered) return { title: t('page.empty.filteredTitle'), description: t('page.empty.filteredDescription') };
    return {
      title: t('page.empty.title'),
      description: t('page.empty.description'),
      action: readOnly ? undefined : <Button onClick={openNew}>{t('page.newButton')}</Button>,
    };
  }, [archived, filtered, openNew, readOnly, t]);

  const isStale = list !== null && list.key !== requestKey;
  const failed = failedKey === requestKey;
  const pagination = list?.result.pagination;

  let body;
  if (failed) {
    body = (
      <div role="alert" className="p-6 text-center space-y-3">
        <p className="text-sm text-red-700 dark:text-red-300">{t('page.loadFailed')}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setFailedKey(null);
            reload();
          }}
        >
          {t('page.retry')}
        </Button>
      </div>
    );
  } else if (list === null) {
    body = <LoadingSpinner text={t('page.loading')} />;
  } else {
    body = (
      <WarrantyList
        warranties={list.result.data}
        sort={sort}
        onSort={(next) => {
          setSort(next);
          setPage(1);
        }}
        empty={empty}
        stale={isStale}
        readOnly={readOnly}
        toolbarActions={
          readOnly ? undefined : (
            <button type="button" onClick={openNew} className={LIST_TOOLBAR_BUTTON_CLASS}>
              <PlusIcon className="h-4 w-4 mr-1" aria-hidden="true" />
              {t('page.newButton')}
            </button>
          )
        }
        onOpen={openDetail}
        onEdit={openEdit}
        onArchive={handleArchive}
        onUnarchive={handleUnarchive}
        onDelete={setDeleteTarget}
        currentPage={pagination?.page}
        totalPages={pagination?.totalPages}
        totalItems={pagination?.total}
        pageSize={pagination?.limit}
        onPageChange={setPage}
      />
    );
  }

  return (
    <PageLayout>
      <main className="px-4 sm:px-6 lg:px-12 pt-6 pb-8">
        <PageHeader title={t('page.title')} subtitle={t('page.subtitle')} />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <SummaryCard
            label={t('page.summary.expiring')}
            value={summaryValue(summary?.counts.expiring)}
            hint={summary ? t('page.summary.expiringHint', { days: formatNumber(summary.windowDays, 0) }) : undefined}
            icon={SummaryIcons.clock}
            valueColor="yellow"
            onClick={() => changeStatus('expiring')}
          />
          <SummaryCard
            label={t('page.summary.active')}
            value={summaryValue(summary?.counts.active)}
            icon={SummaryIcons.checkCircle}
            valueColor="green"
            onClick={() => changeStatus('active')}
          />
          <SummaryCard
            label={t('page.summary.expired')}
            value={summaryValue(summary?.counts.expired)}
            icon={SummaryIcons.ban}
            valueColor="red"
            onClick={() => changeStatus('expired')}
          />
          <SummaryCard
            label={t('page.summary.lifetime')}
            value={summaryValue(summary?.counts.lifetime)}
            icon={SummaryIcons.checkmark}
            valueColor="blue"
            onClick={() => changeStatus('lifetime')}
          />
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
          <div role="group" aria-label={t('page.filters.label')} className="flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((option) => (
              <Badge
                key={option}
                as="button"
                type="button"
                size="md"
                variant={status === option ? 'blue' : 'gray'}
                aria-pressed={status === option}
                onClick={() => changeStatus(option)}
                className="cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-500"
              >
                {t(`page.filters.${option}`)}
              </Badge>
            ))}
          </div>
          <div className="w-full sm:w-auto sm:min-w-[18rem]">
            <Input
              type="search"
              aria-label={t('page.search.label')}
              placeholder={t('page.search.placeholder')}
              value={searchInput}
              maxLength={200}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 sm:ml-auto">
            <ToggleSwitch
              checked={archived}
              onChange={(next) => {
                setArchived(next);
                setPage(1);
              }}
              label={t('page.archivedToggle')}
            />
            <span aria-hidden="true">{t('page.archivedToggle')}</span>
          </label>
        </div>

        {transactionFilter !== null && (
          <div className="mb-4 inline-flex items-center gap-1">
            <Badge variant="blue" size="md">
              {t('page.transactionChip.label')}
            </Badge>
            <button
              type="button"
              onClick={clearTransactionFilter}
              aria-label={t('page.transactionChip.clear')}
              title={t('page.transactionChip.clear')}
              className="rounded p-1 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100 focus-visible:outline-2 focus-visible:outline-blue-500"
            >
              <XMarkIcon className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}

        <Card className="overflow-hidden">{body}</Card>

        {pagination && !failed && (
          <ListBottomPager
            currentPage={pagination.page}
            totalPages={pagination.totalPages}
            totalItems={pagination.total}
            pageSize={pagination.limit}
            onPageChange={setPage}
            itemName={t('page.pager.itemName')}
            totalLabel={t('page.pager.total', { count: pagination.total, total: formatNumber(pagination.total, 0) })}
          />
        )}

        <Modal
          isOpen={showForm}
          onClose={close}
          {...modalProps}
          maxWidth="2xl"
          padding="md"
          title={isEditing ? t('page.modal.editTitle') : t('page.modal.newTitle')}
        >
          <WarrantyForm
            key={editingItem?.id ?? prefill?.transactionId ?? 'new'}
            warranty={editingItem}
            prefill={prefill}
            onSubmit={handleFormSubmit}
            onCancel={close}
            onDirtyChange={setFormDirty}
            submitRef={formSubmitRef}
          />
        </Modal>
        <UnsavedChangesDialog {...unsavedChangesDialog} />

        <ConfirmDialog
          isOpen={deleteTarget !== null}
          title={t('page.delete.title')}
          message={t('page.delete.message', { name: deleteTarget?.name ?? '' })}
          confirmLabel={tc('actions.delete')}
          variant="danger"
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      </main>
    </PageLayout>
  );
}
