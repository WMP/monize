'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowTopRightOnSquareIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { PayeeLogo, type PayeeLogoData } from '@/components/payees/PayeeLogo';
import { Card, HOVER_ROW_ON_CARD } from '@/components/ui/Card';
import { LinkifiedText } from '@/components/ui/LinkifiedText';
import { useWarrantyDaysLeftText } from '@/components/warranties/WarrantyStatusBadge';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { toSafeExternalUrl } from '@/lib/external-url';
import { accountsApi } from '@/lib/accounts';
import { withCurrencyCode } from '@/lib/format';
import { createLogger } from '@/lib/logger';
import { payeesApi } from '@/lib/payees';
import type { Warranty } from '@/types/warranty';

const logger = createLogger('WarrantyDetailCard');

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
 * The vendor's payee record, for its logo: read only when the warranty names
 * a payee, and held with the id it was read for so a reply for another payee
 * is never drawn. Unknown (still loading, or the read failed) is `null`, and
 * `PayeeLogo` then draws the vendor's initial.
 */
function useVendorPayee(payeeId: string | null): PayeeLogoData | null {
  const [loaded, setLoaded] = useState<{ id: string; payee: PayeeLogoData } | null>(null);
  useEffect(() => {
    if (payeeId === null) return;
    let cancelled = false;
    payeesApi
      .getById(payeeId)
      .then((payee) => {
        if (!cancelled) setLoaded({ id: payeeId, payee: { id: payee.id, name: payee.name, hasLogo: payee.hasLogo } });
      })
      .catch((error) => {
        // The initial stands in; nothing else on the card depends on it.
        logger.warn('Failed to load the vendor payee:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [payeeId]);
  return payeeId !== null && loaded?.id === payeeId ? loaded.payee : null;
}

/**
 * The name of the account a purchase was filed in, from the cached account
 * list. Unknown is `null` and the line then shows the date alone.
 */
function useAccountName(accountId: string | null): string | null {
  const [loaded, setLoaded] = useState<{ id: string; name: string | null } | null>(null);
  useEffect(() => {
    if (accountId === null) return;
    let cancelled = false;
    accountsApi
      .getAll(true)
      .then((accounts) => {
        if (cancelled) return;
        const account = accounts.find((a) => a.id === accountId);
        setLoaded({ id: accountId, name: account?.name ?? null });
      })
      .catch((error) => {
        logger.warn('Failed to load the accounts for the purchase line:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);
  return accountId !== null && loaded?.id === accountId ? loaded.name : null;
}

/**
 * The block every state of the purchase line shares, so the card never jumps.
 * It sits on the card's own surface and lifts with `HOVER_ROW_ON_CARD` when it
 * is the link.
 */
const PURCHASE_BLOCK_CLASS =
  'flex min-h-[4.5rem] items-center gap-3 rounded-lg border border-gray-200 p-3 sm:gap-4 sm:p-4 dark:border-gray-700';

/**
 * The purchase a warranty links to (design truth table C, section 9).
 *
 * Three states, decided from what the response carries: the purchase itself,
 * linked through the register's flash deep link; no link at all; or, for an
 * acting delegate, a purchase in an account their delegation does not let
 * them read -- the server omits it and says so with `linkedTransactionHidden`,
 * and saying "no linked transaction" there would be false. All three are the
 * same block, the two without a purchase with a muted placeholder for the
 * logo. Date, payee and amount are the server's; the logo is the vendor's.
 */
function LinkedPurchase({ warranty, vendorPayee }: { warranty: Warranty; vendorPayee: PayeeLogoData | null }) {
  const t = useTranslations('warranties');
  const { formatDate } = useDateFormat();
  const { formatCurrency, defaultCurrency } = useNumberFormat();
  const linked = warranty.linkedTransaction;
  const accountName = useAccountName(linked?.accountId ?? null);

  if (linked === null) {
    return (
      <div className={PURCHASE_BLOCK_CLASS} data-testid="warranty-purchase">
        <PayeeLogo payee={null} size={40} className="opacity-60" />
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {warranty.linkedTransactionHidden ? t('detail.transaction.unreadable') : t('detail.transaction.none')}
        </p>
      </div>
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
      data-testid="warranty-purchase"
      className={`group ${PURCHASE_BLOCK_CLASS} ${HOVER_ROW_ON_CARD} focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
    >
      <PayeeLogo payee={vendorPayee} name={linked.payeeName} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-base font-semibold text-gray-900 group-hover:underline dark:text-gray-100">
          {payee}
        </span>
        <span className="block text-sm text-gray-500 dark:text-gray-400">
          {accountName !== null ? t('detail.transaction.dateInAccount', { date, account: accountName }) : date}
        </span>
      </span>
      <span className="shrink-0 whitespace-nowrap text-lg font-semibold tabular-nums text-gray-900 sm:text-xl dark:text-gray-100">
        {amount}
      </span>
      <ChevronRightIcon className="h-5 w-5 shrink-0 text-gray-400 dark:text-gray-500" aria-hidden="true" />
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
  const vendorPayee = useVendorPayee(warranty.payeeId);

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
        <span className="inline-flex items-center gap-2">
          <PayeeLogo payee={vendorPayee} name={warranty.vendorName} size={20} />
          <Link href={`/payees/${warranty.payeeId}`} className={LINK_CLASS}>
            {warranty.vendorName}
          </Link>
        </span>
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
        {/* The purchase leads: it is what a claim is made against. */}
        <Field label={t('detail.transaction.title')} wide>
          <LinkedPurchase warranty={warranty} vendorPayee={vendorPayee} />
        </Field>
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
