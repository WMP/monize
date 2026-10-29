'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useAuthStore } from '@/store/authStore';
import type { PartialBudgetData } from '@/lib/budget-partial';

export function BudgetFxPartialNotice({ data, onRetry }: { data: PartialBudgetData; onRetry?: () => void }) {
  const t = useTranslations('reports');
  const currencies = useTranslations('currencies.page');
  const { formatCurrency } = useNumberFormat();
  const { formatDate } = useDateFormat();
  const actingAs = useAuthStore(state => state.actingAsUserId);
  const pairs = [...new Set(data.missingRatePairs.map(pair => `${pair.from} → ${pair.to}`))].join(', ');
  return <Card className="p-6 space-y-3" role="note" data-testid="budget-fx-partial">
    <p>{t('partialData.resultUnavailable')}</p>
    <p className="text-sm text-amber-600 dark:text-amber-400">{t('partialData.weightingNoRate', { pairs })}</p>
    {data.knownComponents.length > 0 && <details>
      <summary className="cursor-pointer">{t('partialData.knownComponents')}</summary>
      <ul className="max-h-60 overflow-y-auto text-sm space-y-1">
        {data.knownComponents.map(component => <li key={component.id} className="flex justify-between gap-3">
          <span>{formatDate(component.date)}</span><span>{formatCurrency(component.knownSubtotal, component.currency)} {component.currency}</span>
        </li>)}
      </ul>
    </details>}
    {data.detailsTruncated && <p className="text-sm">{t('partialData.detailsLimited')}</p>}
    <div className="flex gap-3 items-center">
      {!actingAs && <Link href="/currencies" className="text-blue-600 dark:text-blue-400 underline">{currencies('title')}</Link>}
      {onRetry && <Button variant="secondary" onClick={onRetry}>{t('error.retry')}</Button>}
    </div>
  </Card>;
}
