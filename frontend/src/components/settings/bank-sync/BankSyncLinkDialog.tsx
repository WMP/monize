'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { DateInput } from '@/components/ui/DateInput';
import { Modal } from '@/components/ui/Modal';

interface BankSyncLinkDialogProps {
  isOpen: boolean;
  /** The Monize account being linked, by name. */
  accountName: string;
  /** Changing the date of a link that already exists rather than making one. */
  editing: boolean;
  /** The date the link already holds, if any. */
  initialDate: string | null;
  onClose: () => void;
  /**
   * `syncFromDate` is `undefined` when the user left the date empty, so the
   * request leaves it out and the server chooses the default.
   */
  onSave: (syncFromDate: string | undefined) => Promise<void>;
}

/**
 * The cut-off date of a link: rows the bank booked before it are never
 * imported.
 *
 * The date is optional when linking. Left empty, nothing is sent and the server
 * defaults it to the day after the newest transaction in the account, which is
 * what keeps the first sync from duplicating what the user typed by hand. The
 * form says so, and warns about the one choice that defeats it: a date earlier
 * than the newest transaction already in the account.
 */
export function BankSyncLinkDialog({
  isOpen,
  accountName,
  editing,
  initialDate,
  onClose,
  onSave,
}: BankSyncLinkDialogProps) {
  const t = useTranslations('settings.bankSync.link');
  const [date, setDate] = useState(initialDate ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(date === '' ? undefined : date);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editing ? t('editTitle', { account: accountName }) : t('title', { account: accountName })}
      padding="md"
      maxWidth="md"
      pushHistory
    >
      <div className="space-y-4">
        <div>
          <DateInput
            label={t('syncFromLabel')}
            id="bank-sync-sync-from"
            value={date}
            onDateChange={setDate}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('syncFromHelp')}
          </p>
        </div>

        <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600 dark:text-gray-300">
          <li>{t('beforeCutoff')}</li>
          <li className="text-amber-700 dark:text-amber-300">
            {t('duplicateWarning')}
          </li>
        </ul>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            // An existing link's date can only be replaced by a date: an empty
            // field has nothing to send.
            disabled={saving || (editing && date === '')}
          >
            {saving ? t('saving') : editing ? t('saveEdit') : t('save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
