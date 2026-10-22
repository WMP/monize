'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import { ChevronLeftIcon } from '@heroicons/react/24/outline';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Modal } from '@/components/ui/Modal';
import { UnsavedChangesDialog } from '@/components/ui/UnsavedChangesDialog';
import { WarrantyClaimList } from '@/components/warranties/WarrantyClaimList';
import { WarrantyDetailCard } from '@/components/warranties/WarrantyDetailCard';
import { WarrantyDocumentsSection } from '@/components/warranties/WarrantyDocumentsSection';
import { WarrantyStatusBadge } from '@/components/warranties/WarrantyStatusBadge';
import { useFormModal } from '@/hooks/useFormModal';
import { useOnAiAction } from '@/hooks/useOnAiAction';
import { useOnUndoRedo } from '@/hooks/useOnUndoRedo';
import { getErrorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import { warrantiesApi } from '@/lib/warranties';
import type { CreateWarrantyData, Warranty } from '@/types/warranty';

const WarrantyForm = dynamic(
  () => import('@/components/warranties/WarrantyForm').then((m) => m.WarrantyForm),
  { ssr: false },
);

const logger = createLogger('WarrantyDetail');

export default function WarrantyDetailPage() {
  const params = useParams<{ id: string }>();
  return (
    <ProtectedRoute>
      {/* Another id is another warranty: start its page from scratch. */}
      <WarrantyDetailContent key={params.id} warrantyId={params.id} />
    </ProtectedRoute>
  );
}

function BackToWarranties() {
  const t = useTranslations('warranties');
  return (
    <Link
      href="/warranties"
      className="mb-2 -ml-1 inline-flex items-center gap-1 rounded text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      <ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
      {t('detail.back')}
    </Link>
  );
}

/**
 * One warranty: its details, its documents, its claims and the purchase it
 * came from (docs/future-plans/warranty-tracker.md section 10).
 */
function WarrantyDetailContent({ warrantyId }: { warrantyId: string }) {
  const t = useTranslations('warranties');
  const tc = useTranslations('common');
  const router = useRouter();

  // The warranty is held with the id it was read for; a reload keeps the one
  // on screen until the new answer lands.
  const [loaded, setLoaded] = useState<{ id: string; warranty: Warranty } | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const latestRequest = useRef(0);

  useEffect(() => {
    const request = ++latestRequest.current;
    warrantiesApi
      .getById(warrantyId)
      .then((result) => {
        if (latestRequest.current !== request) return;
        setLoaded({ id: warrantyId, warranty: result });
        setFailed(false);
      })
      .catch((error) => {
        if (latestRequest.current !== request) return;
        logger.error(error);
        setFailed(true);
      });
  }, [warrantyId, reloadToken]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);
  useOnUndoRedo(reload);
  useOnAiAction(reload);

  const {
    showForm,
    editingItem,
    openEdit,
    close,
    modalProps,
    setFormDirty,
    unsavedChangesDialog,
    formSubmitRef,
  } = useFormModal<Warranty>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const warranty = loaded !== null && loaded.id === warrantyId ? loaded.warranty : null;

  const handleFormSubmit = async (data: CreateWarrantyData) => {
    try {
      await warrantiesApi.update(warrantyId, data);
      toast.success(t('page.toasts.updated'));
      close();
      reload();
    } catch (error) {
      toast.error(getErrorMessage(error, t('page.toasts.updateFailed')));
      throw error;
    }
  };

  const handleToggleArchive = async () => {
    if (!warranty) return;
    const archived = warranty.archivedAt !== null;
    setBusy(true);
    try {
      if (archived) {
        await warrantiesApi.unarchive(warrantyId);
        toast.success(t('page.toasts.unarchived'));
      } else {
        await warrantiesApi.archive(warrantyId);
        toast.success(t('page.toasts.archived'));
      }
      reload();
    } catch (error) {
      toast.error(
        getErrorMessage(error, archived ? t('page.toasts.unarchiveFailed') : t('page.toasts.archiveFailed')),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    setConfirmDelete(false);
    setBusy(true);
    try {
      await warrantiesApi.delete(warrantyId);
      toast.success(t('page.toasts.deleted'));
      router.push('/warranties');
    } catch (error) {
      toast.error(getErrorMessage(error, t('page.toasts.deleteFailed')));
      setBusy(false);
    }
  };

  let content;
  if (warranty === null && failed) {
    content = (
      <div role="alert" className="py-12 text-center space-y-3">
        <p className="text-sm text-red-700 dark:text-red-300">{t('detail.loadFailed')}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setFailed(false);
            reload();
          }}
        >
          {t('detail.retry')}
        </Button>
      </div>
    );
  } else if (warranty === null) {
    content = <LoadingSpinner text={t('detail.loading')} />;
  } else {
    const archived = warranty.archivedAt !== null;
    content = (
      <>
        <PageHeader
          title={warranty.name}
          titleAdornment={
            <span className="inline-flex flex-wrap items-center gap-2">
              <WarrantyStatusBadge warranty={warranty} />
              {archived && <Badge variant="gray">{t('detail.archivedBadge')}</Badge>}
            </span>
          }
          actions={
            <>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => openEdit(warranty)}>
                {tc('actions.edit')}
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={handleToggleArchive}>
                {archived ? t('list.actions.unarchive') : t('list.actions.archive')}
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmDelete(true)}>
                {tc('actions.delete')}
              </Button>
            </>
          }
        />

        <div className="space-y-6">
          <WarrantyDetailCard warranty={warranty} />
          <WarrantyDocumentsSection warrantyId={warranty.id} />
          <WarrantyClaimList warrantyId={warranty.id} today={warranty.today} onChanged={reload} />
        </div>

        <Modal
          isOpen={showForm}
          onClose={close}
          {...modalProps}
          maxWidth="2xl"
          padding="md"
          title={t('page.modal.editTitle')}
        >
          <WarrantyForm
            key={editingItem?.id ?? 'edit'}
            warranty={editingItem}
            onSubmit={handleFormSubmit}
            onCancel={close}
            onDirtyChange={setFormDirty}
            submitRef={formSubmitRef}
          />
        </Modal>
        <UnsavedChangesDialog {...unsavedChangesDialog} />

        <ConfirmDialog
          isOpen={confirmDelete}
          title={t('page.delete.title')}
          message={t('page.delete.message', { name: warranty.name })}
          confirmLabel={tc('actions.delete')}
          variant="danger"
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      </>
    );
  }

  return (
    <PageLayout>
      <main className="px-4 sm:px-6 lg:px-12 pt-6 pb-8">
        <BackToWarranties />
        {content}
      </main>
    </PageLayout>
  );
}
