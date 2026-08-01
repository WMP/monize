import {
  CapitalGainsTaxMode,
  DividendTaxMode,
} from "./entities/account.entity";
import { roundMoney } from "../common/round.util";

/**
 * Simplified tax estimation for accounts that hold securities.
 *
 * This is deliberately *not* a tax engine. There are no brackets, no
 * allowances, no loss carry-forward between years, no wash-sale handling, no
 * holding-period rates, no residency rules and no tax-lot matching -- the
 * acquisition cost comes from the average-cost basis the portfolio
 * calculations already maintain. Every result is an estimate derived purely
 * from the settings stored on one account, and every surface that shows one
 * must label it as such.
 *
 * Nothing here infers a rate from a security's country, exchange or currency.
 * Rates are only ever the ones the user configured on the account, and a
 * withholding amount recorded on a transaction always wins over the
 * account-level withholding rate.
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

/** The inputs of a single disposal, in the holding account's currency. */
export interface CapitalGainsTaxInput {
  /** Gross proceeds of the sale. */
  saleValue: number;
  /** Cost basis drawn down by the sale (average cost). */
  acquisitionCost: number;
  /** Commission and other fees deductible from the profit. */
  eligibleFees?: number;
}

export interface CapitalGainsTaxEstimate {
  mode: CapitalGainsTaxMode;
  /** Percentage actually applied; 0 when the account charges no tax. */
  rate: number;
  /** The amount the rate was applied to: the positive profit, or the sale value. */
  taxableBase: number;
  estimatedTax: number;
}

export interface DividendTaxInput {
  /** The dividend before any tax, in the account's currency. */
  grossDividend: number;
  /**
   * Tax already taken at source, when the transaction records one. Overrides
   * the account's withholding rate; never guessed when absent.
   */
  recordedWithholdingTax?: number | null;
}

export interface DividendTaxEstimate {
  mode: DividendTaxMode;
  /** Percentage actually applied; 0 when the account charges no dividend tax. */
  rate: number;
  grossDividend: number;
  /** Gross dividend times the account's dividend rate. */
  estimatedDividendTax: number;
  /**
   * Tax already taken at source. Reported even when the account adds no
   * dividend tax of its own, so it stays visible on a tax-exempt account.
   */
  taxAlreadyWithheld: number;
  /** What the estimate says is still owed, never below zero. */
  estimatedAdditionalTax: number;
}

/** A percentage (19 = 19%) as a fraction, with anything unusable treated as 0. */
function rateFraction(percent: number | null | undefined): number {
  const value = Number(percent);
  if (!isFinite(value) || value <= 0) return 0;
  return value / 100;
}

/** A percentage as stored, normalised so a missing or invalid rate reads as 0. */
function ratePercent(percent: number | null | undefined): number {
  const value = Number(percent);
  return isFinite(value) && value > 0 ? value : 0;
}

/** A money input, with non-finite values treated as 0. */
function money(value: number | null | undefined): number {
  const n = Number(value);
  return isFinite(n) ? n : 0;
}

/**
 * Estimate the tax on selling an instrument out of one account.
 *
 * `percentage_of_profit` taxes only a positive result -- a loss produces no
 * tax, and never a negative one, because this feature has no concept of
 * offsetting losses against other gains.
 */
export function estimateCapitalGainsTax(
  settings: Pick<
    InvestmentTaxSettings,
    "capitalGainsTaxMode" | "capitalGainsTaxRate"
  >,
  sale: CapitalGainsTaxInput,
): CapitalGainsTaxEstimate {
  const mode = settings.capitalGainsTaxMode;
  const saleValue = money(sale.saleValue);
  const acquisitionCost = money(sale.acquisitionCost);
  const eligibleFees = money(sale.eligibleFees);

  if (mode === "percentage_of_profit") {
    const taxableProfit = Math.max(
      0,
      saleValue - acquisitionCost - eligibleFees,
    );
    return {
      mode,
      rate: ratePercent(settings.capitalGainsTaxRate),
      taxableBase: roundMoney(taxableProfit),
      estimatedTax: roundMoney(
        taxableProfit * rateFraction(settings.capitalGainsTaxRate),
      ),
    };
  }

  if (mode === "percentage_of_sale_value") {
    const taxableValue = Math.max(0, saleValue);
    return {
      mode,
      rate: ratePercent(settings.capitalGainsTaxRate),
      taxableBase: roundMoney(taxableValue),
      estimatedTax: roundMoney(
        taxableValue * rateFraction(settings.capitalGainsTaxRate),
      ),
    };
  }

  return { mode: "none", rate: 0, taxableBase: 0, estimatedTax: 0 };
}

/**
 * Estimate the tax on a gross dividend paid into one account.
 *
 * The tax already withheld is always reported, whether or not the account adds
 * a dividend tax of its own, so a tax-exempt account still shows what was
 * taken at source. It is subtracted from the estimate only when the account
 * opts in, and the result never goes below zero -- a withholding larger than
 * the estimate produces no refund here, only no additional tax.
 */
export function estimateDividendTax(
  settings: Pick<
    InvestmentTaxSettings,
    | "dividendTaxMode"
    | "dividendTaxRate"
    | "dividendWithholdingTaxRate"
    | "deductRecordedWithholdingTax"
  >,
  dividend: DividendTaxInput,
): DividendTaxEstimate {
  const grossDividend = Math.max(0, money(dividend.grossDividend));

  // A recorded amount is authoritative; the account rate is the fallback
  // assumption, and neither is ever derived from where the security trades.
  const taxAlreadyWithheld =
    dividend.recordedWithholdingTax === null ||
    dividend.recordedWithholdingTax === undefined
      ? roundMoney(
          grossDividend * rateFraction(settings.dividendWithholdingTaxRate),
        )
      : roundMoney(Math.max(0, money(dividend.recordedWithholdingTax)));

  if (settings.dividendTaxMode !== "percentage_of_gross_dividend") {
    return {
      mode: "none",
      rate: 0,
      grossDividend: roundMoney(grossDividend),
      estimatedDividendTax: 0,
      taxAlreadyWithheld,
      estimatedAdditionalTax: 0,
    };
  }

  const estimatedDividendTax = roundMoney(
    grossDividend * rateFraction(settings.dividendTaxRate),
  );
  const estimatedAdditionalTax = settings.deductRecordedWithholdingTax
    ? roundMoney(Math.max(0, estimatedDividendTax - taxAlreadyWithheld))
    : estimatedDividendTax;

  return {
    mode: "percentage_of_gross_dividend",
    rate: ratePercent(settings.dividendTaxRate),
    grossDividend: roundMoney(grossDividend),
    estimatedDividendTax,
    taxAlreadyWithheld,
    estimatedAdditionalTax,
  };
}
