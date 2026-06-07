'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import '@/lib/zodConfig';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import apiClient from '@/lib/api';
import { authApi } from '@/lib/auth';
import { usePreferencesStore } from '@/store/preferencesStore';
import {
  useStepUpTokenStore,
  stashOidcStepUpPending,
} from '@/lib/stepUpToken';
import { getErrorMessage } from '@/lib/errors';

interface StepUpAuthModalProps {
  isOpen: boolean;
  purpose: string;
  /**
   * Auth provider for the caller's account. REQUIRED -- the auth store's
   * cached user is hydrated from /auth/profile which (today) omits this
   * field, so callers must source it from /auth/me-self (`authApi.getSelfProfile`)
   * or another full-user endpoint before opening the modal.
   */
  authProvider: 'local' | 'oidc';
  /**
   * Whether the user has a local password set. Same caveat as
   * `authProvider` -- pass the value from a full-user fetch.
   */
  hasPassword: boolean;
  /** Optional headline shown in the modal (e.g. "View your emergency message"). */
  reason?: string;
  onClose: () => void;
  /** Called after the token is stored in the in-memory step-up store. */
  onVerified?: () => void;
  /**
   * Path the user should return to after the OIDC roundtrip, and an
   * opaque caller-controlled payload that survives the redirect (e.g. which
   * mode -- 'view' or 'edit' -- to resume in).
   */
  oidcReturnTo?: string;
  oidcResumePayload?: Record<string, unknown>;
}

const passwordSchema = z.object({
  password: z
    .string()
    .min(1, 'Password is required')
    .max(256, 'Password is too long'),
});

const totpSchema = z.object({
  totpCode: z
    .string()
    .length(6, 'Code must be exactly 6 digits')
    .regex(/^\d{6}$/, 'Code must be 6 digits'),
});

type PasswordForm = z.infer<typeof passwordSchema>;
type TotpForm = z.infer<typeof totpSchema>;

/**
 * Prompt the user to re-prove possession of the account before unlocking a
 * sensitive surface. Picks the strongest factor available:
 *   - 2FA enabled  -> TOTP code
 *   - local user without 2FA -> password
 *   - OIDC user without 2FA -> message asking them to enable 2FA first
 */
export function StepUpAuthModal({
  isOpen,
  purpose,
  authProvider,
  hasPassword,
  reason,
  onClose,
  onVerified,
  oidcReturnTo,
  oidcResumePayload,
}: StepUpAuthModalProps) {
  const t = useTranslations('auth');
  const preferences = usePreferencesStore((s) => s.preferences);
  const setStepUp = useStepUpTokenStore((s) => s.set);

  const twoFactorEnabled = !!preferences?.twoFactorEnabled;
  const mode: 'totp' | 'password' | 'oidc' | 'unavailable' = twoFactorEnabled
    ? 'totp'
    : authProvider === 'oidc'
      ? 'oidc'
      : authProvider === 'local' && hasPassword
        ? 'password'
        : 'unavailable';

  const handleOidcReauth = () => {
    // Stash the resume payload + the return-to path so the page can finalize
    // the step-up after the IdP roundtrip. Then redirect.
    stashOidcStepUpPending({
      purpose,
      returnTo: oidcReturnTo,
      payload: oidcResumePayload,
    });
    authApi.initiateOidc();
  };

  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: '' },
  });
  const totpForm = useForm<TotpForm>({
    resolver: zodResolver(totpSchema),
    defaultValues: { totpCode: '' },
  });
  const totpRef = totpForm.register('totpCode');

  useEffect(() => {
    if (!isOpen) {
      passwordForm.reset({ password: '' });
      totpForm.reset({ totpCode: '' });
      setServerError(null);
      setSubmitting(false);
    }
  }, [isOpen, passwordForm, totpForm]);

  const submit = async (body: { password?: string; totpCode?: string }) => {
    setSubmitting(true);
    setServerError(null);
    try {
      const res = await apiClient.post<{
        stepUpToken: string;
        expiresAt: string;
      }>('/auth/step-up', { purpose, ...body });
      setStepUp(purpose, res.data.stepUpToken, res.data.expiresAt);
      toast.success(t('stepUp.verified'));
      onVerified?.();
      onClose();
    } catch (error) {
      setServerError(getErrorMessage(error, t('stepUp.verificationFailed')));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="md" pushHistory>
      <div className="flex flex-col">
        <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('stepUp.confirmItsYou')}
          </h2>
          {reason && (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
              {reason}
            </p>
          )}
        </div>

        {mode === 'unavailable' ? (
          <div className="px-6 py-6 space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {t('stepUp.unavailableBody')}
            </p>
            <div className="flex justify-end">
              <Button variant="outline" onClick={onClose}>
                {t('stepUp.close')}
              </Button>
            </div>
          </div>
        ) : mode === 'oidc' ? (
          <div className="px-6 py-6 space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {t('stepUp.oidcBody')}
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={onClose}>
                {t('stepUp.cancel')}
              </Button>
              <Button onClick={handleOidcReauth}>
                {t('stepUp.continueToIdp')}
              </Button>
            </div>
          </div>
        ) : mode === 'totp' ? (
          <form
            onSubmit={totpForm.handleSubmit((data) =>
              submit({ totpCode: data.totpCode }),
            )}
            className="flex flex-col"
          >
            <div className="px-6 py-4 space-y-4">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {t('stepUp.totpPrompt')}
              </p>
              <Input
                label={t('stepUp.authenticatorCodeLabel')}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                autoFocus
                error={totpForm.formState.errors.totpCode?.message}
                {...totpRef}
                onChange={(e) => {
                  const filtered = e.target.value.replace(/\D/g, '');
                  e.target.value = filtered;
                  totpRef.onChange(e);
                }}
              />
              {serverError && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {serverError}
                </p>
              )}
            </div>
            <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={submitting}
              >
                {t('stepUp.cancel')}
              </Button>
              <Button type="submit" isLoading={submitting}>
                {t('stepUp.verify')}
              </Button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={passwordForm.handleSubmit((data) =>
              submit({ password: data.password }),
            )}
            className="flex flex-col"
          >
            <div className="px-6 py-4 space-y-4">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                {t('stepUp.passwordPrompt')}
              </p>
              <Input
                label={t('stepUp.passwordLabel')}
                type="password"
                autoComplete="current-password"
                autoFocus
                error={passwordForm.formState.errors.password?.message}
                {...passwordForm.register('password')}
              />
              {serverError && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {serverError}
                </p>
              )}
            </div>
            <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={submitting}
              >
                {t('stepUp.cancel')}
              </Button>
              <Button type="submit" isLoading={submitting}>
                {t('stepUp.verify')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
