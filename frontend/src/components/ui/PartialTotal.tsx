'use client';

import { useTranslations } from 'next-intl';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import type { ConvertedTotal } from '@/lib/currency-total';

interface PartialTotalProps {
  /** Formatted subtotal, already rendered in the display currency. */
  children: React.ReactNode;
  /** The accumulation the figure came from. */
  total: ConvertedTotal;
  /** Display currency the conversion targeted, for the explanation. */
  displayCurrency: string;
}

/**
 * A money figure that is a subtotal, marked as one.
 *
 * When a rate is missing the honest answer is neither the complete-looking total
 * nor silence: it is the part that could be worked out, plus which currencies had
 * to be left out. Rendering it without the marker is what made an Assets card of
 * 20,000 indistinguishable from 120,000 with a 100,000 hole in it.
 *
 * The marker is a visible symbol and a tooltip, not colour alone -- and it names
 * the pairs, because "incomplete" the user cannot act on.
 */
export function PartialTotal({ children, total, displayCurrency }: PartialTotalProps) {
  const t = useTranslations('common');

  if (total.missingCurrencies.length === 0) return <>{children}</>;

  return (
    <span className="inline-flex items-baseline gap-1">
      <span>{children}</span>
      <span className="text-amber-600 dark:text-amber-400" aria-hidden="true">
        *
      </span>
      <span className="sr-only">{t('partialTotal.srSuffix')}</span>
      <InfoTooltip
        placement="top"
        text={t('partialTotal.explanation', {
          currencies: total.missingCurrencies.join(', '),
          displayCurrency,
          count: total.excludedCount,
        })}
      />
    </span>
  );
}
