import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@/test/render';
import { BrokerImport } from './BrokerImport';
import { brokerImportApi } from '@/lib/ai-broker-import';
import type { BrokerImportParseResponse } from '@/lib/ai-broker-import';
import { accountsApi } from '@/lib/accounts';
import { investmentsApi } from '@/lib/investments';

vi.mock('@/lib/ai-broker-import', () => ({
  brokerImportApi: {
    parse: vi.fn(),
    apply: vi.fn(),
  },
}));

vi.mock('@/lib/accounts', () => ({
  accountsApi: {
    getAll: vi.fn(),
  },
}));

vi.mock('@/lib/investments', () => ({
  investmentsApi: {
    getSecurities: vi.fn(),
  },
}));

const mockedApi = vi.mocked(brokerImportApi);
const mockedAccounts = vi.mocked(accountsApi);
const mockedInvestments = vi.mocked(investmentsApi);

// A brokerage account (eligible) and a chequing account (must be filtered out).
const ACCOUNTS = [
  {
    id: 'acc-broker',
    name: 'Brokerage',
    accountType: 'INVESTMENT',
    accountSubType: 'INVESTMENT_BROKERAGE',
    currencyCode: 'USD',
    isClosed: false,
    isFavourite: false,
    favouriteSortOrder: 0,
  },
  {
    id: 'acc-chequing',
    name: 'Chequing',
    accountType: 'CHEQUING',
    accountSubType: null,
    currencyCode: 'USD',
    isClosed: false,
    isFavourite: false,
    favouriteSortOrder: 0,
  },
];

const SECURITIES = [
  {
    id: 'sec-aapl',
    symbol: 'AAPL',
    name: 'Apple Inc',
    currencyCode: 'USD',
    exchange: 'NASDAQ',
  },
];

// One order matched to an existing security, one with no match (create new).
const PARSE_RESPONSE: BrokerImportParseResponse = {
  model: 'test-model',
  warnings: ['Could not match "Acme Corp" to a known security'],
  orders: [
    {
      rowId: 'r1',
      securityName: 'Apple Inc',
      exchange: 'NASDAQ',
      side: 'BUY',
      quantity: 10,
      price: 150,
      value: 1500,
      commission: 1,
      currency: 'USD',
      tradeDate: '2026-01-02',
      matchedSecurityId: 'sec-aapl',
      matchedSecurityName: 'Apple Inc',
    },
    {
      rowId: 'r2',
      securityName: 'Acme Corp',
      exchange: 'NYSE',
      side: 'SELL',
      quantity: 5,
      price: 20,
      value: 100,
      commission: 2,
      currency: 'USD',
      tradeDate: '2026-01-03',
      matchedSecurityId: null,
      matchedSecurityName: null,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedAccounts.getAll.mockResolvedValue(ACCOUNTS as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockedInvestments.getSecurities.mockResolvedValue(SECURITIES as any);
  mockedApi.parse.mockResolvedValue(PARSE_RESPONSE);
  mockedApi.apply.mockResolvedValue({
    created: 2,
    securitiesCreated: 1,
    skipped: 0,
    errors: [],
  });
});

async function renderComponent() {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(<BrokerImport />);
  });
  return result!;
}

/** Fire a paste event carrying both text/html and text/plain. */
function pasteInto(el: Element, html: string, text: string) {
  fireEvent.paste(el, {
    clipboardData: {
      getData: (type: string) =>
        type === 'text/html' ? html : type === 'text/plain' ? text : '',
    },
  });
}

describe('BrokerImport', () => {
  it('captures text/html on paste and shows a capture hint', async () => {
    await renderComponent();
    const box = screen.getByLabelText('Paste your brokerage order history');

    await act(async () => {
      pasteInto(
        box,
        '<table><tr><td>Apple</td></tr><tr><td>Acme</td></tr></table>',
        'garbled plain text',
      );
    });

    // The HTML branch was taken (2 <tr> rows detected), not the plain text.
    expect(screen.getByText(/HTML table captured/)).toBeInTheDocument();
    expect(screen.getByText(/~2 rows/)).toBeInTheDocument();
  });

  it('renders parsed orders and warnings in the preview table', async () => {
    await renderComponent();
    const box = screen.getByLabelText('Paste your brokerage order history');
    await act(async () => {
      pasteInto(box, '<table><tr><td>x</td></tr></table>', 'x');
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Parse' }));
    });

    await waitFor(() =>
      expect(mockedApi.parse).toHaveBeenCalledWith(
        '<table><tr><td>x</td></tr></table>',
      ),
    );

    // Both order rows show their security names; the warning is surfaced.
    expect(screen.getByText('Apple Inc')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(
      screen.getByText(/Could not match "Acme Corp"/),
    ).toBeInTheDocument();
  });

  it('builds the apply body with existing securityId, newSecurity, and chosen account', async () => {
    await renderComponent();
    const box = screen.getByLabelText('Paste your brokerage order history');
    await act(async () => {
      pasteInto(box, '<table><tr><td>x</td></tr></table>', 'x');
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Parse' }));
    });
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());

    // Pick the target brokerage account (the chequing account is filtered out).
    const accountSelect = screen.getByLabelText('Target account');
    await act(async () => {
      fireEvent.change(accountSelect, { target: { value: 'acc-broker' } });
    });
    // Chequing should not be an option.
    expect(
      screen.queryByRole('option', { name: /Chequing/ }),
    ).not.toBeInTheDocument();

    // Row 2 (Acme) has no match -> open its security Combobox and create new.
    // There are two comboboxes (one per row); the Apple row defaults to the
    // matched security, so its input shows the matched label and the Acme one
    // is the empty placeholder. Grab the empty one.
    const comboInputs = screen.getAllByPlaceholderText(
      'Choose a security',
    ) as HTMLInputElement[];
    const emptyCombo = comboInputs.find((i) => i.value === '')!;
    await act(async () => {
      fireEvent.focus(emptyCombo);
      fireEvent.click(emptyCombo);
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Create new security...'));
    });

    // Fill the required symbol for the new security.
    const symbolInput = screen.getByLabelText('Symbol for Acme Corp');
    await act(async () => {
      fireEvent.change(symbolInput, { target: { value: 'ACME' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add selected' }));
    });

    await waitFor(() => expect(mockedApi.apply).toHaveBeenCalledTimes(1));
    const body = mockedApi.apply.mock.calls[0][0];
    expect(body.accountId).toBe('acc-broker');
    expect(body.orders).toHaveLength(2);

    const appleOrder = body.orders.find((o) => o.securityId === 'sec-aapl');
    expect(appleOrder).toMatchObject({
      securityId: 'sec-aapl',
      side: 'BUY',
      quantity: 10,
      price: 150,
      commission: 1,
      currency: 'USD',
      tradeDate: '2026-01-02',
    });
    expect(appleOrder?.newSecurity).toBeUndefined();

    const acmeOrder = body.orders.find((o) => o.newSecurity);
    expect(acmeOrder?.securityId).toBeUndefined();
    expect(acmeOrder?.newSecurity).toMatchObject({
      symbol: 'ACME',
      name: 'Acme Corp',
      currency: 'USD',
    });
    expect(acmeOrder?.side).toBe('SELL');
  });

  it('only includes checked rows in the apply body', async () => {
    await renderComponent();
    const box = screen.getByLabelText('Paste your brokerage order history');
    await act(async () => {
      pasteInto(box, '<table><tr><td>x</td></tr></table>', 'x');
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Parse' }));
    });
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Target account'), {
        target: { value: 'acc-broker' },
      });
    });

    // Uncheck the Acme row (the one needing a new security) so only Apple
    // (which has a matched security id by default) is applied.
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Add Acme Corp'));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add selected' }));
    });

    await waitFor(() => expect(mockedApi.apply).toHaveBeenCalledTimes(1));
    const body = mockedApi.apply.mock.calls[0][0];
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0].securityId).toBe('sec-aapl');
  });
});
