'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronRightIcon } from '@heroicons/react/20/solid';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import {
  Security,
  SecurityPrice,
  CreateSecurityPriceData,
} from '@/types/investment';
import { investmentsApi } from '@/lib/investments';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { useLongPress } from '@/hooks/useLongPress';
import { RowActionSheet, type RowAction } from '@/components/ui/row-actions';
import { getErrorMessage } from '@/lib/errors';
import { SECURITY_PRICE_HISTORY_LIMIT } from '@/lib/constants';
import {
  groupPricesByPeriod,
  allPriceGroupKeys,
  defaultOpenPriceGroups,
  priceDecimals,
} from '@/lib/security-detail';
import { SecurityPriceForm } from './SecurityPriceForm';

interface SecurityPriceHistoryProps {
  security: Security;
}

function getSourceLabel(source: string | null): string {
  if (!source) return 'Unknown';
  switch (source) {
    case 'yahoo_finance': return 'Yahoo';
    case 'msn_finance': return 'MSN';
    case 'manual': return 'Manual';
    case 'buy': return 'Buy';
    case 'sell': return 'Sell';
    case 'reinvest': return 'Reinvest';
    case 'transfer_in': return 'Transfer In';
    case 'transfer_out': return 'Transfer Out';
    default: return source;
  }
}

function getSourceColor(source: string | null): string {
  if (!source) return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
  switch (source) {
    case 'yahoo_finance':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
    case 'msn_finance':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300';
    case 'manual':
      return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
    default:
      return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
  }
}

/**
 * One price cell, at the column's shared decimal count so the figures line up.
 * See `priceDecimals`: providers mix `93.239998` and `93.18` in one series, and
 * formatting each to its own precision leaves the column ragged.
 *
 * The shared decimal count is this helper's job; the separators are not, so it
 * takes the reader's own `formatNumber` rather than reaching for
 * `toLocaleString(undefined, ...)` -- that follows the *browser*, which is the
 * thing an explicit `numberFormat` preference overrides.
 */
function formatPrice(
  value: number | null,
  decimals: number,
  formatNumber: (value: number, decimals?: number) => string,
): string {
  if (value === null || value === undefined) return '-';
  return formatNumber(Number(value), decimals);
}

export function SecurityPriceHistory({ security }: SecurityPriceHistoryProps) {
  const t = useTranslations('securities');
  const { formatDate, formatMonth } = useDateFormat();
  const { formatNumber } = useNumberFormat();
  const [prices, setPrices] = useState<SecurityPrice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingPrice, setEditingPrice] = useState<SecurityPrice | undefined>();
  const [deletingPrice, setDeletingPrice] = useState<SecurityPrice | undefined>();
  const [isUpdating, setIsUpdating] = useState(false);
  // Mobile has no per-row action buttons -- a long-press (or right-click on a
  // desktop pointer) opens the shared action sheet instead.
  const [contextPrice, setContextPrice] = useState<SecurityPrice | undefined>();

  // Which year and month sections are open, keyed as `yyyy` and `yyyy-MM`. Only
  // an open month mounts its rows, so a decade of daily closes costs nothing
  // until it is asked for.
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());

  const loadPrices = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await investmentsApi.getSecurityPrices(security.id, {
        limit: SECURITY_PRICE_HISTORY_LIMIT,
      });
      setPrices(data);
      // Open the newest year and month so recent prices need no click.
      setOpenGroups(
        new Set(defaultOpenPriceGroups(groupPricesByPeriod(data))),
      );
    } catch (error) {
      toast.error(getErrorMessage(error, t('priceHistory.toasts.loadFailed')));
    } finally {
      setIsLoading(false);
    }
  }, [security.id, t]);

  useEffect(() => {
    loadPrices();
  }, [loadPrices]);

  const handleAdd = useCallback(async (data: CreateSecurityPriceData) => {
    try {
      await investmentsApi.createSecurityPrice(security.id, data);
      toast.success(t('priceHistory.toasts.added'));
      setShowAddForm(false);
      loadPrices();
    } catch (error) {
      toast.error(getErrorMessage(error, t('priceHistory.toasts.addFailed')));
      throw error;
    }
  }, [security.id, loadPrices, t]);

  const handleEdit = useCallback(async (data: CreateSecurityPriceData) => {
    if (!editingPrice) return;
    try {
      await investmentsApi.updateSecurityPrice(security.id, editingPrice.id, data);
      toast.success(t('priceHistory.toasts.updated'));
      setEditingPrice(undefined);
      loadPrices();
    } catch (error) {
      toast.error(getErrorMessage(error, t('priceHistory.toasts.updateFailed')));
      throw error;
    }
  }, [security.id, editingPrice, loadPrices, t]);

  const startEdit = useCallback((price: SecurityPrice) => {
    setShowAddForm(false);
    setEditingPrice(price);
  }, []);

  const { getRowHandlers } = useLongPress<SecurityPrice>({
    onLongPress: setContextPrice,
  });

  const contextActions = useMemo<RowAction[]>(() => {
    if (!contextPrice) return [];
    return [
      {
        key: 'edit',
        label: t('list.actions.edit'),
        icon: 'edit',
        tone: 'primary',
        onClick: () => startEdit(contextPrice),
      },
      {
        key: 'delete',
        label: t('list.actions.delete'),
        icon: 'delete',
        tone: 'delete',
        destructive: true,
        onClick: () => setDeletingPrice(contextPrice),
      },
    ];
  }, [contextPrice, startEdit, t]);

  const handleDelete = useCallback(async () => {
    if (!deletingPrice) return;
    try {
      await investmentsApi.deleteSecurityPrice(security.id, deletingPrice.id);
      toast.success(t('priceHistory.toasts.deleted'));
      setDeletingPrice(undefined);
      loadPrices();
    } catch (error) {
      toast.error(getErrorMessage(error, t('priceHistory.toasts.deleteFailed')));
    }
  }, [security.id, deletingPrice, loadPrices, t]);

  const handleForceUpdate = useCallback(async () => {
    setIsUpdating(true);
    try {
      const result = await investmentsApi.backfillSecurityPrices(security.id);
      if (result.success) {
        toast.success(
          result.pricesLoaded
            ? t('priceHistory.toasts.updatedCount', { count: result.pricesLoaded, symbol: result.symbol })
            : t('priceHistory.toasts.noPricesFound', { symbol: result.symbol }),
        );
        await loadPrices();
      } else {
        toast.error(result.error || t('priceHistory.toasts.updatePricesFailed', { symbol: result.symbol }));
      }
    } catch (error) {
      toast.error(getErrorMessage(error, t('priceHistory.toasts.updateFetchFailed')));
    } finally {
      setIsUpdating(false);
    }
  }, [security.id, loadPrices, t]);

  const isFormOpen = showAddForm || !!editingPrice;
  // One decimal count across every price column and every row, so the figures
  // form a column instead of a ragged edge. Taken over the whole series rather
  // than per visible month: expanding a month must not reformat the rest.
  const decimals = useMemo(
    () =>
      priceDecimals(
        prices.flatMap((price) => [
          price.closePrice,
          price.adjustedClose,
          price.openPrice,
          price.highPrice,
          price.lowPrice,
        ]),
      ),
    [prices],
  );

  const yearGroups = useMemo(() => groupPricesByPeriod(prices), [prices]);
  const allKeys = useMemo(() => allPriceGroupKeys(yearGroups), [yearGroups]);
  const allOpen = allKeys.length > 0 && allKeys.every((k) => openGroups.has(k));

  const toggleGroup = useCallback((key: string) => {
    setOpenGroups((open) => {
      const next = new Set(open);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);


  return (
    <div className="space-y-4">
      {/* The detail page's own header carries the symbol, so this pane opens
          straight into its actions. */}
      <div className="flex items-center justify-end gap-2">
        {!isFormOpen && (
          <>
            <Button
              variant="outline"
              onClick={handleForceUpdate}
              size="sm"
              isLoading={isUpdating}
              title={t('priceHistory.forceUpdateTitle')}
            >
              {t('priceHistory.forceUpdateButton')}
            </Button>
            <Button onClick={() => setShowAddForm(true)} size="sm" disabled={isUpdating}>
              {t('priceHistory.addPriceButton')}
            </Button>
            {yearGroups.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setOpenGroups(allOpen ? new Set() : new Set(allKeys))
                }
              >
                {allOpen
                  ? t('priceHistory.collapseAll')
                  : t('priceHistory.expandAll')}
              </Button>
            )}
          </>
        )}
      </div>

      {/* Add/Edit Form */}
      {showAddForm && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('priceHistory.addPriceSection')}</h3>
          <SecurityPriceForm
            onSubmit={handleAdd}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      )}

      {editingPrice && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('priceHistory.editPriceSection')}</h3>
          <SecurityPriceForm
            price={editingPrice}
            onSubmit={handleEdit}
            onCancel={() => setEditingPrice(undefined)}
          />
        </div>
      )}

      {/* Price Table */}
      {isLoading ? (
        <LoadingSpinner text={t('priceHistory.loading')} />
      ) : prices.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400 text-center py-8">
          {t('priceHistory.empty')}
        </p>
      ) : (
        <div className="space-y-2">
          {yearGroups.map((year) => {
            const yearOpen = openGroups.has(year.key);
            return (
              <div
                key={year.key}
                className="rounded-lg border border-gray-200 dark:border-gray-700"
              >
                <button
                  type="button"
                  onClick={() => toggleGroup(year.key)}
                  aria-expanded={yearOpen}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-gray-700/50"
                >
                  <ChevronRightIcon
                    className={`h-4 w-4 flex-shrink-0 text-gray-400 transition-transform ${yearOpen ? 'rotate-90' : ''}`}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {year.key}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {t('priceHistory.groupCount', { count: year.count })}
                  </span>
                </button>

                {yearOpen && (
                  <div className="space-y-1 border-t border-gray-200 px-2 pb-2 pt-1 dark:border-gray-700">
                    {year.months.map((month) => {
                      const monthOpen = openGroups.has(month.key);
                      return (
                        <div key={month.key}>
                          <button
                            type="button"
                            onClick={() => toggleGroup(month.key)}
                            aria-expanded={monthOpen}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-gray-700/50"
                          >
                            <ChevronRightIcon
                              className={`h-3.5 w-3.5 flex-shrink-0 text-gray-400 transition-transform ${monthOpen ? 'rotate-90' : ''}`}
                              aria-hidden="true"
                            />
                            <span className="text-sm text-gray-800 dark:text-gray-200">
                              {formatMonth(month.key)}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {t('priceHistory.groupCount', {
                                count: month.prices.length,
                              })}
                            </span>
                          </button>

                          {monthOpen && (
                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                                <thead className="bg-gray-50 dark:bg-gray-900">
                                  <tr>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('priceHistory.columns.date')}</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('priceHistory.columns.close')}</th>
                                    {/* The total-return close. Shown so it is visible whether the
                                        provider supplies it at all -- MSN does not, and a column of
                                        dashes here is the only way to notice before a return
                                        calculation quietly uses price instead. */}
                                    <th
                                      className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden lg:table-cell"
                                      title={t('priceHistory.columns.adjustedCloseTitle')}
                                    >
                                      {t('priceHistory.columns.adjustedClose')}
                                    </th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden sm:table-cell">{t('priceHistory.columns.open')}</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden sm:table-cell">{t('priceHistory.columns.high')}</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden sm:table-cell">{t('priceHistory.columns.low')}</th>
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden md:table-cell">{t('priceHistory.columns.volume')}</th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('priceHistory.columns.source')}</th>
                                    {/* Actions - hidden on mobile, where long-press opens the sheet */}
                                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase hidden sm:table-cell">{t('priceHistory.columns.actions')}</th>
                                  </tr>
                                </thead>
                              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                              {month.prices.map((price) => (
                              <tr
                              key={price.id}
                              className="hover:bg-gray-50 dark:hover:bg-gray-700 select-none"
                              {...getRowHandlers(price)}
                              >
                              <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100 whitespace-nowrap">
                              {formatDate(price.priceDate)}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100 text-right">
                              {formatPrice(price.closePrice, decimals, formatNumber)}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 text-right hidden lg:table-cell">
                              {formatPrice(price.adjustedClose, decimals, formatNumber)}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 text-right hidden sm:table-cell">
                              {formatPrice(price.openPrice, decimals, formatNumber)}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 text-right hidden sm:table-cell">
                              {formatPrice(price.highPrice, decimals, formatNumber)}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 text-right hidden sm:table-cell">
                              {formatPrice(price.lowPrice, decimals, formatNumber)}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 text-right hidden md:table-cell">
                              {price.volume !== null ? formatNumber(Number(price.volume), 0) : '-'}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getSourceColor(price.source)}`}>
                              {getSourceLabel(price.source)}
                              </span>
                              </td>
                              <td className="px-3 py-2 text-right whitespace-nowrap hidden sm:table-cell">
                              <div className="flex gap-2 justify-end">
                              <button
                              onClick={() => startEdit(price)}
                              onMouseDown={(e) => e.stopPropagation()}
                              className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-xs"
                              >
                              {t('list.actions.edit')}
                              </button>
                              <button
                              onClick={() => setDeletingPrice(price)}
                              onMouseDown={(e) => e.stopPropagation()}
                              className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-xs"
                              >
                              {t('list.actions.delete')}
                              </button>
                              </div>
                              </td>
                              </tr>
                              ))}

                              </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Long-press action sheet -- the mobile stand-in for the actions column */}
      <RowActionSheet
        isOpen={!!contextPrice}
        title={contextPrice ? formatDate(contextPrice.priceDate) : ''}
        subtitle={contextPrice ? formatPrice(contextPrice.closePrice, decimals, formatNumber) : undefined}
        actions={contextActions}
        onClose={() => setContextPrice(undefined)}
      />

      <ConfirmDialog
        isOpen={!!deletingPrice}
        title={t('priceHistory.deleteConfirm.title')}
        message={t('priceHistory.deleteConfirm.message', {
          date: deletingPrice ? formatDate(deletingPrice.priceDate) : '',
        })}
        confirmLabel={t('priceHistory.deleteConfirm.confirmLabel')}
        onConfirm={handleDelete}
        onCancel={() => setDeletingPrice(undefined)}
      />
    </div>
  );
}
