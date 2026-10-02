import { EntityManager } from "typeorm";
import { ACCOUNT_BALANCE_AS_OF_SQL } from "../common/ledger-balance.sql";
import { roundMoney } from "../common/round.util";

/**
 * The outstanding debt of a loan-like account through `asOfDate`, inclusive,
 * from the authoritative ledger: opening balance plus every non-void,
 * top-level transaction dated on or before that date -- the same expression
 * `recalculateCurrentBalance` and the balances-as-of report use, with the
 * pricing date in place of today.
 *
 * `accounts.current_balance` deliberately excludes future-dated rows, so it
 * cannot price an installment, or a rate change, dated after a payment that is
 * already posted for the future. This is `debt(d)` of
 * docs/specs/mortgage-types.md section 2, the one as-of read that installment
 * pricing (INV-LOAN-006) and the rate-change paths (spec decision 5) share.
 *
 * Debt accounts store the balance negative; an overpaid balance (in credit)
 * reads as retired (0) rather than as fresh debt. Null only when the account
 * row cannot be read back (deleted concurrently); a failed lookup is not a
 * zero balance.
 */
export async function datedLoanDebt(
  m: EntityManager,
  loanAccount: { id: string; userId: string },
  asOfDate: string,
): Promise<number | null> {
  const rows: Array<{ balance: string | null }> = await m.query(
    ACCOUNT_BALANCE_AS_OF_SQL,
    [loanAccount.id, loanAccount.userId, asOfDate],
  );
  if (rows.length === 0 || rows[0].balance == null) {
    return null;
  }
  return Math.max(0, -roundMoney(Number(rows[0].balance)));
}
