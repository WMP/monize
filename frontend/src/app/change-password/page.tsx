'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import '@/lib/zodConfig';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import Image from 'next/image';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/authStore';
import { userSettingsApi } from '@/lib/user-settings';
import { authApi } from '@/lib/auth';
import { getErrorMessage } from '@/lib/errors';
import { passwordSchema, PASSWORD_REQUIREMENTS_TEXT } from '@/lib/zod-helpers';

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

type ChangePasswordFormData = z.infer<typeof changePasswordSchema>;

export default function ChangePasswordPage() {
  const t = useTranslations('auth');
  const router = useRouter();
  const { user, setUser } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ChangePasswordFormData>({
    resolver: zodResolver(changePasswordSchema),
  });

  const onSubmit = async (data: ChangePasswordFormData) => {
    setIsLoading(true);
    try {
      await userSettingsApi.changePassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });

      // Refresh user profile to get updated mustChangePassword: false
      const updatedUser = await authApi.getProfile();
      setUser(updatedUser);

      toast.success(t('changePassword.passwordChanged'));
      router.push('/dashboard');
    } catch (error) {
      toast.error(getErrorMessage(error, t('changePassword.changeFailed')));
    } finally {
      setIsLoading(false);
    }
  };

  // If the user doesn't need to change password, redirect to dashboard
  useEffect(() => {
    if (user && !user.mustChangePassword) {
      router.push('/dashboard');
    }
  }, [user, router]);

  if (user && !user.mustChangePassword) {
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <Image src="/icons/monize-logo.svg" alt={t('common.monizeLogoAlt')} width={96} height={96} className="mx-auto rounded-xl" priority />
          <h2 className="mt-4 text-center text-3xl font-extrabold text-gray-900 dark:text-gray-100">
            {t('changePassword.changeYourPassword')}
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
            {t('changePassword.intro')}
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-4">
            <Input
              label={t('changePassword.currentPasswordLabel')}
              type="password"
              autoComplete="current-password"
              error={errors.currentPassword?.message}
              {...register('currentPassword')}
            />

            <Input
              label={t('changePassword.newPasswordLabel')}
              type="password"
              autoComplete="new-password"
              error={errors.newPassword?.message}
              {...register('newPassword')}
            />

            <Input
              label={t('changePassword.confirmPasswordLabel')}
              type="password"
              autoComplete="new-password"
              error={errors.confirmPassword?.message}
              {...register('confirmPassword')}
            />
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            {PASSWORD_REQUIREMENTS_TEXT}
          </p>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            isLoading={isLoading}
            className="w-full"
          >
            {t('changePassword.changePassword')}
          </Button>
        </form>
      </div>
    </div>
  );
}
