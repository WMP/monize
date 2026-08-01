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

/** The cells of the row for `accountName`, in column order. */
function rowCells(accountName: string): string[] {
  const cell = screen.getByText(accountName);
  const row = cell.closest('tr');
  return Array.from(row!.querySelectorAll('td')).map((td) => td.textContent ?? '');
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
    expect(rowCells('Standard brokerage account')).toEqual([
      'Standard brokerage account',
      '4794.90 PLN', // estimated gain
      '4794.90 PLN', // taxable base
      '911.03 PLN', // estimated tax
      '19% of estimated profit',
    ]);
  });

  it('renders nothing when no account in the report charges tax', () => {
    // Otherwise every user who has configured none of this gets a table of
    // zeros and a tax disclaimer bolted onto their Realized Gains report.
    const { container } = renderPanel([
      entry({
        accountName: 'IKE',
        capitalGainsTaxMode: 'none',
        capitalGainsTaxRate: 0,
        taxableBase: 0,
        estimatedTax: 0,
      }),
    ]);

    expect(container).toBeEmptyDOMElement();
  });

  it('explains a no-tax account alongside a taxed one', () => {
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

    // Identical trades, one taxed and one not: the estimate is per account.
    expect(rowCells('Standard brokerage account')[3]).toBe('911.03 PLN');
    expect(rowCells('IKE')[3]).toBe('0.00 PLN');
    expect(
      screen.getByText('This account is configured with no capital gains tax.'),
    ).toBeInTheDocument();
  });

  it('sums several sales within the same account', () => {
    renderPanel([
      entry(),
      entry({ transactionId: 'tx-2', realizedGain: 1000, estimatedTax: 190 }),
    ]);

    const cells = rowCells('Standard brokerage account');
    expect(cells[1]).toBe('5794.90 PLN');
    expect(cells[3]).toBe('1101.03 PLN');
  });

  it('never presents the estimate as a settled amount', () => {
    renderPanel([entry()]);

    expect(screen.getByText(/This is not tax advice/)).toBeInTheDocument();
    expect(screen.queryByText(/Tax due/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tax return/i)).not.toBeInTheDocument();
  });

  it('shows the taxable base so a net gain of zero reconciles with a non-zero tax', () => {
    // A winning and a losing sale in the same account: the gain column nets to
    // zero while the tax is charged on the winner alone, because losses are not
    // offset. Without the taxable base column that reads as an arithmetic fault.
    renderPanel([
      entry({ realizedGain: 1000, taxableBase: 1000, estimatedTax: 190 }),
      entry({ transactionId: 'tx-2', realizedGain: -1000, taxableBase: 0, estimatedTax: 0 }),
    ]);

    const cells = rowCells('Standard brokerage account');
    expect(cells[1]).toBe('0.00 PLN'); // net gain: +1000 and -1000
    expect(cells[2]).toBe('1000.00 PLN'); // taxable base: the winner alone
    expect(cells[3]).toBe('190.00 PLN'); // tax on that base
    expect(
      screen.getByText(
        'Losses are not offset against gains, so the taxable base can exceed the net gain.',
      ),
    ).toBeInTheDocument();
  });

  it('omits the losses note when nothing diverges', () => {
    renderPanel([entry()]);

    expect(screen.queryByText(/Losses are not offset/)).not.toBeInTheDocument();
  });
});
