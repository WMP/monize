'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { ParsedQifResponse } from '@/lib/import';
import { Account } from '@/types/account';
import { isInvestmentBrokerageAccount, buildAccountDropdownOptions } from '@/lib/account-utils';
import { useAccountTypeLabel } from '@/hooks/useAccountTypeLabel';
import { ImportFileData, ImportStep } from '@/app/import/import-utils';

interface SelectAccountStepProps {
  accounts: Account[];
  importFiles: ImportFileData[];
  isBulkImport: boolean;
  fileName: string;
  parsedData: ParsedQifResponse | null;
  selectedAccountId: string;
  setSelectedAccountId: (id: string) => void;
  setFileAccountId: (index: number, id: string) => void;
  showCreateAccount: boolean;
  setShowCreateAccount: (show: boolean) => void;
  creatingForFileIndex: number;
  setCreatingForFileIndex: (index: number) => void;
  newAccountName: string;
  setNewAccountName: (name: string) => void;
  newAccountType: string;
  setNewAccountType: (type: string) => void;
  newAccountCurrency: string;
  setNewAccountCurrency: (currency: string) => void;
  isCreatingAccount: boolean;
  handleCreateAccount: (fileIndex: number) => void;
  accountTypeOptions: Array<{ value: string; label: string }>;
  currencyOptions: Array<{ value: string; label: string }>;
  categoryMappings: { length: number };
  securityMappings: { length: number };
  shouldShowMapAccounts: boolean;
  setStep: (step: ImportStep) => void;
}

export function SelectAccountStep({
  accounts,
  importFiles,
  isBulkImport,
  fileName,
  parsedData,
  selectedAccountId,
  setSelectedAccountId,
  setFileAccountId,
  showCreateAccount,
  setShowCreateAccount,
  creatingForFileIndex,
  setCreatingForFileIndex,
  newAccountName,
  setNewAccountName,
  newAccountType,
  setNewAccountType,
  newAccountCurrency,
  setNewAccountCurrency,
  isCreatingAccount,
  handleCreateAccount,
  accountTypeOptions,
  currencyOptions,
  categoryMappings,
  securityMappings,
  shouldShowMapAccounts,
  setStep,
}: SelectAccountStepProps) {
  const t = useTranslations('import');
  const formatAccountType = useAccountTypeLabel();
  const getCompatibleAccountOptions = (isInvestment: boolean) => {
    return buildAccountDropdownOptions(
      accounts,
      (a) => isInvestment ? isInvestmentBrokerageAccount(a) : !isInvestmentBrokerageAccount(a),
      (a) => `${a.name} (${formatAccountType(a.accountType)})`,
    );
  };

  const allFilesHaveAccounts = importFiles.every((f) => f.selectedAccountId);

  if (!isBulkImport && parsedData) {
    const isQifInvestment = parsedData.accountType === 'INVESTMENT';
    const compatibleAccountOptions = getCompatibleAccountOptions(isQifInvestment);

    return (
      <div className="max-w-xl mx-auto">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
            {t('selectAccount.headingSingle')}
          </h2>
          <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 mb-6">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              <strong>{t('selectAccount.file')}</strong> {fileName}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              <strong>{t('selectAccount.transactions')}</strong> {parsedData.transactionCount}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              <strong>{t('selectAccount.dateRange')}</strong> {parsedData.dateRange.start} to {parsedData.dateRange.end}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              <strong>{t('selectAccount.detectedType')}</strong> {parsedData.accountType}
            </p>
          </div>

          {isQifInvestment && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 mb-4">
              <p className="text-sm text-blue-700 dark:text-blue-300">
                {t('selectAccount.investmentNotice')}
              </p>
            </div>
          )}

          {compatibleAccountOptions.length > 0 && (
            <Select
              label={t('selectAccount.importIntoAccount')}
              options={compatibleAccountOptions}
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
            />
          )}

          {!showCreateAccount ? (
            <button
              type="button"
              onClick={() => {
                setShowCreateAccount(true);
                setCreatingForFileIndex(0);
                setNewAccountName(fileName.replace(/\.[^/.]+$/, '').trim());
                setNewAccountType(parsedData.accountType || 'CHEQUING');
              }}
              className="mt-3 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
            >
              {t('selectAccount.createNewAccountLink')}
            </button>
          ) : creatingForFileIndex === 0 && (
            <div className="mt-4 border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 space-y-3">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('selectAccount.createNewAccountHeading')}</p>
              <Input
                label={t('common.accountName')}
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                placeholder={t('common.accountNamePlaceholder')}
              />
              <Select
                label={t('common.accountType')}
                options={accountTypeOptions}
                value={newAccountType}
                onChange={(e) => setNewAccountType(e.target.value)}
              />
              <Select
                label={t('common.currency')}
                options={currencyOptions}
                value={newAccountCurrency}
                onChange={(e) => setNewAccountCurrency(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleCreateAccount(0)}
                  disabled={isCreatingAccount || !newAccountName.trim()}
                >
                  {isCreatingAccount ? t('common.creating') : t('common.create')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setShowCreateAccount(false); setCreatingForFileIndex(-1); setNewAccountName(''); }}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          )}

          <div className="flex justify-between mt-6">
            <Button variant="outline" onClick={() => setStep('upload')}>
              {t('common.back')}
            </Button>
            <Button
              onClick={() => {
                if (categoryMappings.length > 0) {
                  setStep('mapCategories');
                } else if (securityMappings.length > 0) {
                  setStep('mapSecurities');
                } else if (shouldShowMapAccounts) {
                  setStep('mapAccounts');
                } else {
                  setStep('review');
                }
              }}
              disabled={!selectedAccountId}
            >
              {t('common.next')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {t('selectAccount.headingBulk')}
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          {t('selectAccount.bulkInstructions')}
        </p>

        <div className="space-y-4 max-h-[32rem] overflow-y-auto">
          {importFiles.map((fileData, index) => {
            const isInvestment = fileData.parsedData.accountType === 'INVESTMENT';
            const compatibleAccountOptions = getCompatibleAccountOptions(isInvestment);
            const isHighConfidence = fileData.selectedAccountId && fileData.matchConfidence === 'exact';

            return (
              <div
                key={index}
                className={`border rounded-lg p-4 ${
                  isHighConfidence
                    ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20'
                    : 'border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {fileData.fileName}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {t('selectAccount.transactionsCount', { count: fileData.parsedData.transactionCount })}
                      {isInvestment && t('selectAccount.investmentSuffix')}
                    </p>
                  </div>
                  <div className="sm:w-80">
                    <Select
                      options={compatibleAccountOptions}
                      value={fileData.selectedAccountId}
                      onChange={(e) => setFileAccountId(index, e.target.value)}
                    />
                    {creatingForFileIndex !== index ? (
                      <button
                        type="button"
                        onClick={() => {
                          setCreatingForFileIndex(index);
                          setShowCreateAccount(true);
                          setNewAccountType(fileData.parsedData.accountType || 'CHEQUING');
                          setNewAccountName(fileData.fileName.replace(/\.[^/.]+$/, '').trim());
                        }}
                        className="mt-1 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                      >
                        {t('selectAccount.createNewLink')}
                      </button>
                    ) : (
                      <div className="mt-2 border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 space-y-2">
                        <Input
                          label={t('common.accountName')}
                          value={newAccountName}
                          onChange={(e) => setNewAccountName(e.target.value)}
                          placeholder={t('common.accountNamePlaceholder')}
                        />
                        <Select
                          label={t('common.accountType')}
                          options={accountTypeOptions}
                          value={newAccountType}
                          onChange={(e) => setNewAccountType(e.target.value)}
                        />
                        <Select
                          label={t('common.currency')}
                          options={currencyOptions}
                          value={newAccountCurrency}
                          onChange={(e) => setNewAccountCurrency(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => handleCreateAccount(index)} disabled={isCreatingAccount || !newAccountName.trim()}>
                            {isCreatingAccount ? t('common.creating') : t('common.create')}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => { setCreatingForFileIndex(-1); setShowCreateAccount(false); setNewAccountName(''); }}>
                            {t('common.cancel')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
          <strong>{t('selectAccount.total')}</strong>{' '}
          {t('selectAccount.totalSummary', {
            files: importFiles.length,
            transactions: importFiles.reduce((sum, f) => sum + f.parsedData.transactionCount, 0),
          })}
        </div>

        <div className="flex justify-between mt-6">
          <Button variant="outline" onClick={() => setStep('upload')}>
            {t('common.back')}
          </Button>
          <Button
            onClick={() => {
              if (categoryMappings.length > 0) {
                setStep('mapCategories');
              } else if (securityMappings.length > 0) {
                setStep('mapSecurities');
              } else if (shouldShowMapAccounts) {
                setStep('mapAccounts');
              } else {
                setStep('review');
              }
            }}
            disabled={!allFilesHaveAccounts}
          >
            {t('common.next')}
          </Button>
        </div>
      </div>
    </div>
  );
}
