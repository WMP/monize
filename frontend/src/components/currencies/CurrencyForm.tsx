'use client';

import { useState, useCallback, useMemo, MutableRefObject } from 'react';
import { useTranslations } from 'next-intl';
import { useForm, Resolver } from 'react-hook-form';
import '@/lib/zodConfig';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { CurrencyInfo, CreateCurrencyData } from '@/lib/exchange-rates';
import { exchangeRatesApi } from '@/lib/exchange-rates';
import { createLogger } from '@/lib/logger';
import { useFormSubmitRef } from '@/hooks/useFormSubmitRef';
import { useFormDirtyNotify } from '@/hooks/useFormDirtyNotify';
import { FormActions } from '@/components/ui/FormActions';

const logger = createLogger('CurrencyForm');

type Translate = (key: string) => string;

const buildCurrencySchema = (t: Translate) =>
  z.object({
    code: z.string().length(3, t('form.validation.codeLength')),
    name: z.string().min(1, t('form.validation.nameRequired')).max(100, t('form.validation.nameMax')),
    symbol: z.string().min(1, t('form.validation.symbolRequired')).max(10, t('form.validation.symbolMax')),
    decimalPlaces: z.coerce.number().int().min(0).max(4).default(2),
  });

type CurrencyFormData = z.infer<ReturnType<typeof buildCurrencySchema>>;

interface CurrencyFormProps {
  currency?: CurrencyInfo;
  onSubmit: (data: CreateCurrencyData) => Promise<void>;
  onCancel: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
  submitRef?: MutableRefObject<(() => void) | null>;
}

export function CurrencyForm({ currency, onSubmit, onCancel, onDirtyChange, submitRef }: CurrencyFormProps) {
  const t = useTranslations('currencies');
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [hasLookupResult, setHasLookupResult] = useState(false);

  const currencySchema = useMemo(() => buildCurrencySchema(t), [t]);

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<CurrencyFormData>({
    resolver: zodResolver(currencySchema) as Resolver<CurrencyFormData>,
    defaultValues: {
      code: currency?.code || '',
      name: currency?.name || '',
      symbol: currency?.symbol || '',
      decimalPlaces: currency?.decimalPlaces ?? 2,
    },
  });

  const handleLookup = useCallback(async () => {
    const { code, name } = getValues();
    // Use code if provided, otherwise fall back to name field (for country/currency name search)
    const codeQuery = code?.trim() || '';
    const nameQuery = name?.trim() || '';
    const query = codeQuery.length >= 2 ? codeQuery : nameQuery;

    if (query.length < 2) {
      toast.error(t('form.toast.lookupTooShort'));
      return;
    }

    setIsLookingUp(true);
    try {
      const result = await exchangeRatesApi.lookupCurrency(query);
      if (result) {
        setValue('code', result.code);
        setValue('name', result.name);
        setValue('symbol', result.symbol);
        setValue('decimalPlaces', result.decimalPlaces);
        setHasLookupResult(true);

        const details = [
          t('form.toast.lookupCode', { code: result.code }),
          t('form.toast.lookupName', { name: result.name }),
          t('form.toast.lookupSymbol', { symbol: result.symbol }),
        ];
        toast.success(t('form.toast.lookupFound', { details: details.join(', ') }));
      } else {
        toast.error(t('form.toast.lookupNotFound', { query }));
      }
    } catch (error) {
      logger.error('Currency lookup failed:', error);
      toast.error(t('form.toast.lookupFailed'));
    } finally {
      setIsLookingUp(false);
    }
  }, [getValues, setValue]);

  const handleClear = useCallback(() => {
    reset({
      code: '',
      name: '',
      symbol: '',
      decimalPlaces: 2,
    });
    setHasLookupResult(false);
  }, [reset]);

  const onFormSubmit = async (data: CurrencyFormData) => {
    const cleanedData: CreateCurrencyData = {
      code: data.code.toUpperCase().trim(),
      name: data.name.trim(),
      symbol: data.symbol.trim(),
      decimalPlaces: data.decimalPlaces,
    };
    await onSubmit(cleanedData);
  };

  useFormDirtyNotify(isDirty, onDirtyChange);

  useFormSubmitRef(submitRef, handleSubmit, onFormSubmit);

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4">
      {/* Code + Lookup / Clear buttons */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Input
            label={t('form.currencyCode')}
            {...register('code')}
            error={errors.code?.message}
            placeholder={t('form.codePlaceholder')}
            className="uppercase"
            disabled={!!currency}
          />
        </div>
        {!currency && (
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="outline"
              onClick={handleLookup}
              disabled={isLookingUp}
              className="mb-[1px]"
            >
              {isLookingUp ? t('form.lookingUp') : t('form.lookup')}
            </Button>
            {hasLookupResult && (
              <Button
                type="button"
                variant="ghost"
                onClick={handleClear}
                className="mb-[1px] text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                title={t('form.clearTitle')}
              >
                {t('form.clear')}
              </Button>
            )}
          </div>
        )}
      </div>

      <Input
        label={t('form.name')}
        {...register('name')}
        error={errors.name?.message}
        placeholder={currency ? t('form.namePlaceholderEdit') : t('form.namePlaceholderCreate')}
      />

      <Input
        label={t('form.symbol')}
        {...register('symbol')}
        error={errors.symbol?.message}
        placeholder={t('form.symbolPlaceholder')}
      />

      <Input
        label={t('form.decimalPlaces')}
        type="number"
        {...register('decimalPlaces')}
        error={errors.decimalPlaces?.message}
        min={0}
        max={4}
      />

      <FormActions onCancel={onCancel} submitLabel={currency ? t('form.updateCurrency') : t('form.createCurrency')} isSubmitting={isSubmitting} />
    </form>
  );
}
