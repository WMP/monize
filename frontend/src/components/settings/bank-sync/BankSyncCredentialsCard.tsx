'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { bankSyncApi } from '@/lib/bank-sync';
import { getErrorMessage } from '@/lib/errors';
import type {
  BankSyncCredentialsTestResult,
  BankSyncStatus,
  SaveBankSyncCredentials,
} from '@/types/bank-sync';
import { BankSyncCredentialsModal } from './BankSyncCredentialsModal';

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'done'; result: BankSyncCredentialsTestResult }
  | { kind: 'error'; message: string };

interface BankSyncCredentialsCardProps {
  status: BankSyncStatus;
  disabled?: boolean;
  /** The status after a write, so the page holds the server's answer. */
  onStatusChange: (status: BankSyncStatus) => void;
}

/**
 * The user's own Enable Banking application: its ID, whether a private key is
 * stored, and the redirect URL to register at the provider.
 *
 * The key is never shown, and a screen that cannot store one says so up front
 * rather than after the user has pasted it: without an encryption key on the
 * server, saving is disabled.
 */
export function BankSyncCredentialsCard({
  status,
  disabled = false,
  onStatusChange,
}: BankSyncCredentialsCardProps) {
  const t = useTranslations('settings.bankSync.credentials');
  const [showModal, setShowModal] = useState(false);
  const [showRemove, setShowRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  const credentials = status.credentials;

  const handleSave = async (data: SaveBankSyncCredentials) => {
    try {
      const saved = await bankSyncApi.saveCredentials(data);
      onStatusChange(saved);
      setTest({ kind: 'idle' });
      setShowModal(false);
      toast.success(t('saved'));
    } catch (error) {
      toast.error(getErrorMessage(error, t('saveFailed')));
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      await bankSyncApi.deleteCredentials();
      onStatusChange({ ...status, credentials: null });
      setTest({ kind: 'idle' });
      toast.success(t('removed'));
    } catch (error) {
      toast.error(getErrorMessage(error, t('removeFailed')));
    } finally {
      setRemoving(false);
      setShowRemove(false);
    }
  };

  const handleTest = async () => {
    setTest({ kind: 'testing' });
    try {
      const result = await bankSyncApi.testCredentials();
      setTest({ kind: 'done', result });
    } catch (error) {
      setTest({ kind: 'error', message: getErrorMessage(error, t('testError')) });
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(status.redirectUrl);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  };

  // The redirect URL is only known to be unregistered when the provider listed
  // some and ours is not among them. An empty list says nothing.
  const redirectMissing =
    test.kind === 'done' &&
    test.result.ok &&
    test.result.redirectUrls.length > 0 &&
    !test.result.redirectUrls.includes(status.redirectUrl);

  return (
    <>
      <Card padding="md" className="mb-6">
        <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('title')}
        </h2>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {t('subtitle')}
        </p>

        {!status.encryptionAvailable && (
          <p
            role="alert"
            className="mb-4 text-sm text-amber-700 dark:text-amber-300"
          >
            {t('encryptionUnavailable')}
          </p>
        )}

        <div className="mb-4">
          <div className="flex items-end gap-2">
            <Input
              label={t('redirectUrlLabel')}
              id="bank-sync-redirect-url"
              value={status.redirectUrl}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleCopy}
              className="shrink-0"
            >
              {t('copy')}
            </Button>
          </div>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t('redirectUrlHelp')}
          </p>
        </div>

        {credentials ? (
          <div className="mb-4 text-sm text-gray-700 dark:text-gray-300">
            <p>
              <span className="font-medium">{t('applicationId')}</span>{' '}
              <span className="font-mono break-all">
                {credentials.applicationId}
              </span>
            </p>
            <p className="mt-1 text-gray-500 dark:text-gray-400">
              {credentials.privateKeySet ? t('keyStored') : t('keyMissing')}
            </p>
          </div>
        ) : (
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            {t('notConfigured')}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={credentials ? 'outline' : 'primary'}
            size="sm"
            onClick={() => setShowModal(true)}
            disabled={disabled || !status.encryptionAvailable}
          >
            {credentials ? t('edit') : t('configure')}
          </Button>
          {credentials && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={disabled || test.kind === 'testing'}
              >
                {test.kind === 'testing' ? t('testing') : t('test')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowRemove(true)}
                disabled={disabled || removing}
              >
                {t('remove')}
              </Button>
            </>
          )}
        </div>

        <div aria-live="polite">
          {test.kind === 'error' && (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">
              {test.message}
            </p>
          )}
          {test.kind === 'done' && !test.result.ok && (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">
              {t('testFailed')}
            </p>
          )}
          {test.kind === 'done' && test.result.ok && !redirectMissing && (
            <p className="mt-3 text-sm text-green-600 dark:text-green-400">
              {test.result.applicationName
                ? t('testSuccess', { name: test.result.applicationName })
                : t('testSuccessNoName')}
            </p>
          )}
          {redirectMissing && (
            <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
              {t('testRedirectMissing')}
            </p>
          )}
        </div>
      </Card>

      {showModal && (
        <BankSyncCredentialsModal
          isOpen={showModal}
          applicationId={credentials?.applicationId ?? null}
          privateKeySet={credentials?.privateKeySet ?? false}
          onClose={() => setShowModal(false)}
          onSave={handleSave}
        />
      )}

      <ConfirmDialog
        isOpen={showRemove}
        title={t('removeConfirm.title')}
        message={t('removeConfirm.message')}
        confirmLabel={t('removeConfirm.confirm')}
        onConfirm={handleRemove}
        onCancel={() => setShowRemove(false)}
        pushHistory
      />
    </>
  );
}
