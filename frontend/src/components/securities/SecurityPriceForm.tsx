'use client';

import { MutableRefObject, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import '@/lib/zodConfig';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/Input';
import { DateInput } from '@/components/ui/DateInput';
import { SecurityPrice, CreateSecurityPriceData } from '@/types/investment';
import { useFormSubmitRef } from '@/hooks/useFormSubmitRef';
import { useFormDirtyNotify } from '@/hooks/useFormDirtyNotify';
import { FormActions } from '@/components/ui/FormActions';

// Validation messages are resolved at render time via t(...) so the schema can
// be localized. The type below is derived from the schema's shape.
const makePriceSchema = (t: ReturnType<typeof useTranslations>) =>
  z.object({
    priceDate: z.string().min(1, t('priceForm.validation.dateRequired')),
    closePrice: z.string().min(1, t('priceForm.validation.priceRequired')).refine(
      (val) => !isNaN(Number(val)) && Number(val) >= 0,
      t('priceForm.validation.priceNonNegative'),
    ),
    openPrice: z.string().optional(),
    highPrice: z.string().optional(),
    lowPrice: z.string().optional(),
    volume: z.string().optional(),
  });

type PriceFormData = z.infer<ReturnType<typeof makePriceSchema>>;

interface SecurityPriceFormProps {
  price?: SecurityPrice;
  onSubmit: (data: CreateSecurityPriceData) => Promise<void>;
  onCancel: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
  submitRef?: MutableRefObject<(() => void) | null>;
}

export function SecurityPriceForm({ price, onSubmit, onCancel, onDirtyChange, submitRef }: SecurityPriceFormProps) {
  const t = useTranslations('securities');
  const priceSchema = useMemo(() => makePriceSchema(t), [t]);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<PriceFormData>({
    resolver: zodResolver(priceSchema),
    defaultValues: {
      priceDate: price?.priceDate || new Date().toISOString().substring(0, 10),
      closePrice: price?.closePrice != null ? String(price.closePrice) : '',
      openPrice: price?.openPrice != null ? String(price.openPrice) : '',
      highPrice: price?.highPrice != null ? String(price.highPrice) : '',
      lowPrice: price?.lowPrice != null ? String(price.lowPrice) : '',
      volume: price?.volume != null ? String(price.volume) : '',
    },
  });

  const onFormSubmit = async (data: PriceFormData) => {
    const cleanedData: CreateSecurityPriceData = {
      priceDate: data.priceDate,
      closePrice: Number(data.closePrice),
      ...(data.openPrice && { openPrice: Number(data.openPrice) }),
      ...(data.highPrice && { highPrice: Number(data.highPrice) }),
      ...(data.lowPrice && { lowPrice: Number(data.lowPrice) }),
      ...(data.volume && { volume: Number(data.volume) }),
    };
    // onSubmit may re-throw after surfacing its own error toast (so the parent
    // keeps the form open). Swallow it here: react-hook-form's handleSubmit
    // would otherwise reject, producing an unhandled promise rejection. The
    // failure is already handled (toast) and the form stays open because the
    // parent does not clear its open state on error.
    try {
      await onSubmit(cleanedData);
    } catch {
      // handled upstream via toast; nothing to do here
    }
  };

  useFormDirtyNotify(isDirty, onDirtyChange);
  useFormSubmitRef(submitRef, handleSubmit, onFormSubmit);

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4">
      <DateInput
        label={t('priceForm.date')}
        error={errors.priceDate?.message}
        onDateChange={(date) => setValue('priceDate', date, { shouldDirty: true, shouldValidate: true })}
        {...register('priceDate')}
      />

      <Input
        label={t('priceForm.closePrice')}
        type="number"
        step="any"
        {...register('closePrice')}
        error={errors.closePrice?.message}
        placeholder={t('priceForm.closePricePlaceholder')}
      />

      <div className="grid grid-cols-2 gap-3">
        <Input
          label={t('priceForm.openPrice')}
          type="number"
          step="any"
          {...register('openPrice')}
          error={errors.openPrice?.message}
          placeholder={t('priceForm.optional')}
        />
        <Input
          label={t('priceForm.highPrice')}
          type="number"
          step="any"
          {...register('highPrice')}
          error={errors.highPrice?.message}
          placeholder={t('priceForm.optional')}
        />
        <Input
          label={t('priceForm.lowPrice')}
          type="number"
          step="any"
          {...register('lowPrice')}
          error={errors.lowPrice?.message}
          placeholder={t('priceForm.optional')}
        />
        <Input
          label={t('priceForm.volume')}
          type="number"
          step="1"
          {...register('volume')}
          error={errors.volume?.message}
          placeholder={t('priceForm.optional')}
        />
      </div>

      <FormActions
        onCancel={onCancel}
        submitLabel={price ? t('priceForm.updatePrice') : t('priceForm.addPrice')}
        isSubmitting={isSubmitting}
      />
    </form>
  );
}
