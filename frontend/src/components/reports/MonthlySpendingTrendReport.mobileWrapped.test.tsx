import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@/test/render";
import { MonthlySpendingTrendReport } from "./MonthlySpendingTrendReport";

/**
 * The phone layout of the Monthly Spending Trend table view.
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/hooks/useNumberFormat", () => ({
  useNumberFormat: () => ({
    formatCurrencyCompact: (n: number) => `$${n.toFixed(0)}`,
    formatCurrency: (n: number) => `$${n.toFixed(2)}`,
    formatCurrencyAxis: (n: number) => `$${n}`,
    defaultCurrency: "CAD",
  }),
}));

const STABLE_RANGE = { start: "2024-01-01", end: "2025-01-01" };
vi.mock("@/hooks/useDateRange", () => ({
  useDateRange: () => ({
    dateRange: "1y",
    setDateRange: vi.fn(),
    startDate: "",
    setStartDate: vi.fn(),
    endDate: "",
    setEndDate: vi.fn(),
    resolvedRange: STABLE_RANGE,
    isValid: true,
  }),
}));

vi.mock("@/components/ui/DateRangeSelector", () => ({
  DateRangeSelector: () => <div data-testid="date-range-selector" />,
}));

vi.mock("@/components/ui/ChartViewToggle", () => ({
  ChartViewToggle: ({ onChange }: any) => (
    <div data-testid="chart-view-toggle">
      <button data-testid="toggle-table" onClick={() => onChange("table")}>Table</button>
    </div>
  ),
}));

vi.mock("@/components/ui/ExportDropdown", () => ({
  ExportDropdown: () => <div data-testid="export-dropdown" />,
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

const mockGetIncomeVsExpenses = vi.fn();

vi.mock("@/lib/built-in-reports", () => ({
  builtInReportsApi: {
    getIncomeVsExpenses: (...args: any[]) => mockGetIncomeVsExpenses(...args),
  },
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Worst case for a phone: six-figure income and expenses, and a month whose
// net is negative, so the `gainLossColor` sign colouring is exercised too.
// The totals row nets out negative for the same reason.
const RESPONSE = {
  data: [
    { month: "2024-01", income: 125400, expenses: 98750, net: 26650 },
    { month: "2024-02", income: 101200, expenses: 143900, net: -42700 },
  ],
};

async function renderTableView() {
  mockGetIncomeVsExpenses.mockResolvedValue(RESPONSE);
  const { container } = render(<MonthlySpendingTrendReport />);
  await waitFor(() =>
    expect(screen.getByTestId("toggle-table")).toBeInTheDocument(),
  );
  await act(async () => {
    fireEvent.click(screen.getByTestId("toggle-table"));
  });
  await waitFor(() => expect(container.querySelector("table")).toBeInTheDocument());
  return container;
}

const rowText = (row: Element | null | undefined) => row?.textContent ?? "";

describe("MonthlySpendingTrendReport (phone wrapped table)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPush.mockClear();
  });

  it("captions every amount inside the row so a phone needs no column header", async () => {
    const container = await renderTableView();

    const row = Array.from(container.querySelectorAll("tbody tr")).find((r) =>
      r.textContent?.includes("Jan 2024"),
    );
    expect(row).toBeDefined();
    // Each value names its own column, beside the value itself.
    for (const caption of ["Income", "Expenses", "Net"]) {
      expect(rowText(row)).toContain(caption);
    }
    // Each caption sits immediately beside the value it names, as its own
    // text node, so a `getByText` on the value still matches the value node.
    expect(rowText(row)).toContain("Income$125400");
    expect(rowText(row)).toContain("Expenses$98750");
    expect(rowText(row)).toContain("Net$26650");
  });

  it("keeps the negative net red in the card, from the same helper the column uses", async () => {
    const container = await renderTableView();

    const row = Array.from(container.querySelectorAll("tbody tr")).find((r) =>
      r.textContent?.includes("Feb 2024"),
    );
    expect(rowText(row)).toContain("Net$-42700");
    const netCell = row?.querySelector(".row-start-1.col-start-2");
    expect(netCell?.className).toContain("text-red-600");
    expect(netCell?.className).toContain("dark:text-red-400");
  });

  it("captions the totals row too, and keeps its negative net signed", async () => {
    const container = await renderTableView();

    const footRow = container.querySelector("tfoot tr");
    for (const caption of ["Total", "Income", "Expenses", "Net"]) {
      expect(rowText(footRow)).toContain(caption);
    }
    // 226,600 income against 242,650 of expenses: a negative net total.
    expect(rowText(footRow)).toContain("Income$226600");
    expect(rowText(footRow)).toContain("Expenses$242650");
    expect(rowText(footRow)).toContain("Net$-16050");
    const netCell = footRow?.querySelector(".row-start-1.col-start-2");
    expect(netCell?.className).toContain("text-red-600");
  });

  it("places every cell on the phone grid explicitly, and never wraps a number", async () => {
    const container = await renderTableView();

    // Auto-flow placement is not deterministic once a cell is added or made
    // conditional, so each cell states its own column and line. A money value
    // stays on one line: a locale grouping thousands with a space would
    // otherwise break in the middle of a number.
    for (const row of [
      ...Array.from(container.querySelectorAll("tbody tr")),
      ...Array.from(container.querySelectorAll("tfoot tr")),
    ]) {
      const cells = Array.from(row.querySelectorAll("td"));
      expect(cells.length).toBe(4);
      for (const cell of cells) {
        expect(cell.className).toMatch(/\bcol-start-\d\b/);
        expect(cell.className).toMatch(/\brow-start-\d\b/);
      }
      // The three money cells (everything but the month/label) never wrap, and
      // each is right-aligned. Right alignment is not containment -- an amount
      // past the measured budget overflows the END edge and reopens the
      // wrapper's scroll -- but truncating a figure would be worse.
      const money = cells.filter((c) => c.className.includes("whitespace-nowrap"));
      expect(money).toHaveLength(3);
      for (const cell of money) {
        expect(cell.className).toContain("text-right");
      }
    }
  });

  it("wraps each row onto two lines: month and net, then income and expenses", async () => {
    const container = await renderTableView();

    // The card is two lines tall on two equal tracks: the month and the net
    // (the figure the row is read for) on line 1, the two figures the net is
    // made of on line 2. DOM order is the desktop column order, so the
    // placement is read off the classes rather than off position.
    const placement = (cell: Element) => {
      const col = /\bcol-start-(\d)\b/.exec(cell.className)?.[1];
      const row = /\brow-start-(\d)\b/.exec(cell.className)?.[1];
      const span = /\bcol-span-(\d)\b/.exec(cell.className)?.[1] ?? "1";
      return `c${col}/r${row}/s${span}`;
    };
    for (const row of [
      ...Array.from(container.querySelectorAll("tbody tr")),
      ...Array.from(container.querySelectorAll("tfoot tr")),
    ]) {
      const [month, income, expenses, net] = Array.from(row.querySelectorAll("td"));
      expect(row.className).toContain("grid-cols-2");
      expect(placement(month)).toBe("c1/r1/s1");
      expect(placement(net)).toBe("c2/r1/s1");
      expect(placement(income)).toBe("c1/r2/s1");
      expect(placement(expenses)).toBe("c2/r2/s1");
      // Nothing is placed on a third line.
      for (const cell of [month, income, expenses, net]) {
        expect(cell.className).not.toMatch(/\brow-start-3\b/);
      }
    }
  });

  it("keeps the row a table row from sm up and a grid below it", async () => {
    const container = await renderTableView();

    const table = container.querySelector("table");
    expect(table?.className).toContain("block");
    expect(table?.className).toContain("sm:table");
    expect(container.querySelector("tbody")?.className).toContain("sm:table-row-group");
    expect(container.querySelector("tfoot")?.className).toContain("sm:table-footer-group");
    const row = container.querySelector("tbody tr");
    expect(row?.className).toContain("grid grid-cols-2");
    expect(row?.className).toContain("sm:table-row");
    // The wrapper still scrolls horizontally, which is what the table needs
    // from `sm` up on a narrow desktop window.
    expect(table?.parentElement?.className).toContain("overflow-x-auto");
  });

  it("restores the table semantics a phone restyle strips", async () => {
    const container = await renderTableView();

    const table = container.querySelector("table");
    expect(table?.getAttribute("role")).toBe("table");
    for (const group of ["thead", "tbody", "tfoot"]) {
      expect(container.querySelector(group)?.getAttribute("role")).toBe("rowgroup");
    }
    for (const row of Array.from(container.querySelectorAll("tr"))) {
      expect(row.getAttribute("role")).toBe("row");
    }
    for (const cell of Array.from(container.querySelectorAll("td"))) {
      expect(cell.getAttribute("role")).toBe("cell");
    }
    // `SortableHeader` restates `columnheader` on the `<th>` it renders, so
    // both header rows already carry it.
    for (const th of Array.from(container.querySelectorAll("th"))) {
      expect(th.getAttribute("role")).toBe("columnheader");
    }
  });

  it("offers the same four sort controls on phones as in the column header", async () => {
    const container = await renderTableView();

    const headerRows = Array.from(container.querySelectorAll("thead tr"));
    expect(headerRows).toHaveLength(2);
    const [phoneRow, columnRow] = headerRows;
    // Exactly one of the two is displayed at any width.
    expect(phoneRow.className).toContain("sm:hidden");
    expect(columnRow.className).toContain("hidden");
    expect(columnRow.className).toContain("sm:table-row");

    // The sort indicator glyph rides inside each control, so compare the
    // labels with it stripped.
    const labelsOf = (row: Element) =>
      Array.from(row.querySelectorAll("th")).map((th) =>
        th.textContent?.replace(/[\u2191\u2193\u2195]/g, "").trim(),
      );
    const expected = ["Month", "Income", "Expenses", "Net"];
    expect(labelsOf(phoneRow)).toEqual(expected);
    // Both rows are rendered from one list, so they cannot list different
    // fields -- assert it rather than trusting the loop.
    expect(labelsOf(columnRow)).toEqual(labelsOf(phoneRow));
  });

  it("sorts from the phone strip, not only from the column header", async () => {
    const container = await renderTableView();

    const monthOrder = () =>
      Array.from(container.querySelectorAll("tbody tr")).map(
        (r) => r.querySelector("td")?.textContent,
      );
    expect(monthOrder()).toEqual(["Jan 2024", "Feb 2024"]);

    // "Net" in the phone strip: the fourth of the four controls in the first
    // header row (Month, Income, Expenses, Net). Addressed by position because
    // the label also appears in the column header row and in every caption.
    const phoneNet = container.querySelectorAll("thead tr")[0].querySelectorAll("th")[3];
    await act(async () => {
      fireEvent.click(phoneNet);
    });
    // Ascending by net puts February's -$42,700 first.
    expect(monthOrder()).toEqual(["Feb 2024", "Jan 2024"]);
  });

  it("keeps the whole row clickable from the card layout", async () => {
    const container = await renderTableView();

    const row = Array.from(container.querySelectorAll("tbody tr")).find((r) =>
      r.textContent?.includes("Jan 2024"),
    );
    expect(row?.className).toContain("cursor-pointer");
    await act(async () => {
      fireEvent.click(row!);
    });
    expect(mockPush).toHaveBeenCalledWith(
      "/transactions?startDate=2024-01-01&endDate=2024-01-31",
    );
  });
});
