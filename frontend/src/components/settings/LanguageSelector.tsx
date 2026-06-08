'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import toast from 'react-hot-toast';
import { Select } from '@/components/ui/Select';
import { userSettingsApi } from '@/lib/user-settings';
import { usePreferencesStore } from '@/store/preferencesStore';
import { getErrorMessage } from '@/lib/errors';
import { LOCALE_COOKIE, SUPPORTED_LOCALES } from '@/i18n/config';

interface LanguageSelectorProps {
  value: string;
  onChange: (language: string) => void;
}

export function LanguageSelector({ value, onChange }: LanguageSelectorProps) {
  const t = useTranslations('settings.language');
  const router = useRouter();
  const [isSaving, startTransition] = useTransition();
  const updatePreferencesStore = usePreferencesStore((state) => state.updatePreferences);

  const options = SUPPORTED_LOCALES.map((l) => ({
    value: l.code,
    label: l.label,
  }));

  const handleChange = (next: string) => {
    onChange(next);
    Cookies.set(LOCALE_COOKIE, next, { sameSite: 'lax', expires: 365 });

    startTransition(async () => {
      try {
        const updated = await userSettingsApi.updatePreferences({ language: next });
        updatePreferencesStore(updated);
        toast.success(t('saved'));
        router.refresh();
      } catch (error) {
        toast.error(getErrorMessage(error, 'Failed to save language'));
      }
    });
  };

  return (
    <div>
      <Select
        label={t('label')}
        options={options}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        disabled={isSaving}
      />
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t('helpText')}</p>
    </div>
  );
}
