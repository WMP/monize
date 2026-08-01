import { describe, it, expect } from 'vitest';
import {
  estimateCapitalGainsTax,
  estimateDividendTax,
  taxSettingsOf,
  InvestmentTaxSettings,
} from './investment-tax';
import { accountHoldsSecurities, AccountType } from '@/types/account';

const noTax: InvestmentTaxSettings = {
  capitalGainsTaxMode: 'none',
  capitalGainsTaxRate: null,
  dividendTaxMode: 'none',
  dividendTaxRate: null,
  dividendWithholdingTaxRate: null,
  deductRecordedWithholdingTax: false,
};

/** A plain Polish brokerage account: 19% on profit, 19% on dividends. */
const polishBrokerage: InvestmentTaxSettings = {
  capitalGainsTaxMode: 'percentage_of_profit',
  capitalGainsTaxRate: 19,
  dividendTaxMode: 'percentage_of_gross_dividend',
  dividendTaxRate: 19,
  dividendWithholdingTaxRate: null,
  deductRecordedWithholdingTax: false,
};

describe('estimateCapitalGainsTax', () => {
  it('taxes a positive profit at the account rate', () => {
    const result = estimateCapitalGainsTax(polishBrokerage, {
      saleValue: 30000,
      acquisitionCost: 25000,
      eligibleFees: 205.1,
    });

    expect(result.rate).toBe(19);
    expect(result.taxableBase).toBe(4794.9);
    expect(result.estimatedTax).toBe(911.031);
  });

  it('charges no tax on a loss rather than a negative tax', () => {
    const result = estimateCapitalGainsTax(polishBrokerage, {
      saleValue: 8000,
      acquisitionCost: 12000,
    });

    expect(result.taxableBase).toBe(0);
    expect(result.estimatedTax).toBe(0);
  });

  it('taxes the sale value in percentage_of_sale_value mode', () => {
    const result = estimateCapitalGainsTax(
      { capitalGainsTaxMode: 'percentage_of_sale_value', capitalGainsTaxRate: 0.5 },
      { saleValue: 20000, acquisitionCost: 25000 },
    );

    expect(result.taxableBase).toBe(20000);
    expect(result.estimatedTax).toBe(100);
  });

  it('returns zero for a no-tax account', () => {
    const result = estimateCapitalGainsTax(noTax, {
      saleValue: 30000,
      acquisitionCost: 25000,
    });

    expect(result.mode).toBe('none');
    expect(result.estimatedTax).toBe(0);
  });

  it('keeps each account independent', () => {
    const sale = { saleValue: 10000, acquisitionCost: 8000 };
    expect(estimateCapitalGainsTax(polishBrokerage, sale).estimatedTax).toBe(380);
    expect(estimateCapitalGainsTax(noTax, sale).estimatedTax).toBe(0);
  });
});

describe('estimateDividendTax', () => {
  it('taxes the gross dividend at the account rate', () => {
    const result = estimateDividendTax(polishBrokerage, { grossDividend: 1000 });

    expect(result.estimatedDividendTax).toBe(190);
    expect(result.estimatedAdditionalTax).toBe(190);
  });

  it('subtracts a recorded withholding tax when the account opts in', () => {
    const result = estimateDividendTax(
      { ...polishBrokerage, deductRecordedWithholdingTax: true },
      { grossDividend: 1000, recordedWithholdingTax: 150 },
    );

    expect(result.taxAlreadyWithheld).toBe(150);
    expect(result.estimatedAdditionalTax).toBe(40);
  });

  it('never produces a negative additional tax when more was withheld', () => {
    const result = estimateDividendTax(
      { ...polishBrokerage, deductRecordedWithholdingTax: true },
      { grossDividend: 1000, recordedWithholdingTax: 300 },
    );

    expect(result.estimatedAdditionalTax).toBe(0);
  });

  it('derives the withheld tax from the account rate when none is recorded', () => {
    const result = estimateDividendTax(
      { ...polishBrokerage, dividendWithholdingTaxRate: 15, deductRecordedWithholdingTax: true },
      { grossDividend: 1000 },
    );

    expect(result.taxAlreadyWithheld).toBe(150);
    expect(result.estimatedAdditionalTax).toBe(40);
  });

  it('still reports tax already withheld on a no-tax account', () => {
    const result = estimateDividendTax(
      { ...noTax, dividendWithholdingTaxRate: 15 },
      { grossDividend: 1000 },
    );

    expect(result.estimatedDividendTax).toBe(0);
    expect(result.taxAlreadyWithheld).toBe(150);
    expect(result.estimatedAdditionalTax).toBe(0);
  });

  it('does not guess a withholding tax when neither source supplies one', () => {
    expect(estimateDividendTax(polishBrokerage, { grossDividend: 1000 }).taxAlreadyWithheld).toBe(
      0,
    );
  });
});

describe('taxSettingsOf', () => {
  it('defaults an account with no settings to no tax', () => {
    expect(taxSettingsOf({})).toEqual(noTax);
    expect(taxSettingsOf(null)).toEqual(noTax);
  });

  it('reads the settings stored on an account', () => {
    expect(
      taxSettingsOf({
        capitalGainsTaxMode: 'percentage_of_profit',
        capitalGainsTaxRate: 19,
        deductRecordedWithholdingTax: true,
      }),
    ).toMatchObject({
      capitalGainsTaxMode: 'percentage_of_profit',
      capitalGainsTaxRate: 19,
      deductRecordedWithholdingTax: true,
    });
  });
});

describe('accountHoldsSecurities', () => {
  it('is true for a standalone investment account', () => {
    expect(accountHoldsSecurities({ accountType: 'INVESTMENT', accountSubType: null })).toBe(true);
  });

  it('is true for the brokerage half of an investment pair', () => {
    expect(
      accountHoldsSecurities({ accountType: 'INVESTMENT', accountSubType: 'INVESTMENT_BROKERAGE' }),
    ).toBe(true);
  });

  it('is false for the cash half of an investment pair', () => {
    expect(
      accountHoldsSecurities({ accountType: 'INVESTMENT', accountSubType: 'INVESTMENT_CASH' }),
    ).toBe(false);
  });

  it.each<AccountType>([
    'CHEQUING',
    'SAVINGS',
    'CREDIT_CARD',
    'LOAN',
    'MORTGAGE',
    'CASH',
    'LINE_OF_CREDIT',
    'ASSET',
    'OTHER',
  ])('is false for a %s account', (accountType) => {
    expect(accountHoldsSecurities({ accountType, accountSubType: null })).toBe(false);
  });
});
