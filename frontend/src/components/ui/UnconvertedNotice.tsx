'use client';

import { useTranslations } from 'next-intl';

/**
 * Says that some amounts were left out of a figure because their currency had no
 * exchange rate.
 *
 * An aggregate over many rows cannot become `null` and still be a chart, so the
 * rows that cannot be expressed in the reporting currency are excluded -- which
 * is right, because including them at a fabricated 1:1 rate would misstate them
 * *and* every percentage measured against the total. But exclusion on its own
 * quietly understates: the number still looks like the whole answer.
 *
 * So wherever a component drops rows for that reason, it renders this beside the
 * figure. One component and one catalog string rather than a bespoke message per
 * chart, so the wording stays consistent and a translator has one place to look.
 *
 * Renders nothing when `count` is zero, so a caller can include it
 * unconditionally.
 */
export function UnconvertedNotice({
  count,
  className = '',
}: {
  count: number;
  className?: string;
}) {
  const t = useTranslations('common');
  if (count <= 0) return null;
  return (
    <p
      className={`text-xs text-amber-600 dark:text-amber-500 ${className}`}
      role="status"
    >
      {t('unconvertedExcluded', { count })}
    </p>
  );
}
