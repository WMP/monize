'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PlusIcon } from '@heroicons/react/24/outline';
import { WarrantyStatusBadge } from '@/components/warranties/WarrantyStatusBadge';
import { useDateFormat } from '@/hooks/useDateFormat';
import { createLogger } from '@/lib/logger';
import { warrantiesApi } from '@/lib/warranties';
import type { Transaction } from '@/types/transaction';
import type { Warranty } from '@/types/warranty';
import { rowHasWarranties } from './WarrantyBadge';

const logger = createLogger('TransactionWarrantiesLine');

const LINK_CLASS =
  'rounded text-blue-600 hover:underline dark:text-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

/** The answer for one transaction id, so a reply for another is never shown. */
type LoadState =
  | { transactionId: string; warranties: Warranty[] }
  | { transactionId: string; failed: true };

interface TransactionWarrantiesLineProps {
  /** A saved transaction; the form renders this only when editing one. */
  transaction: Pick<Transaction, 'id' | 'warrantyCount'>;
}

/**
 * The Warranties line in the transaction edit form: the warranties linked to
 * this purchase, each a link to its detail page, and an "Add warranty" link to
 * the Warranties page's form prefilled from it. The list is fetched only when
 * the register row says the transaction has any (`warrantyCount`); with none
 * the line is the Add link alone and nothing is fetched.
 */
export function TransactionWarrantiesLine({ transaction }: TransactionWarrantiesLineProps) {
  const t = useTranslations('transactions');
  const { formatDate } = useDateFormat();
  const transactionId = transaction.id;
  const shouldFetch = rowHasWarranties(transaction);
  const [loaded, setLoaded] = useState<LoadState | null>(null);

  useEffect(() => {
    if (!shouldFetch) return;
    let cancelled = false;
    warrantiesApi
      .list({ transactionId })
      .then((result) => {
        if (!cancelled) setLoaded({ transactionId, warranties: result.data });
      })
      .catch((error) => {
        logger.error('Failed to load the transaction warranties:', error);
        if (!cancelled) setLoaded({ transactionId, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [shouldFetch, transactionId]);

  const current = shouldFetch && loaded?.transactionId === transactionId ? loaded : null;

  return (
    <div className="space-y-2" data-testid="transaction-warranties">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('form.warranties.title')}
        </span>
        <Link
          href={`/warranties?new=1&transactionId=${transactionId}`}
          className={`inline-flex items-center gap-1 text-sm ${LINK_CLASS}`}
        >
          <PlusIcon className="h-4 w-4" aria-hidden="true" />
          {t('form.warranties.add')}
        </Link>
      </div>
      {shouldFetch && current === null && (
        <p className="text-sm text-gray-500 dark:text-gray-400" role="status">
          {t('form.warranties.loading')}
        </p>
      )}
      {current !== null && 'failed' in current && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {t('form.warranties.loadError')}
        </p>
      )}
      {current !== null && 'warranties' in current && current.warranties.length > 0 && (
        <ul className="space-y-1">
          {current.warranties.map((warranty) => (
            <li key={warranty.id}>
              <Link
                href={`/warranties/${warranty.id}`}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-sm ${LINK_CLASS}`}
              >
                <span className="min-w-0 break-words">{warranty.name}</span>
                <WarrantyStatusBadge warranty={warranty} />
                {!warranty.isLifetime && warranty.expiresOn !== null && (
                  <span className="whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                    {t('form.warranties.expires', { date: formatDate(warranty.expiresOn) })}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
