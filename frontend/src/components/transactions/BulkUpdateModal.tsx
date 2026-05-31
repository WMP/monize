'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Modal } from '@/components/ui/Modal';
import { FormActions } from '@/components/ui/FormActions';
import { Combobox } from '@/components/ui/Combobox';
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Select } from '@/components/ui/Select';
import { TransactionStatus, BulkUpdateData, BulkUpdateResult } from '@/types/transaction';
import { Category } from '@/types/category';
import { Payee } from '@/types/payee';
import { Tag } from '@/types/tag';
import { categoriesApi } from '@/lib/categories';
import { payeesApi } from '@/lib/payees';
import { tagsApi } from '@/lib/tags';
import { buildCategoryTree } from '@/lib/categoryUtils';

interface BulkUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Partial<Pick<BulkUpdateData, 'payeeId' | 'payeeName' | 'categoryId' | 'description' | 'status' | 'tagIds'>>) => Promise<BulkUpdateResult>;
  selectionCount: number;
}

const bulkUpdateSchema = z.object({
  enablePayee: z.boolean(),
  enableCategory: z.boolean(),
  enableDescription: z.boolean(),
  enableStatus: z.boolean(),
  enableTags: z.boolean(),
  payeeId: z.string(),
  payeeName: z.string().max(255),
  categoryId: z.string(),
  description: z.string().max(500),
  status: z.nativeEnum(TransactionStatus),
  tagIds: z.array(z.string()),
});

type BulkUpdateFormData = z.infer<typeof bulkUpdateSchema>;

const defaultValues: BulkUpdateFormData = {
  enablePayee: false,
  enableCategory: false,
  enableDescription: false,
  enableStatus: false,
  enableTags: false,
  payeeId: '',
  payeeName: '',
  categoryId: '',
  description: '',
  status: TransactionStatus.UNRECONCILED,
  tagIds: [],
};

export function BulkUpdateModal({
  isOpen,
  onClose,
  onSubmit,
  selectionCount,
}: BulkUpdateModalProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [payees, setPayees] = useState<Payee[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  const {
    control,
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { isSubmitting },
  } = useForm<BulkUpdateFormData>({
    resolver: zodResolver(bulkUpdateSchema),
    defaultValues,
  });

  // Load data when modal opens
  useEffect(() => {
    if (isOpen) {
      Promise.all([
        categoriesApi.getAll(),
        payeesApi.getAll('active'),
        tagsApi.getAll(),
      ]).then(([categoriesData, payeesData, tagsData]) => {
        setCategories(categoriesData);
        setPayees(payeesData);
        setTags(tagsData);
      });
    }
  }, [isOpen]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      reset(defaultValues);
    }
  }, [isOpen, reset]);

  const categoryTree = useMemo(() => buildCategoryTree(categories), [categories]);

  const categoryOptions = useMemo(() =>
    categoryTree.map(({ category }) => {
      const parentCategory = category.parentId
        ? categories.find(c => c.id === category.parentId)
        : null;
      return {
        value: category.id,
        label: parentCategory ? `${parentCategory.name}: ${category.name}` : category.name,
      };
    }), [categoryTree, categories]);

  const payeeOptions = useMemo(() =>
    payees.map(payee => ({
      value: payee.id,
      label: payee.name,
    })), [payees]);

  const statusOptions = [
    { value: TransactionStatus.UNRECONCILED, label: 'Pending' },
    { value: TransactionStatus.CLEARED, label: 'Cleared' },
    { value: TransactionStatus.VOID, label: 'Void' },
  ];

  const tagOptions = useMemo(() =>
    [...tags]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(tag => ({
        value: tag.id,
        label: tag.name,
      })), [tags]);

  const enablePayee = useWatch({ control, name: 'enablePayee' });
  const enableCategory = useWatch({ control, name: 'enableCategory' });
  const enableDescription = useWatch({ control, name: 'enableDescription' });
  const enableStatus = useWatch({ control, name: 'enableStatus' });
  const enableTags = useWatch({ control, name: 'enableTags' });

  const hasAnyEnabled =
    enablePayee || enableCategory || enableDescription || enableStatus || enableTags;

  const submit = async (data: BulkUpdateFormData) => {
    if (!hasAnyEnabled) return;

    const updateData: Partial<Pick<BulkUpdateData, 'payeeId' | 'payeeName' | 'categoryId' | 'description' | 'status' | 'tagIds'>> = {};

    if (data.enablePayee) {
      if (data.payeeId) {
        updateData.payeeId = data.payeeId;
        // Also send the payee name so the denormalized payeeName field is updated
        const selectedPayee = payees.find(p => p.id === data.payeeId);
        if (selectedPayee) {
          updateData.payeeName = selectedPayee.name;
        }
      } else if (data.payeeName) {
        updateData.payeeName = data.payeeName;
      } else {
        // Clear payee
        updateData.payeeId = null;
        updateData.payeeName = null;
      }
    }

    if (data.enableCategory) {
      updateData.categoryId = data.categoryId || null;
    }

    if (data.enableDescription) {
      updateData.description = data.description || null;
    }

    if (data.enableStatus) {
      updateData.status = data.status;
    }

    if (data.enableTags) {
      updateData.tagIds = data.tagIds;
    }

    await onSubmit(updateData);
  };

  // Info notes about what gets skipped
  const showTransferNote = enablePayee;
  const showSplitNote = enableCategory;

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="lg" className="p-6" allowOverflow>
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">
        Bulk Update Transactions
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Update {selectionCount} selected transaction{selectionCount !== 1 ? 's' : ''}. Toggle the fields you want to change.
      </p>

      <form onSubmit={handleSubmit(submit)}>
        <div className="space-y-4">
          {/* Payee field */}
          <TogglableField
            label="Payee"
            enabled={enablePayee}
            onToggle={() => setValue('enablePayee', !enablePayee)}
          >
            <Controller
              control={control}
              name="payeeId"
              render={({ field }) => (
                <Combobox
                  placeholder="Select or type payee name..."
                  options={payeeOptions}
                  value={field.value}
                  onChange={(payeeId, name) => {
                    field.onChange(payeeId);
                    setValue('payeeName', name);
                  }}
                  onCreateNew={(name) => {
                    field.onChange('');
                    setValue('payeeName', name);
                  }}
                  allowCustomValue
                />
              )}
            />
          </TogglableField>

          {/* Category field */}
          <TogglableField
            label="Category"
            enabled={enableCategory}
            onToggle={() => setValue('enableCategory', !enableCategory)}
          >
            <Controller
              control={control}
              name="categoryId"
              render={({ field }) => (
                <Combobox
                  placeholder="Select category..."
                  options={categoryOptions}
                  value={field.value}
                  onChange={(categoryId) => field.onChange(categoryId)}
                />
              )}
            />
          </TogglableField>

          {/* Description field */}
          <TogglableField
            label="Description"
            enabled={enableDescription}
            onToggle={() => setValue('enableDescription', !enableDescription)}
          >
            <textarea
              {...register('description')}
              placeholder="Enter description (leave empty to clear)"
              rows={2}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 focus:outline-none"
            />
          </TogglableField>

          {/* Status field */}
          <TogglableField
            label="Status"
            enabled={enableStatus}
            onToggle={() => setValue('enableStatus', !enableStatus)}
          >
            <Select
              options={statusOptions}
              {...register('status')}
            />
          </TogglableField>

          {/* Tags field */}
          <TogglableField
            label="Tags"
            enabled={enableTags}
            onToggle={() => setValue('enableTags', !enableTags)}
          >
            <Controller
              control={control}
              name="tagIds"
              render={({ field }) => (
                <MultiSelect
                  options={tagOptions}
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Select tags (leave empty to clear all)..."
                />
              )}
            />
          </TogglableField>
        </div>

        {/* Info notes */}
        {(showTransferNote || showSplitNote) && (
          <div className="mt-4 space-y-1">
            {showTransferNote && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Transfer transactions will have their linked counterpart updated as well.
              </p>
            )}
            {showSplitNote && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Split transactions will be skipped for category changes.
              </p>
            )}
          </div>
        )}

        <FormActions
          onCancel={onClose}
          submitLabel={`Update ${selectionCount} Transaction${selectionCount !== 1 ? 's' : ''}`}
          isSubmitting={isSubmitting}
          submitDisabled={!hasAnyEnabled}
        />
      </form>
    </Modal>
  );
}

function TogglableField({
  label,
  enabled,
  onToggle,
  children,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border ${enabled ? 'border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-900/10' : 'border-gray-200 dark:border-gray-700'} p-3`}>
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 h-4 w-4"
        />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
      </label>
      {enabled && (
        <div className="mt-2">
          {children}
        </div>
      )}
    </div>
  );
}
