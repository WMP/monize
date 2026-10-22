import { FxAggregate } from "../common/fx-aggregate";
import { ordinarySplitLines } from "../common/investment-filter.util";
import { isNetSpending } from "../built-in-reports/spending-reports.service";
import { DirectionFilter } from "./entities/custom-report.entity";
import { Transaction } from "../transactions/entities/transaction.entity";

/**
 * What a custom report's category costs, settled the way Spending by Category
 * settles it (audit A26-M33, `isNetSpending` / `NET_SPEND_AMOUNT` in
 * `built-in-reports/spending-reports.service.ts`).
 *
 * Every line of every row is added, SIGNED, to a cell: one (group, category)
 * pair. A category's cost is its debits net of its credits, so a -100 expense
 * and a +30 refund in Groceries are one cell of -70, and the direction is
 * judged on that net afterwards, never row by row:
 *
 * - EXPENSES_ONLY reports `-net` for a cell that is net spending
 *   (`isNetSpending`), so a refund lowers the cost and an income category is
 *   not a row;
 * - INCOME_ONLY reports `net` for a cell that is positive;
 * - BOTH reports the magnitude of each category's net, `Math.abs(net)`.
 *
 * Netted within one category, never across two: a group (a month, a payee, a
 * tag) sums its settled cells, so Groceries' refund cannot cancel Rent. A
 * transfer is not netted at all: each transfer line is a cell of its own, so a
 * -200 / +200 pair is two cells judged separately, never one cell of zero.
 *
 * A cell also remembers which "units" fed it, so a group's count is the number
 * of distinct units across its kept cells: a transaction counts once per group
 * (a line once per category, when grouped by category).
 */

/** One line of a row, before conversion. */
export interface NetLine {
  /** The category the line nets in; unique per line for a transfer. */
  cell: string;
  /** The line's category key, `"uncategorized"` when it has none. */
  category: string;
  /** Signed, in the row's own currency. */
  amount: number;
  /** What a group counts: the row, or the line when grouped by category. */
  unit: string;
}

/**
 * The lines of a row. A split parent with hydrated lines is its ordinary lines
 * (an embedded investment line is the trade's own cash side); a parent whose
 * lines were not hydrated, or any other row, is the row itself. A parent whose
 * hydrated ordinary lines are empty represents no cash and has no line.
 * `perLine` is the category grouping, which counts lines rather than rows.
 */
export function netLinesOf(tx: Transaction, perLine: boolean): NetLine[] {
  const unitOf = (index: number) => (perLine ? `${tx.id}:${index}` : tx.id);

  if (tx.isSplit && tx.splits) {
    return ordinarySplitLines(tx).map((split, index) => {
      const category = split.categoryId || "uncategorized";
      return {
        cell:
          split.transferAccountId != null
            ? `transfer:${tx.id}:${index}`
            : category,
        category,
        amount: Number(split.amount),
        unit: unitOf(index),
      };
    });
  }

  const category = tx.categoryId || "uncategorized";
  return [
    {
      cell: tx.isTransfer ? `transfer:${tx.id}:0` : category,
      category,
      amount: Number(tx.amount),
      unit: unitOf(0),
    },
  ];
}

interface Cell {
  agg: FxAggregate;
  units: Set<string>;
}

/** A report's cells for one execution; built per call, never shared. */
export interface NetCells {
  /** Adds one line, already converted (signed), to its cell in `group`. */
  add(group: string, line: NetLine, converted: number | null): void;
  /** Each group's settled sum and count; a group with no kept cell is absent. */
  settle(): Map<string, { agg: FxAggregate; count: number }>;
}

/**
 * @param keepsUnconverted whether a line with no rate still counts (the count
 *   metric); every money figure leaves it out of the sum and the count alike.
 */
export function createNetCells(
  direction: DirectionFilter,
  keepsUnconverted: boolean,
): NetCells {
  const groups = new Map<string, Map<string, Cell>>();

  const add = (
    group: string,
    line: NetLine,
    converted: number | null,
  ): void => {
    if (converted === null && !keepsUnconverted) return;
    let cells = groups.get(group);
    if (!cells) {
      cells = new Map();
      groups.set(group, cells);
    }
    let cell = cells.get(line.cell);
    if (!cell) {
      cell = { agg: new FxAggregate(), units: new Set() };
      cells.set(line.cell, cell);
    }
    if (converted !== null) cell.agg.addConverted(converted);
    cell.units.add(line.unit);
  };

  const settle = (): Map<string, { agg: FxAggregate; count: number }> => {
    const settled = new Map<string, { agg: FxAggregate; count: number }>();
    for (const [group, cells] of groups) {
      const agg = new FxAggregate();
      const units = new Set<string>();
      let kept = false;
      for (const cell of cells.values()) {
        const net = cell.agg.knownSubtotal;
        let value: number;
        if (direction === DirectionFilter.EXPENSES_ONLY) {
          value = -net;
          if (!isNetSpending(value)) continue;
        } else if (direction === DirectionFilter.INCOME_ONLY) {
          value = net;
          if (!(value > 0)) continue;
        } else {
          value = Math.abs(net);
        }
        kept = true;
        agg.addConverted(value);
        for (const unit of cell.units) units.add(unit);
      }
      if (kept) settled.set(group, { agg, count: units.size });
    }
    return settled;
  };

  return { add, settle };
}
