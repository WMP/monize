import { EntityManager } from "typeorm";
import { ScheduledTransaction } from "../scheduled-transactions/entities/scheduled-transaction.entity";
import { ScheduledTransactionSplit } from "../scheduled-transactions/entities/scheduled-transaction-split.entity";
import { Account, AccountType } from "../accounts/entities/account.entity";
import { getPeriodicRate } from "../accounts/mortgage-amortization.util";
import {
  amortizationMethodFor,
  mortgageTypeOf,
} from "../accounts/mortgage-type.util";
import {
  missingMethodTerms,
  nonAnnuityInstallment,
} from "../accounts/mortgage-installment.util";
import { roundMoney } from "../common/round.util";
import {
  allocateLoanPayment,
  LoanPaymentAllocation,
} from "../accounts/loan-payment-waterfall.util";
import { LOAN_LIKE_ACCOUNT_TYPES } from "../common/currency-minor-unit.util";
import { datedLoanDebt } from "../accounts/dated-loan-debt.util";
import { LoanRateChange } from "../loan-rate-changes/entities/loan-rate-change.entity";
import { effectiveAnnualRateOn } from "../accounts/effective-loan-rate.util";
import {
  DEFAULT_PERIODS_PER_YEAR,
  periodsPerYearForStoredFrequency,
} from "../accounts/payment-frequency.util";

/**
 * The one pricing path for a scheduled loan installment (INV-LOAN-006,
 * `docs/specs/scheduled-loan-installment-pricing.md` section 2), as plain
 * functions over an `EntityManager` so that every consumer -- the template
 * advancement, the posting, the amortization report's anchor and the
 * settlement of an imported bank debit (`docs/specs/loan-installment-settlement.md`)
 * -- prices through the same code without importing a Nest service.
 *
 * Two halves. `resolveInstallmentCore` does the I/O: the dated ledger debt,
 * the dated rate, the template's managed lines. `priceInstallment` is the pure
 * tail: the method principal, the interest, the waterfall. A caller that
 * gathers its own facts (the settlement planner) calls the tail directly with
 * its own missing-data rule; the scheduled-transaction service calls the core
 * and keeps the posting path's defaults.
 *
 * This module imports no service from `transactions/`,
 * `scheduled-transactions/` or `transaction-rules/` and declares no provider;
 * `loan-core-imports.guard.spec.ts` holds that.
 */

/** The template's managed lines: a principal transfer, one interest line, and
 *  optionally an extra-principal transfer. */
export interface LoanTemplateSplits {
  principalSplit?: ScheduledTransactionSplit;
  interestSplit: ScheduledTransactionSplit;
  extraPrincipalSplit?: ScheduledTransactionSplit;
}

/**
 * Whether the installment is being priced to advance the stored TEMPLATE, to
 * post an OCCURRENCE, to re-level a template after a method change, or to
 * SETTLE an imported bank debit against a slot. The differences are a few
 * rules and they are load-bearing.
 *
 * The template may grow back toward the account's configured payment: a clamp
 * written for one installment must not become the standing instruction (review
 * #1131). An occurrence may NOT: the parent it posts is the bill the user was
 * shown on the bills page and in the Post dialog, so re-pricing may re-divide
 * that total between interest and principal and never resize it. Letting the
 * posting take `max(template, account.payment_amount)` would move more money
 * than any surface displayed, the preview/commit divergence the FX rules call
 * out ("a preview computes what the commit will do, through the same code").
 *
 * `reconfigure` is a template rewrite for a mortgage whose amortization method
 * just changed (`repriceLoanTemplate`). It prices like `template`, except that
 * an annuity targets `accounts.payment_amount` exactly instead of growing
 * toward it: the template still holds the previous method's installment
 * (a LINEAR one is larger than the annuity early in the loan), and
 * `max(template, payment_amount)` would keep billing it forever.
 *
 * `settlement` prices the installment a bank debit paid for its due date
 * (`docs/specs/loan-installment-settlement.md` section 7). An annuity's
 * payment is `accounts.payment_amount` when positive, else the template's
 * amount; the extra is the template's standing extra line, never grown toward
 * the account's configured extra; LINEAR and INTEREST_ONLY derive the
 * installment from the method, as the template purpose does.
 */
export type InstallmentPurpose =
  "template" | "posting" | "reconfigure" | "settlement";

/** One resolved installment: what the next posting of this template should move. */
export type ResolvedInstallment =
  | { kind: "declined"; reason: string }
  /** The ledger could not be read -- not a zero balance, and not "not a loan". */
  | { kind: "unreadable"; reason: string }
  | {
      kind: "paid-off";
      debt: number;
      /**
       * Whether the template is one this module manages (principal transfer +
       * one identifiable interest line, optionally an extra-principal
       * transfer). A retired debt is only a reason to withhold an occurrence's
       * money when every line of the bill is one of those: a mortgage template
       * carrying an escrow, tax or insurance line still owes those lines when
       * the mortgage principal reaches zero, and skipping the write would
       * silently stop paying them.
       */
      managed: boolean;
    }
  | {
      kind: "ok";
      allocation: LoanPaymentAllocation;
      template: LoanTemplateSplits;
      debt: number;
      /** The rate actually priced at -- the timeline's, not the scalar. */
      annualRate: number;
      /** Configured installment total, extra included -- what drove the parent. */
      paymentAmount: number;
      basePaymentAmount: number;
      /** The configured extra, before the waterfall clamped it. */
      extraPrincipalAmount: number;
      templateAmount: number;
      templateExtraAmount: number;
    };

/**
 * Which of a template's lines are the loan's principal, interest and extra
 * principal, and which the module cannot account for.
 *
 * `managed` is the discriminant: when true the interest line exists and no
 * line is unaccounted for, so the set can be priced as principal + interest
 * (+ extra); when false `declineReason` says what is wrong with it.
 */
export type LoanTemplateIdentification =
  | ({
      managed: true;
      unmanagedLines: ScheduledTransactionSplit[];
    } & LoanTemplateSplits)
  | {
      managed: false;
      principalSplit?: ScheduledTransactionSplit;
      interestSplit?: ScheduledTransactionSplit;
      extraPrincipalSplit?: ScheduledTransactionSplit;
      unmanagedLines: ScheduledTransactionSplit[];
      /** Every categorized, non-transfer line; counted in the decline reason. */
      categoryLines: ScheduledTransactionSplit[];
    };

/** The loan-like account a split set transfers to, if any. */
export async function findLoanAccount(
  m: EntityManager,
  splits: ScheduledTransactionSplit[],
): Promise<Account | null> {
  for (const split of splits) {
    if (!split.transferAccountId) continue;
    const candidate = await m.getRepository(Account).findOne({
      where: { id: split.transferAccountId },
    });
    if (candidate && LOAN_LIKE_ACCOUNT_TYPES.has(candidate.accountType)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Identify the managed lines of a loan template. There may be a regular
 * principal transfer, an interest category split, and optionally a separate
 * extra principal transfer. Extra principal splits have memo "Extra Principal"
 * and transfer to the loan account. Regular principal also transfers to the
 * loan account.
 *
 * The interest line is the loan's configured interest category when one is
 * set. "The first categorized line" is an absence predicate -- it says the
 * line is not the principal transfer, not that it is interest -- so on a
 * template a user has added an escrow or insurance line to it would
 * recalculate whichever line happens to be listed first. The configured
 * category is the explicit statement, and it is order-independent.
 *
 * The module understands exactly one template shape: a principal transfer,
 * one interest line, and optionally an extra-principal transfer. It reprices
 * the parent as principal + interest + extra, which is the whole template
 * only for that shape -- so a template carrying an escrow, insurance or tax
 * line would end up with a parent that no longer equals the sum of its
 * children, and the posting path's exact-4dp split validator would then
 * refuse every occurrence. The schedule would stop posting silently, with the
 * amount it would have charged nowhere on screen. So a line it cannot account
 * for makes the set unmanaged, and the caller declines rather than rewriting.
 * The cost is a P/I split that stays at last period's figures; the alternative
 * cost is a bill that never posts again. Declining also removes the last place
 * a line was chosen by position: with several categorized lines and no
 * configured category, there is nothing that identifies interest, and guessing
 * is what put an amortization figure onto a property-tax line.
 */
export function identifyLoanTemplate(
  splits: ScheduledTransactionSplit[],
  loanAccount: Pick<Account, "id" | "interestCategoryId">,
): LoanTemplateIdentification {
  const loanAccountId = loanAccount.id;
  const extraPrincipalSplit = splits.find(
    (s) =>
      s.transferAccountId === loanAccountId &&
      s.memo?.toLowerCase().includes("extra"),
  );
  const principalSplit = splits.find(
    (s) => s.transferAccountId === loanAccountId && s !== extraPrincipalSplit,
  );
  const categoryLines = splits.filter(
    (s) => s.categoryId && !s.transferAccountId,
  );
  const interestSplit = loanAccount.interestCategoryId
    ? categoryLines.find((s) => s.categoryId === loanAccount.interestCategoryId)
    : categoryLines.length === 1
      ? categoryLines[0]
      : undefined;
  const unmanagedLines = splits.filter(
    (s) =>
      s !== interestSplit && s !== principalSplit && s !== extraPrincipalSplit,
  );
  if (interestSplit && unmanagedLines.length === 0) {
    return {
      managed: true,
      principalSplit,
      interestSplit,
      extraPrincipalSplit,
      unmanagedLines,
    };
  }
  return {
    managed: false,
    principalSplit,
    interestSplit,
    extraPrincipalSplit,
    unmanagedLines,
    categoryLines,
  };
}

/** Why an unmanaged template cannot be priced, for the caller's log line. */
export function declineReason(
  identified: Extract<LoanTemplateIdentification, { managed: false }>,
  loanAccount: Pick<Account, "id" | "interestCategoryId">,
): string {
  return identified.interestSplit
    ? `${identified.unmanagedLines.length} line(s) beyond principal/interest/extra`
    : loanAccount.interestCategoryId
      ? "no line carries the loan's configured interest category"
      : `${identified.categoryLines.length} categorized lines and no interest category configured on account ${loanAccount.id}`;
}

/**
 * The annual rate this loan carries on `asOfDate`, from its recorded rate
 * history, falling back to the account's own scalar when no row applies, and
 * `null` when neither says anything.
 *
 * Recording a rate change deliberately does not write `accounts.interest_rate`
 * (see `effectiveAnnualRateOn`), so pricing an installment at that column
 * charges a rate nobody pays -- and made the bill disagree with the
 * amortization report even once the two priced the same balance. The rate is
 * dated for the same reason the balance is: a change recorded for next month
 * belongs to next month's installment, not this one.
 *
 * `null` is "no rate is recorded", not 0 %. The template and posting purposes
 * keep their historical `?? 0` fallback in `resolveInstallmentCore`
 * (`docs/specs/loan-installment-settlement.md` section 15 item 5); the
 * settlement refuses instead (decision 16).
 */
export async function datedAnnualRate(
  m: EntityManager,
  loanAccount: Pick<Account, "id" | "interestRate">,
  asOfDate: string,
): Promise<number | null> {
  const scalar =
    loanAccount.interestRate === null || loanAccount.interestRate === undefined
      ? NaN
      : Number(loanAccount.interestRate);
  const fallback = Number.isFinite(scalar) ? scalar : null;
  const rows = await m.getRepository(LoanRateChange).find({
    where: { accountId: loanAccount.id },
    order: { effectiveDate: "ASC" },
  });
  return effectiveAnnualRateOn(rows, asOfDate, fallback);
}

/**
 * The periodic rate the installment accrues at. One lookup for both
 * frequency spellings: the column is a bare VARCHAR written by two paths, so
 * a MORTGAGE row can hold the recurrence spelling SEMIMONTHLY -- cast into
 * getMortgagePeriodsPerYear it fell through to that function's monthly
 * default, and every posted split booked twice the interest for the life of
 * the loan. Account type still decides the COMPOUNDING (Canadian
 * semi-annual); it never decided the count.
 */
export function periodicRateFor(
  loanAccount: Account,
  frequency: string,
  interestRate: number,
): number {
  const periodsPerYear =
    periodsPerYearForStoredFrequency(frequency) ?? DEFAULT_PERIODS_PER_YEAR;

  return loanAccount.accountType === "MORTGAGE"
    ? getPeriodicRate(interestRate, periodsPerYear, mortgageTypeOf(loanAccount))
    : interestRate / 100 / periodsPerYear;
}

/** The facts the pure tail prices from; every one dated at `asOfDate`. */
export interface PriceInstallmentInput {
  /** The ledger debt through `asOfDate`, positive and not yet retired. */
  debt: number;
  /** The annual rate in percent that applies on `asOfDate`. */
  annualRate: number;
  loanAccount: Account;
  /** The template's managed lines (`identifyLoanTemplate`, `managed: true`). */
  template: LoanTemplateSplits;
  /** The template parent's amount, unsigned. */
  templateAmount: number;
  /** The stored cadence, in either spelling of the frequency column. */
  frequency: string;
  asOfDate: string;
  purpose: InstallmentPurpose;
}

/**
 * Price one installment from its facts: the method principal, the interest at
 * the periodic rate, and the shared waterfall. Pure: no I/O, no clock.
 *
 * Interest comes from the dated ledger balance, never from the previously
 * stored split values: those are money already rounded to 4dp, and the
 * amortization recurrence (`next = prev_interest - prev_principal * rate`)
 * is equivalent to recalculating from balance only when its inputs retain
 * full precision -- so the recurrence drifted from the amortization report by
 * a compounding cent (issue #1253). Every consumer prices through here, so
 * the template, what actually posts and what a settlement books cannot use
 * two different rules.
 */
export function priceInstallment(
  input: PriceInstallmentInput,
): ResolvedInstallment {
  const {
    debt,
    annualRate,
    loanAccount,
    template,
    templateAmount,
    frequency,
    asOfDate,
    purpose,
  } = input;
  const { extraPrincipalSplit } = template;
  const loanAccountId = loanAccount.id;

  // The amortization method decides the principal (INV-LOAN-007). Only a
  // mortgage has one; every other loan-like account is an annuity.
  const mortgageType =
    loanAccount.accountType === AccountType.MORTGAGE
      ? mortgageTypeOf(loanAccount)
      : null;
  const method = mortgageType ? amortizationMethodFor(mortgageType) : null;
  // A LINEAR or INTEREST_ONLY mortgage without its terms has no `N`, no
  // calendar or no principal to divide (spec section 8): decline, so the
  // persisted amounts post as for any shape this module cannot account for,
  // rather than price a guess.
  if (mortgageType && method !== "ANNUITY") {
    const missing = missingMethodTerms(mortgageType, loanAccount);
    if (missing.length > 0) {
      return {
        kind: "declined",
        reason: `the ${mortgageType} mortgage ${loanAccountId} has no ${missing.join(", ")}`,
      };
    }
  }

  // What the template holds is what was just posted -- including any clamp
  // a previous pass wrote for that one installment (a final payment, an
  // interest spike consuming the extra). Deriving the *configured* payment
  // from it therefore ratchets: the clamp becomes the configuration and
  // nothing can grow back, even after the balance is restored by a void or
  // an import (review #1131). The durable configuration lives on the
  // account (payment_amount / extra_payment_amount, kept in sync when the
  // user edits the schedule); the template only wins where it is larger,
  // which can only mean a user edit the account columns have not seen.
  const templateExtraAmount = extraPrincipalSplit
    ? Math.abs(Number(extraPrincipalSplit.amount))
    : 0;
  // The extra can only ride in an existing split row -- this recalculation
  // never creates one -- so without the row the configured extra is 0. A
  // posting and a settlement take the line as it stands; only a template
  // rewrite grows it back toward the account's configured extra.
  const extraPrincipalAmount = !extraPrincipalSplit
    ? 0
    : purpose === "posting" || purpose === "settlement"
      ? templateExtraAmount
      : Math.max(
          templateExtraAmount,
          Number(loanAccount.extraPaymentAmount) || 0,
        );

  const periodicRate = periodicRateFor(loanAccount, frequency, annualRate);
  const newInterest = roundMoney(debt * periodicRate);

  // A LINEAR or INTEREST_ONLY installment is derived, not configured: its
  // principal comes from table 4.3 on this date's debt and calendar, so the
  // template advances to principal + interest + extra, unbounded by
  // `accounts.payment_amount` (null for these methods, spec decision 11).
  // That is what heals a template a declined rate-change sync left at the
  // old installment (spec section 5.2). A posting never takes this branch:
  // it re-divides the bill it was shown, interest first, for every method.
  const methodInstallment =
    mortgageType && purpose !== "posting"
      ? nonAnnuityInstallment(
          mortgageType,
          loanAccount,
          asOfDate,
          debt,
          periodicRate,
        )
      : null;

  // Only a template advancement may grow back toward the configured payment;
  // a posting re-divides the bill it was shown (see `InstallmentPurpose`). A
  // reconfigure and a settlement take the account's configured payment
  // exactly when it has one, else the template's amount.
  const configuredPayment = Number(loanAccount.paymentAmount) || 0;
  const paymentAmount = methodInstallment
    ? roundMoney(
        methodInstallment.principal +
          methodInstallment.interest +
          extraPrincipalAmount,
      )
    : purpose === "posting"
      ? templateAmount
      : (purpose === "reconfigure" || purpose === "settlement") &&
          configuredPayment > 0
        ? configuredPayment
        : Math.max(templateAmount, configuredPayment);
  const basePaymentAmount = paymentAmount - extraPrincipalAmount;
  const newPrincipal = methodInstallment
    ? methodInstallment.principal
    : roundMoney(basePaymentAmount - newInterest);

  // The clamp sequence -- interest-first across the whole installment
  // (recheck RR2-006, DR3-01), principal bounded by the debt with the
  // discretionary extra absorbing the shortfall (audit P5-008, FR-009) --
  // is `allocateLoanPayment`, shared with the first installment written by
  // `LoanPaymentSetupService` because the two must agree about what any
  // installment looks like.
  const allocation = allocateLoanPayment({
    paymentAmount,
    extraPrincipal: extraPrincipalAmount,
    interest: newInterest,
    principal: newPrincipal,
    currentBalance: debt,
  });

  return {
    kind: "ok",
    allocation,
    template,
    debt,
    annualRate,
    paymentAmount,
    basePaymentAmount,
    extraPrincipalAmount,
    templateAmount,
    templateExtraAmount,
  };
}

/** What `resolveInstallmentCore` reads the installment from. */
export interface ResolveInstallmentInput {
  scheduledTransaction: Pick<ScheduledTransaction, "amount" | "frequency">;
  splits: ScheduledTransactionSplit[];
  loanAccount: Account;
  /** The date the installment's money moves, which the interest accrues to. */
  asOfDate: string;
  purpose: InstallmentPurpose;
}

/**
 * Resolve one installment of a scheduled loan payment: identify the managed
 * template lines, measure the debt through `asOfDate` from the ledger, read
 * the rate dated to it, and hand the facts to `priceInstallment`.
 *
 * The debt is checked AFTER the shape, so "paid off" can say whether this is
 * a bill whose every line the payoff settles. The order is the whole point:
 * read the other way round, a mortgage template with an escrow line reports
 * the same "paid off" as a plain principal+interest one, and a posting that
 * withholds money on it stops paying the escrow.
 *
 * A rate nothing records is 0 % for the template, posting and reconfigure
 * purposes, the posting path's historical default
 * (`docs/specs/loan-installment-settlement.md` section 15 item 5); a
 * settlement declines, naming the rate (decision 16). The rate is read only
 * once the shape and the debt have passed, because a retired or unmanaged
 * template needs none.
 */
export async function resolveInstallmentCore(
  m: EntityManager,
  input: ResolveInstallmentInput,
): Promise<ResolvedInstallment> {
  const { scheduledTransaction, splits, loanAccount, asOfDate, purpose } =
    input;
  const loanAccountId = loanAccount.id;

  const debt = await datedLoanDebt(m, loanAccount, asOfDate);
  if (debt === null) {
    return {
      kind: "unreadable",
      reason: `the ledger balance for loan account ${loanAccountId} could not be read`,
    };
  }

  const templateAmount = Math.abs(Number(scheduledTransaction.amount));
  const frequency =
    loanAccount.paymentFrequency || scheduledTransaction.frequency;

  const identified = identifyLoanTemplate(splits, loanAccount);

  if (debt <= 0.01) {
    return { kind: "paid-off", debt, managed: identified.managed };
  }

  if (!identified.managed) {
    return {
      kind: "declined",
      reason: declineReason(identified, loanAccount),
    };
  }

  // Read after the shape and debt checks: a retired or unmanaged template
  // needs no rate, and the answer does not change which of those it is.
  const recordedRate = await datedAnnualRate(m, loanAccount, asOfDate);
  if (recordedRate === null && purpose === "settlement") {
    return {
      kind: "declined",
      reason: `no interest rate is recorded for loan account ${loanAccountId} on ${asOfDate}`,
    };
  }
  // Still owed to the settlement planner (B3/B4 of
  // `docs/future-plans/loan-installment-settlement-tasks.md`): refusing an
  // unknown cadence. `periodicRateFor` defaults it to DEFAULT_PERIODS_PER_YEAR
  // for every purpose, this one included, until the planner checks
  // `periodsPerYearForStoredFrequency` itself before calling the tail.

  return priceInstallment({
    debt,
    annualRate: recordedRate ?? 0,
    loanAccount,
    template: {
      principalSplit: identified.principalSplit,
      interestSplit: identified.interestSplit,
      extraPrincipalSplit: identified.extraPrincipalSplit,
    },
    templateAmount,
    frequency,
    asOfDate,
    purpose,
  });
}
