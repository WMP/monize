import { MONEY_DECIMALS, roundMoney } from "../common/round.util";
import { bookSplitsAtMinorUnit } from "../common/currency-minor-unit.util";

export interface LoanPaymentWaterfallInput {
  /** Total configured installment, extra principal included. */
  paymentAmount: number;
  /** Standing extra-principal instruction (0 when there is none). */
  extraPrincipal: number;
  /** Accrued interest for the period, before any clamp. */
  interest: number;
  /** Regular amortized principal for the period, before any clamp. */
  principal: number;
  /**
   * Outstanding debt to retire, as a positive number -- or null when the
   * balance cannot bound the payment (an account whose history has not been
   * recorded yet reads 0, which means "unknown", not "paid off"). With null,
   * no balance clamp applies.
   */
  currentBalance: number | null;
}

export interface LoanPaymentAllocation {
  principal: number;
  interest: number;
  extraPrincipal: number;
  /** Sum of the three parts -- what the installment's parent row must carry. */
  total: number;
}

/**
 * The one place a loan installment is divided between interest, regular
 * principal and extra principal. `LoanPaymentSetupService` (the first
 * installment) and `ScheduledTransactionLoanService` (every recalculation
 * after a posting) both call this, because the two must agree about what any
 * given installment looks like -- the copy each held drifted twice before this
 * existed (audit P5-008, recheck DR3-01, review #1131).
 * `loan-waterfall.guard.spec.ts` fails on a new hand-rolled copy.
 *
 * Policy, decided once:
 *
 * - A payment that does not cover the accrued interest is applied
 *   interest-first across the WHOLE installment, extra principal included. A
 *   lender applies a payment to accrued interest before principal, so a
 *   designated extra-principal transfer has no principal to reduce until the
 *   interest is met. Interest itself is bounded by the whole installment so a
 *   child can never exceed its parent.
 * - Never schedule more principal than the loan still owes. Regular principal
 *   is what the amortization says is owed, so it is filled first; the
 *   discretionary extra absorbs the shortfall. Interest is not clamped by the
 *   balance -- it accrued on the debt and is owed independently of how much
 *   principal is left to retire.
 * - What is left of the installment after interest is the most that can go to
 *   principal in total, so the extra is bounded by that as well as by the
 *   debt.
 * - The parts only ever shrink from the configured figures, and the total is
 *   the sum of the parts by construction, so the split validator's exact-4dp
 *   equality between parent and children cannot be reached with a mismatch.
 */
export function allocateLoanPayment(
  input: LoanPaymentWaterfallInput,
): LoanPaymentAllocation {
  const paymentAmount = roundMoney(input.paymentAmount);
  const configuredExtra = Math.max(0, roundMoney(input.extraPrincipal));
  const basePayment = roundMoney(paymentAmount - configuredExtra);
  const balance =
    input.currentBalance == null ? null : roundMoney(input.currentBalance);

  let interest = Math.max(0, roundMoney(input.interest));
  let principal = Math.max(0, roundMoney(input.principal));

  if (interest > basePayment) {
    interest = Math.min(interest, paymentAmount);
    principal = 0;
  }

  if (balance !== null && principal > balance) {
    principal = balance;
  }

  const availableForPrincipal = Math.max(
    0,
    roundMoney(paymentAmount - interest),
  );
  let extraPrincipal = Math.min(
    configuredExtra,
    Math.max(0, roundMoney(availableForPrincipal - principal)),
  );
  if (balance !== null && roundMoney(principal + extraPrincipal) > balance) {
    extraPrincipal = Math.max(0, roundMoney(balance - principal));
  }

  return {
    principal,
    interest,
    extraPrincipal,
    total: roundMoney(principal + interest + extraPrincipal),
  };
}

/**
 * The installment as the bank books it: in the currency's smallest unit
 * (`decimals`, from `currencyMinorUnitDecimals`), issue #1581.
 *
 * The waterfall prices at storage precision (docs/specs/mortgage-types.md,
 * decision 7), so a LINEAR installment is 864.5833 principal + 306.0625
 * interest = 1,170.6458; the account it is debited from moves 1,170.65. The
 * total and the interest are each rounded to the unit and principal takes
 * what the roundings leave (864.59), because interest is the period's charge
 * and principal is what retires the loan. Where principal is zero (an
 * interest-only installment carrying an extra), the extra takes it instead,
 * so no line turns negative. The parts still sum to the total exactly.
 *
 * Booking never retires more than `debt`. A ledger posted at 4dp before
 * #1581 can owe 833.3449 on its final installment, and rounding would book
 * 833.35 and push the loan into credit; there the principal is cut down to
 * the unit at or below the debt (833.34), leaving a residue of less than one
 * unit that the next occurrence reads as paid off (`debt <= 0.01`). A ledger
 * booked in the unit owes a whole number of units, so its final installment
 * retires it exactly.
 */
export function bookLoanAllocation(
  allocation: LoanPaymentAllocation,
  decimals: number,
  debt: number | null = null,
): LoanPaymentAllocation {
  const lines = [
    allocation.principal,
    allocation.interest,
    allocation.extraPrincipal,
  ];
  let booked = bookSplitsAtMinorUnit(lines, allocation.total, decimals, 0);
  if (booked.amounts[0] < 0) {
    booked = bookSplitsAtMinorUnit(lines, allocation.total, decimals, 2);
  }
  const [principal, interest, extraPrincipal] = booked.amounts;
  if (
    debt !== null &&
    roundMoney(principal + extraPrincipal) > roundMoney(debt)
  ) {
    const retired = towardZeroInUnit(
      Math.min(allocation.principal + allocation.extraPrincipal, debt),
      decimals,
    );
    const extra = Math.min(
      towardZeroInUnit(allocation.extraPrincipal, decimals),
      retired,
    );
    const cappedPrincipal = roundMoney(retired - extra);
    return {
      principal: cappedPrincipal,
      interest,
      extraPrincipal: extra,
      total: roundMoney(cappedPrincipal + interest + extra),
    };
  }
  return {
    principal,
    interest,
    extraPrincipal,
    total: booked.parentAmount,
  };
}

/** A non-negative 4dp amount cut down to the unit (833.3449 -> 833.34 at 2). */
function towardZeroInUnit(value: number, decimals: number): number {
  const step = 10 ** Math.max(0, MONEY_DECIMALS - decimals);
  const units = Math.round(
    roundMoney(Math.max(0, value)) * 10 ** MONEY_DECIMALS,
  );
  return roundMoney((Math.floor(units / step) * step) / 10 ** MONEY_DECIMALS);
}
