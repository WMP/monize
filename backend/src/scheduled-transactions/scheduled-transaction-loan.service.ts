import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { ScheduledTransaction } from "./entities/scheduled-transaction.entity";
import { ScheduledTransactionSplit } from "./entities/scheduled-transaction-split.entity";
import { Account } from "../accounts/entities/account.entity";
import { PaymentFrequency } from "../accounts/loan-amortization.util";
import {
  getPeriodicRate,
  getMortgagePeriodsPerYear,
  MortgagePaymentFrequency,
} from "../accounts/mortgage-amortization.util";
import { getPeriodsPerYear } from "../accounts/loan-amortization.util";
import { roundMoney } from "../common/round.util";
import { withScopedDb } from "../common/db/scoped-db";

@Injectable()
export class ScheduledTransactionLoanService {
  private readonly logger = new Logger(ScheduledTransactionLoanService.name);

  constructor(private dataSource: DataSource) {}

  async recalculateLoanPaymentSplits(
    scheduledTransactionId: string,
    loanAccountId: string,
  ): Promise<void> {
    return withScopedDb(this.dataSource, async (m) => {
      const loanAccount = await m.getRepository(Account).findOne({
        where: { id: loanAccountId },
      });

      if (!loanAccount) {
        return;
      }

      const scheduledTransaction = await m
        .getRepository(ScheduledTransaction)
        .findOne({
          where: { id: scheduledTransactionId },
          relations: ["splits"],
        });

      if (!scheduledTransaction || !scheduledTransaction.isActive) {
        return;
      }

      const currentBalance = Math.abs(Number(loanAccount.currentBalance));

      if (currentBalance <= 0.01) {
        await m
          .getRepository(ScheduledTransaction)
          .update(scheduledTransactionId, { isActive: false });
        return;
      }

      const paymentAmount = Math.abs(Number(scheduledTransaction.amount));
      const interestRate = Number(loanAccount.interestRate) || 0;
      const frequency = (loanAccount.paymentFrequency ||
        scheduledTransaction.frequency) as PaymentFrequency;

      const splits = scheduledTransaction.splits || [];

      // Identify splits: there may be a regular principal transfer, an interest
      // category split, and optionally a separate extra principal transfer.
      // Extra principal splits have memo "Extra Principal" and transfer to the
      // loan account. Regular principal also transfers to the loan account.
      const extraPrincipalSplit = splits.find(
        (s) =>
          s.transferAccountId === loanAccountId &&
          s.memo?.toLowerCase().includes("extra"),
      );
      const principalSplit = splits.find(
        (s) =>
          s.transferAccountId === loanAccountId && s !== extraPrincipalSplit,
      );
      const interestSplit = splits.find(
        (s) => s.categoryId && !s.transferAccountId,
      );

      // The base payment for amortization calculation excludes extra principal
      const extraPrincipalAmount = extraPrincipalSplit
        ? Math.abs(Number(extraPrincipalSplit.amount))
        : 0;
      const basePaymentAmount = paymentAmount - extraPrincipalAmount;

      // Get the previous split values (the values that were just posted).
      // These are still on the scheduled transaction template because posting
      // is read-only with respect to the template.
      const prevPrincipal = principalSplit
        ? Math.abs(Number(principalSplit.amount))
        : 0;
      const prevInterest = interestSplit
        ? Math.abs(Number(interestSplit.amount))
        : 0;

      let newInterest: number;
      let newPrincipal: number;

      if (prevInterest > 0 && prevPrincipal > 0 && interestRate > 0) {
        // Use the amortization recurrence relation to derive the next P/I split
        // from the previous values. This avoids depending on currentBalance,
        // which may be wrong if the opening balance had the wrong sign.
        //
        // In amortization:
        //   next_interest = prev_interest - (prev_principal + extra) * periodicRate
        //   next_principal = basePayment - next_interest
        //
        // The total principal (regular + extra) reduces the balance, which
        // causes the interest to drop by that amount times the periodic rate.
        const periodsPerYear =
          loanAccount.accountType === "MORTGAGE"
            ? getMortgagePeriodsPerYear(frequency as MortgagePaymentFrequency)
            : getPeriodsPerYear(frequency);

        const periodicRate =
          loanAccount.accountType === "MORTGAGE"
            ? getPeriodicRate(
                interestRate,
                periodsPerYear,
                loanAccount.isCanadianMortgage,
                loanAccount.isVariableRate,
              )
            : interestRate / 100 / periodsPerYear;

        const totalPrevPrincipal = prevPrincipal + extraPrincipalAmount;
        newInterest = prevInterest - totalPrevPrincipal * periodicRate;
        newInterest = Math.max(0, roundMoney(newInterest));
        newPrincipal = roundMoney(basePaymentAmount - newInterest);

        if (newPrincipal < 0) {
          newPrincipal = 0;
        }
      } else {
        // No previous split data or no rate -- fall back to balance-based calc
        const periodsPerYear =
          loanAccount.accountType === "MORTGAGE"
            ? getMortgagePeriodsPerYear(frequency as MortgagePaymentFrequency)
            : getPeriodsPerYear(frequency);

        const periodicRate =
          loanAccount.accountType === "MORTGAGE"
            ? getPeriodicRate(
                interestRate,
                periodsPerYear,
                loanAccount.isCanadianMortgage,
                loanAccount.isVariableRate,
              )
            : interestRate / 100 / periodsPerYear;

        newInterest = roundMoney(currentBalance * periodicRate);
        newPrincipal = roundMoney(basePaymentAmount - newInterest);
        if (newPrincipal < 0) newPrincipal = 0;
        if (newPrincipal > currentBalance) newPrincipal = currentBalance;
      }

      // A payment that does not cover the accrued interest is applied
      // interest-first across the WHOLE installment, extra principal included.
      //
      // Two things are being decided here. First, the interest has to be bounded
      // at all: neither branch above bounded it and the parent update below only
      // shrinks, so a 100,000 balance at 5% per period against a configured 1,000
      // payment wrote an interest child of -5,000 under a parent of -1,000, and the
      // posting path then reached the shared split validator with children 4,000
      // above the parent -- the schedule stopped posting (recheck RR2-006).
      //
      // Second, *which* part yields. Capping at `basePaymentAmount` left a
      // designated extra-principal transfer paying down principal while the
      // interest it accrued went unpaid: 1,000 payment with 300 extra against 800
      // of interest allocated 700 interest and 300 principal. A lender applies a
      // payment to accrued interest before principal, so the extra instruction has
      // no principal to reduce until the interest is met (recheck DR3-01). It is a
      // policy choice, recorded here and in the response document rather than left
      // to whichever branch happened to run.
      if (newInterest > basePaymentAmount) {
        newInterest = Math.min(
          roundMoney(newInterest),
          roundMoney(paymentAmount),
        );
        newPrincipal = 0;
      }

      // The final installment: what is left to pay is less than a regular
      // payment, so the payment itself has to shrink with it.
      //
      // Capping the principal child to the outstanding balance without touching
      // the parent left parent -100 against children summing -50, and the
      // posting path then submits those children to the shared split validator,
      // which requires exact 4dp equality. The final payment failed at exactly
      // the moment the user expected the loan to close, and a manual overpayment
      // triggered the same thing earlier in the schedule (audit P5-008).
      //
      // The recurrence path above had no cap at all, so it could also overpay
      // the loan past zero. Both paths now go through the same clamp.
      if (newPrincipal > currentBalance) {
        newPrincipal = currentBalance;
      }

      // FR-009: the clamp above bounds the regular principal child alone, but
      // the balance is retired by regular *and* extra principal together. A
      // 500 remaining balance against a 400 amortized principal plus a 300
      // standing extra transfer left 700 going into a 500 debt: the loan account
      // crossed zero into a 200 credit, the payoff-detection branch above
      // (`currentBalance <= 0.01`) never fired on the exact-zero it was waiting
      // for, and the schedule kept billing.
      //
      // Regular principal is what the amortization says is owed, so it is filled
      // first; the extra transfer is discretionary and absorbs the shortfall.
      // Interest is not clamped -- it accrued on the balance and is owed
      // independently of how much principal is left to retire.
      // What is left of the installment after interest is the most that can go to
      // principal in total, so the extra is bounded by that as well as by the debt.
      const availableForPrincipal = Math.max(
        0,
        roundMoney(paymentAmount - newInterest),
      );
      let finalExtraPrincipal = Math.min(
        extraPrincipalAmount,
        Math.max(0, roundMoney(availableForPrincipal - newPrincipal)),
      );
      if (roundMoney(newPrincipal + finalExtraPrincipal) > currentBalance) {
        finalExtraPrincipal = Math.max(
          0,
          roundMoney(currentBalance - newPrincipal),
        );
      }

      const requiredParentAmount = roundMoney(
        newPrincipal + newInterest + finalExtraPrincipal,
      );

      this.logger.log(
        `Recalculate loan splits: prevPrincipal=${prevPrincipal}, prevInterest=${prevInterest}, ` +
          `rate=${interestRate}%, freq=${frequency}, basePayment=${basePaymentAmount}, ` +
          `extra=${extraPrincipalAmount} (final ${finalExtraPrincipal}), ` +
          `newPrincipal=${newPrincipal}, newInterest=${newInterest}, ` +
          `isMortgage=${loanAccount.accountType === "MORTGAGE"}, ` +
          `isCanadian=${loanAccount.isCanadianMortgage}`,
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
      // first fix did not reach).
      if (extraPrincipalSplit && finalExtraPrincipal !== extraPrincipalAmount) {
        extraPrincipalSplit.amount = -finalExtraPrincipal;
        await m
          .getRepository(ScheduledTransactionSplit)
          .save(extraPrincipalSplit);
      }

      // Parent and children are written in the same transaction, so a posting
      // can never see one without the other. Only shrunk, never grown: a
      // regular installment keeps the amount the user set, and the parent is
      // reduced only when the debt no longer needs the whole of it.
      if (
        requiredParentAmount > 0 &&
        requiredParentAmount < roundMoney(paymentAmount)
      ) {
        await m
          .getRepository(ScheduledTransaction)
          .update(scheduledTransactionId, { amount: -requiredParentAmount });
        this.logger.log(
          `Final loan payment: reduced scheduled amount from ${paymentAmount} to ${requiredParentAmount} to match the outstanding balance of ${currentBalance}`,
        );
      }
    });
  }

  async findLoanAccountFromSplits(
    splits: ScheduledTransactionSplit[],
  ): Promise<string | null> {
    return withScopedDb(this.dataSource, async (m) => {
      for (const split of splits) {
        if (split.transferAccountId) {
          const account = await m.getRepository(Account).findOne({
            where: { id: split.transferAccountId },
          });
          if (
            account &&
            (account.accountType === "LOAN" ||
              account.accountType === "MORTGAGE")
          ) {
            return account.id;
          }
        }
      }
      return null;
    });
  }
}
