import { baseInvestmentAction } from "../securities/investment-replay.util";
import { InvestmentAction } from "../securities/entities/investment-transaction.entity";
import { ExactDecimal } from "./domain/exact-decimal";

/**
 * One investment transaction of a linked security, as the lot derivation reads
 * it. `quantity` is the column read as text (NUMERIC(20,8)): it is parsed
 * exactly and never through a JavaScript number.
 */
export interface BondLotTransaction {
  readonly action: string;
  readonly status: string;
  /** YYYY-MM-DD. */
  readonly transactionDate: string;
  readonly quantity: string | null;
  /**
   * For a TRANSFER_IN or TRANSFER_OUT: the other leg of the same security is
   * linked and not VOID. The pair moves a lot between the user's accounts and
   * keeps its purchase date, so neither leg changes the lots.
   */
  readonly pairedTransfer: boolean;
}

export interface BondLot {
  readonly purchaseDate: string;
  /** A whole number of bonds. */
  readonly quantity: number;
  /** A TRANSFER_IN with no linked leg: the real purchase date is unknown. */
  readonly purchaseDateAssumed: boolean;
}

export type BondLotsRefusalCode =
  /** A bond does not split. */
  | "SPLIT"
  /** A share-moving row whose quantity is not a whole number of bonds. */
  | "FRACTIONAL_QUANTITY"
  /** A removal larger than the lots open at that point. */
  | "OVER_REMOVAL"
  /** A share-moving row with no quantity, a negative one, or one too large to count. */
  | "INVALID_QUANTITY";

export interface BondLotsRefusal {
  readonly code: BondLotsRefusalCode;
  readonly detail: string;
}

/** Lots known, or the reason they are not: never a guess. */
export type BondLotsResult =
  | { readonly lots: readonly BondLot[]; readonly refusal: null }
  | { readonly lots: null; readonly refusal: BondLotsRefusal };

type Step =
  | { readonly kind: "add"; readonly assumed: boolean }
  | { readonly kind: "remove" }
  | { readonly kind: "split" }
  | { readonly kind: "none" };

/**
 * What each base action does to the lots (spec 12.2), as a table rather than a
 * switch: a split is not folded into a quantity here -- a bond does not split,
 * so the row refuses the derivation -- and the share-count reducer
 * (`applyActionToQuantity`) stays the one place that applies a split's ratio.
 * TRANSFER_IN and TRANSFER_OUT depend on whether the other leg is linked, so
 * they are resolved in `stepOf`. Anything absent is cash only (DIVIDEND,
 * INTEREST, CAPITAL_GAIN) and changes nothing.
 */
const LOT_EFFECT_BY_BASE_ACTION: ReadonlyMap<string, Step> = new Map<
  string,
  Step
>([
  [InvestmentAction.BUY, { kind: "add", assumed: false }],
  [InvestmentAction.REINVEST, { kind: "add", assumed: false }],
  [InvestmentAction.ADD_SHARES, { kind: "add", assumed: false }],
  [InvestmentAction.SELL, { kind: "remove" }],
  [InvestmentAction.REMOVE_SHARES, { kind: "remove" }],
  [InvestmentAction.SPLIT, { kind: "split" }],
]);

const NONE: Step = { kind: "none" };

function stepOf(row: BondLotTransaction): Step {
  const base = baseInvestmentAction(row.action);
  if (base === InvestmentAction.TRANSFER_IN) {
    // A linked leg moves a lot between accounts and keeps its purchase date; an
    // unlinked one is shares that arrived with no known purchase.
    return row.pairedTransfer ? NONE : { kind: "add", assumed: true };
  }
  if (base === InvestmentAction.TRANSFER_OUT) {
    return row.pairedTransfer ? NONE : { kind: "remove" };
  }
  return LOT_EFFECT_BY_BASE_ACTION.get(base) ?? NONE;
}

const refuse = (code: BondLotsRefusalCode, detail: string): BondLotsResult => ({
  lots: null,
  refusal: { code, detail },
});

/**
 * The open lots of a linked security from its investment transactions, per the
 * truth table of spec 12.2.
 *
 * `rows` must be in register order (`INVESTMENT_REPLAY_ORDER_SQL`); this is a
 * pure fold of them, so the lots on a past day are the fold of the rows dated up
 * to it. VOID rows are excluded. A removal takes quantity first-in first-out.
 * Anything that makes the lots unknowable -- a split, a quantity that is not a
 * whole number of bonds, a removal larger than the open lots -- refuses with the
 * reason and the date of the row, and returns no lots: nothing is guessed.
 */
export function bondLotsFromTransactions(
  rows: readonly BondLotTransaction[],
): BondLotsResult {
  let open: BondLot[] = [];

  for (const row of rows) {
    if (row.status === "VOID") continue;
    const step = stepOf(row);
    if (step.kind === "none") continue;
    const where = `${row.action} on ${row.transactionDate}`;

    if (step.kind === "split") {
      return refuse(
        "SPLIT",
        `A split (${where}) is recorded on this security, and a bond does not split`,
      );
    }

    const quantity = parseWholeQuantity(row.quantity);
    if (quantity === "fractional") {
      return refuse(
        "FRACTIONAL_QUANTITY",
        `${where} moves ${row.quantity} bonds, which is not a whole number`,
      );
    }
    if (quantity === "invalid") {
      return refuse(
        "INVALID_QUANTITY",
        `${where} has no usable quantity (${row.quantity ?? "none"})`,
      );
    }
    if (quantity === 0) continue;

    if (step.kind === "add") {
      open = [
        ...open,
        {
          purchaseDate: row.transactionDate,
          quantity,
          purchaseDateAssumed: step.assumed,
        },
      ];
      continue;
    }

    const removed = removeFifo(open, quantity);
    if (removed === null) {
      return refuse(
        "OVER_REMOVAL",
        `${where} removes ${quantity} bonds, more than the ${totalOf(open)} held`,
      );
    }
    open = removed;
  }

  return { lots: open, refusal: null };
}

/**
 * The lots open at the end of `date`: the fold of the rows dated on or before it.
 * A price for a past day is struck on the lots held that day, not on what is
 * left today.
 */
export function bondLotsAsOf(
  rows: readonly BondLotTransaction[],
  date: string,
): BondLotsResult {
  return bondLotsFromTransactions(
    rows.filter((row) => row.transactionDate <= date),
  );
}

type WholeQuantity = number | "fractional" | "invalid";

function parseWholeQuantity(text: string | null): WholeQuantity {
  if (text === null) return "invalid";
  let value: ExactDecimal;
  try {
    value = ExactDecimal.parse(text);
  } catch {
    return "invalid";
  }
  if (value.isNegative()) return "invalid";
  if (value.denominator !== 1n) return "fractional";
  if (value.numerator > BigInt(Number.MAX_SAFE_INTEGER)) return "invalid";
  // Whole and within the safe-integer range, so the conversion is exact.
  return Number(value.numerator);
}

function totalOf(lots: readonly BondLot[]): number {
  return lots.reduce((sum, lot) => sum + lot.quantity, 0);
}

/** Oldest lots first; null when `quantity` exceeds what is open. */
function removeFifo(
  lots: readonly BondLot[],
  quantity: number,
): BondLot[] | null {
  if (quantity > totalOf(lots)) return null;
  const rest: BondLot[] = [];
  let remaining = quantity;
  for (const lot of lots) {
    if (remaining === 0) {
      rest.push(lot);
    } else if (lot.quantity <= remaining) {
      remaining -= lot.quantity;
    } else {
      rest.push({ ...lot, quantity: lot.quantity - remaining });
      remaining = 0;
    }
  }
  return rest;
}
