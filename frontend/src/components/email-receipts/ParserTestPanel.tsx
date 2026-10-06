'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MatchTraceView } from '@/components/email-receipts/MatchTraceView';
import { ParsedReceiptView } from '@/components/email-receipts/ParsedReceiptView';
import { ParserTraceList } from '@/components/email-receipts/ParserTraceList';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { emailReceiptsApi } from '@/lib/email-receipts-api';
import { getErrorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/logger';
import type {
  EmailReceiptListItem,
  EmailReceiptParserTestResult,
  ReceiptParserDefinition,
} from '@/types/email-receipts';

const logger = createLogger('ReceiptParserTest');

/** How many stored emails the picker offers (the list's own default page). */
const RECEIPT_CHOICES = 50;

interface ParserTestPanelProps {
  /** The definition as the form or the JSON editor holds it now, saved or not; null when the JSON does not parse. */
  definition: ReceiptParserDefinition | null;
  payeeId: string;
  /** A stored email to preselect, such as the one the parser is being written for. */
  initialReceiptId?: string;
  categoryLabels: ReadonlyMap<string, string>;
}

/**
 * Reads a stored email with the definition on the form (`POST
 * /email-receipt-parsers/test`, which writes nothing) and shows what the parser
 * found and which transaction the matcher would pick. The definition is read
 * when Test is pressed, so the answer is always about what is on screen at that
 * moment; an earlier result is cleared as soon as the choice of email changes.
 */
export function ParserTestPanel({ definition, payeeId, initialReceiptId, categoryLabels }: ParserTestPanelProps) {
  const t = useTranslations('emailReceipts.test');
  const { formatDate } = useDateFormat();
  const { formatCurrency } = useNumberFormat();

  // null while loading or failed: "no stored emails" is a claim only a loaded,
  // empty list can make.
  const [receipts, setReceipts] = useState<EmailReceiptListItem[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [receiptId, setReceiptId] = useState(initialReceiptId ?? '');
  const [isTesting, setIsTesting] = useState(false);
  const [result, setResult] = useState<EmailReceiptParserTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    emailReceiptsApi.receipts
      .list(undefined, RECEIPT_CHOICES)
      .then((list) => {
        if (!cancelled) setReceipts(list);
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error(err);
        setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(
    () => [
      { value: '', label: t('choosePlaceholder') },
      ...(receipts ?? []).map((receipt) => ({
        value: receipt.id,
        label: t('receiptOption', {
          subject: receipt.subject,
          sender: receipt.fromAddress,
          date: formatDate(receipt.effectiveDate),
        }),
      })),
    ],
    [receipts, t, formatDate],
  );

  const handleTest = async () => {
    if (receiptId === '' || definition === null) return;
    setIsTesting(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await emailReceiptsApi.parsers.test({
          definition,
          receiptId,
          ...(payeeId !== '' ? { payeeId } : {}),
        }),
      );
    } catch (err) {
      setError(getErrorMessage(err, t('failed')));
    } finally {
      setIsTesting(false);
    }
  };

  const match = result?.match;

  return (
    <section aria-labelledby="parser-test-heading" className="space-y-3">
      <div>
        <h3 id="parser-test-heading" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t('heading')}
        </h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('help')}</p>
      </div>

      {loadFailed && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t('loadFailed')}
        </p>
      )}
      {receipts !== null && receipts.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t('noReceipts')}</p>
      )}

      {receipts !== null && receipts.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Select
              id="parser-test-receipt"
              label={t('receiptLabel')}
              value={receiptId}
              options={options}
              onChange={(e) => {
                setReceiptId(e.target.value);
                setResult(null);
                setError(null);
              }}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            isLoading={isTesting}
            disabled={receiptId === '' || definition === null}
            onClick={() => void handleTest()}
          >
            {t('button')}
          </Button>
        </div>
      )}

      {definition === null && <p className="text-sm text-gray-500 dark:text-gray-400">{t('jsonInvalid')}</p>}

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          {result.outcome !== undefined && result.outcome !== 'read' && (
            <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              {t(`outcome.${result.outcome}`)}
            </p>
          )}
          <ParsedReceiptView parsed={result.parsed} categoryLabels={categoryLabels} />
          {result.trace && <ParserTraceList trace={result.trace} />}
          <div role="status" className="text-sm text-gray-700 dark:text-gray-300">
            <p className="font-medium text-gray-900 dark:text-gray-100">{t('matchHeading')}</p>
            {match?.kind === 'matched' && result.transaction && (
              <p>
                {t('matched', {
                  date: formatDate(result.transaction.date),
                  amount: formatCurrency(result.transaction.amount),
                  payee: result.transaction.payeeName ?? t('noPayee'),
                  how: t(`matchKinds.${match.matchKind}`),
                })}
              </p>
            )}
            {match?.kind === 'ambiguous' && <p>{t('ambiguous', { count: match.candidateIds.length })}</p>}
            {match?.kind === 'unmatched' && <p>{t('unmatched', { count: result.candidateCount })}</p>}
          </div>
          {result.matchTrace && <MatchTraceView trace={result.matchTrace} />}
        </div>
      )}
    </section>
  );
}
