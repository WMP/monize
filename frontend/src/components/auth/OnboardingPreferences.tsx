'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import toast from 'react-hot-toast';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { userSettingsApi } from '@/lib/user-settings';
import { exchangeRatesApi, CurrencyInfo } from '@/lib/exchange-rates';
import { usePreferencesStore } from '@/store/preferencesStore';
import { LOCALE_COOKIE, SUPPORTED_LOCALES } from '@/i18n/config';
import { getErrorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/logger';

const logger = createLogger('OnboardingPreferences');

interface OnboardingPreferencesProps {
  /** Initial language (e.g. the locale resolved for the page). */
  initialLanguage?: string;
  /** Called once the user saves or skips, to continue the sign-up flow. */
  onComplete: () => void;
}

/**
 * Post-registration step prompting the user to pick their language and default
 * currency. Both are saved in a single preferences update; the user can skip to
 * keep the defaults (English / USD).
 */
export function OnboardingPreferences({
  initialLanguage = 'en',
  onComplete,
}: OnboardingPreferencesProps) {
  const t = useTranslations('auth.register.preferences');
  const router = useRouter();
  const updatePreferencesStore = usePreferencesStore((s) => s.updatePreferences);

  const [language, setLanguage] = useState(initialLanguage);
  const [defaultCurrency, setDefaultCurrency] = useState('USD');
  const [currencies, setCurrencies] = useState<CurrencyInfo[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    exchangeRatesApi
      .getCurrencies()
      .then(setCurrencies)
      .catch((error) => logger.error(error));
  }, []);

  const languageOptions = useMemo(
    () => SUPPORTED_LOCALES.map((l) => ({ value: l.code, label: l.label })),
    [],
  );

  const currencyOptions = useMemo(
    () =>
      currencies.map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` })),
    [currencies],
  );

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const updated = await userSettingsApi.updatePreferences({
        language,
        defaultCurrency,
      });
      updatePreferencesStore(updated);
      Cookies.set(LOCALE_COOKIE, language, { sameSite: 'lax', expires: 365 });
      // Invalidate the router cache so the layout re-renders with the new
      // locale's catalogs. PreferencesLoader skips its own refresh because
      // the cookie already matches the saved preference by this point, and
      // the navigation in onComplete() alone reuses the cached layout.
      router.refresh();
      onComplete();
    } catch (error) {
      toast.error(getErrorMessage(error, t('saveFailed')));
      logger.error(error);
      setIsSaving(false);
    }
  }, [language, defaultCurrency, updatePreferencesStore, onComplete, router, t]);

  return (
    <div className="space-y-6">
      <Select
        label={t('languageLabel')}
        options={languageOptions}
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
        disabled={isSaving}
      />
      <Select
        label={t('currencyLabel')}
        options={currencyOptions}
        value={defaultCurrency}
        onChange={(e) => setDefaultCurrency(e.target.value)}
        disabled={isSaving || currencyOptions.length === 0}
      />
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onComplete}
          disabled={isSaving}
          className="text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-50"
        >
          {t('skip')}
        </button>
        <Button onClick={handleSave} isLoading={isSaving}>
          {t('continue')}
        </Button>
      </div>
    </div>
  );
}
