'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Payee } from '@/types/payee';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Combobox } from '@/components/ui/Combobox';
import { payeesApi } from '@/lib/payees';
import toast from 'react-hot-toast';
import { getErrorMessage } from '@/lib/errors';

interface MergePayeeDialogProps {
  isOpen: boolean;
  sourcePayee: Payee | null;
  allPayees: Payee[];
  onClose: () => void;
  onSuccess: () => void;
}

export function MergePayeeDialog({
  isOpen,
  sourcePayee,
  allPayees,
  onClose,
  onSuccess,
}: MergePayeeDialogProps) {
  const t = useTranslations('payees');
  const [targetPayeeId, setTargetPayeeId] = useState('');
  const [addAsAlias, setAddAsAlias] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const payeeOptions = useMemo(() => {
    return allPayees
      .filter((p) => p.id !== sourcePayee?.id && p.isActive)
      .map((p) => ({
        value: p.id,
        label: p.name,
      }));
  }, [allPayees, sourcePayee]);

  const targetPayee = allPayees.find((p) => p.id === targetPayeeId);

  const handleMerge = async () => {
    if (!sourcePayee || !targetPayeeId) return;

    setIsSubmitting(true);
    try {
      const result = await payeesApi.mergePayees({
        targetPayeeId,
        sourcePayeeId: sourcePayee.id,
        addAsAlias,
      });

      const parts: string[] = [];
      if (result.transactionsMigrated > 0) {
        parts.push(
          result.transactionsMigrated !== 1
            ? t('merge.migratedToastPlural', { count: result.transactionsMigrated })
            : t('merge.migratedToastSingular', { count: result.transactionsMigrated }),
        );
      }
      if (result.aliasAdded) {
        parts.push(t('merge.aliasAdded'));
      }
      parts.push(t('merge.sourceDeleted', { name: sourcePayee.name }));

      toast.success(t('merge.mergedSuccess', { target: targetPayee?.name ?? '', parts: parts.join(', ') }));
      setTargetPayeeId('');
      onClose();
      onSuccess();
    } catch (error) {
      toast.error(getErrorMessage(error, t('merge.mergeFailed')));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setTargetPayeeId('');
    setAddAsAlias(true);
    onClose();
  };

  if (!sourcePayee) return null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} maxWidth="lg" className="p-6" allowOverflow>
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
        {t('merge.title')}
      </h2>

      <div className="space-y-4">
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
            {t('merge.mergeFromLabel')}
          </p>
          <p className="font-medium text-gray-900 dark:text-gray-100">
            {sourcePayee.name}
          </p>
          {sourcePayee.transactionCount !== undefined && sourcePayee.transactionCount > 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {sourcePayee.transactionCount !== 1
                ? t('merge.migratedPlural', { count: sourcePayee.transactionCount })
                : t('merge.migratedSingular', { count: sourcePayee.transactionCount })}
            </p>
          )}
        </div>

        <Combobox
          label={t('merge.targetLabel')}
          placeholder={t('merge.selectTargetPlaceholder')}
          options={payeeOptions}
          value={targetPayeeId}
          onChange={setTargetPayeeId}
        />

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={addAsAlias}
            onChange={(e) => setAddAsAlias(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          {t('merge.addAsAliasLabel', { name: sourcePayee.name })}
        </label>

        {targetPayee && (
          <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-4 text-sm">
            <p className="font-medium text-blue-800 dark:text-blue-200 mb-2">
              {t('merge.thisWill')}
            </p>
            <ul className="list-disc pl-5 text-blue-700 dark:text-blue-300 space-y-1">
              <li>
                {t('merge.moveTransactionsPrefix', { source: sourcePayee.name })}{' '}
                {t('merge.moveTransactionsTarget', { target: targetPayee.name })}
              </li>
              {addAsAlias && (
                <li>
                  {t('merge.addAliasFuturePrefix', { name: sourcePayee.name })}{' '}
                  {t('merge.addAliasFutureSuffix')}
                </li>
              )}
              <li>{t('merge.deletePayee', { name: sourcePayee.name })}</li>
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={handleClose}>
            {t('merge.cancel')}
          </Button>
          <Button
            onClick={handleMerge}
            disabled={!targetPayeeId || isSubmitting}
          >
            {isSubmitting ? t('merge.merging') : t('merge.mergePayee')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
