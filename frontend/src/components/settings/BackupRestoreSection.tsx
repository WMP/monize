'use client';

import { useEffect, useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import { isAxiosError } from 'axios';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import {
  backupApi,
  BackupEncryptionStatus,
  BACKUP_PASSWORD_REQUIRED_CODE,
  isEncryptedBackupFile,
  RestoreResult,
} from '@/lib/backupApi';
import { getErrorMessage } from '@/lib/errors';
import { User } from '@/types/auth';

// Keys correspond to entries under the `backup.labels` message namespace,
// resolved at render time via t(`backup.labels.${key}`).
const RESTORE_LABEL_KEYS = new Set<string>([
  'userPreferences',
  'userCurrencyPreferences',
  'categories',
  'payees',
  'payeeAliases',
  'accounts',
  'tags',
  'scheduledTransactions',
  'scheduledTransactionSplits',
  'scheduledTransactionOverrides',
  'scheduledTransactionSplitTags',
  'securities',
  'securityPrices',
  'holdings',
  'transactions',
  'transactionSplits',
  'transactionTags',
  'transactionSplitTags',
  'investmentTransactions',
  'budgets',
  'budgetCategories',
  'budgetPeriods',
  'budgetPeriodCategories',
  'budgetAlerts',
  'customReports',
  'importColumnMappings',
  'monthlyAccountBalances',
  'autoBackupSettings',
  'aiProviderConfigs',
  'monteCarloScenarios',
  'monteCarloCashFlows',
]);

function isBackupPasswordRequired(error: unknown): boolean {
  if (!isAxiosError(error)) return false;
  const data = error.response?.data as { code?: string } | undefined;
  return data?.code === BACKUP_PASSWORD_REQUIRED_CODE;
}

interface BackupRestoreSectionProps {
  user: User;
}

export function BackupRestoreSection({ user }: BackupRestoreSectionProps) {
  const t = useTranslations('settings');
  const isOidc = user.authProvider === 'oidc';

  const restoreLabel = (key: string): string =>
    RESTORE_LABEL_KEYS.has(key) ? t(`backup.labels.${key}`) : key;

  const [encryption, setEncryption] = useState<BackupEncryptionStatus | null>(
    null,
  );
  const [encryptionLoading, setEncryptionLoading] = useState(true);

  const [isExporting, setIsExporting] = useState(false);
  const [exportPasswordPrompt, setExportPasswordPrompt] = useState(false);
  const [exportPassword, setExportPassword] = useState('');

  const [showRestore, setShowRestore] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreFileEncrypted, setRestoreFileEncrypted] = useState(false);
  const [restoreBackupPassword, setRestoreBackupPassword] = useState('');
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Encryption setup state
  const [showEncryptionSetup, setShowEncryptionSetup] = useState(false);
  const [setupPassword, setSetupPassword] = useState('');
  const [setupSaving, setSetupSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    backupApi
      .getEncryptionStatus()
      .then((status) => {
        if (!cancelled) setEncryption(status);
      })
      .catch(() => {
        if (!cancelled) setEncryption({ enabled: false, needsBackupPassword: isOidc });
      })
      .finally(() => {
        if (!cancelled) setEncryptionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOidc]);

  const runExport = async (encryptionPassword?: string) => {
    setIsExporting(true);
    try {
      const blob = await backupApi.exportBackup(encryptionPassword);
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const filename = encryptionPassword
        ? `monize-backup-${today}.mzbe`
        : `monize-backup-${today}.json.gz`;

      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success(t('backup.downloaded'));
      setExportPasswordPrompt(false);
      setExportPassword('');
    } catch (error) {
      toast.error(getErrorMessage(error, t('backup.createError')));
    } finally {
      setIsExporting(false);
    }
  };

  const handleExport = async () => {
    if (encryption?.enabled) {
      // Open the modal to capture the encryption password. Cleaner than
      // pre-populating any field: forces explicit confirmation that the
      // password the user is about to type matches their stored one.
      setExportPasswordPrompt(true);
      return;
    }
    await runExport();
  };

  const closeRestoreForm = () => {
    setShowRestore(false);
    setRestorePassword('');
    setRestoreFile(null);
    setRestoreFileEncrypted(false);
    setRestoreBackupPassword('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setRestoreFile(file);
    setRestoreBackupPassword('');
    // Sniff the file so the encrypted-backup password field only appears when
    // the upload is actually an encrypted Monize envelope.
    setRestoreFileEncrypted(file ? await isEncryptedBackupFile(file) : false);
  };

  const runRestore = async () => {
    if (!restoreFile) {
      toast.error(t('backup.selectFileError'));
      return;
    }
    if (!isOidc && !restorePassword) {
      toast.error(t('backup.passwordConfirmError'));
      return;
    }

    setIsRestoring(true);
    try {
      const authData = isOidc
        ? { oidcIdToken: 'oidc-session-confirmed' }
        : { password: restorePassword };

      const result = await backupApi.restoreBackup({
        file: restoreFile,
        ...authData,
        // Only relevant for encrypted backups; the account password above is a
        // separate identity check and is not the decryption key.
        backupPassword:
          restoreFileEncrypted && restoreBackupPassword
            ? restoreBackupPassword
            : undefined,
      });

      setRestoreResult(result);
      closeRestoreForm();
    } catch (error) {
      if (isBackupPasswordRequired(error)) {
        toast.error(
          t('backup.encryptedBackupError'),
        );
      } else {
        toast.error(getErrorMessage(error, t('backup.restoreError')));
      }
    } finally {
      setIsRestoring(false);
    }
  };

  const handleEnableEncryption = async () => {
    setSetupSaving(true);
    try {
      if (isOidc) {
        await backupApi.setBackupPassword(setupPassword);
      } else {
        await backupApi.enableLocalEncryption(setupPassword);
      }
      const status = await backupApi.getEncryptionStatus();
      setEncryption(status);
      setShowEncryptionSetup(false);
      setSetupPassword('');
      toast.success(t('backup.encryptionEnabled'));
    } catch (error) {
      toast.error(getErrorMessage(error, t('backup.enableEncryptionError')));
    } finally {
      setSetupSaving(false);
    }
  };

  const handleDisableEncryption = async () => {
    try {
      await backupApi.disableEncryption();
      const status = await backupApi.getEncryptionStatus();
      setEncryption(status);
      toast.success(t('backup.encryptionDisabled'));
    } catch (error) {
      toast.error(getErrorMessage(error, t('backup.disableEncryptionError')));
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 shadow dark:shadow-gray-700/50 rounded-lg p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">
        {t('backup.title')}
      </h2>

      {/* Encryption Section */}
      <div className="mb-6 pb-6 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
          {t('backup.encryptionTitle')}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          {isOidc
            ? t('backup.encryptionDescriptionOidc')
            : t('backup.encryptionDescriptionLocal')}
        </p>

        {encryptionLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('backup.loading')}</p>
        ) : encryption?.enabled ? (
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
              {t('backup.enabled')}
            </span>
            {isOidc && (
              <Button
                variant="outline"
                onClick={() => setShowEncryptionSetup(true)}
              >
                {t('backup.changeBackupPassword')}
              </Button>
            )}
            <Button variant="outline" onClick={handleDisableEncryption}>
              {t('backup.disable')}
            </Button>
          </div>
        ) : (
          <Button onClick={() => setShowEncryptionSetup(true)}>
            {isOidc ? t('backup.setBackupPassword') : t('backup.enableEncryptedBackups')}
          </Button>
        )}
      </div>

      {/* Export Section */}
      <div className="mb-6 pb-6 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
          {t('backup.createTitle')}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          {t('backup.createDescription')}
        </p>
        <Button
          onClick={handleExport}
          disabled={isExporting}
        >
          {isExporting ? t('backup.creating') : t('backup.downloadBackup')}
        </Button>
      </div>

      {/* Restore Section */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
          {t('backup.restoreTitle')}
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          {t('backup.restoreDescription')}
        </p>

        {!showRestore ? (
          <Button
            variant="outline"
            onClick={() => setShowRestore(true)}
          >
            {t('backup.restoreButton')}
          </Button>
        ) : (
          <div className="space-y-4 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <svg
                className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                {t('backup.restoreWarning')}
              </p>
            </div>

            <div>
              <label htmlFor="backup-file-input" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('backup.selectBackupFile')}
              </label>
              <input
                id="backup-file-input"
                ref={fileInputRef}
                type="file"
                accept=".json,.json.gz,.gz,.mzbe"
                onChange={handleFileChange}
                className="block w-full text-sm text-gray-500 dark:text-gray-400
                  file:mr-4 file:py-2 file:px-4 file:rounded file:border-0
                  file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700
                  dark:file:bg-blue-900/30 dark:file:text-blue-300
                  hover:file:bg-blue-100 dark:hover:file:bg-blue-900/50
                  file:cursor-pointer cursor-pointer"
              />
            </div>

            {restoreFileEncrypted && (
              <div className="pt-2 border-t border-amber-200 dark:border-amber-800">
                <label
                  htmlFor="backup-password-input"
                  className="block text-sm font-medium text-amber-700 dark:text-amber-300 mb-2"
                >
                  {t('backup.encryptedFilePrompt')}
                </label>
                <Input
                  id="backup-password-input"
                  type="password"
                  value={restoreBackupPassword}
                  onChange={(e) => setRestoreBackupPassword(e.target.value)}
                  placeholder={t('backup.backupPasswordPlaceholder')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') runRestore();
                  }}
                />
              </div>
            )}

            <div className="pt-2 border-t border-amber-200 dark:border-amber-800">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300 mb-2">
                {isOidc
                  ? t('backup.reauthPrompt')
                  : t('backup.passwordPrompt')}
              </p>
              {isOidc ? (
                <div className="flex gap-2">
                  <Button
                    variant="danger"
                    onClick={() => runRestore()}
                    disabled={isRestoring || !restoreFile}
                  >
                    {isRestoring ? t('backup.restoring') : t('backup.reauthAndRestore')}
                  </Button>
                  <Button variant="outline" onClick={closeRestoreForm}>
                    {t('backup.cancel')}
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    type="password"
                    value={restorePassword}
                    onChange={(e) => setRestorePassword(e.target.value)}
                    placeholder={t('backup.passwordPlaceholder')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && restorePassword && restoreFile) {
                        runRestore();
                      }
                    }}
                  />
                  <div className="flex gap-2 mt-3">
                    <Button
                      variant="danger"
                      onClick={() => runRestore()}
                      disabled={isRestoring || !restorePassword || !restoreFile}
                    >
                      {isRestoring ? t('backup.restoring') : t('backup.confirmRestore')}
                    </Button>
                    <Button variant="outline" onClick={closeRestoreForm}>
                      {t('backup.cancel')}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Encryption setup modal */}
      <Modal
        isOpen={showEncryptionSetup}
        onClose={() => {
          setShowEncryptionSetup(false);
          setSetupPassword('');
        }}
        maxWidth="sm"
      >
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            {isOidc ? t('backup.setBackupPassword') : t('backup.enableEncryptedBackups')}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {isOidc
              ? t('backup.setupHintOidc')
              : t('backup.setupHintLocal')}
          </p>
          <Input
            type="password"
            value={setupPassword}
            onChange={(e) => setSetupPassword(e.target.value)}
            placeholder={isOidc ? t('backup.newBackupPasswordPlaceholder') : t('backup.loginPasswordPlaceholder')}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowEncryptionSetup(false);
                setSetupPassword('');
              }}
              disabled={setupSaving}
            >
              {t('backup.cancel')}
            </Button>
            <Button
              onClick={handleEnableEncryption}
              disabled={setupSaving || !setupPassword}
            >
              {setupSaving ? t('backup.saving') : t('backup.confirm')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Export-time password prompt (when encryption is enabled) */}
      <Modal
        isOpen={exportPasswordPrompt}
        onClose={() => {
          setExportPasswordPrompt(false);
          setExportPassword('');
        }}
        maxWidth="sm"
      >
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            {t('backup.encryptBackupTitle')}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {t('backup.encryptBackupHint')}
          </p>
          <Input
            type="password"
            value={exportPassword}
            onChange={(e) => setExportPassword(e.target.value)}
            placeholder={isOidc ? t('backup.backupPasswordField') : t('backup.loginPasswordField')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && exportPassword) {
                runExport(exportPassword);
              }
            }}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setExportPasswordPrompt(false);
                setExportPassword('');
              }}
              disabled={isExporting}
            >
              {t('backup.cancel')}
            </Button>
            <Button
              onClick={() => runExport(exportPassword)}
              disabled={isExporting || !exportPassword}
            >
              {isExporting ? t('backup.encrypting') : t('backup.download')}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={restoreResult !== null}
        onClose={() => setRestoreResult(null)}
        maxWidth="md"
      >
        {restoreResult && (
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t('backup.restoreCompleteTitle')}
              </h2>
            </div>

            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              {t('backup.restoreCompleteHint')}
            </p>

            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 max-h-64 overflow-y-auto">
              <dl className="space-y-1">
                {Object.entries(restoreResult.restored)
                  .filter(([, count]) => count > 0)
                  .map(([key, count]) => (
                    <div key={key} className="flex justify-between text-sm">
                      <dt className="text-gray-600 dark:text-gray-400">
                        {restoreLabel(key)}
                      </dt>
                      <dd className="font-medium text-gray-900 dark:text-white">
                        {count.toLocaleString()}
                      </dd>
                    </div>
                  ))}
              </dl>
            </div>

            <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-600 flex justify-between text-sm font-medium">
              <span className="text-gray-900 dark:text-white">{t('backup.totalRecords')}</span>
              <span className="text-gray-900 dark:text-white">
                {Object.values(restoreResult.restored).reduce((sum, n) => sum + n, 0).toLocaleString()}
              </span>
            </div>

            <div className="mt-6 flex justify-end">
              <Button onClick={() => setRestoreResult(null)}>
                {t('backup.done')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
