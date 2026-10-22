'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowTopRightOnSquareIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { Card } from '@/components/ui/Card';
import { LinkifiedText } from '@/components/ui/LinkifiedText';
import { useWarrantyDaysLeftText } from '@/components/warranties/WarrantyStatusBadge';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { toSafeExternalUrl } from '@/lib/external-url';
import { withCurrencyCode } from '@/lib/format';
import { useAuthStore } from '@/store/authStore';
import type { Warranty } from '@/types/warranty';

const LINK_CLASS =
  'rounded text-blue-600 hover:underline dark:text-blue-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900 dark:text-gray-100 break-words">{children}</dd>
    </div>
  );
}

/**
 * The purchase a warranty links to (design truth table C, section 9).
 *
 * Three states, decided from what the response carries: the purchase itself,
 * linked through the register's flash deep link; no link at all; or, for an
 * acting delegate, a purchase in an account their delegation does not let
 * them read -- the server omits it, and saying "no linked transaction" there
 * would be false.
 */
function LinkedPurchase({ warranty }: { warranty: Warranty }) {
  const t = useTranslations('warranties');
  const { formatDate } = useDateFormat();
  const { formatCurrency, defaultCurrency } = useNumberFormat();
  const isDelegate = useAuthStore((s) => s.actingAsUserId) !== null;
  const linked = warranty.linkedTransaction;

  if (linked === null) {
    const unreadable = isDelegate && warranty.transactionId === undefined;
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {unreadable ? t('detail.transaction.unreadable') : t('detail.transaction.none')}
      </p>
    );
  }

  // A decimal crosses the wire as a string; format the number it holds.
  const date = formatDate(linked.transactionDate);
  const payee = linked.payeeName ?? t('detail.transaction.noPayee');
  const amount = withCurrencyCode(
    formatCurrency(Number(linked.amount), linked.currencyCode),
    linked.currencyCode,
    defaultCurrency,
  );
  return (
    <Link
      href={`/transactions?targetTransactionId=${linked.id}`}
      aria-label={t('detail.transaction.open', { date, payee, amount })}
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${LINK_CLASS}`}
    >
      <span className="whitespace-nowrap">{date}</span>
      <span className="min-w-0 break-words">{payee}</span>
      <span className="whitespace-nowrap font-medium">{amount}</span>
      <ChevronRightIcon className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

interface WarrantyDetailCardProps {
  warranty: Warranty;
}

/**
 * What a warranty is: when its cover ends, what kind it is, who sold it and
 * for how much, the identifiers to quote in a claim, and the purchase it
 * came from. Status and days left are the server's (WTY-002); the price is
 * informational and in its own currency (design decision 6).
 */
export function WarrantyDetailCard({ warranty }: WarrantyDetailCardProps) {
  const t = useTranslations('warranties');
  const { formatDate } = useDateFormat();
  const { formatCurrency, defaultCurrency } = useNumberFormat();
  const daysLeftText = useWarrantyDaysLeftText();

  const none = t('detail.card.none');
  const expires = warranty.isLifetime || warranty.expiresOn === null ? t('detail.card.lifetime') : formatDate(warranty.expiresOn);
  const daysLeft = daysLeftText(warranty);
  const price =
    warranty.purchasePrice !== null && warranty.currencyCode !== null
      ? withCurrencyCode(formatCurrency(warranty.purchasePrice, warranty.currencyCode), warranty.currencyCode, defaultCurrency)
      : none;
  // Null unless the stored address is really http(s).
  const productUrl = toSafeExternalUrl(warranty.productUrl);

  let vendor: ReactNode = none;
  if (warranty.vendorName !== null) {
    vendor =
      warranty.payeeId !== null ? (
        <Link href={`/payees/${warranty.payeeId}`} className={LINK_CLASS}>
          {warranty.vendorName}
        </Link>
      ) : (
        warranty.vendorName
      );
  }

  let product: ReactNode = none;
  if (productUrl !== null) {
    product = (
      // `noopener` is the security control: without it the opened page gets
      // a handle on this one through window.opener.
      <a href={productUrl} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-1 break-all ${LINK_CLASS}`}>
        {productUrl}
        <ArrowTopRightOnSquareIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
      </a>
    );
  } else if (warranty.productUrl !== null) {
    product = warranty.productUrl;
  }

  return (
    <Card as="section" padding="md" aria-label={t('detail.card.title')}>
      <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">{t('detail.card.title')}</h2>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        <Field label={t('detail.card.expires')}>{expires}</Field>
        {daysLeft !== null && <Field label={t('detail.card.daysLeft')}>{daysLeft}</Field>}
        <Field label={t('detail.card.kind')}>{t(`kind.${warranty.warrantyKind}`)}</Field>
        <Field label={t('detail.card.vendor')}>{vendor}</Field>
        <Field label={t('detail.card.purchaseDate')}>{formatDate(warranty.purchaseDate)}</Field>
        <Field label={t('detail.card.price')}>{price}</Field>
        <Field label={t('detail.card.model')}>{warranty.modelNumber ?? none}</Field>
        <Field label={t('detail.card.serialNumbers')}>
          {warranty.serialNumbers.length === 0 ? (
            none
          ) : (
            <ul className="space-y-0.5">
              {warranty.serialNumbers.map((serial, index) => (
                <li key={`${serial}-${index}`} className="font-mono">
                  {serial}
                </li>
              ))}
            </ul>
          )}
        </Field>
        <Field label={t('detail.card.productUrl')} wide>
          {product}
        </Field>
        <Field label={t('detail.transaction.title')} wide>
          <LinkedPurchase warranty={warranty} />
        </Field>
        <Field label={t('detail.card.notes')} wide>
          {warranty.notes === null ? (
            none
          ) : (
            <span className="whitespace-pre-wrap">
              <LinkifiedText text={warranty.notes} />
            </span>
          )}
        </Field>
      </dl>
    </Card>
  );
}
