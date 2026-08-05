import { sumKnown, subtractKnown } from '@/lib/partial-sum';
import { GroupedTotal, TransactionSummary } from '@/types/transaction';

/**
 * The active Transactions-page filters a payee/category info widget must
 * honour so its stats reconcile with the list and the chart. Deliberately
 * excludes the widget's own entity id -- each widget injects that itself.
 */
export interface WidgetFilterParams {
  accountIds?: string[];
  startDate?: string;
  endDate?: string;
  tagIds?: string[];
  search?: string;
  amountFrom?: number;
  amountTo?: number;
}

export interface DisplayCurrencyStrategy {
  /** The currency every widget figure is rendered in. */
  displayCurrency: string;
  /** Convert an amount from its source currency into the display currency. */
  /** `null` when the pair has no rate; render it as unknown, never as 0. */
  toDisplay: (amount: number, fromCurrency: string) => number | null;
}

/**
 * Pick the widget's display currency from a summary's per-currency buckets:
 * a single-currency result renders natively, a multi-currency result is
 * converted bucket-by-bucket into the user's default currency (naively
 * summing across currencies would produce a meaningless figure).
 */
export function buildDisplayCurrencyStrategy(
  summary: TransactionSummary | null,
  defaultCurrency: string,
  convertToDefault: (amount: number, fromCurrency: string) => number | null,
): DisplayCurrencyStrategy {
  const currencies = Object.keys(summary?.byCurrency ?? {});
  if (currencies.length === 1) {
    return { displayCurrency: currencies[0], toDisplay: (amount) => amount };
  }
  return {
    displayCurrency: defaultCurrency,
    toDisplay: (amount, fromCurrency) => convertToDefault(amount, fromCurrency),
  };
}

/** Headline figures reduced to the display currency. */
export function summarizeInDisplayCurrency(
  summary: TransactionSummary,
  strategy: DisplayCurrencyStrategy,
): { income: number | null; expenses: number | null; net: number | null } {
  const buckets = Object.entries(summary.byCurrency ?? {});
  if (buckets.length <= 1) {
    return {
      income: summary.totalIncome,
      expenses: summary.totalExpenses,
      net: summary.netCashFlow,
    };
  }
  // A currency with no rate makes these totals unknown rather than smaller: they
  // are the widget's headline figures, and a partial sum under a "net" label is
  // the subtotal-as-total defect.
  const income = sumKnown(
    [...buckets].map(([currency, bucket]) =>
      strategy.toDisplay(bucket.totalIncome, currency),
    ),
  );
  const expenses = sumKnown(
    [...buckets].map(([currency, bucket]) =>
      strategy.toDisplay(bucket.totalExpenses, currency),
    ),
  );
  return { income, expenses, net: subtractKnown(income, expenses) };
}

export interface AggregatedGroupRow {
  id: string | null;
  name: string | null;
  total: number;
  count: number;
}

/**
 * Collapse per-currency grouped rows into one row per entity id, with
 * totals converted to the display currency. Sorted by absolute total,
 * largest first.
 */
export function aggregateGroupedTotals(
  rows: GroupedTotal[],
  strategy: DisplayCurrencyStrategy,
): AggregatedGroupRow[] {
  const byId = new Map<string | null, AggregatedGroupRow>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    const converted = strategy.toDisplay(row.total, row.currencyCode);
    // A group we cannot express in the display currency is left out of the
    // breakdown entirely -- including it at a fabricated parity would misstate
    // its own bar and every other group's share.
    if (converted === null) continue;
    if (existing) {
      byId.set(row.id, {
        ...existing,
        name: existing.name ?? row.name,
        total: existing.total + converted,
        count: existing.count + row.count,
      });
    } else {
      byId.set(row.id, {
        id: row.id,
        name: row.name,
        total: converted,
        count: row.count,
      });
    }
  }
  return [...byId.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}
