'use client';

import { UseFormSetValue, FieldErrors } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { Select } from '@/components/ui/Select';
import { NumericInput } from '@/components/ui/NumericInput';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  CAPITAL_GAINS_TAX_MODES,
  CapitalGainsTaxMode,
  DIVIDEND_TAX_MODES,
  DividendTaxMode,
} from '@/types/account';

interface InvestmentTaxFieldsProps {
  capitalGainsTaxMode: CapitalGainsTaxMode;
  capitalGainsTaxRate: number | undefined;
  dividendTaxMode: DividendTaxMode;
  dividendTaxRate: number | undefined;
  dividendWithholdingTaxRate: number | undefined;
  deductRecordedWithholdingTax: boolean;
  setValue: UseFormSetValue<any>;
  errors: FieldErrors<any>;
}

/**
 * Tax estimation settings for an account that holds securities. Rendered only
 * for those accounts -- see `accountHoldsSecurities` in `@/types/account`,
 * which the account form and the backend both defer to.
 *
 * Capital gains and dividends are configured independently so a tax-deferred
 * account (IKE, IKZE) can suppress one without the other. A rate field is
 * hidden while its mode charges no tax, because there is nothing for a rate to
 * apply to; the stored rate survives the switch and comes back with the mode.
 */
export function InvestmentTaxFields({
  capitalGainsTaxMode,
  capitalGainsTaxRate,
  dividendTaxMode,
  dividendTaxRate,
  dividendWithholdingTaxRate,
  deductRecordedWithholdingTax,
  setValue,
  errors,
}: InvestmentTaxFieldsProps) {
  const t = useTranslations('accounts');

  const capitalGainsOptions = CAPITAL_GAINS_TAX_MODES.map((mode) => ({
    value: mode,
    label: t(`taxFields.capitalGainsModes.${mode}`),
  }));
  const dividendOptions = DIVIDEND_TAX_MODES.map((mode) => ({
    value: mode,
    label: t(`taxFields.dividendModes.${mode}`),
  }));

  const showCapitalGainsRate = capitalGainsTaxMode !== 'none';
  const showDividendRate = dividendTaxMode !== 'none';

  return (
    <div className="space-y-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
      <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
        {t('taxFields.title')}
      </h3>

      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {t('taxFields.capitalGains')}
        </h4>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label={t('taxFields.calculation')}
            options={capitalGainsOptions}
            value={capitalGainsTaxMode}
            onChange={(event) =>
              setValue('capitalGainsTaxMode', event.target.value as CapitalGainsTaxMode, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            error={errors.capitalGainsTaxMode?.message as string | undefined}
          />
          {showCapitalGainsRate && (
            <NumericInput
              label={t('taxFields.taxRate')}
              suffix="%"
              decimalPlaces={4}
              min={0}
              value={capitalGainsTaxRate}
              onChange={(value) =>
                setValue('capitalGainsTaxRate', value, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
              error={errors.capitalGainsTaxRate?.message as string | undefined}
            />
          )}
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {t('taxFields.dividends')}
        </h4>
        <div className="grid grid-cols-2 gap-4">
          <Select
            label={t('taxFields.calculation')}
            options={dividendOptions}
            value={dividendTaxMode}
            onChange={(event) =>
              setValue('dividendTaxMode', event.target.value as DividendTaxMode, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            error={errors.dividendTaxMode?.message as string | undefined}
          />
          {showDividendRate && (
            <NumericInput
              label={t('taxFields.taxRate')}
              suffix="%"
              decimalPlaces={4}
              min={0}
              value={dividendTaxRate}
              onChange={(value) =>
                setValue('dividendTaxRate', value, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
              error={errors.dividendTaxRate?.message as string | undefined}
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <NumericInput
            label={t('taxFields.withholdingTaxRate')}
            suffix="%"
            decimalPlaces={4}
            min={0}
            value={dividendWithholdingTaxRate}
            onChange={(value) =>
              setValue('dividendWithholdingTaxRate', value, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
            error={errors.dividendWithholdingTaxRate?.message as string | undefined}
          />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t('taxFields.withholdingTaxRateHelp')}
        </p>

        {/* labelledBy, not label: the text is visible beside the switch, and an
            aria-label duplicating it announces the name twice. */}
        <div className="flex items-center gap-3">
          <ToggleSwitch
            checked={deductRecordedWithholdingTax}
            onChange={(next) =>
              setValue('deductRecordedWithholdingTax', next, { shouldDirty: true })
            }
            labelledBy="deduct-withholding-label"
          />
          <span
            id="deduct-withholding-label"
            className="text-sm text-gray-700 dark:text-gray-300"
          >
            {t('taxFields.deductWithholding')}
          </span>
        </div>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t('taxFields.disclaimer')}
      </p>
    </div>
  );
}
