'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Combobox } from '@/components/ui/Combobox';
import { Modal } from '@/components/ui/Modal';
import { getErrorMessage } from '@/lib/errors';
import { categoriesApi } from '@/lib/categories';
import { payeesApi } from '@/lib/payees';
import { buildCategoryTree } from '@/lib/categoryUtils';
import type { Category } from '@/types/category';
import type { Payee } from '@/types/payee';
import {
  payeeOrganizerApi,
  type PayeeOrganizerSuggestResponse,
  type PayeeGroup,
  type PayeeCategoryAssignment,
  type PayeeMerge,
  type RejectedMerge,
} from '@/lib/ai-payee-organizer';

import type { PayeeFormSubmitData } from '@/components/payees/PayeeForm';

// PayeeForm is heavy (react-hook-form + zod); load it only when the dialog opens.
const PayeeForm = dynamic(
  () => import('@/components/payees/PayeeForm').then((m) => m.PayeeForm),
  { ssr: false },
);

// Combobox value sentinel for "create a brand-new category with this name".
const NEW_PREFIX = 'new:';

/** The chosen category Combobox value for a group: the user's manual override
 * if set, otherwise the AI's suggestion (an existing id, a new-category
 * sentinel, or empty when there is no suggestion). */
function chosenValue(
  group: PayeeGroup,
  overrides: Record<string, string>,
): string {
  if (overrides[group.groupId] !== undefined) return overrides[group.groupId];
  const cat = group.category;
  if (!cat) return '';
  return cat.isNew ? `${NEW_PREFIX}${cat.categoryName}` : cat.categoryId ?? '';
}

export function PayeeOrganizer() {
  const [allowNewCategories, setAllowNewCategories] = useState(false);
  const [limit, setLimit] = useState(50);
  const [minTransactions, setMinTransactions] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<PayeeOrganizerSuggestResponse | null>(
    null,
  );
  const [categories, setCategories] = useState<Category[]>([]);

  // Per-group apply checkbox (keyed by groupId). Nothing selected by default.
  const [selectedGroups, setSelectedGroups] = useState<Record<string, boolean>>(
    {},
  );
  // Cluster groups the user marked "Not duplicates" (keyed by groupId).
  const [rejectedGroups, setRejectedGroups] = useState<Record<string, boolean>>(
    {},
  );
  // Chosen canonical payee per cluster group (keyed by groupId), default is the
  // AI's suggestedCanonicalPayeeId.
  const [canonicalChoice, setCanonicalChoice] = useState<
    Record<string, string>
  >({});
  // Manual category overrides keyed by groupId (Combobox value: an existing id,
  // or `new:<name>` to create a new category).
  const [categoryOverrides, setCategoryOverrides] = useState<
    Record<string, string>
  >({});

  // Inline payee-edit dialog (same as the transactions view).
  const [editingPayee, setEditingPayee] = useState<Payee | undefined>(
    undefined,
  );
  const [showPayeeForm, setShowPayeeForm] = useState(false);

  useEffect(() => {
    categoriesApi.getAll().then(setCategories).catch(() => {});
  }, []);

  // Existing categories as Combobox options ("Parent: Child" labels).
  const categoryOptions = useMemo(() => {
    const tree = buildCategoryTree(categories);
    return tree.map(({ category }) => {
      const parent = category.parentId
        ? categories.find((c) => c.id === category.parentId)
        : null;
      return {
        value: category.id,
        label: parent ? `${parent.name}: ${category.name}` : category.name,
      };
    });
  }, [categories]);

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const data = await payeeOrganizerApi.suggest({
        allowNewCategories,
        limit,
        mode: 'all',
        minTransactions,
      });
      setResult(data);
      // Nothing selected by default; the user opts into each group.
      setSelectedGroups({});
      setRejectedGroups({});
      setCanonicalChoice({});
      setCategoryOverrides({});
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to analyze payees'));
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleGroup = (groupId: string) => {
    if (rejectedGroups[groupId]) return; // rejected clusters can't be applied
    setSelectedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const toggleRejectGroup = (groupId: string) => {
    setRejectedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
    // Marking a group "Not duplicates" clears its pending apply selection.
    setSelectedGroups((prev) => ({ ...prev, [groupId]: false }));
  };

  const canonicalFor = (group: PayeeGroup): string =>
    canonicalChoice[group.groupId] ?? group.suggestedCanonicalPayeeId;

  const openPayeeDialog = async (payeeId: string) => {
    try {
      const payee = await payeesApi.getById(payeeId);
      setEditingPayee(payee);
      setShowPayeeForm(true);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to load payee details'));
    }
  };

  const handlePayeeFormSubmit = async (data: PayeeFormSubmitData) => {
    if (!editingPayee) return;
    try {
      const cleanedData = {
        ...data,
        defaultCategoryId: data.defaultCategoryId || undefined,
        notes: data.notes || undefined,
      };
      const updated = await payeesApi.update(editingPayee.id, cleanedData);
      toast.success('Payee updated');
      setShowPayeeForm(false);
      setEditingPayee(undefined);
      // Reflect a renamed payee in the visible groups.
      setResult((prev) =>
        prev
          ? {
              ...prev,
              groups: prev.groups.map((g) => ({
                ...g,
                members: g.members.map((m) =>
                  m.payeeId === updated.id
                    ? { ...m, payeeName: updated.name }
                    : m,
                ),
              })),
            }
          : prev,
      );
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update payee'));
    }
  };

  const handlePayeeFormCancel = () => {
    setShowPayeeForm(false);
    setEditingPayee(undefined);
  };

  const applySelected = async () => {
    if (!result) return;

    const categoryAssignments: PayeeCategoryAssignment[] = [];
    const merges: PayeeMerge[] = [];
    const rejected: RejectedMerge[] = [];

    for (const group of result.groups) {
      const isRejected = !!rejectedGroups[group.groupId];
      const canonical = canonicalFor(group);

      // "Not duplicates" persists a rejection regardless of the apply checkbox.
      if (group.isCluster && isRejected) {
        rejected.push({
          canonicalPayeeId: group.suggestedCanonicalPayeeId,
          duplicatePayeeIds: group.members
            .map((m) => m.payeeId)
            .filter((id) => id !== group.suggestedCanonicalPayeeId),
        });
      }

      if (!selectedGroups[group.groupId]) continue;

      // Category for the surviving payee (the chosen canonical for clusters).
      const value = chosenValue(group, categoryOverrides);
      if (value) {
        if (value.startsWith(NEW_PREFIX)) {
          categoryAssignments.push({
            payeeId: canonical,
            newCategoryName: value.slice(NEW_PREFIX.length),
          });
        } else {
          categoryAssignments.push({ payeeId: canonical, categoryId: value });
        }
      }

      // Merge the other cluster members into the chosen canonical.
      if (group.isCluster && !isRejected) {
        const sourcePayeeIds = group.members
          .map((m) => m.payeeId)
          .filter((id) => id !== canonical);
        if (sourcePayeeIds.length > 0) {
          merges.push({ targetPayeeId: canonical, sourcePayeeIds });
        }
      }
    }

    setApplying(true);
    try {
      const res = await payeeOrganizerApi.apply({
        categoryAssignments,
        merges,
        rejectedMerges: rejected,
      });
      const rejectionNote =
        res.mergeRejectionsSaved > 0
          ? `, ${res.mergeRejectionsSaved} merge rejections saved`
          : '';
      toast.success(
        `Applied: ${res.payeesCategorized} categorized, ${res.categoriesCreated} categories created, ${res.payeesMerged} merged${rejectionNote}`,
      );

      // Drop the groups we just resolved (applied OR rejected) and keep the
      // rest for further review, without triggering another AI call.
      const resolvedIds = new Set(
        result.groups
          .filter(
            (g) => selectedGroups[g.groupId] || rejectedGroups[g.groupId],
          )
          .map((g) => g.groupId),
      );
      setResult({
        ...result,
        groups: result.groups.filter((g) => !resolvedIds.has(g.groupId)),
      });
      setSelectedGroups({});
      setRejectedGroups({});
      setCanonicalChoice({});
      setCategoryOverrides({});
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to apply changes'));
    } finally {
      setApplying(false);
    }
  };

  const busy = analyzing || applying;
  const remaining = result?.mergeCandidateClustersRemaining ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
        <label className="flex items-center gap-3 text-sm font-medium text-gray-700 dark:text-gray-200">
          <ToggleSwitch
            checked={allowNewCategories}
            onChange={setAllowNewCategories}
            disabled={busy}
            label="Allow AI to propose new categories"
          />
          Allow AI to propose new categories
        </label>
        <div className="flex items-end gap-3">
          <div className="w-40">
            <Select
              label="Payees per run"
              value={String(limit)}
              onChange={(e) => setLimit(Number(e.target.value))}
              disabled={busy}
              options={[
                { value: '25', label: '25' },
                { value: '50', label: '50' },
                { value: '100', label: '100' },
                { value: '200', label: '200' },
              ]}
            />
          </div>
          <div className="w-36">
            <Input
              label="Min. transactions"
              type="number"
              min={0}
              value={String(minTransactions)}
              onChange={(e) =>
                setMinTransactions(Math.max(0, Number(e.target.value) || 0))
              }
              disabled={busy}
              title="Only categorize payees with at least this many transactions (0 = all)"
            />
          </div>
          <Button onClick={runAnalysis} isLoading={analyzing} disabled={busy}>
            {analyzing ? 'Analyzing...' : 'Analyze'}
          </Button>
        </div>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 -mt-3">
        Analyzes one slice of payees per run, grouping likely-duplicates and
        suggesting categories. If your AI provider hits a tokens-per-minute
        limit, lower &quot;Payees per run&quot; and analyze again.
      </p>

      {result && (
        <>
          <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 px-4 py-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Payees &mdash; review &amp; resolve
                </h2>
                {remaining > 0 && (
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {remaining} more duplicate group
                    {remaining === 1 ? '' : 's'} &mdash; Analyze again
                  </p>
                )}
              </div>
            </div>

            {result.groups.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">
                Nothing to review
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {result.groups.map((group) => {
                  const isRejected = !!rejectedGroups[group.groupId];
                  const canonical = canonicalFor(group);
                  const chosen = chosenValue(group, categoryOverrides);
                  const isNewChosen = chosen.startsWith(NEW_PREFIX);
                  const rowOptions =
                    group.category?.isNew
                      ? [
                          {
                            value: `${NEW_PREFIX}${group.category.categoryName}`,
                            label: `+ Create "${group.category.categoryName}"`,
                          },
                          ...categoryOptions,
                        ]
                      : categoryOptions;

                  return (
                    <li
                      key={group.groupId}
                      className={`px-4 py-3 ${isRejected ? 'opacity-50' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={!!selectedGroups[group.groupId]}
                          onChange={() => toggleGroup(group.groupId)}
                          disabled={busy || isRejected}
                          aria-label={
                            group.isCluster
                              ? `Apply group ${group.suggestedCanonicalPayeeId}`
                              : `Apply category for ${group.members[0].payeeName}`
                          }
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 disabled:opacity-50"
                        />

                        <div className="min-w-0 flex-1 space-y-2">
                          {group.isCluster ? (
                            <>
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                  {
                                    group.members.find(
                                      (m) =>
                                        m.payeeId ===
                                        group.suggestedCanonicalPayeeId,
                                    )?.payeeName
                                  }{' '}
                                  <span className="font-normal text-gray-500 dark:text-gray-400">
                                    ({group.members.length} look alike)
                                  </span>
                                </p>
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleRejectGroup(group.groupId)
                                  }
                                  disabled={busy}
                                  aria-label={`Not duplicates: ${group.members.find((m) => m.payeeId === group.suggestedCanonicalPayeeId)?.payeeName}`}
                                  title="Mark as NOT duplicates so it is never suggested again"
                                  className={`shrink-0 rounded px-2 py-1 text-xs font-medium disabled:opacity-50 ${
                                    isRejected
                                      ? 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
                                      : 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20'
                                  }`}
                                >
                                  {isRejected ? 'Undo' : 'Not duplicates'}
                                </button>
                              </div>

                              <fieldset className="space-y-1">
                                <legend className="sr-only">
                                  Keep which payee
                                </legend>
                                {group.members.map((m) => (
                                  <label
                                    key={m.payeeId}
                                    className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"
                                  >
                                    <input
                                      type="radio"
                                      name={`canonical-${group.groupId}`}
                                      value={m.payeeId}
                                      checked={canonical === m.payeeId}
                                      onChange={() =>
                                        setCanonicalChoice((prev) => ({
                                          ...prev,
                                          [group.groupId]: m.payeeId,
                                        }))
                                      }
                                      disabled={busy || isRejected}
                                      aria-label={`Keep ${m.payeeName}`}
                                      className="h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => openPayeeDialog(m.payeeId)}
                                      className="text-blue-600 dark:text-blue-400 hover:underline"
                                    >
                                      {m.payeeName}
                                    </button>
                                  </label>
                                ))}
                              </fieldset>

                              {group.mergeReason && (
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  {group.mergeReason}
                                </p>
                              )}
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                openPayeeDialog(group.members[0].payeeId)
                              }
                              className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              {group.members[0].payeeName}
                            </button>
                          )}

                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              Category:
                            </span>
                            <div className="w-full sm:w-96">
                              <Combobox
                                options={rowOptions}
                                value={chosen}
                                onChange={(value) =>
                                  setCategoryOverrides((prev) => ({
                                    ...prev,
                                    [group.groupId]: value,
                                  }))
                                }
                                disabled={busy || isRejected}
                                placeholder="Choose a category"
                              />
                            </div>
                            {isNewChosen && (
                              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                                New
                              </span>
                            )}
                          </div>

                          {!group.isCluster &&
                            group.members[0].sampleDescriptions.length > 0 && (
                              <p
                                className="truncate text-xs text-gray-500 dark:text-gray-400"
                                title={group.members[0].sampleDescriptions.join(
                                  '  ·  ',
                                )}
                              >
                                {group.members[0].sampleDescriptions.join(
                                  '  ·  ',
                                )}
                              </p>
                            )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div className="flex justify-end">
            <Button onClick={applySelected} isLoading={applying} disabled={busy}>
              {applying ? 'Applying...' : 'Apply selected'}
            </Button>
          </div>
        </>
      )}

      {editingPayee && (
        <Modal
          isOpen={showPayeeForm}
          onClose={handlePayeeFormCancel}
          maxWidth="lg"
          className="p-6"
          pushHistory
        >
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            Edit payee
          </h2>
          <PayeeForm
            payee={editingPayee}
            categories={categories}
            onSubmit={handlePayeeFormSubmit}
            onCancel={handlePayeeFormCancel}
          />
        </Modal>
      )}
    </div>
  );
}
