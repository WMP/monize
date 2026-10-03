import { ServiceUnavailableException } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { Account } from "./entities/account.entity";
import { datedLoanDebt } from "./dated-loan-debt.util";
import {
  calculatePaymentAmount,
  getPeriodicRate,
  recalculateMortgageAfterRateChange,
} from "./mortgage-amortization.util";
import { mortgageTypeOf } from "./mortgage-type.util";
import {
  DEFAULT_PERIODS_PER_YEAR,
  periodsPerYearForStoredFrequency,
  toMortgagePaymentFrequency,
} from "./payment-frequency.util";
import { formatDateYMDLocal, todayYMD } from "../common/date-utils";
import { tr } from "../i18n/translate";

/** Normalize a DATE column value (string at runtime, Date in tests) to YYYY-MM-DD */
function toYmd(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.split("T")[0];
  return formatDateYMDLocal(value);
}

/** Whole calendar months from `fromYmd` to `toYmd` (floored at 0) */
function monthsBetweenYmd(fromYmd: string, toYmdStr: string): number {
  const [fromYear, fromMonth] = fromYmd.split("-").map(Number);
  const [toYear, toMonth] = toYmdStr.split("-").map(Number);
  return Math.max(0, (toYear - fromYear) * 12 + (toMonth - fromMonth));
}

/**
 * The annuity installment of an annuity mortgage re-levelled on `asOfDate`:
 * the payment that clears the ledger debt through that date over the
 * remaining amortization at `annualRate` (spec section 5.3, the ANNUITY row).
 * The debt is `datedLoanDebt`, never `current_balance`, which stops at today
 * (spec decision 5).
 *
 * One formula for the two places that re-level a payment: a rate change
 * recorded with `recalculatePayment` (`LoanRateChangesService`), and a type
 * change from LINEAR or INTEREST_ONLY back to an annuity type, which must
 * store a constant payment again (spec section 5.6).
 *
 * Throws 503 when the ledger cannot be read: a failed read is not a zero
 * debt.
 */
export async function datedAnnuityInstallment(
  m: EntityManager,
  account: Account,
  annualRate: number,
  asOfDate: string,
): Promise<number> {
  const debt = await datedLoanDebt(m, account, asOfDate);
  if (debt === null) {
    throw new ServiceUnavailableException(
      tr(
        "errors.accounts.loanLedgerUnreadable",
        "This loan's balance could not be read. Try again.",
      ),
    );
  }
  const mortgageType = mortgageTypeOf(account);
  const startDate = toYmd(account.paymentStartDate) ?? todayYMD();
  const monthsElapsed = monthsBetweenYmd(startDate, asOfDate);
  const remainingAmortizationMonths = Math.max(
    12,
    (account.amortizationMonths || 300) - monthsElapsed,
  );

  // Converted, not cast. `recalculateMortgageAfterRateChange` derives its
  // periodic rate from a MORTGAGE-domain cadence, and the column can hold the
  // recurrence spelling: casting handed it SEMIMONTHLY, which its lookup read
  // as monthly, so the recalculated installment was a whole month's payment on
  // a half-monthly schedule -- persisted on the rate change and pushed into
  // the scheduled transaction. Quarterly and yearly have no mortgage cadence
  // at all, so those amortize on the standard convention instead of being
  // forced into a mortgage shape the helpers cannot express.
  const mortgageFrequency = toMortgagePaymentFrequency(
    account.paymentFrequency || "MONTHLY",
  );
  if (!mortgageFrequency) {
    const periodsPerYear =
      periodsPerYearForStoredFrequency(account.paymentFrequency) ??
      DEFAULT_PERIODS_PER_YEAR;
    // The COMPOUNDING is still the account's own, even where the cadence is
    // not one the mortgage helpers can express. Amortizing on the nominal
    // convention here would have derived the persisted installment one way
    // and the split this file computes 200 lines above it the other, for the
    // same Canadian account -- two conventions for one mortgage.
    return calculatePaymentAmount(
      debt,
      getPeriodicRate(annualRate, periodsPerYear, mortgageType),
      Math.max(
        1,
        Math.round((remainingAmortizationMonths * periodsPerYear) / 12),
      ),
    );
  }

  const result = recalculateMortgageAfterRateChange(
    debt,
    annualRate,
    remainingAmortizationMonths,
    mortgageFrequency,
    mortgageType,
  );
  return result.paymentAmount;
}
