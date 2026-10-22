import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@/test/render';
import { InvestmentPerformanceReport } from './InvestmentPerformanceReport';

vi.mock('@/hooks/useNumberFormat', async () => {
  const { numberFormatMockDefaults } = await import('@/test/number-format-mock');
  return {
    useNumberFormat: () => ({
      ...numberFormatMockDefaults(),
      formatCurrencyCompact: (n: number) => `$${n.toFixed(0)}`,
      formatCurrency: (n: number, _currency?: string) => `$${n.toFixed(2)}`,
      formatSignedPercent: (n: number, decimals = 2) =>
        `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`,
      defaultCurrency: 'CAD',
    }),
  };
});
vi.mock('@/hooks/useExchangeRates', () => ({
  useExchangeRates: () => ({
    convertToDefault: (amount: number, _currency: string) => amount,
    defaultCurrency: 'CAD',
  }),
}));

vi.mock('@/lib/chart-colours', () => ({
  CHART_COLOURS: ['#3b82f6', '#ef4444', '#22c55e'],
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
  Pie: ({ children }: any) => <div data-testid="pie">{children}</div>,
  Cell: () => null,
  Tooltip: ({ content }: any) => {
    if (content && content.type) {
      const C = content.type;
      return (
        <div data-testid="tooltip">
          <C {...content.props} active={true} payload={[{ name: 'V', value: 100, color: '#000', payload: { name: 'Equities', symbol: 'VFV', marketValue: 100, gainLoss: 10, gainLossPercent: 5, currencyCode: 'CAD', value: 100, percentage: 50 } }]} />
          <C {...content.props} active={false} payload={[]} />
          <C {...content.props} active={true} payload={[{ name: 'X', value: 50, color: '#000', payload: { name: 'Bonds', symbol: 'XIC', marketValue: -50, gainLoss: -10, gainLossPercent: -5, currencyCode: 'USD', value: 50, percentage: 25 } }]} />
        </div>
      );
    }
    return null;
  },
  Legend: () => null,
}));

const mockGetPortfolioSummary = vi.fn();
const mockGetInvestmentAccounts = vi.fn();

vi.mock('@/lib/investments', () => ({
  investmentsApi: {
    getPortfolioSummary: (...args: any[]) => mockGetPortfolioSummary(...args),
    getInvestmentAccounts: (...args: any[]) => mockGetInvestmentAccounts(...args),
  },
}));

// The Performance view now draws the historical percent-return comparison chart
// (one line per held security) instead of a holdings donut. It owns its own
// fetch, so it is stubbed here; the report's job is only to feed it the held
// securities and the window.
const mockPerfChartProps = vi.fn();
vi.mock('@/components/reports/SecurityComparisonChart', () => ({
  SecurityComparisonChart: (props: any) => {
    mockPerfChartProps(props);
    return (
      <div
        data-testid="performance-chart"
        data-security-ids={(props.securityIds ?? []).join(',')}
        data-start={props.startDate}
        data-end={props.endDate}
      />
    );
  },
}));

vi.mock('@/lib/pdf-export', () => ({
  exportToPdf: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

const fullPortfolio = {
  holdings: [
    {
      id: 'h-1',
      securityId: 'sec-vfv',
      accountId: 'acc-1',
      symbol: 'VFV',
      name: 'Vanguard S&P 500',
      quantity: 100,
      averageCost: 90,
      currentPrice: 100,
      marketValue: 10000,
      costBasis: 9000,
      costBasisAccountCurrency: 9000,
      gainLoss: 1000,
      gainLossPercent: 11.11,
      currencyCode: 'CAD',
    },
    {
      id: 'h-2',
      securityId: 'sec-vfv',
      accountId: 'acc-2',
      symbol: 'VFV',
      name: 'Vanguard S&P 500',
      quantity: 50,
      averageCost: 95,
      currentPrice: 100,
      marketValue: 5000,
      costBasis: 4750,
      costBasisAccountCurrency: 4750,
      gainLoss: 250,
      gainLossPercent: 5.26,
      currencyCode: 'CAD',
    },
    {
      id: 'h-3',
      securityId: 'sec-xic',
      accountId: 'acc-1',
      symbol: 'XIC',
      name: 'iShares S&P/TSX',
      quantity: 0,
      averageCost: null,
      currentPrice: null,
      marketValue: null,
      costBasis: 0,
      costBasisAccountCurrency: 0,
      gainLoss: null,
      gainLossPercent: null,
      currencyCode: 'CAD',
    },
    {
      id: 'h-4',
      securityId: 'sec-aapl',
      accountId: 'acc-3',
      symbol: 'AAPL',
      name: 'Apple Inc',
      quantity: 10,
      averageCost: 150,
      currentPrice: 140,
      marketValue: 1400,
      costBasis: 1500,
      costBasisAccountCurrency: 1500,
      gainLoss: -100,
      gainLossPercent: -6.67,
      currencyCode: 'USD',
    },
  ],
  holdingsByAccount: [
    { accountId: 'acc-1', totalMarketValue: 10000, cashBalance: 500, totalCostBasis: 9000 },
    { accountId: 'acc-2', totalMarketValue: 5000, cashBalance: 0, totalCostBasis: 4750 },
  ],
  allocation: [
    { name: 'Equities', value: 15000, percentage: 80, color: '#3b82f6' },
    { name: 'Bonds', value: 1400, percentage: 20, symbol: 'XBND' },
  ],
  totalPortfolioValue: 16400,
  totalCostBasis: 15250,
  totalGainLoss: 1150,
  totalGainLossPercent: 7.54,
};

describe('InvestmentPerformanceReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockGetPortfolioSummary.mockReturnValue(new Promise(() => {}));
    mockGetInvestmentAccounts.mockReturnValue(new Promise(() => {}));
    render(<InvestmentPerformanceReport />);
    expect(document.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders empty state when no holdings', async () => {
    mockGetPortfolioSummary.mockResolvedValue({
      holdings: [],
      holdingsByAccount: [],
      allocation: [],
      totalPortfolioValue: 0,
      totalCostBasis: 0,
      totalGainLoss: 0,
      totalGainLossPercent: 0,
    });
    mockGetInvestmentAccounts.mockResolvedValue([]);
    render(<InvestmentPerformanceReport />);
    await waitFor(() => {
      expect(screen.getByText(/No investment holdings found/)).toBeInTheDocument();
    });
  });

  it('handles error in loadData gracefully', async () => {
    mockGetPortfolioSummary.mockRejectedValue(new Error('boom'));
    mockGetInvestmentAccounts.mockRejectedValue(new Error('boom'));
    render(<InvestmentPerformanceReport />);
    await waitFor(() => {
      expect(screen.getByText(/Failed to load report data/i)).toBeInTheDocument();
    });
  });

  it('renders portfolio summary, holdings, allocation toggle, expand and export', async () => {
    mockGetPortfolioSummary.mockResolvedValue(fullPortfolio);
    mockGetInvestmentAccounts.mockResolvedValue([
      { id: 'acc-1', name: 'TFSA - Brokerage', currencyCode: 'CAD', accountSubType: 'INVESTMENT_BROKERAGE' },
      { id: 'acc-2', name: 'TFSA - Cash', currencyCode: 'CAD', accountSubType: 'INVESTMENT_CASH' },
      { id: 'acc-3', name: 'RRSP', currencyCode: 'USD', accountSubType: 'INVESTMENT_CASH' },
    ]);
    render(<InvestmentPerformanceReport />);
    await waitFor(() => {
      expect(screen.getByText('Total Value')).toBeInTheDocument();
    });
    // expand multi-account VFV
    const expandableRow = screen.getAllByText('VFV')[0];
    await act(async () => {
      fireEvent.click(expandableRow);
    });
    // collapse it
    await act(async () => {
      fireEvent.click(expandableRow);
    });
    // switch to allocation view
    await act(async () => {
      fireEvent.click(screen.getByText('Allocation'));
    });
    expect(screen.getByText('Asset Allocation')).toBeInTheDocument();
    // back to performance
    await act(async () => {
      fireEvent.click(screen.getByText('Holdings'));
    });
    // change account filter via the multi-select; selecting the single USD
    // account exercises the foreign-currency summary path
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Filter by account' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('RRSP'));
    });
    // export pdf
    const exportBtn = screen.getByRole('button', { name: /export/i });
    await act(async () => {
      fireEvent.click(exportBtn);
    });
    const pdfBtn = screen.queryByText(/PDF/i);
    if (pdfBtn) {
      await act(async () => {
        fireEvent.click(pdfBtn);
      });
    }
  });

  it('draws the historical performance chart for the held securities, deduped', async () => {
    mockGetPortfolioSummary.mockResolvedValue(fullPortfolio);
    mockGetInvestmentAccounts.mockResolvedValue([]);
    render(<InvestmentPerformanceReport />);
    const chart = await screen.findByTestId('performance-chart');
    // sec-vfv is held in two accounts but is one line, not two; a zero-quantity
    // holding (sec-xic) still has a return history worth plotting.
    expect(chart.getAttribute('data-security-ids')).toBe('sec-vfv,sec-xic,sec-aapl');
    // The window's start and end are handed down (default 1y range), so the
    // chart requests the same period the report is scoped to.
    expect(chart.getAttribute('data-start')).toBeTruthy();
    expect(chart.getAttribute('data-end')).toBeTruthy();
    // The point-in-time donut is gone from the Performance view; composition
    // now lives under Allocation.
    expect(screen.queryByTestId('pie-chart')).not.toBeInTheDocument();
  });

  it('handles loss case (negative totalGainLoss)', async () => {
    mockGetPortfolioSummary.mockResolvedValue({
      ...fullPortfolio,
      totalGainLoss: -500,
      totalGainLossPercent: -3.5,
    });
    mockGetInvestmentAccounts.mockResolvedValue([]);
    render(<InvestmentPerformanceReport />);
    await waitFor(() => {
      expect(screen.getByText('Total Value')).toBeInTheDocument();
    });
  });

  it('handles unknown account in expansion mapping', async () => {
    mockGetPortfolioSummary.mockResolvedValue(fullPortfolio);
    mockGetInvestmentAccounts.mockResolvedValue([]);
    render(<InvestmentPerformanceReport />);
    await waitFor(() => {
      expect(screen.getByText('Total Value')).toBeInTheDocument();
    });
    // Find VFV row and click it
    const vfvCells = screen.getAllByText('VFV').filter((el) => el.closest('tr'));
    const row = vfvCells[0].closest('tr');
    await act(async () => {
      fireEvent.click(row!);
    });
    expect(screen.getAllByText(/Unknown account/i).length).toBeGreaterThan(0);
  });

  it('exercises every sortable column on the holdings table', async () => {
    mockGetPortfolioSummary.mockResolvedValue({
      holdings: [
        { id: 'h1', accountId: 'a1', securityId: 's1', symbol: 'AAA', name: 'Alpha', currencyCode: 'USD', securityType: 'STOCK', quantity: 10, averageCost: 50, costBasis: 500, currentPrice: 100, marketValue: 1000, gainLoss: 500, gainLossPercent: 100 },
        { id: 'h2', accountId: 'a1', securityId: 's2', symbol: 'BBB', name: 'Bravo', currencyCode: 'USD', securityType: 'ETF', quantity: 5, averageCost: 80, costBasis: 400, currentPrice: 90, marketValue: 450, gainLoss: 50, gainLossPercent: 12.5 },
      ],
      allocation: [],
      totalPortfolioValue: 1450,
      totalCostBasis: 900,
      totalGainLoss: 550,
      totalGainLossPercent: 61.1,
    });
    mockGetInvestmentAccounts.mockResolvedValue([]);
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(<InvestmentPerformanceReport />));
    });
    await waitFor(() => expect(container.querySelector('table')).toBeInTheDocument());
    const headerCount = container.querySelectorAll('table thead th').length;
    expect(headerCount).toBeGreaterThan(0);
    for (let __i = 0; __i < headerCount; __i += 1) {
      const __ths = container.querySelectorAll('table thead th');
      if (!__ths[__i]) break;
      await act(async () => { fireEvent.click(__ths[__i]); });
    }
    for (let __i = 0; __i < headerCount; __i += 1) {
      const __ths = container.querySelectorAll('table thead th');
      if (!__ths[__i]) break;
      await act(async () => { fireEvent.click(__ths[__i]); });
    }
  });

  it('restores the persisted account selection', async () => {
    window.localStorage.setItem(
      'monize-reports-investment-performance-accounts',
      JSON.stringify(['acc-1']),
    );
    mockGetPortfolioSummary.mockResolvedValue(fullPortfolio);
    mockGetInvestmentAccounts.mockResolvedValue([{ id: 'acc-1', name: 'TFSA', currencyCode: 'CAD', accountSubType: 'INVESTMENT_CASH' }]);
    render(<InvestmentPerformanceReport />);
    await waitFor(() => {
      expect(mockGetPortfolioSummary).toHaveBeenCalledWith(['acc-1']);
    });
  });

  it('drops persisted account IDs that no longer exist once accounts load', async () => {
    window.localStorage.setItem(
      'monize-reports-investment-performance-accounts',
      JSON.stringify(['acc-1', 'gone']),
    );
    mockGetPortfolioSummary.mockResolvedValue(fullPortfolio);
    mockGetInvestmentAccounts.mockResolvedValue([{ id: 'acc-1', name: 'TFSA', currencyCode: 'CAD', accountSubType: 'INVESTMENT_CASH' }]);
    render(<InvestmentPerformanceReport />);
    await waitFor(() => {
      expect(
        window.localStorage.getItem('monize-reports-investment-performance-accounts'),
      ).toBe(JSON.stringify(['acc-1']));
    });
  });
  describe('gain over the priced holdings (A26-M38)', () => {
    // Priced A: value 100,000, cost 80,000. Unpriced B: cost 50,000. The server's
    // gain is +20,000 / +25% over A. Value less every cost is -30,000.
    const incompleteAccount = {
      accountId: 'acc-1',
      accountName: 'TFSA',
      currencyCode: 'CAD',
      totalMarketValue: 100000,
      cashBalance: 0,
      totalCostBasis: 130000,
      gainCostBasis: 80000,
      unpricedCostBasis: 50000,
      totalGainLoss: 20000,
      totalGainLossPercent: 25,
      unpricedHoldingsCount: 1,
      fxComplete: true,
      missingRatePairs: [],
      pricesComplete: false,
      unpricedSecurityIds: ['sec-xic'],
      valuationComplete: false,
    };
    const incompletePortfolio = {
      ...fullPortfolio,
      holdingsByAccount: [incompleteAccount],
      totalPortfolioValue: 100000,
      totalCostBasis: 130000,
      gainCostBasis: 80000,
      unpricedCostBasis: 50000,
      totalGainLoss: 20000,
      totalGainLossPercent: 25,
      fxComplete: true,
      missingRatePairs: [],
      pricesComplete: false,
      unpricedSecurityIds: ['sec-xic'],
      valuationComplete: false,
    };

    it('marks the all-accounts gain and return as partial and never prints -30,000', async () => {
      mockGetPortfolioSummary.mockResolvedValue(incompletePortfolio);
      mockGetInvestmentAccounts.mockResolvedValue([]);
      render(<InvestmentPerformanceReport />);
      await waitFor(() => {
        expect(screen.getByText('Total Gain/Loss')).toBeInTheDocument();
      });

      expect(screen.queryByText('-$30000.00')).not.toBeInTheDocument();
      expect(screen.queryByText('$-30000.00')).not.toBeInTheDocument();
      const gain = screen.getByText('+$20000.00');
      expect(gain.closest('[data-testid="partial-total"]')).not.toBeNull();
      const ret = screen.getByText('+25.00%');
      expect(ret.closest('[data-testid="partial-total"]')).not.toBeNull();
    });

    it('reads the server per-account gain when a single account is selected', async () => {
      window.localStorage.setItem(
        'monize-reports-investment-performance-accounts',
        JSON.stringify(['acc-1']),
      );
      mockGetPortfolioSummary.mockResolvedValue(incompletePortfolio);
      mockGetInvestmentAccounts.mockResolvedValue([
        { id: 'acc-1', name: 'TFSA', currencyCode: 'CAD', accountSubType: 'INVESTMENT_CASH' },
      ]);
      render(<InvestmentPerformanceReport />);
      await waitFor(() => {
        expect(screen.getByText('Total Gain/Loss')).toBeInTheDocument();
      });

      expect(screen.queryByText('-$30000.00')).not.toBeInTheDocument();
      expect(screen.queryByText('$-30000.00')).not.toBeInTheDocument();
      const gain = screen.getByText('+$20000.00');
      expect(gain.closest('[data-testid="partial-total"]')).not.toBeNull();
      expect(screen.getByText('+25.00%')).toBeInTheDocument();
      window.localStorage.removeItem('monize-reports-investment-performance-accounts');
    });

    it('marks the Total Value card partial, and the Cost Basis card only when a cost had no rate', async () => {
      const cardFigure = (label: string) =>
        screen.getByText(label).parentElement!.querySelector('[data-testid="partial-total"]');

      mockGetPortfolioSummary.mockResolvedValue(incompletePortfolio);
      mockGetInvestmentAccounts.mockResolvedValue([]);
      const { unmount } = render(<InvestmentPerformanceReport />);
      await waitFor(() => {
        expect(screen.getByText('Total Value')).toBeInTheDocument();
      });
      // An unpriced holding is missing from the value; every cost is counted.
      expect(cardFigure('Total Value')).not.toBeNull();
      expect(cardFigure('Cost Basis')).toBeNull();
      unmount();

      mockGetPortfolioSummary.mockResolvedValue({
        ...incompletePortfolio,
        fxComplete: false,
        missingRatePairs: ['EUR->CAD'],
      });
      render(<InvestmentPerformanceReport />);
      await waitFor(() => {
        expect(screen.getByText('Cost Basis')).toBeInTheDocument();
      });
      expect(cardFigure('Cost Basis')).not.toBeNull();
    });

    it('leaves a complete portfolio unmarked', async () => {
      mockGetPortfolioSummary.mockResolvedValue({
        ...fullPortfolio,
        fxComplete: true,
        pricesComplete: true,
        valuationComplete: true,
        unpricedSecurityIds: [],
        missingRatePairs: [],
      });
      mockGetInvestmentAccounts.mockResolvedValue([]);
      render(<InvestmentPerformanceReport />);
      await waitFor(() => {
        expect(screen.getByText('Total Gain/Loss')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('partial-total')).not.toBeInTheDocument();
    });
  });
});
