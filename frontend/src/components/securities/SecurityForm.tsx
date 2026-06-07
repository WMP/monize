'use client';

import { useState, useEffect, useCallback, useMemo, MutableRefObject } from 'react';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import '@/lib/zodConfig';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Combobox } from '@/components/ui/Combobox';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SecurityLookupPicker, LookupCandidate } from './SecurityLookupPicker';
import { Security, CreateSecurityData } from '@/types/investment';
import { investmentsApi } from '@/lib/investments';
import { exchangeRatesApi, CurrencyInfo } from '@/lib/exchange-rates';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { usePreferencesStore } from '@/store/preferencesStore';
import { createLogger } from '@/lib/logger';
import { useFormSubmitRef } from '@/hooks/useFormSubmitRef';
import { useFormDirtyNotify } from '@/hooks/useFormDirtyNotify';
import { FormActions } from '@/components/ui/FormActions';
import { EXCHANGE_OPTIONS } from '@/lib/constants';

const logger = createLogger('SecurityForm');

// Validation messages are resolved at render time via t(...) so the schema can
// be localized. The type below is derived from a base schema with the same shape.
const makeSecuritySchema = (t: ReturnType<typeof useTranslations>) =>
  z.object({
    symbol: z.string().min(1, t('form.validation.symbolRequired')).max(20, t('form.validation.symbolMax')),
    name: z.string().min(1, t('form.validation.nameRequired')).max(255, t('form.validation.nameMax')),
    securityType: z.string().optional(),
    exchange: z.string().optional(),
    currencyCode: z.string().min(1, t('form.validation.currencyRequired')),
    quoteProvider: z.enum(['', 'yahoo', 'msn']).optional(),
    msnInstrumentId: z.string().max(50).optional(),
    isFavourite: z.boolean().optional(),
  });

type SecurityFormData = z.infer<ReturnType<typeof makeSecuritySchema>>;

// Option labels are stored as message keys and resolved at render via t(...).
const quoteProviderOverrideOptions = [
  { value: '', labelKey: 'form.quoteProviderOptions.useDefault' },
  { value: 'yahoo', labelKey: 'form.quoteProviderOptions.yahooFinance' },
  { value: 'msn', labelKey: 'form.quoteProviderOptions.msnMoney' },
];

const lookupProviderOptions = [
  { value: 'auto', labelKey: 'form.lookupProviderOptions.auto' },
  { value: 'yahoo', labelKey: 'form.lookupProviderOptions.yahoo' },
  { value: 'msn', labelKey: 'form.lookupProviderOptions.msn' },
];

interface SecurityFormProps {
  security?: Security;
  onSubmit: (data: CreateSecurityData) => Promise<void>;
  onCancel: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
  submitRef?: MutableRefObject<(() => void) | null>;
}

const securityTypeOptions = [
  { value: '', labelKey: 'form.typeOptions.select' },
  { value: 'STOCK', labelKey: 'form.typeOptions.stock' },
  { value: 'ETF', labelKey: 'form.typeOptions.etf' },
  { value: 'MUTUAL_FUND', labelKey: 'form.typeOptions.mutualFund' },
  { value: 'BOND', labelKey: 'form.typeOptions.bond' },
  { value: 'OPTION', labelKey: 'form.typeOptions.option' },
  { value: 'CRYPTO', labelKey: 'form.typeOptions.crypto' },
  { value: 'OTHER', labelKey: 'form.typeOptions.other' },
];

export function SecurityForm({ security, onSubmit, onCancel, onDirtyChange, submitRef }: SecurityFormProps) {
  const t = useTranslations('securities');
  const securitySchema = useMemo(() => makeSecuritySchema(t), [t]);
  const { defaultCurrency } = useNumberFormat();
  const rawPreferredExchanges = usePreferencesStore((s) => s.preferences?.preferredExchanges);
  const preferredExchanges = useMemo(() => rawPreferredExchanges || [], [rawPreferredExchanges]);
  const userDefaultProvider = usePreferencesStore((s) => s.preferences?.defaultQuoteProvider) ?? 'yahoo';
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [hasLookupResult, setHasLookupResult] = useState(false);
  const [currencies, setCurrencies] = useState<CurrencyInfo[]>([]);
  const [lookupProvider, setLookupProvider] = useState<'auto' | 'yahoo' | 'msn'>('auto');
  const [pickerQuery, setPickerQuery] = useState<string>('');
  const [pickerCandidates, setPickerCandidates] = useState<LookupCandidate[]>([]);
  const [msnReady, setMsnReady] = useState<boolean | null>(null);

  useEffect(() => {
    exchangeRatesApi.getCurrencies().then(setCurrencies).catch(() => {});
  }, []);

  useEffect(() => {
    investmentsApi
      .getProviderStatus()
      .then((status) => setMsnReady(status.msn.ready))
      .catch(() => setMsnReady(null));
  }, []);

  const currencyOptions = useMemo(() => {
    const sorted = [...currencies].sort((a, b) => {
      if (a.code === defaultCurrency) return -1;
      if (b.code === defaultCurrency) return 1;
      return a.code.localeCompare(b.code);
    });
    return sorted.map((c) => ({
      value: c.code,
      label: `${c.code} - ${c.name} (${c.symbol})`,
    }));
  }, [currencies, defaultCurrency]);

  const securityTypeSelectOptions = useMemo(
    () => securityTypeOptions.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t],
  );
  const lookupProviderSelectOptions = useMemo(
    () => lookupProviderOptions.map((o) => ({ value: o.value, label: t(o.labelKey) })),
    [t],
  );

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    watch,
    reset,
    formState: { errors, isSubmitting, isDirty, defaultValues },
  } = useForm<SecurityFormData>({
    resolver: zodResolver(securitySchema),
    defaultValues: {
      symbol: security?.symbol || '',
      name: security?.name || '',
      securityType: security?.securityType || '',
      exchange: security?.exchange || '',
      currencyCode: security?.currencyCode || defaultCurrency,
      quoteProvider: security?.quoteProvider || '',
      msnInstrumentId: security?.msnInstrumentId || '',
      isFavourite: security?.isFavourite || false,
    },
  });

  const isFavourite = watch('isFavourite') ?? false;
  const toggleFavourite = () =>
    setValue('isFavourite', !isFavourite, { shouldDirty: true });

  const applyLookupResult = useCallback(
    (result: LookupCandidate) => {
      const setOpts = { shouldDirty: true, shouldTouch: true, shouldValidate: true };

      setValue('symbol', result.symbol, setOpts);
      setValue('name', result.name, setOpts);
      if (result.exchange) setValue('exchange', result.exchange, setOpts);
      if (result.securityType) setValue('securityType', result.securityType, setOpts);
      if (result.currencyCode) setValue('currencyCode', result.currencyCode, setOpts);

      if (result.provider) {
        const explicit = lookupProvider !== 'auto';
        const differsFromDefault = result.provider !== userDefaultProvider;
        if (explicit || differsFromDefault) {
          setValue('quoteProvider', result.provider, setOpts);
        }
      }

      if (result.msnInstrumentId) {
        setValue('msnInstrumentId', result.msnInstrumentId, setOpts);
      }

      setHasLookupResult(true);

      const details = [
        t('form.toast.detailSymbol', { value: result.symbol }),
        t('form.toast.detailName', { value: result.name }),
      ];
      if (result.exchange) details.push(t('form.toast.detailExchange', { value: result.exchange }));
      if (result.securityType) details.push(t('form.toast.detailType', { value: result.securityType }));
      if (result.currencyCode) details.push(t('form.toast.detailCurrency', { value: result.currencyCode }));
      if (result.provider) details.push(t('form.toast.detailProvider', { value: result.provider === 'msn' ? 'MSN' : 'Yahoo' }));
      toast.success(t('form.toast.foundDetails', { details: details.join(', ') }));
    },
    [setValue, lookupProvider, userDefaultProvider, t],
  );

  const handleLookup = useCallback(async () => {
    const { symbol, name, exchange: currentExchange } = getValues();
    const query = (symbol?.trim() || name?.trim() || '');
    if (query.length < 2) {
      toast.error(t('form.toast.enterQuery'));
      return;
    }

    const exchanges = currentExchange
      ? [currentExchange, ...preferredExchanges.filter((e) => e !== currentExchange)]
      : preferredExchanges.length > 0
        ? preferredExchanges
        : undefined;

    setIsLookingUp(true);
    try {
      const candidates = await investmentsApi.lookupSecurityCandidates(
        query,
        exchanges,
        lookupProvider,
      );
      if (candidates.length === 0) {
        toast.error(t('form.toast.noSecurityFound', { query }));
      } else if (candidates.length === 1) {
        applyLookupResult(candidates[0]);
      } else {
        setPickerQuery(query);
        setPickerCandidates(candidates);
      }
    } catch (error) {
      logger.error('Security lookup failed:', error);
      toast.error(t('form.toast.lookupFailed'));
    } finally {
      setIsLookingUp(false);
    }
  }, [getValues, preferredExchanges, lookupProvider, applyLookupResult, t]);

  // In edit mode, revert to the original security values. In create mode,
  // blank everything out (keeping the user's default currency).
  const handleClear = useCallback(() => {
    if (security) {
      reset();
    } else {
      reset({
        symbol: '',
        name: '',
        securityType: '',
        exchange: '',
        currencyCode: defaultValues?.currencyCode || defaultCurrency,
        quoteProvider: '',
        msnInstrumentId: '',
        isFavourite: false,
      });
    }
    setHasLookupResult(false);
  }, [reset, defaultValues, defaultCurrency, security]);

  const onFormSubmit = async (data: SecurityFormData) => {
    const cleanedData: CreateSecurityData = {
      symbol: data.symbol.toUpperCase().trim(),
      name: data.name.trim(),
      securityType: data.securityType || undefined,
      exchange: data.exchange?.trim() || undefined,
      currencyCode: data.currencyCode,
      // Send null (not undefined) when the user picks "Use Default" so the
      // backend clears any existing override. Undefined would be stripped by
      // axios and treated as "no change", leaving the previous override in place.
      quoteProvider: data.quoteProvider === '' ? null : data.quoteProvider,
      msnInstrumentId: data.msnInstrumentId?.trim() || undefined,
      isFavourite: data.isFavourite ?? false,
    };
    await onSubmit(cleanedData);
  };

  useFormDirtyNotify(isDirty, onDirtyChange);

  useFormSubmitRef(submitRef, handleSubmit, onFormSubmit);

  return (
    <>
    <SecurityLookupPicker
      isOpen={pickerCandidates.length > 0}
      query={pickerQuery}
      candidates={pickerCandidates}
      onPick={(c) => {
        applyLookupResult(c);
        setPickerCandidates([]);
        setPickerQuery('');
      }}
      onCancel={() => {
        setPickerCandidates([]);
        setPickerQuery('');
      }}
    />
    <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4">
      {/* Symbol + Lookup / Clear buttons */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Input
            label={t('form.symbol')}
            {...register('symbol')}
            error={errors.symbol?.message}
            placeholder={t('form.symbolPlaceholder')}
            className="uppercase"
          />
        </div>
        <div className="flex gap-1.5">
          <Select
            aria-label={t('form.lookupProvider')}
            options={lookupProviderSelectOptions}
            value={lookupProvider}
            onChange={(e) =>
              setLookupProvider(e.target.value as 'auto' | 'yahoo' | 'msn')
            }
            className="mb-[1px] w-24"
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleLookup}
            disabled={isLookingUp}
            className="mb-[1px] relative"
          >
            <span className={isLookingUp ? 'invisible' : ''}>{t('form.lookup')}</span>
            {isLookingUp && (
              <span className="absolute inset-0 flex items-center justify-center">
                <LoadingSpinner size="sm" fullContainer={false} />
              </span>
            )}
          </Button>
          {hasLookupResult && (
            <Button
              type="button"
              variant="ghost"
              onClick={handleClear}
              className="mb-[1px] text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              title={security ? t('form.revertTitle') : t('form.clearTitle')}
            >
              {security ? t('form.revert') : t('form.clear')}
            </Button>
          )}
        </div>
      </div>

      <Input
        label={t('form.name')}
        {...register('name')}
        error={errors.name?.message}
        placeholder={t('form.namePlaceholder')}
      />

      <Select
        label={t('form.type')}
        options={securityTypeSelectOptions}
        value={watch('securityType') || ''}
        onChange={(e) => setValue('securityType', e.target.value, { shouldDirty: true })}
        error={errors.securityType?.message}
      />

      <Combobox
        label={t('form.exchange')}
        options={EXCHANGE_OPTIONS}
        value={watch('exchange') || ''}
        onChange={(value, label) => setValue('exchange', value || label, { shouldDirty: true })}
        error={errors.exchange?.message}
        placeholder={t('form.exchangePlaceholder')}
        allowCustomValue
        usePortal
        alwaysShowSubtitle
        priorityValues={preferredExchanges}
      />

      <Select
        label={t('form.currency')}
        options={currencyOptions}
        {...register('currencyCode')}
        error={errors.currencyCode?.message}
      />

      <div>
        <Select
          label={t('form.quoteProvider')}
          options={[
            { value: '', label: t('form.useDefaultProvider', { provider: userDefaultProvider === 'msn' ? t('form.providerMsn') : t('form.providerYahoo') }) },
            ...quoteProviderOverrideOptions.slice(1).map((o) => ({ value: o.value, label: t(o.labelKey) })),
          ]}
          value={watch('quoteProvider') || ''}
          onChange={(e) =>
            setValue('quoteProvider', (e.target.value as 'yahoo' | 'msn' | ''), {
              shouldDirty: true,
            })
          }
          error={errors.quoteProvider?.message}
        />
        {watch('quoteProvider') === 'msn' && msnReady === false && (
          <p
            role="alert"
            className="text-sm text-red-600 dark:text-red-400 mt-2"
            data-testid="msn-not-configured-error"
          >
            {t('form.msnNotConfigured')}
            <code>MSN_API_KEY</code>{t('form.msnNotConfiguredSuffix')}
          </p>
        )}
      </div>

      {watch('quoteProvider') === 'msn' && (
        <Input
          label={t('form.msnInstrumentId')}
          {...register('msnInstrumentId')}
          error={errors.msnInstrumentId?.message}
          placeholder={t('form.msnInstrumentIdPlaceholder')}
        />
      )}

      {/* Favourite star toggle */}
      <button
        type="button"
        onClick={toggleFavourite}
        className="flex items-center gap-2 px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        title={isFavourite ? t('form.removeFromFavourites') : t('form.addToFavourites')}
        aria-pressed={isFavourite}
      >
        <svg
          className={`w-5 h-5 transition-colors ${
            isFavourite ? 'text-yellow-500 fill-current' : 'text-gray-400 dark:text-gray-500'
          }`}
          fill={isFavourite ? 'currentColor' : 'none'}
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
          />
        </svg>
        <span className="text-sm text-gray-700 dark:text-gray-300">
          {isFavourite ? t('form.favourite') : t('form.addToFavourites')}
        </span>
      </button>

      <FormActions onCancel={onCancel} submitLabel={security ? t('form.updateSecurity') : t('form.createSecurity')} isSubmitting={isSubmitting} />
    </form>
    </>
  );
}
