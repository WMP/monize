import { Logger } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { ScheduledTransaction } from "../scheduled-transactions/entities/scheduled-transaction.entity";
import { ScheduledTransactionSplit } from "../scheduled-transactions/entities/scheduled-transaction-split.entity";
import { AccountType } from "../accounts/entities/account.entity";
import { mortgageTypeOf } from "../accounts/mortgage-type.util";
import { roundMoney } from "../common/round.util";
import { ensureYMD } from "../common/recurrence";
import {
  findLoanAccount,
  InstallmentPurpose,
  resolveInstallmentCore,
} from "./price-installment";

const logger = new Logger("LoanInstallments");

/**
 * The two purposes that rewrite a stored template. A posting re-divides the
 * bill it was shown and a settlement books a bank row; neither writes the
 * template.
 */
export type TemplateRewritePurpose = Extract<
  InstallmentPurpose,
  "template" | "reconfigure"
>;

/**
 * Rewrite a loan template's principal, interest and extra-principal lines, and
 * its parent, to the installment due at its `next_due_date`.
 *
 * `template` is the advancement after each posting
 * (`ScheduledTransactionLoanService.recalculateLoanPaymentSplits`) and the
 * reprice every settlement caller dispatches after its commit
 * (`docs/specs/loan-installment-settlement.md` section 4.7). `reconfigure` is
 * the rewrite after a mortgage's amortization method changed
 * (`repriceLoanTemplate`, `docs/specs/mortgage-types.md` section 5.6).
 *
 * Runs inside the caller's transaction (`m`), which every caller opens
 * through `withScopedDb`.
 */
export async function rewriteLoanTemplate(
  m: EntityManager,
  scheduledTransactionId: string,
  purpose: TemplateRewritePurpose,
): Promise<void> {
  // This writer mutates the child split set, so it must serialize through
  // the same parent lock the posting path takes (issue #1154 re-review): a
  // recalculation that changed principal/interest without the lock could
  // land between a poster's split-set guard and its write, and because a
  // P/I reallocation leaves the parent total unchanged, the poster's own
  // parent lock would not have blocked it. Lock the parent, then read the
  // current child set and derive the loan from it -- never from a loan id
  // captured off a pre-lock snapshot.
  const scheduledTransaction = await m
    .getRepository(ScheduledTransaction)
    .findOne({
      where: { id: scheduledTransactionId },
      lock: { mode: "pessimistic_write" },
    });

  if (!scheduledTransaction || !scheduledTransaction.isActive) {
    return;
  }

  const splits = await m.getRepository(ScheduledTransactionSplit).find({
    where: { scheduledTransactionId },
  });

  const loanAccount = await findLoanAccount(m, splits);
  if (!loanAccount) {
    return;
  }

  // Recalculation runs after the schedule advances, so the installment being
  // prepared is the one due at the (new) nextDueDate.
  const installment = await resolveInstallmentCore(m, {
    scheduledTransaction,
    splits,
    loanAccount,
    asOfDate: ensureYMD(scheduledTransaction.nextDueDate),
    purpose,
  });

  // A failed ledger read is not a template this module cannot account for,
  // and the remedy below ("set the interest category") would send the
  // reader nowhere. Two causes, two messages.
  if (installment.kind === "unreadable") {
    logger.warn(
      `Skipping loan recalculation for scheduled transaction ${scheduledTransactionId}: ` +
        `${installment.reason}. The stored principal/interest split stays at last period's ` +
        `figures until a later recalculation reads the ledger successfully.`,
    );
    return;
  }

  if (installment.kind === "paid-off") {
    // A LINE OF CREDIT owing nothing is not a finished loan -- it is a
    // revolving facility at a zero (or credit) balance, and the user can
    // draw on it again tomorrow. Deactivating its schedule is not
    // recoverable from the UI, so it keeps billing whatever the template
    // holds and simply writes no new split this period.
    //
    // This matters more since the debt became `max(0, -balance)`: an
    // overpaid account in credit now reads as owing nothing, where the
    // old `Math.abs` read a credit balance as fresh debt and kept
    // amortizing it. That change is right (it matches `debtMagnitude` on
    // the client) but it must not take a revolving account's schedule
    // down with it.
    if (loanAccount.accountType === AccountType.LINE_OF_CREDIT) {
      logger.log(
        `Loan recalculation: line of credit ${loanAccount.id} owes nothing through ` +
          `${ensureYMD(scheduledTransaction.nextDueDate)}; leaving the schedule active ` +
          `(a revolving facility can be drawn on again).`,
      );
      return;
    }
    await m
      .getRepository(ScheduledTransaction)
      .update(scheduledTransactionId, { isActive: false });
    return;
  }

  if (installment.kind === "declined") {
    logger.warn(
      `Skipping loan recalculation for scheduled transaction ${scheduledTransactionId}: ` +
        `${installment.reason}. ` +
        `Rewriting the parent would leave it unequal to the sum of its children and the occurrence would stop posting. ` +
        `Set the loan's interest category, or keep the template to principal + interest (+ extra principal).`,
    );
    return;
  }

  const {
    allocation,
    template,
    debt,
    paymentAmount,
    basePaymentAmount,
    extraPrincipalAmount,
    templateAmount,
    templateExtraAmount,
  } = installment;
  const { principalSplit, interestSplit, extraPrincipalSplit } = template;

  const newInterest = allocation.interest;
  const newPrincipal = allocation.principal;
  const finalExtraPrincipal = allocation.extraPrincipal;
  const requiredParentAmount = allocation.total;

  // The stored cadence is deliberately not in this line: the account's
  // payment fields are what the Bearer logger rule (CWE-532) refuses to see
  // logged, and the rate and amounts already say what was priced.
  const mortgageType =
    loanAccount.accountType === "MORTGAGE"
      ? mortgageTypeOf(loanAccount)
      : "none";
  logger.log(
    `Recalculate loan splits: balance=${debt}, rate=${installment.annualRate}%, ` +
      `basePayment=${basePaymentAmount}, ` +
      `extra=${extraPrincipalAmount} (final ${finalExtraPrincipal}), ` +
      `newPrincipal=${newPrincipal}, newInterest=${newInterest}, ` +
      `mortgageType=${mortgageType}`,
  );

  if (principalSplit) {
    principalSplit.amount = -newPrincipal;
    await m.getRepository(ScheduledTransactionSplit).save(principalSplit);
  }

  if (interestSplit) {
    interestSplit.amount = -newInterest;
    await m.getRepository(ScheduledTransactionSplit).save(interestSplit);
  }

  // The extra principal child was never written here, so a clamped total had
  // nowhere to land: the parent would shrink while the children still summed
  // to the unclamped figure, and the posting path's split validator requires
  // exact 4dp equality between them (audit P5-008 again, on the child the
  // first fix did not reach). Written whenever it differs from what the
  // template holds -- in either direction, so one clamped installment does
  // not become the standing instruction (review #1131).
  if (extraPrincipalSplit && finalExtraPrincipal !== templateExtraAmount) {
    extraPrincipalSplit.amount = -finalExtraPrincipal;
    await m.getRepository(ScheduledTransactionSplit).save(extraPrincipalSplit);
  }

  // Parent and children are written in the same transaction, so a posting
  // can never see one without the other. The parent is written whenever the
  // next installment differs from what the template holds: shrunk when the
  // debt no longer needs the whole configured payment, and grown back
  // toward the configured payment when a clamp written for one installment
  // no longer binds -- a voided final payment or an imported balance must
  // not leave the schedule billing the clamped figure forever (review
  // #1131). `allocateLoanPayment` bounds the total by the configured
  // payment, so this can never grow past what the user set -- for a
  // LINEAR or INTEREST_ONLY mortgage, past the method's installment for
  // this due date, which is what the user set by choosing the method.
  if (
    requiredParentAmount > 0 &&
    requiredParentAmount !== roundMoney(templateAmount)
  ) {
    await m
      .getRepository(ScheduledTransaction)
      .update(scheduledTransactionId, { amount: -requiredParentAmount });
    logger.log(
      `Loan payment recalculated: scheduled amount changed from ${templateAmount} to ${requiredParentAmount} (configured payment ${paymentAmount}, outstanding balance ${debt})`,
    );
  }
}
