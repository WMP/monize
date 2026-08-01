import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/render';
import { EstimatedTaxByAccountPanel } from './EstimatedTaxByAccountPanel';
import { RealizedGainEntry } from '@/types/investment';

const toDisplay = (value: number) => value;
const fmtValue = (value: number) => `${value.toFixed(2)} PLN`;

function entry(overrides: Partial<RealizedGainEntry> = {}): RealizedGainEntry {
  return {
    transactionId: 'tx-1',
    transactionDate: '2026-06-10',
    accountId: 'acct-1',
    accountName: 'Standard brokerage account',
    accountCurrencyCode: 'PLN',
    securityId: 'sec-1',
    symbol: 'ABC',
    securityName: 'ABC Corp',
    securityCurrencyCode: 'PLN',
    quantity: 100,
    price: 300,
    commission: 205.1,
    proceeds: 29794.9,
    costBasis: 25000,
    realizedGain: 4794.9,
    capitalGainsTaxMode: 'percentage_of_profit',
    capitalGainsTaxRate: 19,
    taxableBase: 4794.9,
    estimatedTax: 911.03,
    ...overrides,
  };
}

function renderPanel(entries: RealizedGainEntry[]) {
  return render(
    <EstimatedTaxByAccountPanel entries={entries} toDisplay={toDisplay} fmtValue={fmtValue} />,
  );
}

describe('EstimatedTaxByAccountPanel', () => {
  it('renders nothing when there are no sales', () => {
    const { container } = renderPanel([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the account, estimated gain, estimated tax and calculation', () => {
    renderPanel([entry()]);

    expect(screen.getByText('Estimated tax impact')).toBeInTheDocument();
    expect(screen.getByText('Standard brokerage account')).toBeInTheDocument();
    expect(screen.getByText('4794.90 PLN')).toBeInTheDocument();
    expect(screen.getByText('911.03 PLN')).toBeInTheDocument();
    expect(screen.getByText('19% of estimated profit')).toBeInTheDocument();
  });

  it('explains a no-tax account instead of leaving the calculation blank', () => {
    renderPanel([
      entry({
        accountName: 'IKE',
        capitalGainsTaxMode: 'none',
        capitalGainsTaxRate: 0,
        taxableBase: 0,
        estimatedTax: 0,
      }),
    ]);

    expect(screen.getByText('0.00 PLN')).toBeInTheDocument();
    expect(
      screen.getByText('This account is configured with no capital gains tax.'),
    ).toBeInTheDocument();
  });

  it('labels a sale-value calculation as such', () => {
    renderPanel([
      entry({
        capitalGainsTaxMode: 'percentage_of_sale_value',
        capitalGainsTaxRate: 0.5,
        taxableBase: 29794.9,
        estimatedTax: 148.97,
      }),
    ]);

    expect(screen.getByText('0.5% of sale value')).toBeInTheDocument();
  });

  it('keeps accounts separate rather than blending one rate across the portfolio', () => {
    renderPanel([
      entry(),
      entry({
        transactionId: 'tx-2',
        accountId: 'acct-ike',
        accountName: 'IKE',
        capitalGainsTaxMode: 'none',
        capitalGainsTaxRate: 0,
        taxableBase: 0,
        estimatedTax: 0,
      }),
    ]);

    expect(screen.getByText('Standard brokerage account')).toBeInTheDocument();
    expect(screen.getByText('IKE')).toBeInTheDocument();
    expect(screen.getByText('911.03 PLN')).toBeInTheDocument();
    expect(screen.getByText('0.00 PLN')).toBeInTheDocument();
    expect(
      screen.getByText('This account is configured with no capital gains tax.'),
    ).toBeInTheDocument();
  });

  it('sums several sales within the same account', () => {
    renderPanel([
      entry(),
      entry({ transactionId: 'tx-2', realizedGain: 1000, estimatedTax: 190 }),
    ]);

    expect(screen.getByText('5794.90 PLN')).toBeInTheDocument();
    expect(screen.getByText('1101.03 PLN')).toBeInTheDocument();
  });

  it('never presents the estimate as a settled amount', () => {
    renderPanel([entry()]);

    expect(screen.getByText(/This is not tax advice/)).toBeInTheDocument();
    expect(screen.queryByText(/Tax due/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tax return/i)).not.toBeInTheDocument();
  });
});
