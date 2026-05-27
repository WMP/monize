'use client';

import { useState, useMemo, useCallback, useRef, memo } from 'react';
import { Security } from '@/types/investment';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DensityLevel, nextDensity } from '@/hooks/useTableDensity';
import { SortIcon } from '@/components/ui/SortIcon';
import { usePreferencesStore } from '@/store/preferencesStore';
import { formatShareQuantity } from '@/lib/format';

export type SecuritySortField = 'symbol' | 'name' | 'type' | 'shares' | 'exchange' | 'currency' | 'provider' | 'source';

/** Format a security_prices.source value into a short human label. */
function formatPriceSource(source: string | null | undefined): string {
  if (!source) return '';
  switch (source) {
    case 'yahoo_finance': return 'Yahoo';
    case 'msn_finance': return 'MSN';
    case 'manual': return 'Manual';
    case 'buy':
    case 'sell':
    case 'reinvest':
    case 'transfer_in':
    case 'transfer_out': return 'Txn';
    default: return source;
  }
}

function priceSourceBadgeClass(source: string | null | undefined): string {
  switch (source) {
    case 'yahoo_finance':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
    case 'msn_finance':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300';
    case 'manual':
      return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
    case 'buy':
    case 'sell':
    case 'reinvest':
    case 'transfer_in':
    case 'transfer_out':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300';
    default:
      return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
  }
}
export type SortDirection = 'asc' | 'desc';

// Map of securityId -> total quantity across all accounts
export type SecurityHoldings = Record<string, number>;

// Set of securityIds that have investment transactions
export type SecurityTransactions = Set<string>;

interface SecurityListProps {
  securities: Security[];
  holdings?: SecurityHoldings;
  transactionSecurityIds?: SecurityTransactions;
  onEdit: (security: Security) => void;
  onToggleActive: (security: Security) => void;
  onDelete?: (security: Security) => void;
  onViewPrices?: (security: Security) => void;
  onViewHistory?: (security: Security) => void;
  density?: DensityLevel;
  onDensityChange?: (density: DensityLevel) => void;
  sortField?: SecuritySortField;
  sortDirection?: SortDirection;
  onSort?: (field: SecuritySortField) => void;
}

interface SecurityRowProps {
  security: Security;
  hasHoldings: boolean;
  hasTransactions: boolean;
  shares: number;
  density: DensityLevel;
  cellPadding: string;
  onEdit: (security: Security) => void;
  onToggleActive: (security: Security) => void;
  onDelete?: (security: Security) => void;
  onViewPrices?: (security: Security) => void;
  onViewHistory?: (security: Security) => void;
  onLongPressStart: (security: Security) => void;
  onLongPressStartTouch: (security: Security, e: React.TouchEvent) => void;
  onLongPressEnd: () => void;
  onTouchMove: (e: React.TouchEvent) => void;
  index: number;
  defaultQuoteProvider: 'yahoo' | 'msn';
}

const formatSecurityType = (type: string | null, dense: boolean = false): string => {
  if (!type) return '-';
  const labels: Record<string, { full: string; short: string }> = {
    STOCK: { full: 'Stock', short: 'Stk' },
    ETF: { full: 'ETF', short: 'ETF' },
    MUTUAL_FUND: { full: 'Mutual Fund', short: 'MF' },
    BOND: { full: 'Bond', short: 'Bnd' },
    OPTION: { full: 'Option', short: 'Opt' },
    CRYPTO: { full: 'Crypto', short: 'Cry' },
    OTHER: { full: 'Other', short: 'Oth' },
  };
  const label = labels[type];
  if (!label) return type;
  return dense ? label.short : label.full;
};

const SecurityRow = memo(function SecurityRow({
  security,
  hasHoldings,
  hasTransactions,
  shares,
  density,
  cellPadding,
  onEdit,
  onToggleActive,
  onDelete,
  onViewPrices,
  onViewHistory,
  onLongPressStart,
  onLongPressStartTouch,
  onLongPressEnd,
  onTouchMove,
  index,
  defaultQuoteProvider,
}: SecurityRowProps) {
  const canDelete = !hasHoldings && !hasTransactions;

  const handleEdit = useCallback(() => {
    onEdit(security);
  }, [onEdit, security]);

  const handleToggleActive = useCallback(() => {
    onToggleActive(security);
  }, [onToggleActive, security]);

  const handleDelete = useCallback(() => {
    onDelete?.(security);
  }, [onDelete, security]);

  const handleViewPrices = useCallback(() => {
    onViewPrices?.(security);
  }, [onViewPrices, security]);

  const handleViewHistory = useCallback(() => {
    onViewHistory?.(security);
  }, [onViewHistory, security]);

  return (
    <tr
      className={`group hover:bg-gray-100 dark:hover:bg-gray-800 select-none ${
        !security.isActive ? 'opacity-60' : ''
      } ${density !== 'normal' && index % 2 === 1 ? 'bg-gray-50 dark:bg-table-stripe-dark' : 'bg-white dark:bg-gray-900'}`}
      onMouseDown={() => onLongPressStart(security)}
      onMouseUp={onLongPressEnd}
      onMouseLeave={onLongPressEnd}
      onTouchStart={(e) => onLongPressStartTouch(security, e)}
      onTouchMove={onTouchMove}
      onTouchEnd={onLongPressEnd}
      onTouchCancel={onLongPressEnd}
    >
      <td className={`${cellPadding} whitespace-nowrap`}>
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {security.symbol}
        </span>
      </td>
      <td className={`${cellPadding}`}>
        <span className="text-sm text-gray-900 dark:text-gray-100">
          {security.name}
        </span>
      </td>
      <td className={`${cellPadding} whitespace-nowrap`}>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {formatSecurityType(security.securityType, density === 'dense')}
        </span>
      </td>
      <td className={`${cellPadding} whitespace-nowrap text-right`}>
        <span
          className="text-sm text-gray-900 dark:text-gray-100"
          title="Current shares held across all accounts"
        >
          {formatShareQuantity(shares)}
        </span>
      </td>
      {density === 'normal' && (
        <>
          <td className={`${cellPadding} whitespace-nowrap hidden sm:table-cell`}>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {security.exchange || '-'}
            </span>
          </td>
          <td className={`${cellPadding} whitespace-nowrap hidden sm:table-cell`}>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {security.currencyCode}
            </span>
          </td>
          <td className={`${cellPadding} whitespace-nowrap hidden md:table-cell`}>
            {(() => {
              const effective = security.quoteProvider ?? defaultQuoteProvider;
              const isOverride = !!security.quoteProvider;
              const baseClass =
                effective === 'msn'
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
                  : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
              return (
                <span
                  className={`inline-flex items-center rounded text-xs font-medium px-2 py-0.5 ${baseClass} ${
                    isOverride ? '' : 'italic opacity-70'
                  }`}
                  title={
                    isOverride
                      ? 'Per-security provider override'
                      : 'Inherited from your default Quote Provider preference'
                  }
                >
                  {effective === 'msn' ? 'MSN' : 'Yahoo'}
                </span>
              );
            })()}
          </td>
          <td className={`${cellPadding} whitespace-nowrap hidden md:table-cell`}>
            {security.lastPriceSource ? (
              <span
                className={`inline-flex items-center rounded text-xs font-medium px-2 py-0.5 ${priceSourceBadgeClass(security.lastPriceSource)}`}
                title={security.lastPriceSource}
              >
                {formatPriceSource(security.lastPriceSource)}
              </span>
            ) : (
              <span className="text-sm text-gray-400 dark:text-gray-500">-</span>
            )}
          </td>
        </>
      )}
      {/* Status - hidden on mobile */}
      <td className={`${cellPadding} whitespace-nowrap hidden sm:table-cell`}>
        {security.isActive ? (
          <span className={`inline-flex items-center rounded-full text-xs font-medium bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 ${density === 'dense' ? 'px-1.5 py-0.5' : 'px-2.5 py-0.5'}`}>
            {density === 'dense' ? 'Act' : 'Active'}
          </span>
        ) : (
          <span className={`inline-flex items-center rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300 ${density === 'dense' ? 'px-1.5 py-0.5' : 'px-2.5 py-0.5'}`}>
            {density === 'dense' ? 'Ina' : 'Inactive'}
          </span>
        )}
      </td>
      {/* Actions - hidden on mobile */}
      <td className={`${cellPadding} whitespace-nowrap text-right text-sm font-medium hidden sm:table-cell sticky right-0 ${density !== 'normal' && index % 2 === 1 ? 'bg-gray-50 dark:bg-table-stripe-dark' : 'bg-white dark:bg-gray-900'} group-hover:bg-gray-100 dark:group-hover:bg-gray-800`}>
        <div className="flex justify-end gap-2">
          {onViewHistory && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleViewHistory}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
            >
              {density === 'dense' ? '☰' : 'History'}
            </Button>
          )}
          {onViewPrices && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleViewPrices}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
            >
              {density === 'dense' ? '$' : 'Prices'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleEdit}
            className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
          >
            {density === 'dense' ? '✎' : 'Edit'}
          </Button>
          {!hasHoldings && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleActive}
              className={security.isActive
                ? 'text-yellow-600 dark:text-yellow-400 hover:text-yellow-900 dark:hover:text-yellow-300'
                : 'text-green-600 dark:text-green-400 hover:text-green-900 dark:hover:text-green-300'}
            >
              {density === 'dense'
                ? (security.isActive ? '⊘' : '✓')
                : (security.isActive ? 'Deactivate' : 'Activate')}
            </Button>
          )}
          {canDelete && onDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              className="text-red-600 dark:text-red-400 hover:text-red-900 dark:hover:text-red-300"
            >
              {density === 'dense' ? '\u2715' : 'Delete'}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
});

export function SecurityList({
  securities,
  holdings = {},
  transactionSecurityIds = new Set(),
  onEdit,
  onToggleActive,
  onDelete,
  onViewPrices,
  onViewHistory,
  density: propDensity,
  onDensityChange,
  sortField: propSortField,
  sortDirection: propSortDirection,
  onSort,
}: SecurityListProps) {
  const [localDensity, setLocalDensity] = useState<DensityLevel>('normal');
  const [localSortField, setLocalSortField] = useState<SecuritySortField>('symbol');
  const [localSortDirection, setLocalSortDirection] = useState<SortDirection>('asc');

  const defaultQuoteProvider =
    usePreferencesStore((s) => s.preferences?.defaultQuoteProvider) ?? 'yahoo';

  // Use prop sort state if provided (controlled), otherwise use local state
  const sortField = propSortField ?? localSortField;
  const sortDirection = propSortDirection ?? localSortDirection;

  // Use prop density if provided, otherwise use local state
  const density = propDensity ?? localDensity;

  const handleSort = useCallback((field: SecuritySortField) => {
    if (onSort) {
      onSort(field);
    } else {
      if (localSortField === field) {
        setLocalSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setLocalSortField(field);
        setLocalSortDirection('asc');
      }
    }
  }, [onSort, localSortField]);

  // Long-press handling for context menu on mobile
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const longPressTriggered = useRef(false);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const LONG_PRESS_MOVE_THRESHOLD = 10;
  const [contextSecurity, setContextSecurity] = useState<Security | null>(null);

  const handleLongPressStart = useCallback((security: Security) => {
    touchStartPos.current = null;
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setContextSecurity(security);
    }, 750);
  }, []);

  const handleLongPressStartTouch = useCallback((security: Security, e: React.TouchEvent) => {
    if (e?.touches?.[0]) {
      touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else {
      touchStartPos.current = null;
    }
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setContextSecurity(security);
    }, 750);
  }, []);

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    touchStartPos.current = null;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartPos.current && longPressTimer.current && e.touches?.[0]) {
      const deltaX = Math.abs(e.touches[0].clientX - touchStartPos.current.x);
      const deltaY = Math.abs(e.touches[0].clientY - touchStartPos.current.y);
      if (deltaX > LONG_PRESS_MOVE_THRESHOLD || deltaY > LONG_PRESS_MOVE_THRESHOLD) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
        touchStartPos.current = null;
      }
    }
  }, []);

  // Memoize padding classes based on density
  const cellPadding = useMemo(() => {
    switch (density) {
      case 'dense': return 'px-3 py-1';
      case 'compact': return 'px-4 py-2';
      default: return 'px-6 py-4';
    }
  }, [density]);

  const headerPadding = useMemo(() => {
    switch (density) {
      case 'dense': return 'px-3 py-2';
      case 'compact': return 'px-4 py-2';
      default: return 'px-6 py-3';
    }
  }, [density]);

  const cycleDensity = useCallback(() => {
    const next = nextDensity(density);
    if (onDensityChange) {
      onDensityChange(next);
    } else {
      setLocalDensity(next);
    }
  }, [density, onDensityChange]);

  if (securities.length === 0) {
    return (
      <div className="p-12 text-center">
        <svg
          className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
        <h3 className="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
          No securities
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Get started by adding your first security.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Density toggle */}
      <div className="flex justify-end p-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
        <button
          onClick={cycleDensity}
          className="inline-flex items-center px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          title="Toggle row density"
        >
          <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          {density === 'normal' ? 'Normal' : density === 'compact' ? 'Compact' : 'Dense'}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr>
              <th
                className={`${headerPadding} text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200`}
                onClick={() => handleSort('symbol')}
              >
                Symbol<SortIcon field="symbol" sortField={sortField} sortDirection={sortDirection} />
              </th>
              <th
                className={`${headerPadding} text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200`}
                onClick={() => handleSort('name')}
              >
                Name<SortIcon field="name" sortField={sortField} sortDirection={sortDirection} />
              </th>
              <th
                className={`${headerPadding} text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200`}
                onClick={() => handleSort('type')}
              >
                Type<SortIcon field="type" sortField={sortField} sortDirection={sortDirection} />
              </th>
              <th
                className={`${headerPadding} text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200`}
                onClick={() => handleSort('shares')}
              >
                Shares<SortIcon field="shares" sortField={sortField} sortDirection={sortDirection} />
              </th>
              {density === 'normal' && (
                <>
                  <th
                    className={`${headerPadding} text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 hidden sm:table-cell`}
                    onClick={() => handleSort('exchange')}
                  >
                    Exchange<SortIcon field="exchange" sortField={sortField} sortDirection={sortDirection} />
                  </th>
                  <th
                    className={`${headerPadding} text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 hidden sm:table-cell`}
                    onClick={() => handleSort('currency')}
                  >
                    Currency<SortIcon field="currency" sortField={sortField} sortDirection={sortDirection} />
                  </th>
                  <th
                    className={`${headerPadding} text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 hidden md:table-cell`}
                    onClick={() => handleSort('provider')}
                    title="Per-security quote provider override"
                  >
                    Provider<SortIcon field="provider" sortField={sortField} sortDirection={sortDirection} />
                  </th>
                  <th
                    className={`${headerPadding} text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 hidden md:table-cell`}
                    onClick={() => handleSort('source')}
                    title="Source of the most recent price"
                  >
                    Source<SortIcon field="source" sortField={sortField} sortDirection={sortDirection} />
                  </th>
                </>
              )}
              <th className={`${headerPadding} text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell`}>
                Status
              </th>
              <th className={`${headerPadding} text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell sticky right-0 bg-gray-50 dark:bg-gray-800`}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
            {securities.map((security, index) => (
              <SecurityRow
                key={security.id}
                security={security}
                hasHoldings={(holdings[security.id] || 0) > 0}
                hasTransactions={transactionSecurityIds.has(security.id)}
                shares={holdings[security.id] || 0}
                density={density}
                cellPadding={cellPadding}
                onEdit={onEdit}
                onToggleActive={onToggleActive}
                onDelete={onDelete}
                onViewPrices={onViewPrices}
                onViewHistory={onViewHistory}
                onLongPressStart={handleLongPressStart}
                onLongPressStartTouch={handleLongPressStartTouch}
                onLongPressEnd={handleLongPressEnd}
                onTouchMove={handleTouchMove}
                index={index}
                defaultQuoteProvider={defaultQuoteProvider}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Long-press Context Menu */}
      <Modal isOpen={!!contextSecurity} onClose={() => setContextSecurity(null)} maxWidth="sm" className="p-0">
        {contextSecurity && (() => {
          const contextHasHoldings = (holdings[contextSecurity.id] || 0) > 0;
          const contextHasTransactions = transactionSecurityIds.has(contextSecurity.id);
          const contextCanDelete = !contextHasHoldings && !contextHasTransactions;
          return (
          <div>
            <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">{contextSecurity.symbol}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">{contextSecurity.name}</p>
            </div>
            <div className="py-2">
              {onViewHistory && (
                <button
                  onClick={() => { setContextSecurity(null); onViewHistory(contextSecurity); }}
                  className="w-full text-left px-5 py-3 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-3"
                >
                  <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                  Transaction History
                </button>
              )}
              {onViewPrices && (
                <button
                  onClick={() => { setContextSecurity(null); onViewPrices(contextSecurity); }}
                  className="w-full text-left px-5 py-3 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-3"
                >
                  <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  View Prices
                </button>
              )}
              <button
                onClick={() => { setContextSecurity(null); onEdit(contextSecurity); }}
                className="w-full text-left px-5 py-3 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-3"
              >
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit Security
              </button>
              {!contextHasHoldings && (
                <button
                  onClick={() => { setContextSecurity(null); onToggleActive(contextSecurity); }}
                  className={`w-full text-left px-5 py-3 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-3 ${
                    contextSecurity.isActive
                      ? 'text-yellow-600 dark:text-yellow-400'
                      : 'text-green-600 dark:text-green-400'
                  }`}
                >
                  {contextSecurity.isActive ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                  {contextSecurity.isActive ? 'Deactivate' : 'Activate'}
                </button>
              )}
              {contextCanDelete && onDelete && (
                <button
                  onClick={() => { setContextSecurity(null); onDelete(contextSecurity); }}
                  className="w-full text-left px-5 py-3 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-3"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete
                </button>
              )}
            </div>
          </div>
          );
        })()}
      </Modal>
    </div>
  );
}
