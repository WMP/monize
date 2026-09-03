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
import { MultiSelect } from '@/components/ui/MultiSelect';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SecurityLookupPicker, LookupCandidate } from './SecurityLookupPicker';
import { AllocationEditor, AllocationRow } from './AllocationEditor';
import { TagForm } from '@/components/tags/TagForm';
import { Security, CreateSecurityData } from '@/types/investment';
import { Tag } from '@/types/tag';
import { tagsApi } from '@/lib/tags';
import { investmentsApi } from '@/lib/investments';
import { exchangeRatesApi, CurrencyInfo } from '@/lib/exchange-rates';
import { useNumberFormat } from '@/hooks/useNumberFormat';
import { usePreferencesStore } from '@/store/preferencesStore';
import { createLogger } from '@/lib/logger';
import { useFormSubmitRef } from '@/hooks/useFormSubmitRef';
import { useFormDirtyNotify } from '@/hooks/useFormDirtyNotify';
import { FormActions } from '@/components/ui/FormActions';
import { EXCHANGE_OPTIONS, COUNTRY_OPTIONS } from '@/lib/constants';

// Map stored weightings (decimal 0-1) to editor rows (percentage strings).
const toAllocationRows = (
  weightings: { name: string; weight: number }[] | null | undefined,
): AllocationRow[] =>
  (weightings ?? [])
    // An "Other" bucket isn't a real slice: don't surface it as a row --
    // it's folded into the editor's computed (100 - total) "Other" remainder.
    .filter((w) => (w.name ?? '').trim().toLowerCase() !== 'other')
    .map((w) => ({
      name: w.name,
      weight: String(Math.round(w.weight * 1000000) / 10000),
    }));

// Editor rows -> API slices: trim names, drop blank/zero rows. Weights stay in
// percentage units here; the caller converts to the stored decimal 0-1 form.
const toAllocationSlices = (rows: AllocationRow[]) =>
  rows
    .map((row) => ({ name: row.name.trim(), weight: parseFloat(row.weight) }))
    .filter(
      (row) => row.name !== '' && Number.isFinite(row.weight) && row.weight > 0,
    );

const logger = createLogger('SecurityForm');

const buildSecuritySchema = (t: (key: string) => string) => z.object({
  symbol: z.string().min(1, t('validation.symbolRequired')).max(20, t('validation.symbolMax')),
  name: z.string().min(1, t('validation.nameRequired')).max(255, t('validation.nameMax')),
  securityType: z.string().optional(),
  exchange: z.string().optional(),
  currencyCode: z.string().min(1, t('validation.currencyRequired')),
  description: z.string().max(5000, t('validation.descriptionMax')).optional(),
  website: z.string().max(2048).optional(),
  irWebsite: z.string().max(2048).optional(),
  quoteProvider: z.enum(['', 'yahoo', 'msn']).optional(),
  msnInstrumentId: z.string().max(50).optional(),
  isFavourite: z.boolean().optional(),
  // 'auto_disabled' is carried through so an auto-paused security keeps its state
  // when the user saves an unrelated edit; only 'active'/'disabled' are ever sent.
  priceFetchStatus: z.enum(['active', 'auto_disabled', 'disabled']).optional(),
});

type SecurityFormData = z.infer<ReturnType<typeof buildSecuritySchema>>;

const quoteProviderOverrideOptions = [
  { value: '', label: 'Use default' },
  { value: 'yahoo', label: 'Yahoo Finance' },
  { value: 'msn', label: 'MSN Money' },
];

const lookupProviderOptions = [
  { value: 'auto', labelKey: 'form.providers.auto' },
  { value: 'yahoo', labelKey: 'form.providers.yahoo' },
  { value: 'msn', labelKey: 'form.providers.msn' },
];

interface SecurityFormProps {
  security?: Security;
  /**
   * Starting values for a *new* security, so a caller that already knows which
   * fund is wanted can open the form filled in. Ignored in edit mode, where
   * `security` supplies the values. Every prefilled field stays editable: a
   * suggested listing names one exchange and currency, and the investor's
   * broker may trade a different one.
   */
  defaults?: Partial<CreateSecurityData>;
  onSubmit: (data: CreateSecurityData) => Promise<void>;
  onCancel: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
  submitRef?: MutableRefObject<(() => void) | null>;
}

const securityTypeOptions = [
  { value: '', labelKey: 'form.types.select' },
  { value: 'STOCK', labelKey: 'form.types.stock' },
  { value: 'ETF', labelKey: 'form.types.etf' },
  { value: 'MUTUAL_FUND', labelKey: 'form.types.mutualFund' },
  { value: 'BOND', labelKey: 'form.types.bond' },
  { value: 'OPTION', labelKey: 'form.types.option' },
  { value: 'CRYPTO', labelKey: 'form.types.crypto' },
  { value: 'OTHER', labelKey: 'form.types.other' },
];

export function SecurityForm({ security, defaults, onSubmit, onCancel, onDirtyChange, submitRef }: SecurityFormProps) {
  const t = useTranslations('securities');
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
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(
    security?.tags?.map((tag) => tag.id) || [],
  );
  const [countryRows, setCountryRows] = useState<AllocationRow[]>(
    toAllocationRows(security?.countryWeightings),
  );
  // Canonical countries plus the user's custom ones, base-currency country
  // first. Seeded with the static list so the picker works before the fetch.
  const [countryNames, setCountryNames] = useState<string[]>(
    COUNTRY_OPTIONS.map((o) => o.value),
  );
  const [assetRows, setAssetRows] = useState<AllocationRow[]>(
    toAllocationRows(security?.assetWeightings),
  );
  // Asset classes are free text with no canonical list: the picker offers only
  // what this user has already saved, so it starts from the security's own rows
  // until the fetch lands.
  const [assetNames, setAssetNames] = useState<string[]>(() =>
    toAllocationRows(security?.assetWeightings).map((row) => row.name),
  );
  // Asset class the user asked to delete from the list, pending confirmation.
  const [assetToDelete, setAssetToDelete] = useState<string | null>(null);
  const [showTagForm, setShowTagForm] = useState(false);

  useEffect(() => {
    exchangeRatesApi.getCurrencies().then(setCurrencies).catch(() => {});
  }, []);

  useEffect(() => {
    investmentsApi
      .getCountryOptions()
      .then(setCountryNames)
      .catch(() => {});
  }, []);

  useEffect(() => {
    investmentsApi
      .getAssetOptions()
      .then(setAssetNames)
      .catch(() => {});
  }, []);

  const countryOptions = useMemo(
    () => countryNames.map((name) => ({ value: name, label: name })),
    [countryNames],
  );

  // The names on this security's own rows may not be saved yet, so merge them
  // into the fetched list (case-insensitively) rather than losing them.
  const assetOptions = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const name of [...assetNames, ...assetRows.map((row) => row.name)]) {
      const trimmed = name.trim();
      if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
      seen.add(trimmed.toLowerCase());
      names.push(trimmed);
    }
    return names
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ value: name, label: name }));
  }, [assetNames, assetRows]);

  useEffect(() => {
    tagsApi.getAll().then(setTags).catch(() => {});
  }, []);

  const tagOptions = useMemo(
    () =>
      [...tags]
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
        )
        .map((tag) => ({ value: tag.id, label: tag.name })),
    [tags],
  );

  useEffect(() => {
    investmentsApi
      .getProviderStatus()
      .then((status) => setMsnReady(status.msn.ready))
      .catch(() => setMsnReady(null));
  }, []);


  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    watch,
    reset,
    formState: { errors, isSubmitting, isDirty, defaultValues },
  } = useForm<SecurityFormData>({
    resolver: zodResolver(buildSecuritySchema(t)),
    defaultValues: {
      symbol: security?.symbol || defaults?.symbol || '',
      name: security?.name || defaults?.name || '',
      securityType: security?.securityType || defaults?.securityType || '',
      exchange: security?.exchange || defaults?.exchange || '',
      currencyCode: security?.currencyCode || defaults?.currencyCode || defaultCurrency,
      description: security?.description || '',
      website: security?.website || '',
      irWebsite: security?.irWebsite || '',
      quoteProvider: security?.quoteProvider || '',
      msnInstrumentId: security?.msnInstrumentId || '',
      isFavourite: security?.isFavourite || false,
      priceFetchStatus: security?.priceFetchStatus ?? 'active',
    },
  });

  const selectedCurrency = watch('currencyCode');

  /**
   * The user's currencies, plus whatever the form currently holds.
   *
   * A lookup fills the currency from the provider, and that currency need not
   * be one the user has configured in Tools. A `<select>` whose value has no
   * matching `<option>` renders blank, so the code the provider returned would
   * silently disappear from the field -- and be lost on save. Keeping it in the
   * list preserves it and says where it came from, the same way a deactivated
   * security stays selectable while it is still assigned.
   */
  const currencyOptions = useMemo(() => {
    const sorted = [...currencies].sort((a, b) => {
      if (a.code === defaultCurrency) return -1;
      if (b.code === defaultCurrency) return 1;
      return a.code.localeCompare(b.code);
    });
    const options = sorted.map((c) => ({
      value: c.code,
      label: `${c.code} - ${c.name} (${c.symbol})`,
    }));
    if (
      selectedCurrency &&
      !currencies.some((c) => c.code === selectedCurrency)
    ) {
      options.push({
        value: selectedCurrency,
        label: t('form.currencyNotConfigured', { code: selectedCurrency }),
      });
    }
    return options;
  }, [currencies, defaultCurrency, selectedCurrency, t]);

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

      // Pull the description from the provider as part of the lookup, just like
      // the other fields. Best-effort and still editable: only overwrite when
      // the provider actually returns something so a manual edit isn't wiped.
      investmentsApi
        .getSuggestedDescription(result.symbol, result.exchange || undefined)
        .then(({ description, website }) => {
          if (description) {
            setValue('description', description, { shouldDirty: true });
          }
          // Same request, no extra call. Null for a fund, where Yahoo gives a
          // fund family and no URL -- and there is never an IR address to
          // suggest, because no provider publishes one.
          if (website) {
            setValue('website', website, { shouldDirty: true });
          }
        })
        .catch((error) => logger.error('Profile fetch failed:', error));

      const details = [`Symbol: ${result.symbol}`, `Name: ${result.name}`];
      if (result.exchange) details.push(`Exchange: ${result.exchange}`);
      if (result.securityType) details.push(`Type: ${result.securityType}`);
      if (result.currencyCode) details.push(`Currency: ${result.currencyCode}`);
      if (result.provider) details.push(`Provider: ${result.provider === 'msn' ? 'MSN' : 'Yahoo'}`);
      toast.success(t('form.toasts.found', { details: details.join(', ') }));
    },
    [setValue, lookupProvider, userDefaultProvider, t],
  );

  const handleLookup = useCallback(async () => {
    const { symbol, name, exchange: currentExchange } = getValues();
    const query = (symbol?.trim() || name?.trim() || '');
    if (query.length < 2) {
      toast.error(t('form.toasts.lookupTooShort'));
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
        toast.error(t('form.toasts.notFound', { query }));
      } else if (candidates.length === 1) {
        applyLookupResult(candidates[0]);
      } else {
        setPickerQuery(query);
        setPickerCandidates(candidates);
      }
    } catch (error) {
      logger.error('Security lookup failed:', error);
      toast.error(t('form.toasts.lookupFailed'));
    } finally {
      setIsLookingUp(false);
    }
  }, [getValues, preferredExchanges, lookupProvider, applyLookupResult, t]);

  // In edit mode, revert to the original security values. In create mode,
  // blank everything out (keeping the user's default currency).
  const handleClear = useCallback(() => {
    if (security) {
      reset();
      setSelectedTagIds(security.tags?.map((tag) => tag.id) || []);
      setCountryRows(toAllocationRows(security.countryWeightings));
      setAssetRows(toAllocationRows(security.assetWeightings));
    } else {
      reset({
        symbol: '',
        name: '',
        securityType: '',
        exchange: '',
        currencyCode: defaultValues?.currencyCode || defaultCurrency,
        description: '',
        quoteProvider: '',
        msnInstrumentId: '',
        isFavourite: false,
        priceFetchStatus: 'active',
      });
      setSelectedTagIds([]);
      setCountryRows([]);
      setAssetRows([]);
    }
    setHasLookupResult(false);
  }, [reset, defaultValues, defaultCurrency, security]);

  // Drop an asset class from the user's list. The backend removes it from every
  // security that used it; nothing is re-apportioned, so the freed percentage
  // simply falls into each security's computed "Other" remainder -- including
  // this form's, once the matching rows are gone.
  const confirmDeleteAsset = useCallback(async () => {
    const name = assetToDelete;
    setAssetToDelete(null);
    if (!name) return;
    try {
      await investmentsApi.deleteAssetOption(name);
      const lower = name.trim().toLowerCase();
      setAssetNames((prev) =>
        prev.filter((option) => option.trim().toLowerCase() !== lower),
      );
      setAssetRows((prev) =>
        prev.filter((row) => row.name.trim().toLowerCase() !== lower),
      );
      toast.success(t('form.assetAllocation.deleteSuccess', { name }));
    } catch (error) {
      logger.error('Asset class delete failed:', error);
      toast.error(t('form.assetAllocation.deleteFailed', { name }));
    }
  }, [assetToDelete, t]);

  // Pre-fill the description from the Yahoo provider profile. Best-effort and
  // always editable; replaces whatever is in the field so the user can review.
  const handleTagCreate = async (data: { name: string; color?: string; icon?: string }) => {
    const cleanedData = {
      ...data,
      color: data.color || undefined,
      icon: data.icon || undefined,
    };
    const newTag = await tagsApi.create(cleanedData);
    setTags((prev) => [...prev, newTag]);
    setSelectedTagIds((prev) => [...prev, newTag.id]);
    toast.success(t('form.toasts.tagCreated', { name: newTag.name }));
    setShowTagForm(false);
  };

  const isFundType =
    watch('securityType') === 'ETF' || watch('securityType') === 'MUTUAL_FUND';

  const onFormSubmit = async (data: SecurityFormData) => {
    const isFund =
      data.securityType === 'ETF' || data.securityType === 'MUTUAL_FUND';

    // Editor weights are percentages; persist as decimal 0-1. Drop blank rows.
    const countrySlices = toAllocationSlices(countryRows);
    const assetSlices = toAllocationSlices(assetRows);

    const overAllocated = (slices: { weight: number }[]) =>
      slices.reduce((sum, row) => sum + row.weight, 0) > 100.0001;
    if (isFund && (overAllocated(countrySlices) || overAllocated(assetSlices))) {
      toast.error(t('form.allocation.overError'));
      return;
    }

    const cleanedData: CreateSecurityData = {
      symbol: data.symbol.toUpperCase().trim(),
      name: data.name.trim(),
      securityType: data.securityType || undefined,
      exchange: data.exchange?.trim() || undefined,
      currencyCode: data.currencyCode,
      description: data.description?.trim() || undefined,
      tagIds: selectedTagIds,
      // Send null (not undefined) when the user picks "Use Default" so the
      // backend clears any existing override. Undefined would be stripped by
      // axios and treated as "no change", leaving the previous override in place.
      quoteProvider: data.quoteProvider === '' ? null : data.quoteProvider,
      // Only the two user-settable states are sent, and only when they differ
      // from what the security already holds: leaving an 'auto_disabled' security
      // untouched sends nothing (it stays paused), while unrelated edits to an
      // active security do not reset its 404 streak.
      priceFetchStatus: (() => {
        const next =
          data.priceFetchStatus === 'disabled'
            ? 'disabled'
            : data.priceFetchStatus === 'active'
              ? 'active'
              : undefined;
        return next && next !== security?.priceFetchStatus ? next : undefined;
      })(),
      // Empty string rather than undefined, so clearing an address actually
      // clears it: the backend normalises "" to null, where an omitted field
      // would leave the previous value in place.
      website: data.website?.trim() ?? '',
      irWebsite: data.irWebsite?.trim() ?? '',
      msnInstrumentId: data.msnInstrumentId?.trim() || undefined,
      isFavourite: data.isFavourite ?? false,
      // Only ETFs/funds carry the manual breakdowns; send [] to clear them.
      ...(isFund
        ? {
            countryWeightings: countrySlices.map((row) => ({
              name: row.name,
              weight: row.weight / 100,
            })),
            assetWeightings: assetSlices.map((row) => ({
              name: row.name,
              weight: row.weight / 100,
            })),
          }
        : {}),
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
            label={t('form.symbolLabel')}
            {...register('symbol')}
            error={errors.symbol?.message}
            placeholder={t('form.symbolPlaceholder')}
            className="uppercase"
          />
        </div>
        <div className="flex gap-1.5">
          <Select
            aria-label={t('form.lookupProviderAriaLabel')}
            options={lookupProviderOptions.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
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
            <span className={isLookingUp ? 'invisible' : ''}>{t('form.lookupButton')}</span>
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
              {security ? t('form.revertButton') : t('form.clearButton')}
            </Button>
          )}
        </div>
      </div>

      <Input
        label={t('form.nameLabel')}
        {...register('name')}
        error={errors.name?.message}
        placeholder={t('form.namePlaceholder')}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Select
          label={t('form.typeLabel')}
          options={securityTypeOptions.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          value={watch('securityType') || ''}
          onChange={(e) => setValue('securityType', e.target.value, { shouldDirty: true })}
          error={errors.securityType?.message}
        />

        <Combobox
          label={t('form.exchangeLabel')}
          options={EXCHANGE_OPTIONS}
          value={watch('exchange') || ''}
          onChange={(value, label) => setValue('exchange', value || label, { shouldDirty: true })}
          error={errors.exchange?.message}
          placeholder={t('form.exchangeSearchPlaceholder')}
          allowCustomValue
          usePortal
          alwaysShowSubtitle
          priorityValues={preferredExchanges}
        />

        <Select
          label={t('form.currencyLabel')}
          options={currencyOptions}
          value={selectedCurrency || ''}
          onChange={(e) =>
            setValue('currencyCode', e.target.value, { shouldDirty: true })
          }
          error={errors.currencyCode?.message}
        />
      </div>

      <div>
        <Select
          label={t('form.quoteProviderLabel')}
          options={[
            { value: '', label: t('form.quoteProviderUseDefault', { provider: userDefaultProvider === 'msn' ? 'MSN Money' : 'Yahoo Finance' }) },
            ...quoteProviderOverrideOptions.slice(1),
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
          </p>
        )}
      </div>

      {watch('quoteProvider') === 'msn' && (
        <Input
          label={t('form.msnIdLabel')}
          {...register('msnInstrumentId')}
          error={errors.msnInstrumentId?.message}
          placeholder={t('form.exchangePlaceholder')}
        />
      )}

      {/* Price fetching control: lets the user turn off provider lookups for a
          security no data provider carries, and surfaces the system's own
          auto-pause after repeated 404s. */}
      <div>
        <Select
          label={t('form.priceFetchLabel')}
          options={[
            ...(watch('priceFetchStatus') === 'auto_disabled'
              ? [
                  {
                    value: 'auto_disabled',
                    label: t('form.priceFetchAutoPaused'),
                  },
                ]
              : []),
            { value: 'active', label: t('form.priceFetchActive') },
            { value: 'disabled', label: t('form.priceFetchDisabled') },
          ]}
          value={watch('priceFetchStatus') || 'active'}
          onChange={(e) =>
            setValue(
              'priceFetchStatus',
              e.target.value as 'active' | 'auto_disabled' | 'disabled',
              { shouldDirty: true },
            )
          }
        />
        {watch('priceFetchStatus') === 'auto_disabled' && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            {t('form.priceFetchAutoPausedHelp')}
          </p>
        )}
        {watch('priceFetchStatus') === 'disabled' && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            {t('form.priceFetchDisabledHelp')}
          </p>
        )}
      </div>

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
          {isFavourite ? t('form.favouriteLabel') : t('form.addToFavourites')}
        </span>
      </button>

      {/* Description -- populated from the provider during Lookup, editable. */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {t('form.descriptionLabel')}
        </label>
        <textarea
          rows={4}
          className="block w-full rounded-md border-gray-300 dark:border-gray-600 shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-blue-400 dark:focus:ring-blue-400"
          placeholder={t('form.descriptionPlaceholder')}
          {...register('description')}
        />
        {errors.description && (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">
            {errors.description.message}
          </p>
        )}
      </div>

      {/* Both are rendered as links on the detail page, so the backend only
          stores an http(s) address and normalises a bare domain to https. There
          is no provider field for an IR page, hence the hint. */}
      <Input
        label={t('form.websiteLabel')}
        placeholder="apple.com"
        error={errors.website?.message}
        {...register('website')}
      />

      <div>
        <Input
          label={t('form.irWebsiteLabel')}
          placeholder="investor.apple.com"
          error={errors.irWebsite?.message}
          {...register('irWebsite')}
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t('form.irWebsiteHint')}
        </p>
      </div>

      {/* Tags */}
      <MultiSelect
        label={t('form.tagsLabel')}
        options={tagOptions}
        value={selectedTagIds}
        onChange={setSelectedTagIds}
        placeholder={t('form.tagsPlaceholder')}
        onCreateNew={() => setShowTagForm(true)}
        createNewLabel={t('form.createNewTag')}
      />

      {/* Manual country allocation (ETFs/funds only -- providers don't supply it) */}
      {isFundType && (
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('form.allocation.sectionTitle')}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            {t('form.allocation.help')}
          </p>
          <AllocationEditor
            value={countryRows}
            onChange={setCountryRows}
            options={countryOptions}
            namePlaceholder={t('form.allocation.countryPlaceholder')}
          />
        </div>
      )}

      {/* Manual asset-class allocation (ETFs/funds only). Free text: the picker
          offers whatever the user has already saved, and entries can be deleted
          from the list straight from the dropdown. */}
      {isFundType && (
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('form.assetAllocation.sectionTitle')}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            {t('form.assetAllocation.help')}
          </p>
          <AllocationEditor
            value={assetRows}
            onChange={setAssetRows}
            options={assetOptions}
            namePlaceholder={t('form.assetAllocation.placeholder')}
            addRowLabel={t('form.assetAllocation.addRow')}
            nameAriaLabel={t('form.assetAllocation.nameAriaLabel')}
            onDeleteOption={setAssetToDelete}
            deleteOptionAriaLabel={t('form.assetAllocation.deleteOption')}
          />
        </div>
      )}

      <ConfirmDialog
        isOpen={assetToDelete !== null}
        title={t('form.assetAllocation.deleteTitle')}
        message={t('form.assetAllocation.deleteMessage', {
          name: assetToDelete ?? '',
        })}
        confirmLabel={t('form.assetAllocation.deleteConfirm')}
        onConfirm={confirmDeleteAsset}
        onCancel={() => setAssetToDelete(null)}
        pushHistory
      />

      {/* Tag creation modal */}
      <Modal isOpen={showTagForm} onClose={() => setShowTagForm(false)} maxWidth="lg" allowOverflow pushHistory className="p-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
          {t('form.newTagTitle')}
        </h2>
        <TagForm onSubmit={handleTagCreate} onCancel={() => setShowTagForm(false)} />
      </Modal>

      <FormActions onCancel={onCancel} submitLabel={security ? t('form.submitUpdate') : t('form.submitCreate')} isSubmitting={isSubmitting} />
    </form>
    </>
  );
}
