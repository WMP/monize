import { EntityManager } from "typeorm";
import { Account, AccountType } from "./entities/account.entity";
import { LoanRateChange } from "../loan-rate-changes/entities/loan-rate-change.entity";
import { effectiveAnnualRateOn } from "./effective-loan-rate.util";
import { datedAnnuityInstallment } from "./annuity-relevel.util";
import { assertMortgageMethodTerms } from "./mortgage-installment.util";
import {
  MortgageType,
  PrepaymentMode,
  mortgageTypeOf,
  prepaymentModeColumn,
  storesConstantPayment,
} from "./mortgage-type.util";
import { todayYMD } from "../common/date-utils";

/**
 * The next due date of the account's linked loan payment, or null when it has
 * none. Read raw with `TO_CHAR`, so the date is the stored calendar date.
 */
async function nextLoanDueDate(
  m: EntityManager,
  account: Account,
): Promise<string | null> {
  if (!account.scheduledTransactionId) return null;
  const rows: Array<{ next_due_date: string | null }> = await m.query(
    `SELECT TO_CHAR(next_due_date, 'YYYY-MM-DD') AS next_due_date
       FROM scheduled_transactions
      WHERE id = $1 AND user_id = $2`,
    [account.scheduledTransactionId, account.userId],
  );
  return rows[0]?.next_due_date ?? null;
}

/**
 * The method-dependent columns an account update writes beside the mortgage
 * type, in the same transaction as the type (spec decisions 10 and 11,
 * section 5.6). Mutates `account`, which already carries the saved type.
 *
 * - `prepayment_mode`: the requested mode, else the stored one, for LINEAR;
 *   null for every other type and every other account type.
 * - `payment_amount`: null for LINEAR and INTEREST_ONLY, which are refused
 *   first when a term their method needs is missing (spec section 8). A
 *   mortgage moved from one of those back to an annuity type gets the annuity
 *   installment of its dated debt over the remaining amortization at the rate
 *   in force on its next due date (`datedAnnuityInstallment`, the section 5.3
 *   ANNUITY formula), because an annuity mortgage must carry its constant
 *   payment again. A save between two annuity types leaves the column as the
 *   request set it, as before.
 */
export async function applyMortgageMethodColumns(
  m: EntityManager,
  account: Account,
  previousType: MortgageType | null,
  requestedMode: PrepaymentMode | null | undefined,
): Promise<void> {
  if (account.accountType !== AccountType.MORTGAGE) {
    account.prepaymentMode = null;
    return;
  }
  const type = mortgageTypeOf(account);
  account.prepaymentMode = prepaymentModeColumn(
    type,
    requestedMode,
    account.prepaymentMode,
  );
  if (!storesConstantPayment(type)) {
    assertMortgageMethodTerms(type, account);
    account.paymentAmount = null;
    return;
  }
  if (previousType === null || storesConstantPayment(previousType)) return;

  const asOfDate = (await nextLoanDueDate(m, account)) ?? todayYMD();
  const scalar = Number(account.interestRate);
  const fallback = Number.isFinite(scalar) ? scalar : 0;
  const rates = await m.getRepository(LoanRateChange).find({
    where: { accountId: account.id },
    order: { effectiveDate: "ASC" },
  });
  account.paymentAmount = await datedAnnuityInstallment(
    m,
    account,
    effectiveAnnualRateOn(rates, asOfDate, fallback) ?? fallback,
    asOfDate,
  );
}
