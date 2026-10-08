import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { createScopedDbMocks } from "../test-helpers/scoped-db-testing";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { LoanPaymentSetupService } from "./loan-payment-setup.service";
import { LoanPaymentMatchingService } from "./loan-payment-matching.service";
import { Account, AccountType } from "./entities/account.entity";
import { CategoriesService } from "../categories/categories.service";
import { ScheduledTransactionsService } from "../scheduled-transactions/scheduled-transactions.service";

describe("LoanPaymentSetupService", () => {
  let service: LoanPaymentSetupService;
  let accountsRepository: Record<string, jest.Mock>;
  let categoriesService: Record<string, jest.Mock>;
  let scheduledTransactionsService: Record<string, jest.Mock>;
  let paymentMatching: jest.Mocked<
    Pick<
      LoanPaymentMatchingService,
      "assertDefinable" | "createMatchingRuleReported"
    >
  >;

  const mockLoanAccount = {
    id: "loan-1",
    userId: "user-1",
    name: "Auto Loan",
    accountType: AccountType.LOAN,
    currencyCode: "USD",
    currentBalance: -15000,
    openingBalance: -20000,
    interestRate: null,
    institution: "Bank of Test",
    scheduledTransactionId: null,
    isCanadianMortgage: false,
    isVariableRate: false,
    originalPrincipal: null,
  };

  const mockSourceAccount = {
    id: "source-1",
    userId: "user-1",
    name: "Checking",
    accountType: AccountType.CHEQUING,
  };

  const mockScheduledTx = {
    id: "sched-1",
  };

  beforeEach(async () => {
    paymentMatching = {
      assertDefinable: jest.fn(),
      createMatchingRuleReported: jest
        .fn()
        .mockResolvedValue({ ruleId: "rule-1", error: null }),
    };
    accountsRepository = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
    };

    categoriesService = {
      findLoanCategories: jest.fn().mockResolvedValue({
        principalCategory: null,
        interestCategory: { id: "interest-cat-1", name: "Loan Interest" },
      }),
    };

    scheduledTransactionsService = {
      create: jest.fn().mockResolvedValue(mockScheduledTx),
    };

    const { dataSource } = createScopedDbMocks([[Account, accountsRepository]]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoanPaymentSetupService,
        { provide: DataSource, useValue: dataSource },
        {
          provide: CategoriesService,
          useValue: categoriesService,
        },
        {
          provide: ScheduledTransactionsService,
          useValue: scheduledTransactionsService,
        },
        { provide: LoanPaymentMatchingService, useValue: paymentMatching },
      ],
    }).compile();

    service = module.get<LoanPaymentSetupService>(LoanPaymentSetupService);
  });

  describe("setupLoanPayments", () => {
    it("throws NotFoundException for unknown account", async () => {
      accountsRepository.findOne.mockResolvedValue(null);
      await expect(
        service.setupLoanPayments("user-1", "nonexistent", {
          paymentAmount: 500,
          paymentFrequency: "MONTHLY",
          sourceAccountId: "source-1",
          nextDueDate: "2026-04-01",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws BadRequestException for non-loan account", async () => {
      accountsRepository.findOne.mockResolvedValue({
        ...mockSourceAccount,
        userId: "user-1",
      });
      await expect(
        service.setupLoanPayments("user-1", "source-1", {
          paymentAmount: 500,
          paymentFrequency: "MONTHLY",
          sourceAccountId: "source-1",
          nextDueDate: "2026-04-01",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException if account already has scheduled payment", async () => {
      accountsRepository.findOne.mockResolvedValue({
        ...mockLoanAccount,
        scheduledTransactionId: "existing-sched",
      });
      await expect(
        service.setupLoanPayments("user-1", "loan-1", {
          paymentAmount: 500,
          paymentFrequency: "MONTHLY",
          sourceAccountId: "source-1",
          nextDueDate: "2026-04-01",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException for invalid source account", async () => {
      accountsRepository.findOne
        .mockResolvedValueOnce(mockLoanAccount) // loan account lookup
        .mockResolvedValueOnce(null); // source account lookup
      await expect(
        service.setupLoanPayments("user-1", "loan-1", {
          paymentAmount: 500,
          paymentFrequency: "MONTHLY",
          sourceAccountId: "bad-source",
          nextDueDate: "2026-04-01",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("creates scheduled transaction and updates account for loan", async () => {
      accountsRepository.findOne
        .mockResolvedValueOnce(mockLoanAccount)
        .mockResolvedValueOnce(mockSourceAccount);

      const result = await service.setupLoanPayments("user-1", "loan-1", {
        paymentAmount: 500,
        paymentFrequency: "MONTHLY",
        sourceAccountId: "source-1",
        nextDueDate: "2026-04-01",
        interestRate: 5.5,
      });

      expect(result.scheduledTransactionId).toBe("sched-1");
      expect(result.accountId).toBe("loan-1");
      expect(result.paymentAmount).toBe(500);
      expect(result.paymentFrequency).toBe("MONTHLY");
      expect(result.nextDueDate).toBe("2026-04-01");

      // Verify scheduled transaction was created
      expect(scheduledTransactionsService.create).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({
          accountId: "source-1",
          name: "Loan Payment - Auto Loan",
          amount: -500,
          frequency: "MONTHLY",
          nextDueDate: "2026-04-01",
        }),
      );

      // Verify account was updated
      expect(accountsRepository.update).toHaveBeenCalledWith(
        "loan-1",
        expect.objectContaining({
          paymentAmount: 500,
          paymentFrequency: "MONTHLY",
          sourceAccountId: "source-1",
          scheduledTransactionId: "sched-1",
          interestRate: 5.5,
        }),
      );
    });

    describe("payment matching", () => {
      const setupDto = {
        paymentAmount: 500,
        paymentFrequency: "MONTHLY",
        sourceAccountId: "source-1",
        nextDueDate: "2026-04-01",
        interestRate: 5.5,
        autoPost: true,
      };
      const matching = { payeePattern: "BANK OF TEST*" };

      beforeEach(() => {
        accountsRepository.findOne
          .mockResolvedValueOnce(mockLoanAccount)
          .mockResolvedValueOnce(mockSourceAccount);
      });

      it("checks the patterns before the schedule, keeps auto-post off and creates the rule after the account points at it", async () => {
        const result = await service.setupLoanPayments("user-1", "loan-1", {
          ...setupDto,
          paymentMatching: matching,
        });

        expect(paymentMatching.assertDefinable).toHaveBeenCalledWith(
          "source-1",
          matching,
        );
        expect(
          paymentMatching.assertDefinable.mock.invocationCallOrder[0],
        ).toBeLessThan(
          scheduledTransactionsService.create.mock.invocationCallOrder[0],
        );
        expect(scheduledTransactionsService.create).toHaveBeenCalledWith(
          "user-1",
          expect.objectContaining({ autoPost: false }),
        );
        expect(paymentMatching.createMatchingRuleReported).toHaveBeenCalledWith(
          "user-1",
          "loan-1",
          matching,
        );
        expect(
          paymentMatching.createMatchingRuleReported.mock
            .invocationCallOrder[0],
        ).toBeGreaterThan(
          accountsRepository.update.mock.invocationCallOrder[0],
        );
        expect(result).toMatchObject({
          paymentMatchingRuleId: "rule-1",
          paymentMatchingError: null,
        });
      });

      it("reports a rule it could not create, and the schedule stays", async () => {
        const error = {
          errorCode: "PAYMENT_MATCHING_FAILED",
          message:
            "The loan was saved, but its payment matching rule could not be created.",
        };
        paymentMatching.createMatchingRuleReported.mockResolvedValue({
          ruleId: null,
          error,
        });

        const result = await service.setupLoanPayments("user-1", "loan-1", {
          ...setupDto,
          paymentMatching: matching,
        });

        expect(result).toMatchObject({
          scheduledTransactionId: "sched-1",
          paymentMatchingRuleId: null,
          paymentMatchingError: error,
        });
        expect(accountsRepository.update).toHaveBeenCalled();
      });

      it("leaves the request's auto-post and creates no rule when none is asked for", async () => {
        const result = await service.setupLoanPayments(
          "user-1",
          "loan-1",
          setupDto,
        );

        expect(scheduledTransactionsService.create).toHaveBeenCalledWith(
          "user-1",
          expect.objectContaining({ autoPost: true }),
        );
        expect(paymentMatching.assertDefinable).not.toHaveBeenCalled();
        expect(
          paymentMatching.createMatchingRuleReported,
        ).not.toHaveBeenCalled();
        expect(result).toMatchObject({
          paymentMatchingRuleId: null,
          paymentMatchingError: null,
        });
      });

      it("refuses payment matching on a line of credit before anything is written", async () => {
        accountsRepository.findOne.mockReset();
        accountsRepository.findOne
          .mockResolvedValueOnce({
            ...mockLoanAccount,
            accountType: AccountType.LINE_OF_CREDIT,
          })
          .mockResolvedValueOnce(mockSourceAccount);

        await expect(
          service.setupLoanPayments("user-1", "loan-1", {
            ...setupDto,
            paymentMatching: matching,
          }),
        ).rejects.toThrow(BadRequestException);
        expect(scheduledTransactionsService.create).not.toHaveBeenCalled();
        expect(accountsRepository.update).not.toHaveBeenCalled();
      });

      it("refuses a pattern the rule would refuse before anything is written", async () => {
        paymentMatching.assertDefinable.mockImplementation(() => {
          throw new BadRequestException("The rule definition is not valid");
        });

        await expect(
          service.setupLoanPayments("user-1", "loan-1", {
            ...setupDto,
            paymentMatching: { payeePattern: "A|B*" },
          }),
        ).rejects.toThrow(BadRequestException);
        expect(scheduledTransactionsService.create).not.toHaveBeenCalled();
        expect(accountsRepository.update).not.toHaveBeenCalled();
      });

      it("stores a loan's originalPrincipal apart from its opening balance", async () => {
        await service.setupLoanPayments("user-1", "loan-1", {
          ...setupDto,
          originalPrincipal: 24000,
        });

        expect(accountsRepository.update).toHaveBeenCalledWith(
          "loan-1",
          expect.objectContaining({ originalPrincipal: 24000 }),
        );
      });
    });

    it("creates scheduled transaction with principal/interest splits", async () => {
      accountsRepository.findOne
        .mockResolvedValueOnce(mockLoanAccount)
        .mockResolvedValueOnce(mockSourceAccount);

      await service.setupLoanPayments("user-1", "loan-1", {
        paymentAmount: 500,
        paymentFrequency: "MONTHLY",
        sourceAccountId: "source-1",
        nextDueDate: "2026-04-01",
        interestRate: 5.5,
        interestCategoryId: "my-interest-cat",
      });

      const createCall = scheduledTransactionsService.create.mock.calls[0][1];
      expect(createCall.splits).toBeDefined();
      expect(createCall.splits.length).toBe(2);

      const principalSplit = createCall.splits.find(
        (s: any) => s.memo === "Principal",
      );
      const interestSplit = createCall.splits.find(
        (s: any) => s.memo === "Interest",
      );

      expect(principalSplit).toBeDefined();
      expect(principalSplit.transferAccountId).toBe("loan-1");
      expect(principalSplit.amount).toBeLessThan(0);

      expect(interestSplit).toBeDefined();
      expect(interestSplit.categoryId).toBe("my-interest-cat");
      expect(interestSplit.amount).toBeLessThan(0);

      // Principal + Interest should equal payment amount
      expect(
        Math.abs(principalSplit.amount) + Math.abs(interestSplit.amount),
      ).toBeCloseTo(500, 1);
    });

    it("uses default loan interest category when none provided", async () => {
      accountsRepository.findOne
        .mockResolvedValueOnce(mockLoanAccount)
        .mockResolvedValueOnce(mockSourceAccount);

      await service.setupLoanPayments("user-1", "loan-1", {
        paymentAmount: 500,
        paymentFrequency: "MONTHLY",
        sourceAccountId: "source-1",
        nextDueDate: "2026-04-01",
        interestRate: 5.5,
      });

      expect(categoriesService.findLoanCategories).toHaveBeenCalledWith(
        "user-1",
      );

      // Verify the default interest category was used
      expect(accountsRepository.update).toHaveBeenCalledWith(
        "loan-1",
        expect.objectContaining({
          interestCategoryId: "interest-cat-1",
        }),
      );
    });

    it("handles zero interest rate (entire payment to principal)", async () => {
      accountsRepository.findOne
        .mockResolvedValueOnce(mockLoanAccount)
        .mockResolvedValueOnce(mockSourceAccount);

      await service.setupLoanPayments("user-1", "loan-1", {
        paymentAmount: 500,
        paymentFrequency: "MONTHLY",
        sourceAccountId: "source-1",
        nextDueDate: "2026-04-01",
        interestRate: 0,
      });

      const createCall = scheduledTransactionsService.create.mock.calls[0][1];
      // Should only have principal split, no interest
      expect(createCall.splits.length).toBe(1);
      expect(createCall.splits[0].memo).toBe("Principal");
      expect(createCall.splits[0].amount).toBe(-500);
    });

    it("does not count extra principal twice on a zero-rate loan", async () => {
      // Every other branch splits from `basePaymentAmount` (payment less extra);
      // the zero-rate branch used the full payment, so a 0% loan with extra
      // principal produced children summing to payment + extra against a parent
      // of payment. `ScheduledTransactionsService.create` validates that sum to
      // exact 4dp equality, so setup failed outright.
      accountsRepository.findOne
        .mockResolvedValueOnce(mockLoanAccount)
        .mockResolvedValueOnce(mockSourceAccount);

      await service.setupLoanPayments("user-1", "loan-1", {
        paymentAmount: 500,
        paymentFrequency: "MONTHLY",
        sourceAccountId: "source-1",
        nextDueDate: "2026-04-01",
        interestRate: 0,
        extraPrincipal: 100,
      } as never);

      const createCall = scheduledTransactionsService.create.mock.calls[0][1];
      const sum = createCall.splits.reduce(
        (acc: number, split: { amount: number }) => acc + split.amount,
        0,
      );
      expect(createCall.amount).toBe(-500);
      expect(sum).toBe(-500);
      // 400 amortized principal plus the 100 the user asked to add.
      expect(
        createCall.splits.map((s: { memo: string; amount: number }) => [
          s.memo,
          s.amount,
        ]),
      ).toEqual([
        ["Principal", -400],
        ["Extra Principal", -100],
      ]);
    });

    it("clamps the first installment to the outstanding balance", async () => {
      // Setting up payments on a nearly-paid loan: 300 left, a 500 payment with
      // 100 of extra principal. Nothing here clamped anything -- the
      // recalculation after each posting does, but the first installment is
      // written here -- so the schedule would have driven the balance to -300.
      accountsRepository.findOne
        .mockResolvedValueOnce({ ...mockLoanAccount, currentBalance: -300 })
        .mockResolvedValueOnce(mockSourceAccount);

      const response = await service.setupLoanPayments("user-1", "loan-1", {
        paymentAmount: 500,
        paymentFrequency: "MONTHLY",
        sourceAccountId: "source-1",
        nextDueDate: "2026-04-01",
        interestRate: 0,
        extraPrincipal: 100,
      } as never);

      const createCall = scheduledTransactionsService.create.mock.calls[0][1];
      // Regular principal takes the 300 that is owed; the discretionary extra
      // has nothing left to retire and is dropped.
      expect(
        createCall.splits.map((s: { memo: string; amount: number }) => [
          s.memo,
          s.amount,
        ]),
      ).toEqual([["Principal", -300]]);
      expect(createCall.amount).toBe(-300);
      // The account still records the payment the user configured; only this
      // schedule's installment shrank. The standing extra instruction is
      // recorded unclamped too -- it is what the recalculation grows back to.
      expect(accountsRepository.update).toHaveBeenCalledWith(
        "loan-1",
        expect.objectContaining({
          paymentAmount: 500,
          extraPaymentAmount: 100,
        }),
      );
      // And the caller is told what the schedule will actually post, not the
      // figure it will never post (review #1131).
      expect(response.paymentAmount).toBe(500);
      expect(response.firstInstallmentAmount).toBe(-createCall.amount);
    });

    it("allocates the whole payment to interest when it does not cover the interest", async () => {
      // A detected interest amount above the base payment left principal at 0
      // and interest at the detected figure, so the children summed to more than
      // the parent. A payment that does not cover the interest is applied
      // entirely to interest.
      accountsRepository.findOne
        .mockResolvedValueOnce(mockLoanAccount)
        .mockResolvedValueOnce(mockSourceAccount);

      await service.setupLoanPayments("user-1", "loan-1", {
        paymentAmount: 500,
        paymentFrequency: "MONTHLY",
        sourceAccountId: "source-1",
        nextDueDate: "2026-04-01",
        detectedInterestAmount: 620,
      } as never);

      const createCall = scheduledTransactionsService.create.mock.calls[0][1];
      const sum = createCall.splits.reduce(
        (acc: number, split: { amount: number }) => acc + split.amount,
        0,
      );
      expect(sum).toBe(createCall.amount);
      expect(createCall.amount).toBe(-500);
      expect(
        createCall.splits.map((s: { memo: string; amount: number }) => [
          s.memo,
          s.amount,
        ]),
      ).toEqual([
        ["Principal", -0],
        ["Interest", -500],
      ]);
    });

    it("sets mortgage-specific fields for mortgage accounts", async () => {
      const mortgageAccount = {
        ...mockLoanAccount,
        id: "mortgage-1",
        name: "Home Mortgage",
        accountType: AccountType.MORTGAGE,
        isCanadianMortgage: false,
        isVariableRate: false,
        originalPrincipal: null,
      };

      accountsRepository.findOne
        .mockResolvedValueOnce(mortgageAccount)
        .mockResolvedValueOnce(mockSourceAccount);

      await service.setupLoanPayments("user-1", "mortgage-1", {
        paymentAmount: 1500,
        paymentFrequency: "MONTHLY",
        sourceAccountId: "source-1",
        nextDueDate: "2026-04-01",
        interestRate: 4.25,
        isCanadianMortgage: true,
        amortizationMonths: 300,
        termMonths: 60,
      });

      expect(accountsRepository.update).toHaveBeenCalledWith(
        "mortgage-1",
        expect.objectContaining({
          isCanadianMortgage: true,
          amortizationMonths: 300,
          termMonths: 60,
          originalPrincipal: 20000,
        }),
      );

      // Verify the scheduled transaction name uses "Mortgage"
      const createCall = scheduledTransactionsService.create.mock.calls[0][1];
      expect(createCall.name).toBe("Mortgage Payment - Home Mortgage");
    });

    it("refuses a Canadian mortgage at a cadence the helpers cannot express", async () => {
      // getMortgagePeriodsPerYear has no QUARTERLY case, so casting the DTO's
      // value in used to reach its `default: 12` and split the payment at three
      // times the correct interest for the life of the mortgage. A refusal is
      // the only honest answer -- and the setup dialog no longer OFFERS these
      // two to a Canadian mortgage, so this is the server half of one rule.
      const mortgageAccount = {
        ...mockLoanAccount,
        id: "mortgage-2",
        accountType: AccountType.MORTGAGE,
        isCanadianMortgage: true,
        isVariableRate: false,
      };

      for (const paymentFrequency of ["QUARTERLY", "YEARLY"]) {
        accountsRepository.findOne
          .mockResolvedValueOnce(mortgageAccount)
          .mockResolvedValueOnce(mockSourceAccount);
        scheduledTransactionsService.create.mockClear();

        await expect(
          service.setupLoanPayments("user-1", "mortgage-2", {
            paymentAmount: 1500,
            paymentFrequency,
            sourceAccountId: "source-1",
            nextDueDate: "2026-04-01",
            interestRate: 4.25,
          }),
        ).rejects.toBeInstanceOf(BadRequestException);

        // Rejection happens before the write: no schedule, no account update.
        expect(scheduledTransactionsService.create).not.toHaveBeenCalled();
      }
    });

    it("lets an explicit false override a stored Canadian flag", async () => {
      // The same request writes the flag, so unticking the box means "this is
      // not a Canadian mortgage" and must decide the split it arrives with.
      // Under `||` the stored `true` won: the account was saved as non-Canadian
      // while its first split was computed the Canadian way, and the setup
      // dialog -- which filters its cadence list on the checkbox -- offered
      // quarterly to an account the server then refused with a 400.
      const storedCanadian = {
        ...mockLoanAccount,
        id: "mortgage-3",
        accountType: AccountType.MORTGAGE,
        isCanadianMortgage: true,
        isVariableRate: false,
      };

      accountsRepository.findOne
        .mockResolvedValueOnce(storedCanadian)
        .mockResolvedValueOnce(mockSourceAccount);
      scheduledTransactionsService.create.mockClear();

      await service.setupLoanPayments("user-1", "mortgage-3", {
        paymentAmount: 1500,
        paymentFrequency: "QUARTERLY",
        sourceAccountId: "source-1",
        nextDueDate: "2026-04-01",
        interestRate: 4.25,
        isCanadianMortgage: false,
      });

      // No refusal, and the flag is written as the request asked.
      expect(scheduledTransactionsService.create).toHaveBeenCalled();
      expect(accountsRepository.update).toHaveBeenCalledWith(
        "mortgage-3",
        expect.objectContaining({ isCanadianMortgage: false }),
      );
    });

    it("writes the type with the flags it maps to, only when the request names one", async () => {
      const storedFixed = {
        ...mockLoanAccount,
        id: "mortgage-4",
        accountType: AccountType.MORTGAGE,
        isCanadianMortgage: true,
        isVariableRate: false,
        mortgageType: "CANADIAN_FIXED",
      };
      const request = {
        paymentAmount: 1500,
        paymentFrequency: "MONTHLY",
        sourceAccountId: "source-1",
        nextDueDate: "2026-04-01",
        interestRate: 4.25,
      };
      const lastUpdate = () => {
        const calls = accountsRepository.update.mock.calls;
        return calls[calls.length - 1][1];
      };

      accountsRepository.findOne
        .mockResolvedValueOnce(storedFixed)
        .mockResolvedValueOnce(mockSourceAccount);
      await service.setupLoanPayments("user-1", "mortgage-4", {
        ...request,
        isCanadianMortgage: false,
      });
      expect(lastUpdate()).toMatchObject({
        mortgageType: "ANNUITY",
        isCanadianMortgage: false,
        isVariableRate: false,
      });

      // A type-only request stores the same row a flags-only one does.
      accountsRepository.findOne
        .mockResolvedValueOnce(storedFixed)
        .mockResolvedValueOnce(mockSourceAccount);
      await service.setupLoanPayments("user-1", "mortgage-4", {
        ...request,
        mortgageType: "ANNUITY",
      });
      expect(lastUpdate()).toMatchObject({
        mortgageType: "ANNUITY",
        isCanadianMortgage: false,
        isVariableRate: false,
      });

      // Naming neither leaves the stored columns alone.
      accountsRepository.findOne
        .mockResolvedValueOnce(storedFixed)
        .mockResolvedValueOnce(mockSourceAccount);
      await service.setupLoanPayments("user-1", "mortgage-4", request);
      expect(lastUpdate()).not.toHaveProperty("mortgageType");
      expect(lastUpdate()).not.toHaveProperty("isCanadianMortgage");
    });

    it("splits an ANNUITY mortgage at the nominal rate, at every cadence", async () => {
      // Every mortgage is split by its type now (spec 5.5), and ANNUITY is
      // the nominal rate over the payments per year -- the arithmetic the loan
      // helper split it with before, quarterly included. A Canadian
      // variable-rate mortgage is ANNUITY, so it is no longer refused the
      // cadences the Canadian fixed-rate convention refuses.
      for (const [paymentFrequency, ppy] of [
        ["MONTHLY", 12],
        ["SEMIMONTHLY", 24],
        ["QUARTERLY", 4],
      ] as const) {
        accountsRepository.findOne
          .mockResolvedValueOnce({
            ...mockLoanAccount,
            id: "mortgage-5",
            accountType: AccountType.MORTGAGE,
            isCanadianMortgage: true,
            isVariableRate: true,
            mortgageType: null,
          })
          .mockResolvedValueOnce(mockSourceAccount);
        scheduledTransactionsService.create.mockClear();

        await service.setupLoanPayments("user-1", "mortgage-5", {
          paymentAmount: 1500,
          paymentFrequency,
          sourceAccountId: "source-1",
          nextDueDate: "2026-04-01",
          interestRate: 6,
        });

        const interest = Math.round(15000 * (0.06 / ppy) * 10000) / 10000;
        const splits = scheduledTransactionsService.create.mock.calls[0][1]
          .splits as Array<{ memo: string; amount: number }>;
        expect(splits.map((sp) => [sp.memo, sp.amount])).toEqual([
          ["Principal", -(1500 - interest)],
          ["Interest", -interest],
        ]);
      }
    });

    it("splits a CANADIAN_FIXED mortgage at the semi-annual conversion", async () => {
      accountsRepository.findOne
        .mockResolvedValueOnce({
          ...mockLoanAccount,
          id: "mortgage-6",
          accountType: AccountType.MORTGAGE,
          isCanadianMortgage: false,
          isVariableRate: false,
          mortgageType: "CANADIAN_FIXED",
        })
        .mockResolvedValueOnce(mockSourceAccount);

      await service.setupLoanPayments("user-1", "mortgage-6", {
        paymentAmount: 1500,
        paymentFrequency: "MONTHLY",
        sourceAccountId: "source-1",
        nextDueDate: "2026-04-01",
        interestRate: 6,
      });

      const interest =
        Math.round(15000 * (Math.pow(1.03, 2 / 12) - 1) * 10000) / 10000;
      const interestSplit = scheduledTransactionsService.create.mock.calls[0][1]
        .splits[1] as { memo: string; amount: number };
      expect(interestSplit).toMatchObject({
        memo: "Interest",
        amount: -interest,
      });
    });

    it("puts the whole base payment to principal on a zero-rate mortgage", async () => {
      accountsRepository.findOne
        .mockResolvedValueOnce({
          ...mockLoanAccount,
          id: "mortgage-7",
          accountType: AccountType.MORTGAGE,
          currentBalance: 0,
          mortgageType: "ANNUITY",
        })
        .mockResolvedValueOnce(mockSourceAccount);

      await service.setupLoanPayments("user-1", "mortgage-7", {
        paymentAmount: 1500,
        paymentFrequency: "MONTHLY",
        sourceAccountId: "source-1",
        nextDueDate: "2026-04-01",
      });

      // A zero recorded balance is history not yet imported, not a payoff.
      const createCall = scheduledTransactionsService.create.mock.calls[0][1];
      expect(createCall.amount).toBe(-1500);
      expect(createCall.splits).toEqual([
        expect.objectContaining({ memo: "Principal", amount: -1500 }),
      ]);
    });

    it("refuses a frequency the recurrence table cannot schedule", async () => {
      // The DTO's @IsIn list keeps this unreachable through the controller, and
      // loan-payment-frequency.guard.spec.ts holds the two lists together -- but
      // the fallback that used to stand here (`?? "MONTHLY"`, behind an `as any`
      // the compiler could not see through) scheduled an unmapped cadence twelve
      // times a year and said nothing. A refusal fails loudly instead.
      accountsRepository.findOne
        .mockResolvedValueOnce(mockLoanAccount)
        .mockResolvedValueOnce(mockSourceAccount);
      scheduledTransactionsService.create.mockClear();

      await expect(
        service.setupLoanPayments("user-1", "loan-1", {
          paymentAmount: 500,
          paymentFrequency: "FORTNIGHTLY_ISH",
          sourceAccountId: "source-1",
          nextDueDate: "2026-04-01",
          interestRate: 5,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(scheduledTransactionsService.create).not.toHaveBeenCalled();
    });
  });
});
