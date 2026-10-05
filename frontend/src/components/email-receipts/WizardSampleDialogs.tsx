'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { EmailBodyView } from '@/components/email-receipts/EmailBodyView';
import { ReceiptTransactionPicker } from '@/components/email-receipts/ReceiptTransactionPicker';
import type { ChosenTransaction } from '@/components/email-receipts/profile-wizard-types';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Modal } from '@/components/ui/Modal';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { emailReceiptsApi } from '@/lib/email-receipts-api';
import { createLogger } from '@/lib/logger';
import type { EmailReceiptDetail, EmailReceiptListItem } from '@/types/email-receipts';

const logger = createLogger('WizardSampleDialogs');

type DetailState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; detail: EmailReceiptDetail };

/** The content of one stored email, read-only: HTML, text and numbered lines, as the Emails tab shows it. */
export function SampleEmailDialog({ receipt, onClose }: { receipt: EmailReceiptListItem; onClose: () => void }) {
  const t = useTranslations('emailReceipts.profileWizard.samples');
  const [state, setState] = useState<DetailState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    emailReceiptsApi.receipts
      .get(receipt.id)
      .then((detail) => {
        if (!cancelled) setState({ status: 'ready', detail });
      })
      .catch((error) => {
        if (cancelled) return;
        logger.error(error);
        setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [receipt.id, attempt]);

  return (
    <Modal isOpen onClose={onClose} maxWidth="3xl" padding="md" title={t('emailTitle', { subject: receipt.subject })}>
      {state.status === 'loading' ? (
        <LoadingSpinner text={t('emailLoading')} />
      ) : state.status === 'error' ? (
        <div role="alert" className="space-y-2">
          <p className="text-sm text-red-600 dark:text-red-400">{t('emailError')}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setState({ status: 'loading' });
              setAttempt((n) => n + 1);
            }}
          >
            {t('retry')}
          </Button>
        </div>
      ) : (
        <EmailBodyView bodyText={state.detail.bodyText} bodyHtml={state.detail.bodyHtml ?? null} lines={state.detail.lines} />
      )}
    </Modal>
  );
}

interface SampleTransactionDialogProps {
  receipt: EmailReceiptListItem;
  onClose: () => void;
  onChosen: (chosen: Pick<ChosenTransaction, 'transactionId' | 'summary'>) => void;
}

/** The transaction picker of the detail dialog, in a dialog of its own; the choice is kept by the wizard, not written. */
export function SampleTransactionDialog({ receipt, onClose, onChosen }: SampleTransactionDialogProps) {
  const t = useTranslations('emailReceipts.profileWizard.samples');
  const { formatDate } = useDateFormat();
  const { formatCurrency } = useNumberFormat();
  const tp = useTranslations('emailReceipts.picker');

  return (
    <Modal isOpen onClose={onClose} maxWidth="3xl" padding="md" title={t('transactionTitle', { subject: receipt.subject })}>
      <ReceiptTransactionPicker
        effectiveDate={receipt.effectiveDate}
        linkingId={null}
        mode="sample"
        onChoose={(row) =>
          onChosen({
            transactionId: row.id,
            summary: tp('row', {
              date: formatDate(row.transactionDate),
              amount: formatCurrency(Number(row.amount), row.currencyCode),
              payee: row.payeeName ?? tp('noPayee'),
            }),
          })
        }
        onLink={() => {}}
      />
    </Modal>
  );
}
