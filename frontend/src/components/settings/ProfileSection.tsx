'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import '@/lib/zodConfig';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { userSettingsApi } from '@/lib/user-settings';
import { useAuthStore } from '@/store/authStore';
import { User, UpdateProfileData } from '@/types/auth';
import { getErrorMessage } from '@/lib/errors';

const profileSchema = z.object({
  firstName: z
    .string()
    .max(100, 'First name must be 100 characters or less')
    .optional()
    .or(z.literal('')),
  lastName: z
    .string()
    .max(100, 'Last name must be 100 characters or less')
    .optional()
    .or(z.literal('')),
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Please enter a valid email address')
    .max(254, 'Email must be 254 characters or less'),
  currentPassword: z
    .string()
    .max(128, 'Password must be 128 characters or less')
    .optional()
    .or(z.literal('')),
});

type ProfileFormData = z.infer<typeof profileSchema>;

const VALIDATION_KEYS: Record<string, string> = {
  'First name must be 100 characters or less': 'profile.validation.firstNameMax',
  'Last name must be 100 characters or less': 'profile.validation.lastNameMax',
  'Email is required': 'profile.validation.emailRequired',
  'Please enter a valid email address': 'profile.validation.emailInvalid',
  'Email must be 254 characters or less': 'profile.validation.emailMax',
  'Password must be 128 characters or less': 'profile.validation.passwordMax',
};

interface ProfileSectionProps {
  user: User;
  onUserUpdated: (user: User) => void;
}

export function ProfileSection({ user, onUserUpdated }: ProfileSectionProps) {
  const t = useTranslations('settings');
  const { setUser } = useAuthStore();
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  const tError = (msg?: string) =>
    msg ? (VALIDATION_KEYS[msg] ? t(VALIDATION_KEYS[msg]) : msg) : msg;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email,
      currentPassword: '',
    },
  });

  const watchedEmail = watch('email');
  const isEmailChanged = watchedEmail !== user.email;

  const onSubmit = async (formData: ProfileFormData) => {
    setIsUpdatingProfile(true);
    try {
      const data: UpdateProfileData = {};
      if (formData.firstName !== (user.firstName || '')) data.firstName = formData.firstName;
      if (formData.lastName !== (user.lastName || '')) data.lastName = formData.lastName;
      if (isEmailChanged) {
        if (!formData.currentPassword) {
          toast.error(t('profile.passwordRequiredForEmail'));
          return;
        }
        data.email = formData.email;
        data.currentPassword = formData.currentPassword;
      }

      if (Object.keys(data).length === 0) {
        toast.error(t('profile.noChanges'));
        return;
      }

      const updatedUser = await userSettingsApi.updateProfile(data);
      onUserUpdated(updatedUser);
      setUser(updatedUser);
      setValue('currentPassword', '');
      toast.success(t('profile.updated'));
    } catch (error) {
      toast.error(getErrorMessage(error, t('profile.updateError')));
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 shadow dark:shadow-gray-700/50 rounded-lg p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{t('profile.title')}</h2>
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label={t('profile.firstName')}
            {...register('firstName')}
            error={tError(errors.firstName?.message)}
            placeholder={t('profile.firstNamePlaceholder')}
          />
          <Input
            label={t('profile.lastName')}
            {...register('lastName')}
            error={tError(errors.lastName?.message)}
            placeholder={t('profile.lastNamePlaceholder')}
          />
        </div>
        <div className="mt-4">
          <Input
            label={t('profile.email')}
            type="email"
            {...register('email')}
            error={tError(errors.email?.message)}
            placeholder={t('profile.emailPlaceholder')}
          />
        </div>
        {isEmailChanged && (
          <div className="mt-4">
            <Input
              label={t('profile.currentPassword')}
              type="password"
              {...register('currentPassword')}
              error={tError(errors.currentPassword?.message)}
              placeholder={t('profile.currentPasswordPlaceholder')}
            />
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t('profile.emailConfirmHint')}
            </p>
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <Button type="submit" disabled={isUpdatingProfile}>
            {isUpdatingProfile ? t('profile.saving') : t('profile.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
