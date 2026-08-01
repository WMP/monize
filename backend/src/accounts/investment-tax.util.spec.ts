import {
  estimateCapitalGainsTax,
  estimateDividendTax,
  InvestmentTaxSettings,
} from "./investment-tax.util";
import {
  accountHoldsSecurities,
  AccountSubType,
  AccountType,
} from "./entities/account.entity";

const noTax: InvestmentTaxSettings = {
  capitalGainsTaxMode: "none",
  capitalGainsTaxRate: null,
  dividendTaxMode: "none",
  dividendTaxRate: null,
  dividendWithholdingTaxRate: null,
  deductRecordedWithholdingTax: false,
};

/** A plain Polish brokerage account: 19% on profit, 19% on dividends. */
const polishBrokerage: InvestmentTaxSettings = {
  capitalGainsTaxMode: "percentage_of_profit",
  capitalGainsTaxRate: 19,
  dividendTaxMode: "percentage_of_gross_dividend",
  dividendTaxRate: 19,
  dividendWithholdingTaxRate: null,
  deductRecordedWithholdingTax: false,
};

describe("estimateCapitalGainsTax", () => {
  it("taxes a positive profit at the account rate", () => {
    const result = estimateCapitalGainsTax(polishBrokerage, {
      saleValue: 30000,
      acquisitionCost: 25000,
      eligibleFees: 205.1,
    });

    expect(result.mode).toBe("percentage_of_profit");
    expect(result.rate).toBe(19);
    expect(result.taxableBase).toBe(4794.9);
    expect(result.estimatedTax).toBe(911.031);
  });

  it("charges no tax on a loss rather than a negative tax", () => {
    const result = estimateCapitalGainsTax(polishBrokerage, {
      saleValue: 8000,
      acquisitionCost: 12000,
      eligibleFees: 15,
    });

    expect(result.taxableBase).toBe(0);
    expect(result.estimatedTax).toBe(0);
  });

  it("charges no tax when fees push a small profit negative", () => {
    const result = estimateCapitalGainsTax(polishBrokerage, {
      saleValue: 1000,
      acquisitionCost: 990,
      eligibleFees: 25,
    });

    expect(result.estimatedTax).toBe(0);
  });

  it("treats missing fees as zero", () => {
    const result = estimateCapitalGainsTax(polishBrokerage, {
      saleValue: 1500,
      acquisitionCost: 1000,
    });

    expect(result.taxableBase).toBe(500);
    expect(result.estimatedTax).toBe(95);
  });

  it("taxes the sale value in percentage_of_sale_value mode, ignoring cost", () => {
    const settings: InvestmentTaxSettings = {
      ...noTax,
      capitalGainsTaxMode: "percentage_of_sale_value",
      capitalGainsTaxRate: 0.5,
    };

    const result = estimateCapitalGainsTax(settings, {
      saleValue: 20000,
      acquisitionCost: 25000,
      eligibleFees: 10,
    });

    expect(result.taxableBase).toBe(20000);
    expect(result.estimatedTax).toBe(100);
  });

  it("taxes the sale value even when the position was sold at a loss", () => {
    const settings: InvestmentTaxSettings = {
      ...noTax,
      capitalGainsTaxMode: "percentage_of_sale_value",
      capitalGainsTaxRate: 1,
    };

    const result = estimateCapitalGainsTax(settings, {
      saleValue: 5000,
      acquisitionCost: 9000,
    });

    expect(result.estimatedTax).toBe(50);
  });

  it("returns zero for a no-tax account (IKE/IKZE, tax-deferred)", () => {
    const result = estimateCapitalGainsTax(noTax, {
      saleValue: 30000,
      acquisitionCost: 25000,
      eligibleFees: 205.1,
    });

    expect(result.mode).toBe("none");
    expect(result.rate).toBe(0);
    expect(result.taxableBase).toBe(0);
    expect(result.estimatedTax).toBe(0);
  });

  it("treats a percentage mode with no rate configured as zero tax", () => {
    const result = estimateCapitalGainsTax(
      { capitalGainsTaxMode: "percentage_of_profit", capitalGainsTaxRate: null },
      { saleValue: 2000, acquisitionCost: 1000 },
    );

    expect(result.estimatedTax).toBe(0);
    expect(result.taxableBase).toBe(1000);
  });

  it("handles fractional rates without floating-point drift", () => {
    const result = estimateCapitalGainsTax(
      {
        capitalGainsTaxMode: "percentage_of_profit",
        capitalGainsTaxRate: 26.375,
      },
      { saleValue: 1000.1, acquisitionCost: 900.05 },
    );

    expect(result.taxableBase).toBe(100.05);
    expect(result.estimatedTax).toBe(26.3882);
  });

  it("keeps each account's settings independent", () => {
    const sale = { saleValue: 10000, acquisitionCost: 8000 };
    const ike: InvestmentTaxSettings = { ...noTax };
    const foreign: InvestmentTaxSettings = {
      ...noTax,
      capitalGainsTaxMode: "percentage_of_sale_value",
      capitalGainsTaxRate: 2,
    };

    expect(estimateCapitalGainsTax(polishBrokerage, sale).estimatedTax).toBe(
      380,
    );
    expect(estimateCapitalGainsTax(ike, sale).estimatedTax).toBe(0);
    expect(estimateCapitalGainsTax(foreign, sale).estimatedTax).toBe(200);
  });
});

describe("estimateDividendTax", () => {
  it("taxes the gross dividend at the account rate", () => {
    const result = estimateDividendTax(polishBrokerage, {
      grossDividend: 1000,
    });

    expect(result.mode).toBe("percentage_of_gross_dividend");
    expect(result.rate).toBe(19);
    expect(result.estimatedDividendTax).toBe(190);
    expect(result.estimatedAdditionalTax).toBe(190);
  });

  it("subtracts a recorded withholding tax when the account opts in", () => {
    const result = estimateDividendTax(
      { ...polishBrokerage, deductRecordedWithholdingTax: true },
      { grossDividend: 1000, recordedWithholdingTax: 150 },
    );

    expect(result.estimatedDividendTax).toBe(190);
    expect(result.taxAlreadyWithheld).toBe(150);
    expect(result.estimatedAdditionalTax).toBe(40);
  });

  it("never produces a negative additional tax when more was withheld", () => {
    const result = estimateDividendTax(
      { ...polishBrokerage, deductRecordedWithholdingTax: true },
      { grossDividend: 1000, recordedWithholdingTax: 300 },
    );

    expect(result.estimatedDividendTax).toBe(190);
    expect(result.taxAlreadyWithheld).toBe(300);
    expect(result.estimatedAdditionalTax).toBe(0);
  });

  it("keeps the full estimate when the account does not opt in to deducting", () => {
    const result = estimateDividendTax(polishBrokerage, {
      grossDividend: 1000,
      recordedWithholdingTax: 150,
    });

    expect(result.taxAlreadyWithheld).toBe(150);
    expect(result.estimatedAdditionalTax).toBe(190);
  });

  it("derives the withheld tax from the account rate when none is recorded", () => {
    const result = estimateDividendTax(
      {
        ...polishBrokerage,
        dividendWithholdingTaxRate: 15,
        deductRecordedWithholdingTax: true,
      },
      { grossDividend: 1000 },
    );

    expect(result.taxAlreadyWithheld).toBe(150);
    expect(result.estimatedAdditionalTax).toBe(40);
  });

  it("prefers a recorded amount over the account's withholding rate", () => {
    const result = estimateDividendTax(
      {
        ...polishBrokerage,
        dividendWithholdingTaxRate: 15,
        deductRecordedWithholdingTax: true,
      },
      { grossDividend: 1000, recordedWithholdingTax: 100 },
    );

    expect(result.taxAlreadyWithheld).toBe(100);
    expect(result.estimatedAdditionalTax).toBe(90);
  });

  it("still reports tax already withheld on a no-tax account", () => {
    const result = estimateDividendTax(
      { ...noTax, dividendWithholdingTaxRate: 15 },
      { grossDividend: 1000 },
    );

    expect(result.mode).toBe("none");
    expect(result.estimatedDividendTax).toBe(0);
    expect(result.taxAlreadyWithheld).toBe(150);
    expect(result.estimatedAdditionalTax).toBe(0);
  });

  it("reports a recorded withholding on a no-tax account too", () => {
    const result = estimateDividendTax(noTax, {
      grossDividend: 1000,
      recordedWithholdingTax: 150,
    });

    expect(result.estimatedDividendTax).toBe(0);
    expect(result.taxAlreadyWithheld).toBe(150);
    expect(result.estimatedAdditionalTax).toBe(0);
  });

  it("does not guess a withholding tax when neither source supplies one", () => {
    const result = estimateDividendTax(polishBrokerage, {
      grossDividend: 1000,
    });

    expect(result.taxAlreadyWithheld).toBe(0);
  });

  it("handles decimal dividends without floating-point drift", () => {
    const result = estimateDividendTax(
      { ...polishBrokerage, dividendTaxRate: 19 },
      { grossDividend: 123.45 },
    );

    expect(result.estimatedDividendTax).toBe(23.4555);
  });

  it("treats a negative gross dividend as zero", () => {
    const result = estimateDividendTax(polishBrokerage, {
      grossDividend: -100,
    });

    expect(result.grossDividend).toBe(0);
    expect(result.estimatedDividendTax).toBe(0);
  });

  it("keeps each account's dividend settings independent", () => {
    const dividend = { grossDividend: 500 };
    const ike: InvestmentTaxSettings = { ...noTax };

    expect(estimateDividendTax(polishBrokerage, dividend).estimatedDividendTax).toBe(
      95,
    );
    expect(estimateDividendTax(ike, dividend).estimatedDividendTax).toBe(0);
  });
});

describe("accountHoldsSecurities", () => {
  it("is true for a standalone investment account", () => {
    expect(
      accountHoldsSecurities({
        accountType: AccountType.INVESTMENT,
        accountSubType: null,
      }),
    ).toBe(true);
  });

  it("is true for the brokerage side of an investment pair", () => {
    expect(
      accountHoldsSecurities({
        accountType: AccountType.INVESTMENT,
        accountSubType: AccountSubType.INVESTMENT_BROKERAGE,
      }),
    ).toBe(true);
  });

  it("is false for the cash side of an investment pair", () => {
    expect(
      accountHoldsSecurities({
        accountType: AccountType.INVESTMENT,
        accountSubType: AccountSubType.INVESTMENT_CASH,
      }),
    ).toBe(false);
  });

  it.each([
    AccountType.CHEQUING,
    AccountType.SAVINGS,
    AccountType.CREDIT_CARD,
    AccountType.LOAN,
    AccountType.MORTGAGE,
    AccountType.CASH,
    AccountType.LINE_OF_CREDIT,
    AccountType.ASSET,
    AccountType.OTHER,
  ])("is false for a %s account", (accountType) => {
    expect(accountHoldsSecurities({ accountType, accountSubType: null })).toBe(
      false,
    );
  });
});
