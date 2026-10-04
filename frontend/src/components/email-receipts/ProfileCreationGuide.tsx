'use client';

import { useTranslations } from 'next-intl';

/**
 * How a profile gets made from the Emails tab, in the order the page is used:
 * choose a sender, give each of its emails the transaction it paid for, tick
 * the emails and hand them to the assistant. Plain copy, no state.
 */
export function ProfileCreationGuide() {
  const t = useTranslations('emailReceipts.receipts.guide');
  return (
    <section
      aria-label={t('heading')}
      className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300"
    >
      <h2 className="font-medium text-gray-900 dark:text-gray-100">{t('heading')}</h2>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5">
        <li>{t('stepSender')}</li>
        <li>{t('stepTransaction')}</li>
        <li>{t('stepSelect')}</li>
        <li>{t('stepPrepare', { button: t('buttonName') })}</li>
      </ol>
    </section>
  );
}
