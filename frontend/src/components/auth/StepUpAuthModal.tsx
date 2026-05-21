'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import '@/lib/zodConfig';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import apiClient from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { usePreferencesStore } from '@/store/preferencesStore';
import { useStepUpTokenStore } from '@/lib/stepUpToken';
import { getErrorMessage } from '@/lib/errors';

interface StepUpAuthModalProps {
  isOpen: boolean;
  purpose: string;
  /** Optional headline shown in the modal (e.g. "View your emergency message"). */
  reason?: string;
  onClose: () => void;
  /** Called after the token is stored in the in-memory step-up store. */
  onVerified?: () => void;
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
  reason,
  onClose,
  onVerified,
}: StepUpAuthModalProps) {
  const user = useAuthStore((s) => s.user);
  const preferences = usePreferencesStore((s) => s.preferences);
  const setStepUp = useStepUpTokenStore((s) => s.set);

  const twoFactorEnabled = !!preferences?.twoFactorEnabled;
  const mode: 'totp' | 'password' | 'unavailable' = twoFactorEnabled
    ? 'totp'
    : user?.authProvider === 'local' && user?.hasPassword
      ? 'password'
      : 'unavailable';

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
      toast.success('Verified');
      onVerified?.();
      onClose();
    } catch (error) {
      setServerError(getErrorMessage(error, 'Verification failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="md" pushHistory>
      <div className="flex flex-col">
        <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Confirm it&apos;s you
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
              This action requires extra verification. Your account doesn&apos;t
              have a password or two-factor authentication enabled, so we
              can&apos;t challenge you securely. Enable two-factor
              authentication in the Security section to unlock this setting.
            </p>
            <div className="flex justify-end">
              <Button variant="outline" onClick={onClose}>
                Close
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
                Enter the 6-digit code from your authenticator app.
              </p>
              <Input
                label="Authenticator code"
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
                Cancel
              </Button>
              <Button type="submit" isLoading={submitting}>
                Verify
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
                Enter your current account password to continue.
              </p>
              <Input
                label="Password"
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
                Cancel
              </Button>
              <Button type="submit" isLoading={submitting}>
                Verify
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
