'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { userSettingsApi } from '@/lib/user-settings';
import { usePreferencesStore } from '@/store/preferencesStore';
import { useTheme } from '@/contexts/ThemeContext';
import { UserPreferences, UpdatePreferencesData } from '@/types/auth';
import { getErrorMessage } from '@/lib/errors';
import { exchangeRatesApi, CurrencyInfo } from '@/lib/exchange-rates';
import { investmentsApi } from '@/lib/investments';
import { Combobox } from '@/components/ui/Combobox';
import { DATE_FORMAT_OPTIONS, EXCHANGE_OPTIONS } from '@/lib/constants';
import { LanguageSwitcher } from '@/components/settings/LanguageSwitcher';

const NUMBER_FORMAT_OPTIONS = [
  { value: 'browser', labelKey: 'preferences.numberFormatOptions.browser' },
  { value: 'en-US', labelKey: 'preferences.numberFormatOptions.enUS' },
  { value: 'en-GB', labelKey: 'preferences.numberFormatOptions.enGB' },
  { value: 'de-DE', labelKey: 'preferences.numberFormatOptions.deDE' },
  { value: 'fr-FR', labelKey: 'preferences.numberFormatOptions.frFR' },
];

function getBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const WEEK_STARTS_ON_OPTIONS = [
  { value: '0', labelKey: 'preferences.weekDays.sunday' },
  { value: '1', labelKey: 'preferences.weekDays.monday' },
  { value: '2', labelKey: 'preferences.weekDays.tuesday' },
  { value: '3', labelKey: 'preferences.weekDays.wednesday' },
  { value: '4', labelKey: 'preferences.weekDays.thursday' },
  { value: '5', labelKey: 'preferences.weekDays.friday' },
  { value: '6', labelKey: 'preferences.weekDays.saturday' },
];

const THEME_OPTIONS = [
  { value: 'system', labelKey: 'preferences.themeOptions.system' },
  { value: 'light', labelKey: 'preferences.themeOptions.light' },
  { value: 'dark', labelKey: 'preferences.themeOptions.dark' },
];

const QUOTE_PROVIDER_OPTIONS = [
  { value: 'yahoo', labelKey: 'preferences.quoteProviderOptions.yahoo' },
  { value: 'msn', labelKey: 'preferences.quoteProviderOptions.msn' },
];

const RECENT_TRANSACTIONS_LIMIT_OPTIONS = [
  { value: '3', label: '3' },
  { value: '5', label: '5' },
  { value: '10', label: '10' },
  { value: '15', label: '15' },
  { value: '20', label: '20' },
];

interface PreferencesSectionProps {
  preferences: UserPreferences;
  onPreferencesUpdated: (prefs: UserPreferences) => void;
}

export function PreferencesSection({ preferences, onPreferencesUpdated }: PreferencesSectionProps) {
  const t = useTranslations('settings');
  const updatePreferencesStore = usePreferencesStore((state) => state.updatePreferences);
  const { setTheme: setAppTheme } = useTheme();

  const timezoneOptions = useMemo<{ value: string; label: string }[]>(() => {
    const browserTz = getBrowserTimezone();
    const options: { value: string; label: string }[] = [
      { value: 'browser', label: t('preferences.timezoneOptions.browser', { tz: browserTz }) },
      { value: 'UTC', label: 'UTC' },
    ];
    const allTimezones = Intl.supportedValuesOf('timeZone').filter((tz) => tz !== 'UTC');
    for (const tz of allTimezones) {
      // Format: "America/New_York" -> "America/New York"
      options.push({ value: tz, label: tz.replaceAll('_', ' ') });
    }
    return options;
  }, [t]);

  const numberFormatOptions = useMemo(
    () => NUMBER_FORMAT_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t],
  );
  const weekStartsOnOptions = useMemo(
    () => WEEK_STARTS_ON_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t],
  );
  const themeOptions = useMemo(
    () => THEME_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t],
  );
  const quoteProviderOptions = useMemo(
    () => QUOTE_PROVIDER_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t],
  );
  // Only the "browser" option is prose; the format patterns (YYYY-MM-DD, ...)
  // are universal and left as-is.
  const dateFormatOptions = useMemo(
    () =>
      DATE_FORMAT_OPTIONS.map((o) =>
        o.value === 'browser'
          ? { ...o, label: t('preferences.dateFormatOptions.browser') }
          : o,
      ),
    [t],
  );

  const [dateFormat, setDateFormat] = useState(preferences.dateFormat);
  const [numberFormat, setNumberFormat] = useState(preferences.numberFormat);
  const [timezone, setTimezone] = useState(preferences.timezone);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(preferences.theme);
  const [defaultCurrency, setDefaultCurrency] = useState(preferences.defaultCurrency);
  const [weekStartsOn, setWeekStartsOn] = useState(preferences.weekStartsOn ?? 1);
  const [showCreatedAt, setShowCreatedAt] = useState(preferences.showCreatedAt ?? false);
  const [timeFormat, setTimeFormat] = useState<'24h' | '12h'>(preferences.timeFormat ?? '24h');
  const [preferredExchanges, setPreferredExchanges] = useState<string[]>(
    preferences.preferredExchanges ?? [],
  );
  const [defaultQuoteProvider, setDefaultQuoteProvider] = useState<'yahoo' | 'msn'>(
    preferences.defaultQuoteProvider ?? 'yahoo',
  );
  const [recentTransactionsLimit, setRecentTransactionsLimit] = useState(
    preferences.recentTransactionsLimit ?? 5,
  );
  const [isUpdatingPreferences, setIsUpdatingPreferences] = useState(false);

  const [availableCurrencies, setAvailableCurrencies] = useState<CurrencyInfo[]>([]);
  const [msnReady, setMsnReady] = useState<boolean | null>(null);

  useEffect(() => {
    exchangeRatesApi.getCurrencies().then(setAvailableCurrencies).catch(() => {});
  }, []);

  useEffect(() => {
    investmentsApi
      .getProviderStatus()
      .then((status) => setMsnReady(status.msn.ready))
      .catch(() => setMsnReady(null));
  }, []);

  const currencyOptions = useMemo(() => {
    return availableCurrencies.map((c) => ({
      value: c.code,
      label: `${c.code} - ${c.name}`,
    }));
  }, [availableCurrencies]);

  const handleUpdatePreferences = async () => {
    setIsUpdatingPreferences(true);
    try {
      const data: UpdatePreferencesData = {
        dateFormat,
        numberFormat,
        timezone,
        theme,
        defaultCurrency,
        weekStartsOn,
        showCreatedAt,
        timeFormat,
        preferredExchanges: preferredExchanges.filter(Boolean),
        defaultQuoteProvider,
        recentTransactionsLimit,
      };

      const updated = await userSettingsApi.updatePreferences(data);
      onPreferencesUpdated(updated);
      updatePreferencesStore(updated);
      setAppTheme(theme);
      toast.success(t('preferences.saved'));
    } catch (error) {
      toast.error(getErrorMessage(error, t('preferences.saveError')));
    } finally {
      setIsUpdatingPreferences(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 shadow dark:shadow-gray-700/50 rounded-lg p-6 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{t('preferences.title')}</h2>

      <div className="space-y-4">
        <LanguageSwitcher />

        <Select
          label={t('preferences.theme')}
          options={themeOptions}
          value={theme}
          onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
        />

        <Select
          label={t('preferences.defaultCurrency')}
          options={currencyOptions}
          value={defaultCurrency}
          onChange={(e) => setDefaultCurrency(e.target.value)}
        />

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('preferences.preferredExchanges')}
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            {t('preferences.preferredExchangesHint')}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <Combobox
                key={i}
                options={EXCHANGE_OPTIONS
                  .filter(
                    (opt) =>
                      !preferredExchanges.includes(opt.value) ||
                      preferredExchanges[i] === opt.value,
                  )
                  .sort((a, b) => a.label.localeCompare(b.label))}
                value={preferredExchanges[i] || ''}
                onChange={(value) => {
                  const updated = [...preferredExchanges];
                  if (value) {
                    updated[i] = value;
                  } else {
                    updated.splice(i, 1);
                  }
                  setPreferredExchanges(updated.filter(Boolean));
                }}
                placeholder={t('preferences.priority', { n: i + 1 })}
                alwaysShowSubtitle
              />
            ))}
          </div>
        </div>

        <div>
          <Select
            label={t('preferences.defaultQuoteProvider')}
            options={quoteProviderOptions}
            value={defaultQuoteProvider}
            onChange={(e) => setDefaultQuoteProvider(e.target.value as 'yahoo' | 'msn')}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t('preferences.quoteProviderHint')}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t('preferences.quoteProviderNote')}
          </p>
          {defaultQuoteProvider === 'msn' && msnReady === false && (
            <p
              role="alert"
              className="text-sm text-red-600 dark:text-red-400 mt-2"
              data-testid="msn-not-configured-error"
            >
              {t('preferences.msnNotConfigured')}{' '}
              <code>MSN_API_KEY</code> {t('preferences.msnNotConfiguredSuffix')}
            </p>
          )}
        </div>

        <Select
          label={t('preferences.dateFormat')}
          options={dateFormatOptions}
          value={dateFormat}
          onChange={(e) => setDateFormat(e.target.value)}
        />

        <Select
          label={t('preferences.numberFormat')}
          options={numberFormatOptions}
          value={numberFormat}
          onChange={(e) => setNumberFormat(e.target.value)}
        />

        <Combobox
          label={t('preferences.timezone')}
          options={timezoneOptions}
          value={timezone}
          onChange={(value) => setTimezone(value)}
          placeholder={t('preferences.timezoneSearchPlaceholder')}
        />

        <Select
          label={t('preferences.weekStartsOn')}
          options={weekStartsOnOptions}
          value={String(weekStartsOn)}
          onChange={(e) => setWeekStartsOn(Number(e.target.value))}
        />

        <div className="flex items-center">
          <label
            htmlFor="showCreatedAt"
            className="flex items-center gap-2 cursor-pointer"
          >
            <ToggleSwitch
              checked={showCreatedAt}
              onChange={setShowCreatedAt}
              label={t('preferences.showCreatedAt')}
            />
            <span className="text-sm text-gray-900 dark:text-gray-100">
              {t('preferences.showCreatedAt')}
            </span>
          </label>
          <InfoTooltip text={t('preferences.showCreatedAtTooltip')} />
        </div>

        {showCreatedAt && (
          <Select
            label={t('preferences.timeFormat')}
            options={[
              { value: '24h', label: t('preferences.timeFormatOptions.h24') },
              { value: '12h', label: t('preferences.timeFormatOptions.h12') },
            ]}
            value={timeFormat}
            onChange={(e) => setTimeFormat(e.target.value as '24h' | '12h')}
          />
        )}

        <div>
          <Select
            label={t('preferences.recentTransactions')}
            options={RECENT_TRANSACTIONS_LIMIT_OPTIONS}
            value={String(recentTransactionsLimit)}
            onChange={(e) => setRecentTransactionsLimit(Number(e.target.value))}
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t('preferences.recentTransactionsHint')}
          </p>
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <Button onClick={handleUpdatePreferences} disabled={isUpdatingPreferences}>
          {isUpdatingPreferences ? t('preferences.saving') : t('preferences.save')}
        </Button>
      </div>
    </div>
  );
}
