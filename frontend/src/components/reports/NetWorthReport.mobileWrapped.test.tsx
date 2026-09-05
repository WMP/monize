import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@/test/render';
import { NetWorthReport } from './NetWorthReport';

/**
 * The phone layout of the Net Worth table view.
 *
 * The table is ONE tree restyled by CSS (mechanism A): below `sm` the rows wrap
 * into a two-column, two-line grid and the column header row is hidden, from
 * `sm` up it is the ordinary table. jsdom applies no media queries, so both
 * header rows and every phone caption are in the DOM here at all times -- which
 * is exactly what lets these assertions read the phone markup without emulating
 * a viewport, and why the sort controls have to be addressed by position rather
 * than by label (each label matches the phone strip, the column header row, and
 * a caption).
 */

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/reports/net-worth',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ reportId: 'net-worth' }),
}));

vi.mock('@/lib/pdf-export', () => ({
  exportToPdf: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/components/ui/ChartViewToggle', () => ({
  ChartViewToggle: ({ onChange }: any) => (
    <div data-testid="chart-view-toggle">
      <button data-testid="toggle-table" onClick={() => onChange('table')}>Table</button>
    </div>
  ),
}));

vi.mock('@/hooks/useNumberFormat', () => ({
  useNumberFormat: () => ({
    formatSignedPercent: (n: number, decimals = 2) => `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`,
    formatCurrencyCompact: (n: number) => `$${n.toFixed(0)}`,
    formatCurrency: (n: number) => `$${n.toFixed(2)}`,
    formatCurrencyAxis: (n: number) => `$${n}`,
    formatCurrencyLabel: (n: number) => `$${n.toFixed(0)}`,
    defaultCurrency: 'CAD',
  }),
}));

const STABLE_RANGE = { start: '2024-01-01', end: '2025-01-01' };
vi.mock('@/hooks/useDateRange', () => ({
  useDateRange: () => ({
    dateRange: '1y',
    setDateRange: vi.fn(),
    startDate: '',
    setStartDate: vi.fn(),
    endDate: '',
    setEndDate: vi.fn(),
    resolvedRange: STABLE_RANGE,
    isValid: true,
  }),
}));

vi.mock('@/components/ui/DateRangeSelector', () => ({
  DateRangeSelector: () => <div data-testid="date-range-selector" />,
}));

vi.mock('@/components/ui/ExportDropdown', () => ({
  ExportDropdown: () => <div data-testid="export-dropdown" />,
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Area: () => null,
  Bar: ({ children }: any) => <div>{children}</div>,
  LabelList: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ReferenceLine: () => null,
  ReferenceDot: () => null,
}));

const mockGetMonthly = vi.fn();

vi.mock('@/lib/net-worth', () => ({
  netWorthApi: {
    getMonthly: (...args: any[]) => mockGetMonthly(...args),
    recalculate: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Worst case for a phone: seven-figure assets and liabilities, and a month
// whose net worth is negative, so both branches of this table's sign colouring
// (neutral at or above zero, red below) are exercised.
const RESPONSE = [
  { month: '2024-01-01', assets: 1439000, liabilities: 987654, netWorth: 451346 },
  { month: '2024-02-01', assets: 987654, liabilities: 1439000, netWorth: -451346 },
];

async function renderTableView() {
  mockGetMonthly.mockResolvedValue(RESPONSE);
  const { container } = render(<NetWorthReport />);
  await waitFor(() =>
    expect(screen.getByTestId('toggle-table')).toBeInTheDocument(),
  );
  await act(async () => {
    fireEvent.click(screen.getByTestId('toggle-table'));
  });
  await waitFor(() => expect(container.querySelector('table')).toBeInTheDocument());
  return container;
}

const rowText = (row: Element | null | undefined) => row?.textContent ?? '';

const findRow = (container: Element, month: string) =>
  Array.from(container.querySelectorAll('tbody tr')).find((r) =>
    r.textContent?.includes(month),
  );

describe('NetWorthReport (phone wrapped table)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPush.mockClear();
    window.localStorage.clear();
  });

  it('captions every amount inside the row so a phone needs no column header', async () => {
    const container = await renderTableView();

    const row = findRow(container, 'Jan 2024');
    expect(row).toBeDefined();
    // Each value names its own column, beside the value itself.
    for (const caption of ['Assets', 'Liabilities', 'Net Worth']) {
      expect(rowText(row)).toContain(caption);
    }
    // Each caption sits immediately beside the value it names, as its own text
    // node, so a `getByText` on the value still matches the value node.
    expect(rowText(row)).toContain('Assets$1439000');
    expect(rowText(row)).toContain('Liabilities$987654');
    expect(rowText(row)).toContain('Net Worth$451346');
  });

  it('colours the net worth by its sign, both ways, in the card', async () => {
    const container = await renderTableView();

    // Neutral at or above zero -- this table's rule, and not the green/red
    // gain-loss pair the sibling reports use for a change in value.
    const positive = findRow(container, 'Jan 2024')?.querySelector('.row-start-1.col-start-2');
    expect(positive?.className).toContain('text-gray-900');
    expect(positive?.className).toContain('dark:text-gray-100');
    expect(positive?.className).not.toContain('text-green-600');

    const negative = findRow(container, 'Feb 2024')?.querySelector('.row-start-1.col-start-2');
    expect(rowText(findRow(container, 'Feb 2024'))).toContain('Net Worth$-451346');
    expect(negative?.className).toContain('text-red-600');
    expect(negative?.className).toContain('dark:text-red-400');
  });

  it('places every cell on the phone grid explicitly, and never wraps a number', async () => {
    const container = await renderTableView();

    // Auto-flow placement is not deterministic once a cell is added or made
    // conditional, so each cell states its own column and line. A money value
    // stays on one line: a locale grouping thousands with a space would
    // otherwise break in the middle of a number.
    const rows = Array.from(container.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td'));
      expect(cells).toHaveLength(4);
      for (const cell of cells) {
        expect(cell.className).toMatch(/\bcol-start-\d\b/);
        expect(cell.className).toMatch(/\brow-start-\d\b/);
      }
      // The three money cells (everything but the month) never wrap, and each
      // is right-aligned. Right alignment is not containment -- an amount past
      // the measured budget overflows the END edge and reopens the wrapper's
      // scroll -- but truncating a figure would be worse.
      const money = cells.filter((c) => c.className.includes('whitespace-nowrap'));
      expect(money).toHaveLength(3);
      for (const cell of money) {
        expect(cell.className).toContain('text-right');
      }
    }
  });

  it('wraps each row onto two lines: month and net worth, then assets and liabilities', async () => {
    const container = await renderTableView();

    // The card is two lines tall on two equal tracks: the month and the net
    // worth (the figure the row is read for) on line 1, the two figures the net
    // worth is made of on line 2. DOM order is the desktop column order, so the
    // placement is read off the classes rather than off position.
    const placement = (cell: Element) => {
      const col = /\bcol-start-(\d)\b/.exec(cell.className)?.[1];
      const line = /\brow-start-(\d)\b/.exec(cell.className)?.[1];
      const span = /\bcol-span-(\d)\b/.exec(cell.className)?.[1] ?? '1';
      return `c${col}/r${line}/s${span}`;
    };
    for (const row of Array.from(container.querySelectorAll('tbody tr'))) {
      const [month, assets, liabilities, netWorth] = Array.from(row.querySelectorAll('td'));
      expect(row.className).toContain('grid-cols-2');
      expect(placement(month)).toBe('c1/r1/s1');
      expect(placement(netWorth)).toBe('c2/r1/s1');
      expect(placement(assets)).toBe('c1/r2/s1');
      expect(placement(liabilities)).toBe('c2/r2/s1');
      // Nothing is placed on a third line.
      for (const cell of [month, assets, liabilities, netWorth]) {
        expect(cell.className).not.toMatch(/\brow-start-3\b/);
      }
    }
  });

  it('keeps the row a table row from sm up and a grid below it', async () => {
    const container = await renderTableView();

    const table = container.querySelector('table');
    expect(table?.className).toContain('block');
    expect(table?.className).toContain('sm:table');
    expect(container.querySelector('thead')?.className).toContain('sm:table-header-group');
    expect(container.querySelector('tbody')?.className).toContain('sm:table-row-group');
    const row = container.querySelector('tbody tr');
    expect(row?.className).toContain('grid grid-cols-2');
    expect(row?.className).toContain('sm:table-row');
    // The wrapper still scrolls horizontally, which is what the table needs
    // from `sm` up on a narrow desktop window.
    expect(table?.parentElement?.className).toContain('overflow-x-auto');
  });

  it('restores the table semantics a phone restyle strips', async () => {
    const container = await renderTableView();

    const table = container.querySelector('table');
    expect(table?.getAttribute('role')).toBe('table');
    for (const group of ['thead', 'tbody']) {
      expect(container.querySelector(group)?.getAttribute('role')).toBe('rowgroup');
    }
    // This table has no `tfoot`; nothing should have grown one.
    expect(container.querySelector('tfoot')).toBeNull();
    for (const row of Array.from(container.querySelectorAll('tr'))) {
      expect(row.getAttribute('role')).toBe('row');
    }
    for (const cell of Array.from(container.querySelectorAll('td'))) {
      expect(cell.getAttribute('role')).toBe('cell');
    }
    // `SortableHeader` restates `columnheader` on the `<th>` it renders, so
    // both header rows already carry it.
    for (const th of Array.from(container.querySelectorAll('th'))) {
      expect(th.getAttribute('role')).toBe('columnheader');
    }
  });

  it('offers the same four sort controls on phones as in the column header', async () => {
    const container = await renderTableView();

    const headerRows = Array.from(container.querySelectorAll('thead tr'));
    expect(headerRows).toHaveLength(2);
    const [phoneRow, columnRow] = headerRows;
    // Exactly one of the two is displayed at any width.
    expect(phoneRow.className).toContain('sm:hidden');
    expect(columnRow.className).toContain('hidden');
    expect(columnRow.className).toContain('sm:table-row');

    // The sort indicator glyph rides inside each control, so compare the labels
    // with it stripped.
    const labelsOf = (row: Element) =>
      Array.from(row.querySelectorAll('th')).map((th) =>
        th.textContent?.replace(/[↑↓↕]/g, '').trim(),
      );
    expect(labelsOf(phoneRow)).toEqual(['Month', 'Assets', 'Liabilities', 'Net Worth']);
    // Both rows are rendered from one list, so they cannot list different
    // fields -- assert it rather than trusting the loop.
    expect(labelsOf(columnRow)).toEqual(labelsOf(phoneRow));
  });

  it('sorts from the phone strip, not only from the column header', async () => {
    const container = await renderTableView();

    const monthOrder = () =>
      Array.from(container.querySelectorAll('tbody tr')).map(
        (r) => r.querySelector('td')?.textContent,
      );
    expect(monthOrder()).toEqual(['Jan 2024', 'Feb 2024']);

    // "Net Worth" in the PHONE strip -- the header row that survives below
    // `sm`, identified by the class that hides it from `sm` up rather than by
    // its position, so this cannot silently fall through to the column header
    // row. Within it the control is the fourth of four (Month, Assets,
    // Liabilities, Net Worth), addressed by position because the label also
    // appears in the column header row and in every caption.
    const phoneStrip = Array.from(container.querySelectorAll('thead tr')).find((r) =>
      r.className.includes('sm:hidden'),
    );
    expect(phoneStrip).toBeDefined();
    const phoneNetWorth = phoneStrip!.querySelectorAll('th')[3];
    await act(async () => {
      fireEvent.click(phoneNetWorth);
    });
    // Ascending by net worth puts February's -$451,346 first.
    expect(monthOrder()).toEqual(['Feb 2024', 'Jan 2024']);
  });

  it('leaves the row non-clickable, as it is today', async () => {
    const container = await renderTableView();

    const rows = Array.from(container.querySelectorAll('tbody tr'));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // A pointer cue would promise an action the row does not have.
      expect(row.className).not.toContain('cursor-pointer');
      await act(async () => {
        fireEvent.click(row);
      });
    }
    // The behaviour claim, not the attribute: clicking navigates nowhere.
    expect(mockPush).not.toHaveBeenCalled();
    // And the rows are still there -- the click changed nothing.
    expect(
      Array.from(container.querySelectorAll('tbody tr')).map(
        (r) => r.querySelector('td')?.textContent,
      ),
    ).toEqual(['Jan 2024', 'Feb 2024']);
  });
});
