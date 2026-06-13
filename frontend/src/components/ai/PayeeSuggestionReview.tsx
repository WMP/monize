'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Combobox } from '@/components/ui/Combobox';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  aiSuggestionSessionsApi,
  type ApplySuggestionItem,
  type SuggestionSession,
  type SuggestionSessionItem,
  type SuggestionSessionSummary,
} from '@/lib/ai-suggestion-sessions';
import { categoriesApi } from '@/lib/categories';
import { buildCategoryTree } from '@/lib/categoryUtils';
import { Category } from '@/types/category';

// Sentinel prefix marking a Combobox value that should create a new category
// with the given name, mirroring the payee organizer convention.
const NEW_PREFIX = 'new:';

interface RowSelection {
  // The Combobox value: an existing category id, or `new:<name>`.
  value: string;
  selected: boolean;
}

/**
 * Resolve a row's Combobox value into the apply payload shape: either an
 * existing category id or a new category name.
 */
function resolveApplyItem(
  payeeId: string,
  value: string,
): ApplySuggestionItem | null {
  if (value.startsWith(NEW_PREFIX)) {
    const newCategoryName = value.slice(NEW_PREFIX.length).trim();
    if (!newCategoryName) return null;
    return { payeeId, newCategoryName };
  }
  if (!value) return null;
  return { payeeId, categoryId: value };
}

/** The initial Combobox value for an item: existing suggestion or `new:` sentinel. */
function initialItemValue(item: SuggestionSessionItem): string {
  if (item.suggestedCategoryId) return item.suggestedCategoryId;
  if (item.newCategoryName) return `${NEW_PREFIX}${item.newCategoryName}`;
  return '';
}

export function PayeeSuggestionReview() {
  const t = useTranslations('payeeSuggestions');

  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<SuggestionSessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<SuggestionSession | null>(
    null,
  );
  const [categories, setCategories] = useState<Category[]>([]);
  const [selections, setSelections] = useState<Record<string, RowSelection>>(
    {},
  );
  const [applying, setApplying] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const openSession = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const session = await aiSuggestionSessionsApi.getById(id);
      setActiveSession(session);
      setSelections(
        Object.fromEntries(
          session.items.map((item) => [
            item.payeeId,
            { value: initialItemValue(item), selected: false },
          ]),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const [list, cats] = await Promise.all([
        aiSuggestionSessionsApi.list({
          kind: 'payee_categorization',
          status: 'draft',
        }),
        categoriesApi.getAll(),
      ]);
      setCategories(cats);
      setSessions(list);
      // Auto-open the most recent (the list is ordered by the backend).
      if (list.length > 0) {
        await openSession(list[0].id);
      } else {
        setActiveSession(null);
      }
    } finally {
      setLoading(false);
    }
  }, [openSession]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const categoryOptions = useMemo(
    () =>
      buildCategoryTree(categories).map(({ category, level }) => ({
        value: category.id,
        label: `${'  '.repeat(level)}${category.name}`,
      })),
    [categories],
  );

  const selectedCount = useMemo(
    () => Object.values(selections).filter((s) => s.selected).length,
    [selections],
  );

  const toggleRow = (payeeId: string) => {
    setSelections((prev) => ({
      ...prev,
      [payeeId]: { ...prev[payeeId], selected: !prev[payeeId].selected },
    }));
  };

  const setRowValue = (payeeId: string, value: string) => {
    setSelections((prev) => ({
      ...prev,
      [payeeId]: { ...prev[payeeId], value },
    }));
  };

  const setRowNewCategory = (payeeId: string, name: string) => {
    const trimmed = name.trim();
    setSelections((prev) => ({
      ...prev,
      [payeeId]: {
        ...prev[payeeId],
        value: trimmed ? `${NEW_PREFIX}${trimmed}` : '',
      },
    }));
  };

  const handleApply = async () => {
    if (!activeSession) return;
    const items: ApplySuggestionItem[] = activeSession.items
      .filter((item) => selections[item.payeeId]?.selected)
      .map((item) => resolveApplyItem(item.payeeId, selections[item.payeeId].value))
      .filter((item): item is ApplySuggestionItem => item !== null);

    if (items.length === 0) {
      toast.error(t('errors.noneSelected'));
      return;
    }

    setApplying(true);
    try {
      const result = await aiSuggestionSessionsApi.apply(
        activeSession.id,
        items,
      );
      toast.success(
        t('applied', {
          payees: result.payeesCategorized,
          categories: result.categoriesCreated,
        }),
      );
      await loadSessions();
    } catch {
      toast.error(t('errors.applyFailed'));
    } finally {
      setApplying(false);
    }
  };

  const handleDiscard = async () => {
    if (!activeSession) return;
    setConfirmDiscard(false);
    try {
      await aiSuggestionSessionsApi.remove(activeSession.id);
      toast.success(t('discarded'));
      await loadSessions();
    } catch {
      toast.error(t('errors.discardFailed'));
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-gray-500 dark:text-gray-400">
        {t('loading')}
      </div>
    );
  }

  if (!activeSession) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 py-16 px-6 text-center">
        <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">
          {t('empty.title')}
        </h2>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
          {t('empty.description')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {sessions.length > 1 && (
        <div>
          <label
            htmlFor="session-picker"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            {t('sessionPicker.label')}
          </label>
          <select
            id="session-picker"
            value={activeSession.id}
            onChange={(e) => void openSession(e.target.value)}
            className="block w-full max-w-md rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm"
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title ?? t('sessionPicker.untitled')} (
                {t('sessionPicker.itemCount', { count: session.itemCount })})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('selectedSummary', {
            selected: selectedCount,
            total: activeSession.items.length,
          })}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setConfirmDiscard(true)}
            disabled={applying}
          >
            {t('actions.discard')}
          </Button>
          <Button
            onClick={handleApply}
            isLoading={applying}
            disabled={applying || selectedCount === 0}
          >
            {t('actions.apply')}
          </Button>
        </div>
      </div>

      <ul className="space-y-3">
        {activeSession.items.map((item) => {
          const selection = selections[item.payeeId];
          if (!selection) return null;
          const isNew = selection.value.startsWith(NEW_PREFIX);
          const newName = isNew
            ? selection.value.slice(NEW_PREFIX.length)
            : '';
          const samples = item.sampleDescriptions.join(' • ');
          return (
            <li
              key={item.payeeId}
              className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <label className="flex items-center pt-1">
                  <input
                    type="checkbox"
                    checked={selection.selected}
                    onChange={() => toggleRow(item.payeeId)}
                    aria-label={t('row.selectAria', { payee: item.payeeName })}
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                </label>

                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                    {item.payeeName}
                  </p>
                  {item.sampleDescriptions.length > 0 && (
                    <p
                      className="mt-0.5 text-xs text-gray-500 dark:text-gray-400 truncate"
                      title={samples}
                    >
                      {samples}
                    </p>
                  )}
                  {(item.reason || item.confidence !== null) && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {item.reason}
                      {item.reason && item.confidence !== null ? ' ' : ''}
                      {item.confidence !== null && (
                        <span className="text-gray-400 dark:text-gray-500">
                          {t('row.confidence', {
                            percent: Math.round(item.confidence * 100),
                          })}
                        </span>
                      )}
                    </p>
                  )}
                </div>

                <div className="w-full sm:w-72">
                  <Combobox
                    options={categoryOptions}
                    value={isNew ? '' : selection.value}
                    initialDisplayValue={isNew ? newName : undefined}
                    allowCustomValue
                    usePortal
                    placeholder={t('row.categoryPlaceholder')}
                    onChange={(value, label) => {
                      if (value) {
                        setRowValue(item.payeeId, value);
                      } else if (label) {
                        setRowNewCategory(item.payeeId, label);
                      } else {
                        setRowValue(item.payeeId, '');
                      }
                    }}
                    onCreateNew={(name) => setRowNewCategory(item.payeeId, name)}
                  />
                  {isNew && newName && (
                    <p className="mt-1 text-xs text-green-600 dark:text-green-400">
                      {t('row.willCreate', { name: newName })}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        isOpen={confirmDiscard}
        title={t('discardConfirm.title')}
        message={t('discardConfirm.message')}
        confirmLabel={t('actions.discard')}
        variant="danger"
        onConfirm={handleDiscard}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>
  );
}
