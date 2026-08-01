import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/render';
import { InvestmentIncomePanel } from './InvestmentIncomePanel';
import { Account } from '@/types/account';

vi.mock('@/hooks/useNumberFormat', () => ({
  useNumberFormat: () => ({ formatCurrency: (a: number) => `$${a.toFixed(2)}` }),
}));

describe('InvestmentIncomePanel', () => {
  it('shows dividends/interest and realized gains', () => {
    render(
      <InvestmentIncomePanel
        dividendInterestYtd={60}
        realizedGainsYtd={100}
        currencyCode="CAD"
        isLoading={false}
      />,
    );
    expect(screen.getByText('Dividends & Interest')).toBeInTheDocument();
    expect(screen.getByText('$60.00')).toBeInTheDocument();
    expect(screen.getByText('Realized Gains')).toBeInTheDocument();
    expect(screen.getByText('$100.00')).toBeInTheDocument();
  });

  it('shows an empty state when there is no income', () => {
    render(
      <InvestmentIncomePanel
        dividendInterestYtd={0}
        realizedGainsYtd={0}
        currencyCode="CAD"
        isLoading={false}
      />,
    );
    expect(screen.getByText('No investment income this year')).toBeInTheDocument();
  });
  describe('dividend tax estimation', () => {
    const brokerage = (overrides: Partial<Account> = {}): Account =>
      ({
        id: 'acct-1',
        accountType: 'INVESTMENT',
        accountSubType: 'INVESTMENT_BROKERAGE',
        currencyCode: 'PLN',
        ...overrides,
      }) as Account;

    it('is absent when the account has no tax configured and nothing was withheld', () => {
      render(
        <InvestmentIncomePanel
          dividendInterestYtd={1000}
          realizedGainsYtd={0}
          currencyCode="PLN"
          isLoading={false}
          account={brokerage()}
        />,
      );
      expect(screen.queryByText('Dividend tax estimation')).not.toBeInTheDocument();
    });

    it('estimates tax on the gross dividend at the account rate', () => {
      render(
        <InvestmentIncomePanel
          dividendInterestYtd={1000}
          realizedGainsYtd={0}
          currencyCode="PLN"
          isLoading={false}
          account={brokerage({
            dividendTaxMode: 'percentage_of_gross_dividend',
            dividendTaxRate: 19,
          })}
        />,
      );

      expect(screen.getByText('Dividend tax estimation')).toBeInTheDocument();
      expect(screen.getByText('Estimated dividend tax')).toBeInTheDocument();
      expect(screen.getByText('Tax already withheld')).toBeInTheDocument();
      expect(screen.getByText('Estimated additional tax')).toBeInTheDocument();
      expect(screen.getAllByText('$190.00')).toHaveLength(2); // estimated + additional
    });

    it('subtracts a recorded withholding tax when the account opts in', () => {
      render(
        <InvestmentIncomePanel
          dividendInterestYtd={1000}
          realizedGainsYtd={0}
          currencyCode="PLN"
          isLoading={false}
          account={brokerage({
            dividendTaxMode: 'percentage_of_gross_dividend',
            dividendTaxRate: 19,
            deductRecordedWithholdingTax: true,
          })}
          recordedWithholdingTaxYtd={150}
        />,
      );

      expect(screen.getByText('$190.00')).toBeInTheDocument(); // estimated
      expect(screen.getByText('$150.00')).toBeInTheDocument(); // withheld
      expect(screen.getByText('$40.00')).toBeInTheDocument(); // additional
    });

    it('shows no additional tax when more was withheld than estimated', () => {
      render(
        <InvestmentIncomePanel
          dividendInterestYtd={1000}
          realizedGainsYtd={500}
          currencyCode="PLN"
          isLoading={false}
          account={brokerage({
            dividendTaxMode: 'percentage_of_gross_dividend',
            dividendTaxRate: 19,
            deductRecordedWithholdingTax: true,
          })}
          recordedWithholdingTaxYtd={300}
        />,
      );

      expect(screen.getByText('$300.00')).toBeInTheDocument(); // withheld
      expect(screen.getByText('$0.00')).toBeInTheDocument(); // additional, not negative
    });

    it('keeps the tax already withheld visible on a no-tax account', () => {
      render(
        <InvestmentIncomePanel
          dividendInterestYtd={1000}
          realizedGainsYtd={500}
          currencyCode="PLN"
          isLoading={false}
          account={brokerage({ dividendTaxMode: 'none' })}
          recordedWithholdingTaxYtd={150}
        />,
      );

      expect(screen.getByText('Dividend tax estimation')).toBeInTheDocument();
      expect(screen.getByText('$150.00')).toBeInTheDocument();
      expect(screen.getAllByText('$0.00')).toHaveLength(2); // estimated + additional
    });

    it('derives the withheld tax from the account rate when none is recorded', () => {
      render(
        <InvestmentIncomePanel
          dividendInterestYtd={1000}
          realizedGainsYtd={0}
          currencyCode="PLN"
          isLoading={false}
          account={brokerage({ dividendWithholdingTaxRate: 15 })}
        />,
      );

      expect(screen.getByText('$150.00')).toBeInTheDocument();
    });
  });
});
