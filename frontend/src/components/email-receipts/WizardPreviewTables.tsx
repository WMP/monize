'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/Badge';
import { TABLE_BODY_CLASS, TABLE_CLASS, Td, Th } from '@/components/ui/Table';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import {
  PARSED_RECEIPT_REASONS,
  type ParsedReceiptReason,
  type ParserPreviewItem,
  type ParserPreviewOutcome,
  type ParserPreviewResult,
} from '@/types/email-receipts';

const MUTED = 'text-gray-500 dark:text-gray-400';

/** What the draft read from one email: date, total and the number of lines, each "not stated" when the email did not say. */
function ParsedCell({ item }: { item: ParserPreviewItem }) {
  const t = useTranslations('emailReceipts.profileWizard.preview');
  const { formatDate } = useDateFormat();
  const { formatCurrency, formatNumber } = useNumberFormat();
  const parsed = item.parsed;
  if (parsed === null) return <span className={MUTED}>{t('nothingRead')}</span>;
  // The server sends the total in money units; a total with no currency is shown as a bare number.
  const total =
    parsed.total === null
      ? t('notStated')
      : parsed.currency
        ? formatCurrency(parsed.total, parsed.currency)
        : formatNumber(parsed.total, 2);
  return (
    <div className="space-y-0.5">
      <div>{t('parsedDate', { date: parsed.date === null ? t('notStated') : formatDate(parsed.date) })}</div>
      <div>{t('parsedTotal', { total })}</div>
      <div className={`text-xs ${MUTED}`}>{t('parsedLines', { count: parsed.lineCount })}</div>
    </div>
  );
}

function EmailCell({ item }: { item: ParserPreviewItem }) {
  const { formatDateTime } = useDateFormat();
  return (
    <Td className="min-w-0 px-2 align-top break-words sm:px-4">
      <div className="font-medium">{item.subject}</div>
      <div className={`mt-0.5 text-xs ${MUTED}`}>{formatDateTime(item.effectiveDate)}</div>
    </Td>
  );
}

function OutcomeLabel({ outcome }: { outcome: ParserPreviewOutcome }) {
  const t = useTranslations('emailReceipts.profileWizard.preview.outcomes');
  return <>{t(outcome)}</>;
}

/** A parse reason the catalog names is shown in words; any other is shown as sent. */
function ReasonLabel({ reason }: { reason: string }) {
  const t = useTranslations('emailReceipts.parsed.reasons');
  const known = (PARSED_RECEIPT_REASONS as readonly string[]).includes(reason);
  return <>{known ? t(reason as ParsedReceiptReason) : reason}</>;
}

/**
 * The two tables of the preview: the chosen samples (what was expected against what
 * the draft read, and whether they agree) and, only when there are any, the domain's
 * other emails (how the draft would read them and which transaction it would match).
 */
export function WizardPreviewTables({ result }: { result: ParserPreviewResult }) {
  const t = useTranslations('emailReceipts.profileWizard.preview');
  const { formatNumber } = useNumberFormat();

  return (
    <div className="space-y-6">
      {result.selected.length > 0 && (
        <section aria-labelledby="wizard-preview-selected" className="space-y-2">
          <h3 id="wizard-preview-selected" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('selectedHeading')}
          </h3>
          <div className="overflow-x-auto">
            <table className={TABLE_CLASS}>
              <thead>
                <tr>
                  <Th className="px-2 sm:px-4">{t('columns.email')}</Th>
                  <Th className="px-2 sm:px-4">{t('columns.expected')}</Th>
                  <Th className="px-2 sm:px-4">{t('columns.parsed')}</Th>
                  <Th className="px-2 sm:px-4">{t('columns.agrees')}</Th>
                </tr>
              </thead>
              <tbody className={TABLE_BODY_CLASS}>
                {result.selected.map((item) => (
                  <tr key={item.receiptId}>
                    <EmailCell item={item} />
                    <Td className="min-w-0 px-2 align-top break-words sm:px-4">
                      {item.expected ? item.expected.summary : <span className={MUTED}>{t('noExpectation')}</span>}
                    </Td>
                    <Td className="px-2 align-top sm:px-4">
                      <ParsedCell item={item} />
                    </Td>
                    <Td className="px-2 align-top sm:px-4">
                      {item.agrees === null ? (
                        <span className={MUTED}>{t('agreesUnknown')}</span>
                      ) : (
                        <Badge variant={item.agrees ? 'green' : 'red'}>{item.agrees ? t('agreesYes') : t('agreesNo')}</Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {result.others.length > 0 && (
        <section aria-labelledby="wizard-preview-others" className="space-y-2">
          <h3 id="wizard-preview-others" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('othersHeading')}
          </h3>
          {result.othersTotal > result.others.length && (
            <p className={`text-xs ${MUTED}`}>
              {t('othersCapped', { shown: formatNumber(result.others.length, 0), total: formatNumber(result.othersTotal, 0) })}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className={TABLE_CLASS}>
              <thead>
                <tr>
                  <Th className="px-2 sm:px-4">{t('columns.email')}</Th>
                  <Th className="px-2 sm:px-4">{t('columns.outcome')}</Th>
                  <Th className="px-2 sm:px-4">{t('columns.parsed')}</Th>
                  <Th className="px-2 sm:px-4">{t('columns.matched')}</Th>
                </tr>
              </thead>
              <tbody className={TABLE_BODY_CLASS}>
                {result.others.map((item) => (
                  <tr key={item.receiptId}>
                    <EmailCell item={item} />
                    <Td className="px-2 align-top sm:px-4">
                      <div>
                        <OutcomeLabel outcome={item.outcome} />
                      </div>
                      {item.statusReason !== null && <div className={`mt-0.5 text-xs ${MUTED}`}><ReasonLabel reason={item.statusReason} /></div>}
                    </Td>
                    <Td className="px-2 align-top sm:px-4">
                      <ParsedCell item={item} />
                    </Td>
                    <Td className="min-w-0 px-2 align-top break-words sm:px-4">
                      {item.match ? item.match.summary : <span className={MUTED}>{t('noMatch')}</span>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
