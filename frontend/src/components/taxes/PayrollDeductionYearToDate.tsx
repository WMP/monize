'use client';

import { useTranslations } from 'next-intl';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { TABLE_BODY_CLASS, TABLE_CLASS, Td, Th } from '@/components/ui/Table';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import type { PayrollDeductionRule } from '@/types/payroll-deduction';

interface PayrollDeductionYearToDateProps {
  rules: PayrollDeductionRule[];
}

/**
 * What each rule's category has collected in the period containing today,
 * as the server read it (docs/specs/payroll-deductions.md decision 6). A row
 * says when rows in another currency were left out, so the paid figure is
 * read as the lower bound it then is.
 */
export function PayrollDeductionYearToDate({ rules }: PayrollDeductionYearToDateProps) {
  const t = useTranslations('taxes.payroll');
  const { formatCurrency } = useNumberFormat();
  const { formatDate } = useDateFormat();

  return (
    <section aria-label={t('yearToDate.title')}>
      <div className="flex items-center gap-1 px-4 pt-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('yearToDate.title')}</h2>
        <InfoTooltip text={t('yearToDate.help')} placement="bottom" />
      </div>
      <div className="overflow-x-auto">
        <table className={TABLE_CLASS}>
          <thead>
            <tr>
              <Th>{t('list.bill')}</Th>
              <Th>{t('list.category')}</Th>
              <Th>{t('list.period')}</Th>
              <Th align="right">{t('list.paid')}</Th>
              <Th align="right">{t('list.yearlyMaximum')}</Th>
              <Th align="right">{t('list.remaining')}</Th>
            </tr>
          </thead>
          <tbody className={TABLE_BODY_CLASS}>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <Td>{rule.scheduledTransactionName}</Td>
                <Td>{rule.categoryName}</Td>
                <Td>
                  {t('list.periodRange', {
                    start: formatDate(rule.periodStart),
                    end: formatDate(rule.periodEnd),
                  })}
                </Td>
                <Td align="right">
                  {formatCurrency(rule.paidToDate, rule.currencyCode)}
                  {rule.foreignCurrencyRows > 0 && (
                    <span className="block text-xs text-amber-600 dark:text-amber-400">
                      {t('yearToDate.foreignRows', { count: rule.foreignCurrencyRows })}
                    </span>
                  )}
                </Td>
                <Td align="right">{formatCurrency(rule.yearlyMaximum, rule.currencyCode)}</Td>
                <Td align="right">{formatCurrency(rule.remaining, rule.currencyCode)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
