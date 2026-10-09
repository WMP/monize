import { EntityManager } from "typeorm";
import {
  datedAnnualRate,
  identifyLoanTemplate,
  declineReason,
  InstallmentPurpose,
  priceInstallment,
  resolveInstallmentCore,
} from "./price-installment";
import { ScheduledTransaction } from "../scheduled-transactions/entities/scheduled-transaction.entity";
import { ScheduledTransactionSplit } from "../scheduled-transactions/entities/scheduled-transaction-split.entity";
import { Account, AccountType } from "../accounts/entities/account.entity";
import { LoanRateChange } from "../loan-rate-changes/entities/loan-rate-change.entity";
import { createScopedDbMocks } from "../test-helpers/scoped-db-testing";

/**
 * The pure pricing tail for the LINEAR and INTEREST_ONLY methods
 * (docs/specs/mortgage-types.md, sections 5.2 and 9, table 4.3). Every figure
 * is copied from the spec's section 7 tables, which were produced by an
 * independent period-by-period loop: EUR 300,000 over 360 monthly payments from
 * 2024-01-01, 2.00% until 4.00% from 2027-01-01, repayments of 20,000 on
 * 2025-07-01 and 15,000 on 2026-01-01. The debt each case prices is the spec's
 * "debt as posted", the figure `datedLoanDebt` returns; the rate is the one
 * the timeline resolves for the date, passed in directly because the tail is
 * pure. The service's own spec keeps the cases about what the service WRITES
 * (deactivation, the posting's booking, the method-change reprice, the
 * missing-term decline); these are the ones about the numbers.
 */
describe("priceInstallment", () => {
  const loanAccountId = "acc-mortgage";
  const userId = "user-1";

  const makeMortgage = (overrides: Partial<Account> = {}): Account =>
    ({
      id: loanAccountId,
      userId,
      accountType: "MORTGAGE",
      name: "Hypotheek",
      mortgageType: "LINEAR",
      prepaymentMode: null,
      isCanadianMortgage: false,
      isVariableRate: false,
      interestRate: 2,
      paymentAmount: null,
      extraPaymentAmount: null,
      paymentFrequency: "MONTHLY",
      paymentStartDate: "2024-01-01",
      amortizationMonths: 360,
      originalPrincipal: 300000,
      openingBalance: -300000,
      currentBalance: -300000,
      interestCategoryId: "cat-interest",
      ...overrides,
    }) as unknown as Account;

  const makeTemplate = (
    principal: number,
    interest: number,
    nextDueDate: string,
    extra?: number,
  ): ScheduledTransaction =>
    ({
      id: "st-mortgage",
      userId,
      accountId: "acc-chequing",
      name: "Mortgage Payment",
      amount: -(principal + interest + (extra ?? 0)),
      frequency: "MONTHLY",
      nextDueDate,
      isActive: true,
      splits: [
        {
          id: "split-principal",
          transferAccountId: loanAccountId,
          categoryId: null,
          amount: -principal,
          memo: "Principal",
        },
        {
          id: "split-interest",
          transferAccountId: null,
          categoryId: "cat-interest",
          amount: -interest,
          memo: "Interest",
        },
        ...(extra
          ? [
              {
                id: "split-extra",
                transferAccountId: loanAccountId,
                categoryId: null,
                amount: -extra,
                memo: "Extra Principal",
              },
            ]
          : []),
      ],
    }) as unknown as ScheduledTransaction;

  /** Price the template at its own due date, with the rate the timeline gives. */
  const price = (
    account: Account,
    template: ScheduledTransaction,
    debt: number,
    annualRate: number,
    purpose: InstallmentPurpose = "template",
  ) => {
    const identified = identifyLoanTemplate(
      template.splits as ScheduledTransactionSplit[],
      account,
    );
    if (!identified.managed) {
      throw new Error("fixture is not a managed template");
    }
    return priceInstallment({
      debt,
      annualRate,
      loanAccount: account,
      template: identified,
      templateAmount: Math.abs(Number(template.amount)),
      frequency: account.paymentFrequency || template.frequency,
      asOfDate: template.nextDueDate,
      purpose,
    });
  };

  /** The allocation of a priced installment: principal, interest, extra, parent. */
  const priced = (...args: Parameters<typeof price>) => {
    const result = price(...args);
    if (result.kind !== "ok") {
      throw new Error(`expected a priced installment, got ${result.kind}`);
    }
    return {
      principal: result.allocation.principal,
      interest: result.allocation.interest,
      extra: result.allocation.extraPrincipal,
      parent: result.allocation.total,
    };
  };

  describe("LINEAR, SHORTEN_TERM (spec table 7.1)", () => {
    it("keeps the principal constant through a rate change; only the interest moves", () => {
      const account = makeMortgage();

      const december = priced(
        account,
        makeTemplate(833.3333, 393.6111, "2026-12-01"),
        235833.3345,
        2,
      );
      expect(december).toEqual({
        principal: 833.3333,
        interest: 393.0556,
        extra: 0,
        parent: 1226.3889,
      });

      const january = priced(
        account,
        makeTemplate(833.3333, 393.0556, "2027-01-01"),
        235000.0012,
        4,
      );
      expect(january).toEqual({
        principal: 833.3333,
        interest: 783.3333,
        extra: 0,
        parent: 1616.6666,
      });
    });

    it("prices 2027-01-01 on a ledger posted at cents: 833.33 and 783.33", () => {
      // 36 installments of 833.33 and 35,000 of repayments leave 235,000.12.
      const result = priced(
        makeMortgage(),
        makeTemplate(833.3333, 393.0556, "2027-01-01"),
        235000.12,
        4,
      );
      expect(result.principal).toBe(833.3333);
      expect(result.interest).toBe(783.3337);
      expect(Math.round(result.interest * 100) / 100).toBe(783.33);
    });

    it("prices a ledger recorded at statement cents from what it holds (table 7.2)", () => {
      const result = priced(
        makeMortgage(),
        makeTemplate(833.3333, 443.0556, "2025-07-01"),
        265000.06,
        2,
      );
      expect(result).toMatchObject({
        principal: 833.3333,
        interest: 441.6668,
        parent: 1275.0001,
      });
    });

    it("lets the final installment absorb the leftover", () => {
      const final = priced(
        makeMortgage(),
        makeTemplate(833.3333, 5.5555, "2050-06-01"),
        833.3439,
        4,
      );
      expect(final).toEqual({
        principal: 833.3439,
        interest: 2.7778,
        extra: 0,
        parent: 836.1217,
      });
    });

    it("grows the template to the method installment, unbounded by payment_amount", () => {
      // payment_amount is null for LINEAR (spec decision 11); the template
      // still advances to c + interest + the standing extra.
      const result = priced(
        makeMortgage({ extraPaymentAmount: 100 }),
        makeTemplate(833.3333, 393.0556, "2027-01-01", 100),
        235000.0012,
        4,
      );
      expect(result).toEqual({
        principal: 833.3333,
        interest: 783.3333,
        extra: 100,
        parent: 1716.6666,
      });
    });

    it("reads a mortgage whose original_principal is null from its opening balance", () => {
      const result = priced(
        makeMortgage({ originalPrincipal: null }),
        makeTemplate(833.3333, 500, "2024-02-01"),
        299166.6667,
        2,
      );
      expect(result).toMatchObject({ principal: 833.3333, interest: 498.6111 });
    });
  });

  describe("LINEAR, LOWER_INSTALLMENT (spec table 7.3)", () => {
    it("re-derives the principal from the next due date after a prepayment", () => {
      const account = makeMortgage({ prepaymentMode: "LOWER_INSTALLMENT" });
      const template = makeTemplate(833.3333, 474.7222, "2025-07-01");

      // Before the 20,000 repayment reaches the ledger: 285,000.0006 over 342.
      const before = priced(account, template, 285000.0006, 2);
      expect(before.principal).toBe(833.3333);

      // After it: the same due date re-derives 265,000.0006 / 342.
      const after = priced(account, template, 265000.0006, 2);
      expect(after).toEqual({
        principal: 774.8538,
        interest: 441.6667,
        extra: 0,
        parent: 1216.5205,
      });
    });

    it("keeps the principal through a rate change", () => {
      const result = priced(
        makeMortgage({ prepaymentMode: "LOWER_INSTALLMENT" }),
        makeTemplate(730.2109, 395.0, "2027-01-01"),
        236588.347,
        4,
      );
      expect(result).toEqual({
        principal: 730.2109,
        interest: 788.6278,
        extra: 0,
        parent: 1518.8387,
      });
    });

    it("counts remaining payments from the calendar for a due date moved off it", () => {
      // 2025-07-10 is k = 19, the same as 2025-07-01: remaining 342.
      const result = priced(
        makeMortgage({ prepaymentMode: "LOWER_INSTALLMENT" }),
        makeTemplate(833.3333, 474.7222, "2025-07-10"),
        265000.0006,
        2,
      );
      expect(result.principal).toBe(774.8538);
    });

    it("pays the whole debt on payment N", () => {
      const result = priced(
        makeMortgage({ prepaymentMode: "LOWER_INSTALLMENT" }),
        makeTemplate(730.2109, 4.8679, "2053-12-01"),
        730.2109,
        4,
      );
      expect(result).toEqual({
        principal: 730.2109,
        interest: 2.434,
        extra: 0,
        parent: 732.6449,
      });
    });
  });

  describe("INTEREST_ONLY (spec table 7.4 and section 9)", () => {
    const interestOnly = () =>
      makeMortgage({ mortgageType: "INTEREST_ONLY", prepaymentMode: null });

    it("keeps the principal line at zero and prices the interest", () => {
      const result = priced(
        interestOnly(),
        makeTemplate(0, 441.6667, "2027-01-01"),
        265000,
        4,
      );
      expect(result.principal).toBe(0);
      expect(result.interest).toBe(883.3333);
      expect(result.parent).toBe(883.3333);
    });

    it("writes the bullet into the principal line before payment N", () => {
      const result = priced(
        interestOnly(),
        makeTemplate(0, 883.3333, "2053-12-01"),
        265000,
        4,
      );
      expect(result).toEqual({
        principal: 265000,
        interest: 883.3333,
        extra: 0,
        parent: 265883.3333,
      });
    });
  });

  describe("missing terms (spec section 8)", () => {
    it("declines a LINEAR mortgage without its calendar, naming the term", () => {
      const result = price(
        makeMortgage({ paymentStartDate: null }),
        makeTemplate(833.3333, 500, "2024-02-01"),
        299166.6667,
        2,
      );
      expect(result).toEqual({
        kind: "declined",
        reason: `the LINEAR mortgage ${loanAccountId} has no paymentStartDate`,
      });
    });
  });

  /**
   * The settlement purpose (`docs/specs/loan-installment-settlement.md`
   * section 7, the spec's 9.2 annuity: 200,000 at 6 % monthly, payment 1,500).
   * The template may hold a clamp written for one installment; the settlement
   * prices the configured payment, and takes the extra line as it stands.
   */
  describe('purpose "settlement"', () => {
    const annuityLoan = (overrides: Partial<Account> = {}): Account =>
      makeMortgage({
        accountType: AccountType.LOAN,
        mortgageType: null,
        interestRate: 6,
        paymentAmount: 1500,
        paymentStartDate: null,
        amortizationMonths: null,
        originalPrincipal: null,
        ...overrides,
      });

    it("prices an annuity at accounts.payment_amount, not the template's clamped amount", () => {
      const result = priced(
        annuityLoan(),
        makeTemplate(480, 1000, "2024-02-01"),
        200000,
        6,
        "settlement",
      );
      expect(result).toEqual({
        principal: 500,
        interest: 1000,
        extra: 0,
        parent: 1500,
      });
    });

    it("falls back to the template's amount when the account carries no payment", () => {
      const result = priced(
        annuityLoan({ paymentAmount: null }),
        makeTemplate(500, 1000, "2024-02-01"),
        200000,
        6,
        "settlement",
      );
      expect(result).toEqual({
        principal: 500,
        interest: 1000,
        extra: 0,
        parent: 1500,
      });
    });

    it("takes the template's standing extra line where a reconfigure grows it toward the account's", () => {
      const account = annuityLoan({ extraPaymentAmount: 300 });
      const template = makeTemplate(400, 1000, "2024-02-01", 100);

      const settlement = priced(account, template, 200000, 6, "settlement");
      expect(settlement).toEqual({
        principal: 400,
        interest: 1000,
        extra: 100,
        parent: 1500,
      });

      const reconfigure = priced(account, template, 200000, 6, "reconfigure");
      expect(reconfigure).toEqual({
        principal: 200,
        interest: 1000,
        extra: 300,
        parent: 1500,
      });
    });

    it("prices LINEAR through the method installment as the template purpose does", () => {
      const template = makeTemplate(833.3333, 393.0556, "2027-01-01");
      const settlement = priced(
        makeMortgage(),
        template,
        235000.0012,
        4,
        "settlement",
      );
      expect(settlement).toEqual(
        priced(makeMortgage(), template, 235000.0012, 4),
      );
      expect(settlement.principal).toBe(833.3333);
      expect(settlement.interest).toBe(783.3333);
    });
  });

  describe("identifyLoanTemplate", () => {
    it("names the principal, interest and extra lines of a managed template", () => {
      const template = makeTemplate(800, 500, "2024-02-01", 100);
      const identified = identifyLoanTemplate(
        template.splits as ScheduledTransactionSplit[],
        makeMortgage(),
      );
      expect(identified.managed).toBe(true);
      expect(identified.principalSplit?.id).toBe("split-principal");
      expect(identified.interestSplit?.id).toBe("split-interest");
      expect(identified.extraPrincipalSplit?.id).toBe("split-extra");
      expect(identified.unmanagedLines).toEqual([]);
    });

    it("reports a line it cannot account for, with the reason a caller logs", () => {
      const template = makeTemplate(800, 500, "2024-02-01");
      const splits = [
        ...(template.splits as ScheduledTransactionSplit[]),
        {
          id: "split-escrow",
          transferAccountId: null,
          categoryId: "cat-escrow",
          amount: -200,
          memo: "Escrow",
        } as unknown as ScheduledTransactionSplit,
      ];
      const account = makeMortgage();
      const identified = identifyLoanTemplate(splits, account);
      expect(identified.managed).toBe(false);
      if (identified.managed) throw new Error("unreachable");
      expect(identified.unmanagedLines.map((s) => s.id)).toEqual([
        "split-escrow",
      ]);
      expect(declineReason(identified, account)).toBe(
        "1 line(s) beyond principal/interest/extra",
      );
    });

    it("cannot pick the interest line from several categorized lines without a configured category", () => {
      const template = makeTemplate(800, 500, "2024-02-01");
      const splits = [
        ...(template.splits as ScheduledTransactionSplit[]),
        {
          id: "split-escrow",
          transferAccountId: null,
          categoryId: "cat-escrow",
          amount: -200,
          memo: "Escrow",
        } as unknown as ScheduledTransactionSplit,
      ];
      const account = makeMortgage({ interestCategoryId: null });
      const identified = identifyLoanTemplate(splits, account);
      expect(identified.managed).toBe(false);
      if (identified.managed) throw new Error("unreachable");
      expect(declineReason(identified, account)).toBe(
        `2 categorized lines and no interest category configured on account ${loanAccountId}`,
      );
    });
  });

  /**
   * The I/O half: the rate comes from the timeline dated at the boundary, and
   * a rate nothing records is `null` -- which the template and posting
   * purposes read as 0 % (the posting path's historical default, spec section
   * 15 item 5) and the settlement refuses (decision 16).
   */
  describe("datedAnnualRate and the core's missing-rate rule", () => {
    let manager: Record<string, jest.Mock>;
    let rateChangesRepository: Record<string, jest.Mock>;
    let ledgerDebt: number;

    const m = () => manager as unknown as EntityManager;

    beforeEach(() => {
      rateChangesRepository = { find: jest.fn().mockResolvedValue([]) };
      manager = createScopedDbMocks([
        [LoanRateChange, rateChangesRepository],
      ]).manager;
      ledgerDebt = 235000.0012;
      manager.query.mockImplementation(async (sql: unknown) =>
        String(sql).includes("opening_balance")
          ? [{ balance: String(-ledgerDebt) }]
          : [],
      );
    });

    it("resolves the timeline's rate for the date, not the account's scalar", async () => {
      rateChangesRepository.find.mockResolvedValue([
        { effectiveDate: "2024-01-01", annualRate: "2.0000" },
        { effectiveDate: "2027-01-01", annualRate: "4.0000" },
      ]);
      const account = makeMortgage({ interestRate: 9 });
      await expect(datedAnnualRate(m(), account, "2026-12-01")).resolves.toBe(
        2,
      );
      await expect(datedAnnualRate(m(), account, "2027-01-01")).resolves.toBe(
        4,
      );
      expect(rateChangesRepository.find).toHaveBeenCalledWith({
        where: { accountId: loanAccountId },
        order: { effectiveDate: "ASC" },
      });
    });

    it("falls back to the account's scalar when no row applies", async () => {
      await expect(
        datedAnnualRate(
          m(),
          // A raw read hands a decimal back as a string; the rule reads both.
          makeMortgage({ interestRate: "3.5" } as unknown as Partial<Account>),
          "2024-02-01",
        ),
      ).resolves.toBe(3.5);
    });

    it.each([[null], [undefined], ["not a number"]])(
      "answers null, not 0, when nothing records a rate (scalar %p)",
      async (interestRate) => {
        await expect(
          datedAnnualRate(
            m(),
            makeMortgage({ interestRate } as unknown as Partial<Account>),
            "2024-02-01",
          ),
        ).resolves.toBeNull();
      },
    );

    it("prices the template purpose at 0 % when no rate is recorded, the posting path's default", async () => {
      const template = makeTemplate(833.3333, 393.0556, "2027-01-01");
      const result = await resolveInstallmentCore(m(), {
        scheduledTransaction: template,
        splits: template.splits as ScheduledTransactionSplit[],
        loanAccount: makeMortgage({ interestRate: null }),
        asOfDate: "2027-01-01",
        purpose: "template",
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") throw new Error("unreachable");
      expect(result.annualRate).toBe(0);
      expect(result.allocation).toMatchObject({
        principal: 833.3333,
        interest: 0,
      });
    });

    it("declines the settlement purpose when no rate is recorded, naming the rate and the date", async () => {
      const template = makeTemplate(833.3333, 393.0556, "2027-01-01");
      const result = await resolveInstallmentCore(m(), {
        scheduledTransaction: template,
        splits: template.splits as ScheduledTransactionSplit[],
        loanAccount: makeMortgage({ interestRate: null }),
        asOfDate: "2027-01-01",
        purpose: "settlement",
      });
      expect(result).toEqual({
        kind: "declined",
        reason: `no interest rate is recorded for loan account ${loanAccountId} on 2027-01-01`,
      });
    });

    it("reports a retired debt before asking for a rate: zero needs none", async () => {
      ledgerDebt = 0;
      const template = makeTemplate(833.3333, 393.0556, "2027-01-01");
      const result = await resolveInstallmentCore(m(), {
        scheduledTransaction: template,
        splits: template.splits as ScheduledTransactionSplit[],
        loanAccount: makeMortgage({ interestRate: null }),
        asOfDate: "2027-01-01",
        purpose: "settlement",
      });
      expect(result).toEqual({ kind: "paid-off", debt: 0, managed: true });
    });

    it("prices the settlement at the timeline's rate once one applies", async () => {
      rateChangesRepository.find.mockResolvedValue([
        { effectiveDate: "2027-01-01", annualRate: "4.0000" },
      ]);
      const template = makeTemplate(833.3333, 393.0556, "2027-01-01");
      const result = await resolveInstallmentCore(m(), {
        scheduledTransaction: template,
        splits: template.splits as ScheduledTransactionSplit[],
        loanAccount: makeMortgage({ interestRate: null }),
        asOfDate: "2027-01-01",
        purpose: "settlement",
      });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") throw new Error("unreachable");
      expect(result.annualRate).toBe(4);
      expect(result.allocation).toMatchObject({
        principal: 833.3333,
        interest: 783.3333,
      });
    });
  });
});
