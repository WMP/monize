import { Account, CapitalGainsTaxMode, DividendTaxMode } from '@/types/account';

/**
 * Mirrors backend `investment-tax.util.ts` so a surface that already has the
 * transactions client-side (the account detail income panel, the realized
 * gains report) can show an estimate without a second round trip. The backend
 * stays authoritative for anything it returns; keep the two in step.
 *
 * This is deliberately not a tax engine. No brackets, allowances, loss
 * carry-forward, wash sales, holding-period rates, residency rules or tax-lot
 * matching -- just the settings stored on one account. Nothing here infers a
 * rate from a security's country, exchange or currency.
 */

/** The tax-estimation settings carried by an account. */
export interface InvestmentTaxSettings {
  capitalGainsTaxMode: CapitalGainsTaxMode;
  capitalGainsTaxRate: number | null;
  dividendTaxMode: DividendTaxMode;
  dividendTaxRate: number | null;
  dividendWithholdingTaxRate: number | null;
  deductRecordedWithholdingTax: boolean;
}

export interface CapitalGainsTaxEstimate {
  mode: CapitalGainsTaxMode;
  rate: number;
  taxableBase: number;
  estimatedTax: number;
}

export interface DividendTaxEstimate {
  mode: DividendTaxMode;
  rate: number;
  grossDividend: number;
  estimatedDividendTax: number;
  /** Reported even when the account adds no dividend tax of its own. */
  taxAlreadyWithheld: number;
  /** Never below zero: more withheld than estimated produces no refund here. */
  estimatedAdditionalTax: number;
}

/** Money rounded to the 4dp storage precision, matching the backend. */
function roundMoney(value: number): number {
  if (!isFinite(value)) return 0;
  return Math.round(value * 10000) / 10000;
}

function rateFraction(percent: number | null | undefined): number {
  const value = Number(percent);
  if (!isFinite(value) || value <= 0) return 0;
  return value / 100;
}

function ratePercent(percent: number | null | undefined): number {
  const value = Number(percent);
  return isFinite(value) && value > 0 ? value : 0;
}

function money(value: number | null | undefined): number {
  const n = Number(value);
  return isFinite(n) ? n : 0;
}

/** Read an account's tax settings, defaulting anything unset to no tax. */
export function taxSettingsOf(account: Partial<Account> | null | undefined): InvestmentTaxSettings {
  return {
    capitalGainsTaxMode: account?.capitalGainsTaxMode ?? 'none',
    capitalGainsTaxRate: account?.capitalGainsTaxRate ?? null,
    dividendTaxMode: account?.dividendTaxMode ?? 'none',
    dividendTaxRate: account?.dividendTaxRate ?? null,
    dividendWithholdingTaxRate: account?.dividendWithholdingTaxRate ?? null,
    deductRecordedWithholdingTax: account?.deductRecordedWithholdingTax ?? false,
  };
}

/**
 * Estimate the tax on selling an instrument out of one account.
 * `percentage_of_profit` taxes only a positive result -- a loss produces no
 * tax, and never a negative one.
 */
export function estimateCapitalGainsTax(
  settings: Pick<InvestmentTaxSettings, 'capitalGainsTaxMode' | 'capitalGainsTaxRate'>,
  sale: { saleValue: number; acquisitionCost: number; eligibleFees?: number },
): CapitalGainsTaxEstimate {
  const mode = settings.capitalGainsTaxMode;
  const saleValue = money(sale.saleValue);
  const acquisitionCost = money(sale.acquisitionCost);
  const eligibleFees = money(sale.eligibleFees);

  if (mode === 'percentage_of_profit') {
    const taxableProfit = Math.max(0, saleValue - acquisitionCost - eligibleFees);
    return {
      mode,
      rate: ratePercent(settings.capitalGainsTaxRate),
      taxableBase: roundMoney(taxableProfit),
      estimatedTax: roundMoney(taxableProfit * rateFraction(settings.capitalGainsTaxRate)),
    };
  }

  if (mode === 'percentage_of_sale_value') {
    const taxableValue = Math.max(0, saleValue);
    return {
      mode,
      rate: ratePercent(settings.capitalGainsTaxRate),
      taxableBase: roundMoney(taxableValue),
      estimatedTax: roundMoney(taxableValue * rateFraction(settings.capitalGainsTaxRate)),
    };
  }

  return { mode: 'none', rate: 0, taxableBase: 0, estimatedTax: 0 };
}

/**
 * Estimate the tax on a gross dividend paid into one account.
 *
 * The tax already withheld is always reported, whether or not the account adds
 * a dividend tax of its own, so a tax-exempt account still shows what was
 * taken at source. A recorded amount wins over the account's withholding rate.
 */
export function estimateDividendTax(
  settings: Pick<
    InvestmentTaxSettings,
    | 'dividendTaxMode'
    | 'dividendTaxRate'
    | 'dividendWithholdingTaxRate'
    | 'deductRecordedWithholdingTax'
  >,
  dividend: { grossDividend: number; recordedWithholdingTax?: number | null },
): DividendTaxEstimate {
  const grossDividend = Math.max(0, money(dividend.grossDividend));

  const taxAlreadyWithheld =
    dividend.recordedWithholdingTax === null || dividend.recordedWithholdingTax === undefined
      ? roundMoney(grossDividend * rateFraction(settings.dividendWithholdingTaxRate))
      : roundMoney(Math.max(0, money(dividend.recordedWithholdingTax)));

  if (settings.dividendTaxMode !== 'percentage_of_gross_dividend') {
    return {
      mode: 'none',
      rate: 0,
      grossDividend: roundMoney(grossDividend),
      estimatedDividendTax: 0,
      taxAlreadyWithheld,
      estimatedAdditionalTax: 0,
    };
  }

  const estimatedDividendTax = roundMoney(grossDividend * rateFraction(settings.dividendTaxRate));
  const estimatedAdditionalTax = settings.deductRecordedWithholdingTax
    ? roundMoney(Math.max(0, estimatedDividendTax - taxAlreadyWithheld))
    : estimatedDividendTax;

  return {
    mode: 'percentage_of_gross_dividend',
    rate: ratePercent(settings.dividendTaxRate),
    grossDividend: roundMoney(grossDividend),
    estimatedDividendTax,
    taxAlreadyWithheld,
    estimatedAdditionalTax,
  };
}
