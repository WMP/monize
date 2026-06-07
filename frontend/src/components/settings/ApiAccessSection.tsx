'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import '@/lib/zodConfig';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { authApi } from '@/lib/auth';
import { PersonalAccessToken } from '@/types/auth';
import { getErrorMessage } from '@/lib/errors';
import { useDateFormat } from '@/hooks/useDateFormat';

const MCP_PATH = '/api/v1/mcp';

const SCOPE_OPTIONS = [
  { value: 'read', labelKey: 'apiAccess.scopeOptions.read', descriptionKey: 'apiAccess.scopeOptions.readDescription' },
  { value: 'write', labelKey: 'apiAccess.scopeOptions.write', descriptionKey: 'apiAccess.scopeOptions.writeDescription' },
  { value: 'reports', labelKey: 'apiAccess.scopeOptions.reports', descriptionKey: 'apiAccess.scopeOptions.reportsDescription' },
];

const EXPIRY_OPTIONS = [
  { value: '', labelKey: 'apiAccess.expiryOptions.none' },
  { value: '30', labelKey: 'apiAccess.expiryOptions.days30' },
  { value: '90', labelKey: 'apiAccess.expiryOptions.days90' },
  { value: '365', labelKey: 'apiAccess.expiryOptions.year1' },
];

const createTokenSchema = z.object({
  name: z.string().min(1, 'Token name is required').max(100, 'Token name must be 100 characters or less'),
  expiryDays: z.string(),
});

type CreateTokenFormData = z.infer<typeof createTokenSchema>;

function relativeOrFormatted(
  dateStr: string | null,
  formatDate: (date: Date | string) => string,
  t: (key: string, values?: Record<string, string | number | Date>) => string,
): string {
  if (!dateStr) return t('apiAccess.relative.never');
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return t('apiAccess.relative.today');
  if (diffDays === 1) return t('apiAccess.relative.yesterday');
  if (diffDays < 30) return t('apiAccess.relative.daysAgo', { count: diffDays });
  if (diffDays < 365) return t('apiAccess.relative.monthsAgo', { count: Math.floor(diffDays / 30) });
  return formatDate(date);
}

export function ApiAccessSection() {
  const t = useTranslations('settings');
  const { formatDate } = useDateFormat();
  const tError = (msg?: string) => {
    if (!msg) return msg;
    if (msg === 'Token name is required') return t('apiAccess.validation.nameRequired');
    if (msg === 'Token name must be 100 characters or less') return t('apiAccess.validation.nameMax');
    return msg;
  };
  const [tokens, setTokens] = useState<PersonalAccessToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [revokeTokenId, setRevokeTokenId] = useState<string | null>(null);

  // Scope selection state (managed separately since it's a multi-select toggle)
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['read']);

  // Show token once state
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mcpUrlCopied, setMcpUrlCopied] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const {
    register,
    handleSubmit,
    reset: resetForm,
    formState: { errors },
  } = useForm<CreateTokenFormData>({
    resolver: zodResolver(createTokenSchema),
    defaultValues: {
      name: '',
      expiryDays: '',
    },
  });

  const mcpServerUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${MCP_PATH}`
    : MCP_PATH;

  const loadTokens = useCallback(async () => {
    try {
      const data = await authApi.getTokens();
      setTokens(data);
    } catch (error) {
      toast.error(getErrorMessage(error, t('apiAccess.loadError')));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadTokens();
  }, [loadTokens]);

  const handleCreate = async (formData: CreateTokenFormData) => {
    if (selectedScopes.length === 0) {
      toast.error(t('apiAccess.selectScope'));
      return;
    }

    setIsCreating(true);
    try {
      let expiresAt: string | undefined;
      if (formData.expiryDays) {
        const date = new Date();
        date.setDate(date.getDate() + parseInt(formData.expiryDays));
        expiresAt = date.toISOString();
      }

      const result = await authApi.createToken({
        name: formData.name.trim(),
        scopes: selectedScopes.join(','),
        expiresAt,
      });

      setCreatedToken(result.token);
      setTokens((prev) => [result, ...prev]);
      setCopied(false);
    } catch (error) {
      toast.error(getErrorMessage(error, t('apiAccess.createError')));
    } finally {
      setIsCreating(false);
    }
  };

  const handleCloseCreateModal = () => {
    setShowCreateModal(false);
    setCreatedToken(null);
    resetForm();
    setSelectedScopes(['read']);
    setCopied(false);
  };

  const handleCopyToken = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      setCopied(true);
      toast.success(t('apiAccess.tokenCopied'));
    } catch {
      toast.error(t('apiAccess.copyError'));
    }
  };

  const handleRevoke = async () => {
    if (!revokeTokenId) return;
    try {
      await authApi.revokeToken(revokeTokenId);
      setTokens((prev) => prev.filter((tok) => tok.id !== revokeTokenId));
      toast.success(t('apiAccess.tokenRevoked'));
    } catch (error) {
      toast.error(getErrorMessage(error, t('apiAccess.revokeError')));
    } finally {
      setRevokeTokenId(null);
    }
  };

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scope)
        ? prev.filter((s) => s !== scope)
        : [...prev, scope],
    );
  };

  const activeTokens = tokens.filter((t) => !t.isRevoked);

  return (
    <div className="bg-white dark:bg-gray-800 shadow dark:shadow-gray-700/50 rounded-lg p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('apiAccess.title')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('apiAccess.description')}
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setShowCreateModal(true)}
        >
          {t('apiAccess.createToken')}
        </Button>
      </div>

      {/* MCP Server URL */}
      <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
          {t('apiAccess.mcpServerUrl')}
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={mcpServerUrl}
            className="flex-1 text-sm font-mono bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-1.5 text-gray-900 dark:text-gray-100"
          />
          <Button
            variant={mcpUrlCopied ? 'secondary' : 'outline'}
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(mcpServerUrl);
                setMcpUrlCopied(true);
                toast.success(t('apiAccess.mcpUrlCopied'));
                setTimeout(() => setMcpUrlCopied(false), 2000);
              } catch {
                toast.error(t('apiAccess.copyUrlError'));
              }
            }}
          >
            {mcpUrlCopied ? t('apiAccess.copied') : t('apiAccess.copy')}
          </Button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
          {t('apiAccess.mcpUrlHint')}
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <LoadingSpinner size="sm" fullContainer={false} />
        </div>
      ) : activeTokens.length === 0 ? (
        <div className="text-center py-8 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
          <svg
            className="mx-auto h-10 w-10 text-gray-400 dark:text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
            />
          </svg>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {t('apiAccess.noTokens')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeTokens.map((token) => (
            <div
              key={token.id}
              className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {token.name}
                  </p>
                  <code className="text-xs text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded">
                    {token.tokenPrefix}...
                  </code>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  {token.scopes.split(',').map((scope) => (
                    <span
                      key={scope}
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
                    >
                      {scope}
                    </span>
                  ))}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('apiAccess.created', { date: formatDate(new Date(token.createdAt)) })}
                  {' \u00B7 '}
                  {t('apiAccess.lastUsed', { value: relativeOrFormatted(token.lastUsedAt, formatDate, t) })}
                  {token.expiresAt && (
                    <>
                      {' \u00B7 '}
                      {t('apiAccess.expires', { date: formatDate(new Date(token.expiresAt)) })}
                    </>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRevokeTokenId(token.id)}
                className="ml-3 flex-shrink-0"
              >
                {t('apiAccess.revoke')}
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Create Token Modal */}
      <Modal isOpen={showCreateModal} onClose={handleCloseCreateModal}>
        <div className="p-6">
          {createdToken ? (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t('apiAccess.tokenCreated')}
              </h3>
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  {t('apiAccess.copyTokenWarning')}
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={createdToken}
                  className="flex-1 text-sm font-mono bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-gray-900 dark:text-gray-100"
                />
                <Button
                  variant={copied ? 'secondary' : 'primary'}
                  size="sm"
                  onClick={handleCopyToken}
                >
                  {copied ? t('apiAccess.copied') : t('apiAccess.copy')}
                </Button>
              </div>
              <div className="flex justify-end">
                <Button variant="outline" onClick={handleCloseCreateModal}>
                  {t('apiAccess.done')}
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit(handleCreate)} className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t('apiAccess.createApiToken')}
              </h3>
              <Input
                label={t('apiAccess.tokenName')}
                {...register('name')}
                error={tError(errors.name?.message)}
                placeholder={t('apiAccess.tokenNamePlaceholder')}
                maxLength={100}
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('apiAccess.scopes')}
                </label>
                <div className="space-y-2">
                  {SCOPE_OPTIONS.map((scope) => (
                    <label
                      key={scope.value}
                      className="flex items-start gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedScopes.includes(scope.value)}
                        onChange={() => toggleScope(scope.value)}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {t(scope.labelKey)}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {t(scope.descriptionKey)}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('apiAccess.expiration')}
                </label>
                <select
                  {...register('expiryDays')}
                  className="block w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:ring-blue-500"
                >
                  {EXPIRY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" type="button" onClick={handleCloseCreateModal}>
                  {t('apiAccess.cancel')}
                </Button>
                <Button type="submit" disabled={isCreating}>
                  {isCreating ? t('apiAccess.creating') : t('apiAccess.createToken')}
                </Button>
              </div>
            </form>
          )}
        </div>
      </Modal>

      {/* Revoke Confirmation */}
      <ConfirmDialog
        isOpen={!!revokeTokenId}
        title={t('apiAccess.revokeTokenTitle')}
        message={t('apiAccess.revokeTokenMessage')}
        confirmLabel={t('apiAccess.revoke')}
        onConfirm={handleRevoke}
        onCancel={() => setRevokeTokenId(null)}
      />
    </div>
  );
}
