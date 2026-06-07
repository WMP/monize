'use client';

import { useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Select } from '@/components/ui/Select';
import { setLocale } from '@/i18n/actions';
import { locales, localeNames, type Locale } from '@/i18n/config';

/**
 * Language selector. Writes the chosen locale to the NEXT_LOCALE cookie via a
 * server action, then refreshes so server components re-render with the new
 * messages. The choice persists across sessions via the cookie.
 */
export function LanguageSwitcher() {
  const t = useTranslations('settings');
  const activeLocale = useLocale() as Locale;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const options = locales.map((locale) => ({
    value: locale,
    label: localeNames[locale],
  }));

  const handleChange = (value: string) => {
    const next = value as Locale;
    if (next === activeLocale) return;
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
      toast.success(t('language.updated'));
    });
  };

  return (
    <Select
      label={t('language.label')}
      value={activeLocale}
      onChange={(e) => handleChange(e.target.value)}
      options={options}
      disabled={isPending}
    />
  );
}
