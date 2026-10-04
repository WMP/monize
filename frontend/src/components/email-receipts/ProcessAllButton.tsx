'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ProcessStatus } from '@/components/email-receipts/ProcessStatus';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useProcessStoredEmails } from '@/hooks/useProcessStoredEmails';

interface ProcessAllButtonProps {
  /** How many emails the run would process; `null` while unknown, which disables the button. */
  count: number | null;
  /** Keep the run to this sender domain (and its sub-domains); omit for every sender. */
  domain?: string;
  /** Called once a run has ended, so the list and the counts are read again. */
  onFinished?: () => void;
  className?: string;
}

/**
 * "Process all (N)": asks first (every stored email in the range is read again and a
 * proposal may be made or, with auto-apply on, applied), then runs the server's bulk
 * call in a loop with progress and a Cancel. The confirmation says the one thing a
 * person should know: which of the emails it reaches.
 */
export function ProcessAllButton({ count, domain, onFinished, className }: ProcessAllButtonProps) {
  const t = useTranslations('emailReceipts.process');
  const { state, run, cancel, dismiss } = useProcessStoredEmails();
  const [confirming, setConfirming] = useState(false);
  const running = state.status === 'running';

  const start = async () => {
    setConfirming(false);
    await run([domain]);
    onFinished?.();
  };

  return (
    <div className={`space-y-3 ${className ?? ''}`}>
      <Button variant="outline" onClick={() => setConfirming(true)} disabled={running || count === null || count === 0}>
        {count === null ? t('button') : t('buttonCount', { count })}
      </Button>
      <ProcessStatus state={state} onCancel={cancel} onDismiss={dismiss} />
      <ConfirmDialog
        isOpen={confirming}
        title={t('dialog.title', { count: count ?? 0 })}
        message={domain ? t('dialog.messageDomain', { domain }) : t('dialog.message')}
        confirmLabel={t('dialog.confirm')}
        variant="info"
        onConfirm={() => void start()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
