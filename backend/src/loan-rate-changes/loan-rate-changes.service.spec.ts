import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import {
  LoanRateChangesService,
  toYmd,
  hashScheduledPaymentPreview,
} from "./loan-rate-changes.service";
import { LoanRateChange } from "./entities/loan-rate-change.entity";
import { Account, AccountType } from "../accounts/entities/account.entity";
import { recalculateMortgageAfterRateChange } from "../accounts/mortgage-amortization.util";
import { todayYMD } from "../common/date-utils";
import {
  createScopedDbMocks,
  DataSourceMock,
  ManagerMock,
} from "../test-helpers/scoped-db-testing";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);

describe("LoanRateChangesService", () => {
  let service: LoanRateChangesService;
  let rateChangesRepository: Record<string, jest.Mock>;
  let accountsRepository: Record<string, jest.Mock>;
  let scheduledTransactionsService: Record<string, jest.Mock>;
  let manager: ManagerMock;
  let dataSource: DataSourceMock;

  const userId = "user-1";
  const accountId = "account-1";

  const makeAccount = (overrides: Partial<Account> = {}): Account =>
    ({
      id: accountId,
      userId,
      accountType: AccountType.MORTGAGE,
      currentBalance: -400000,
      interestRate: 5.5,
      paymentAmount: 2500,
      paymentFrequency: "MONTHLY",
      paymentStartDate: "2022-01-01",
      amortizationMonths: 300,
      isCanadianMortgage: true,
      isVariableRate: true,
      isClosed: false,
      scheduledTransactionId: "sched-1",
      interestCategoryId: "cat-interest",
      ...overrides,
    }) as unknown as Account;

  const makeRow = (overrides: Partial<LoanRateChange> = {}): LoanRateChange =>
    ({
      id: "rc-1",
      userId,
      accountId,
      effectiveDate: "2024-06-01",
      annualRate: 4.9,
      newPaymentAmount: null,
      source: "manual",
      note: null,
      createdAt: new Date("2024-06-01"),
      updatedAt: new Date("2024-06-01"),
      ...overrides,
    }) as LoanRateChange;

  beforeEach(() => {
    rateChangesRepository = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };

    accountsRepository = {
      findOne: jest.fn().mockResolvedValue(makeAccount()),
    };

    scheduledTransactionsService = {
      findOne: jest.fn().mockResolvedValue({ id: "sched-1", splits: [] }),
      update: jest.fn().mockResolvedValue({ id: "sched-1" }),
    };

    ({ manager, dataSource } = createScopedDbMocks([
      [LoanRateChange, rateChangesRepository],
      [Account, accountsRepository],
    ]));
    manager.count.mockResolvedValue(1);
    manager.find.mockResolvedValue([]);
    manager.findOne.mockResolvedValue(null);
    manager.create.mockImplementation((_entity, data) => ({ ...data }));
    manager.save.mockImplementation((data) =>
      Promise.resolve(data.id ? data : { ...data, id: "rc-new" }),
    );
    manager.remove.mockResolvedValue(undefined);
    manager.merge.mockImplementation((_entity, target, patch) => ({
      ...target,
      ...patch,
    }));
    manager.delete.mockResolvedValue({ affected: 0 });

    service = new LoanRateChangesService(
      dataSource as never,
      scheduledTransactionsService as never,
    );
  });

  describe("toYmd", () => {
    it("normalizes strings and Dates to YYYY-MM-DD", () => {
      expect(toYmd("2024-06-01")).toBe("2024-06-01");
      expect(toYmd("2024-06-01T00:00:00.000Z")).toBe("2024-06-01");
      expect(toYmd(new Date(2024, 5, 1))).toBe("2024-06-01");
      expect(toYmd(null)).toBeNull();
    });
  });

  describe("findAll", () => {
    it("returns the timeline ordered by effective date", async () => {
      const rows = [makeRow()];
      rateChangesRepository.find.mockResolvedValue(rows);

      const result = await service.findAll(userId, accountId);

      expect(rateChangesRepository.find).toHaveBeenCalledWith({
        where: { userId, accountId },
        order: { effectiveDate: "ASC" },
      });
      expect(result).toEqual(rows);
    });

    it("404s for an account the user does not own", async () => {
      accountsRepository.findOne.mockResolvedValue(null);

      await expect(service.findAll(userId, accountId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("rejects line-of-credit and other non-amortizing account types", async () => {
      for (const accountType of [
        AccountType.LINE_OF_CREDIT,
        AccountType.CHEQUING,
      ]) {
        accountsRepository.findOne.mockResolvedValue(
          makeAccount({ accountType }),
        );
        await expect(service.findAll(userId, accountId)).rejects.toThrow(
          BadRequestException,
        );
      }
    });

    it("accepts LOAN accounts", async () => {
      accountsRepository.findOne.mockResolvedValue(
        makeAccount({ accountType: AccountType.LOAN }),
      );
      await expect(service.findAll(userId, accountId)).resolves.toEqual([]);
    });
  });

  describe("create", () => {
    it("snapshots an initial row before the first change", async () => {
      manager.count.mockResolvedValue(0);

      await service.create(userId, accountId, {
        effectiveDate: "2024-06-01",
        annualRate: 4.9,
      });

      const savedRows = manager.save.mock.calls.map((call) => call[0]);
      const initial = savedRows.find((row) => row.source === "initial");
      expect(initial).toMatchObject({
        accountId,
        effectiveDate: "2022-01-01",
        annualRate: 5.5,
        newPaymentAmount: 2500,
      });
      const created = savedRows.find((row) => row.source === "manual");
      expect(created).toMatchObject({
        effectiveDate: "2024-06-01",
        annualRate: 4.9,
        newPaymentAmount: null,
      });
    });

    it("dates the initial row just before the change when it precedes the start date", async () => {
      manager.count.mockResolvedValue(0);
      accountsRepository.findOne.mockResolvedValue(
        makeAccount({ paymentStartDate: "2025-01-01" as any }),
      );

      await service.create(userId, accountId, {
        effectiveDate: "2024-06-01",
        annualRate: 4.9,
      });

      const initial = manager.save.mock.calls
        .map((call) => call[0])
        .find((row) => row.source === "initial");
      expect(initial.effectiveDate).toBe("2024-05-31");
    });

    it("does not snapshot an initial row when history already exists", async () => {
      manager.count.mockResolvedValue(2);

      await service.create(userId, accountId, {
        effectiveDate: "2024-06-01",
        annualRate: 4.9,
      });

      const initialRows = manager.save.mock.calls
        .map((call) => call[0])
        .filter((row) => row.source === "initial");
      expect(initialRows).toHaveLength(0);
    });

    it("409s on a duplicate effective date", async () => {
      manager.findOne.mockResolvedValue(makeRow());

      await expect(
        service.create(userId, accountId, {
          effectiveDate: "2024-06-01",
          annualRate: 4.9,
        }),
      ).rejects.toThrow(ConflictException);
      // The duplicate check runs inside the write transaction, so nothing is
      // saved when it rejects.
      expect(dataSource.transaction).toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("rejects supplying both a payment and recalculatePayment", async () => {
      await expect(
        service.create(userId, accountId, {
          effectiveDate: "2024-06-01",
          annualRate: 4.9,
          newPaymentAmount: 2600,
          recalculatePayment: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects recalculatePayment for plain loans", async () => {
      accountsRepository.findOne.mockResolvedValue(
        makeAccount({ accountType: AccountType.LOAN }),
      );

      await expect(
        service.create(userId, accountId, {
          effectiveDate: "2024-06-01",
          annualRate: 4.9,
          recalculatePayment: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects recalculatePayment on a closed account", async () => {
      accountsRepository.findOne.mockResolvedValue(
        makeAccount({ isClosed: true }),
      );

      await expect(
        service.create(userId, accountId, {
          effectiveDate: "2024-06-01",
          annualRate: 4.9,
          recalculatePayment: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects recalculatePayment when effectiveDate is not today", async () => {
      const account = makeAccount();
      accountsRepository.findOne.mockResolvedValue(account);

      // Past date
      await expect(
        service.create(userId, accountId, {
          effectiveDate: "2024-06-01",
          annualRate: 4.9,
          recalculatePayment: true,
        }),
      ).rejects.toThrow(BadRequestException);

      // Future date
      await expect(
        service.create(userId, accountId, {
          effectiveDate: "2050-01-01",
          annualRate: 4.9,
          recalculatePayment: true,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(manager.save).not.toHaveBeenCalled();
    });

    it("recalculates the payment to hold remaining amortization", async () => {
      // paymentStartDate "2022-01-01", effectiveDate = today; remaining months
      // computed dynamically so the test is date-independent.
      const account = makeAccount();
      accountsRepository.findOne.mockResolvedValue(account);
      const today = todayYMD();

      const result = await service.create(userId, accountId, {
        effectiveDate: today,
        annualRate: 4.9,
        recalculatePayment: true,
      });

      const [ty, tm] = today.split("-").map(Number);
      const monthsElapsed = (ty - 2022) * 12 + (tm - 1);
      const expected = recalculateMortgageAfterRateChange(
        400000,
        4.9,
        300 - monthsElapsed,
        "MONTHLY",
        true,
        true,
      );
      expect(result.newPaymentAmount).toBe(expected.paymentAmount);
    });

    it("recalculates over the actual remaining term, not a 12-month floor, when under a year remains", async () => {
      // Derive a paymentStartDate such that today is exactly 294 months in,
      // leaving 6 of the account's 300 configured amortization months.
      const today = todayYMD();
      const [ty, tm] = today.split("-").map(Number);
      const startTotalMonths = ty * 12 + (tm - 1) - 294;
      const startYear = Math.floor(startTotalMonths / 12);
      const startMonth = (startTotalMonths % 12) + 1;
      const paymentStartDate = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;

      const account = makeAccount({
        paymentStartDate: paymentStartDate as unknown as Date,
      });
      accountsRepository.findOne.mockResolvedValue(account);

      const result = await service.create(userId, accountId, {
        effectiveDate: today,
        annualRate: 4.9,
        recalculatePayment: true,
      });

      const expectedOverActualTerm = recalculateMortgageAfterRateChange(
        400000,
        4.9,
        6,
        "MONTHLY",
        true,
        true,
      );
      const wrongOverTwelveMonths = recalculateMortgageAfterRateChange(
        400000,
        4.9,
        12,
        "MONTHLY",
        true,
        true,
      );

      // Sanity check the two calculations are not coincidentally equal, so
      // the assertion below is not vacuous.
      expect(expectedOverActualTerm.paymentAmount).not.toBe(
        wrongOverTwelveMonths.paymentAmount,
      );
      expect(result.newPaymentAmount).toBe(
        expectedOverActualTerm.paymentAmount,
      );
      expect(result.newPaymentAmount).not.toBe(
        wrongOverTwelveMonths.paymentAmount,
      );
    });

    it("rejects recalculation when today is beyond the loan's configured amortization end", async () => {
      // paymentStartDate far in the past with a short amortization so today is
      // well past the loan's end (2000-01-01 + 100 months ≈ 2008-05-01).
      const account = makeAccount({
        paymentStartDate: "2000-01-01" as unknown as Date,
        amortizationMonths: 100,
      });
      accountsRepository.findOne.mockResolvedValue(account);

      await expect(
        service.create(userId, accountId, {
          effectiveDate: todayYMD(),
          annualRate: 4.9,
          recalculatePayment: true,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it("records a past-dated change without touching the account scalars", async () => {
      const account = makeAccount();
      accountsRepository.findOne.mockResolvedValue(account);
      manager.save.mockImplementation((data) => Promise.resolve(data));
      manager.find.mockResolvedValue([
        makeRow({
          source: "initial",
          effectiveDate: "2022-01-01",
          annualRate: 5.5,
          newPaymentAmount: 2500,
        }),
        makeRow({ effectiveDate: "2024-06-01", annualRate: 4.9 }),
      ]);

      await service.create(userId, accountId, {
        effectiveDate: "2024-06-01",
        annualRate: 4.9,
      });

      // The timeline is user-owned; the account's manual rate/payment stay put.
      expect(account.interestRate).toBe(5.5);
      expect(account.paymentAmount).toBe(2500);
      expect(manager.save).not.toHaveBeenCalledWith(account);
    });

    it("resyncs the scheduled payment splits at the new rate, keeping the amount", async () => {
      const account = makeAccount();
      accountsRepository.findOne.mockResolvedValue(account);
      manager.find.mockResolvedValue([
        makeRow({ effectiveDate: "2024-06-01", annualRate: 4.9 }),
      ]);

      await service.create(userId, accountId, {
        effectiveDate: "2024-06-01",
        annualRate: 4.9,
      });

      // Variable-rate mortgage: monthly compounding at the new rate
      const expectedInterest =
        Math.round(400000 * (4.9 / 100 / 12) * 10000) / 10000;
      expect(scheduledTransactionsService.update).toHaveBeenCalledWith(
        userId,
        "sched-1",
        expect.objectContaining({
          amount: -2500,
          splits: [
            expect.objectContaining({
              transferAccountId: accountId,
              amount: -(2500 - expectedInterest),
              memo: "Principal",
            }),
            expect.objectContaining({
              categoryId: "cat-interest",
              amount: -expectedInterest,
              memo: "Interest",
            }),
          ],
        }),
      );
    });

    it("preserves a separate extra-principal split on the scheduled payment", async () => {
      const account = makeAccount();
      accountsRepository.findOne.mockResolvedValue(account);
      manager.find.mockResolvedValue([
        makeRow({ effectiveDate: "2024-06-01", annualRate: 4.9 }),
      ]);
      scheduledTransactionsService.findOne.mockResolvedValue({
        id: "sched-1",
        splits: [
          { transferAccountId: accountId, amount: -800, memo: "Principal" },
          { categoryId: "cat-interest", amount: -1700, memo: "Interest" },
          {
            transferAccountId: accountId,
            amount: -200,
            memo: "Extra Principal",
          },
        ],
      });

      await service.create(userId, accountId, {
        effectiveDate: "2024-06-01",
        annualRate: 4.9,
      });

      const updateArgs = scheduledTransactionsService.update.mock.calls[0][2];
      expect(updateArgs.amount).toBe(-2700);
      expect(updateArgs.splits).toHaveLength(3);
      expect(updateArgs.splits[2]).toMatchObject({
        transferAccountId: accountId,
        amount: -200,
        memo: "Extra Principal",
      });
    });

    // REV-20260803-028: only a memo containing the literal English substring
    // "extra" was recognized as the extra-principal split, so a recurring
    // overpayment labeled with the account's own configured category, or a
    // localized/user-chosen memo, was silently dropped when the scheduled
    // payment's splits were rebuilt during rate sync. Recognition now mirrors
    // `isOverpayment` (frontend/src/lib/loan-history.ts): the account's
    // configured overpayment category or memo substring, in addition to the
    // legacy literal "extra" fallback.
    it("preserves an extra-principal split recognized by the account's configured overpayment category, even though its memo does not contain 'extra'", async () => {
      const account = makeAccount({ overpaymentCategoryId: "cat-overpayment" });
      accountsRepository.findOne.mockResolvedValue(account);
      manager.find.mockResolvedValue([
        makeRow({ effectiveDate: "2024-06-01", annualRate: 4.9 }),
      ]);
      scheduledTransactionsService.findOne.mockResolvedValue({
        id: "sched-1",
        splits: [
          { transferAccountId: accountId, amount: -800, memo: "Principal" },
          { categoryId: "cat-interest", amount: -1700, memo: "Interest" },
          {
            transferAccountId: accountId,
            categoryId: "cat-overpayment",
            amount: -200,
            memo: "Additional principal",
          },
        ],
      });

      await service.create(userId, accountId, {
        effectiveDate: "2024-06-01",
        annualRate: 4.9,
      });

      const updateArgs = scheduledTransactionsService.update.mock.calls[0][2];
      expect(updateArgs.splits).toHaveLength(3);
      expect(updateArgs.splits[2]).toMatchObject({
        transferAccountId: accountId,
        amount: -200,
        memo: "Additional principal",
      });
    });

    it("preserves an extra-principal split recognized by the account's configured (localized) overpayment memo, even though it does not contain 'extra'", async () => {
      const account = makeAccount({
        overpaymentMemo: "Dodatkowa spłata kapitału",
      });
      accountsRepository.findOne.mockResolvedValue(account);
      manager.find.mockResolvedValue([
        makeRow({ effectiveDate: "2024-06-01", annualRate: 4.9 }),
      ]);
      scheduledTransactionsService.findOne.mockResolvedValue({
        id: "sched-1",
        splits: [
          { transferAccountId: accountId, amount: -800, memo: "Principal" },
          { categoryId: "cat-interest", amount: -1700, memo: "Interest" },
          {
            transferAccountId: accountId,
            amount: -200,
            memo: "Dodatkowa spłata kapitału",
          },
        ],
      });

      await service.create(userId, accountId, {
        effectiveDate: "2024-06-01",
        annualRate: 4.9,
      });

      const updateArgs = scheduledTransactionsService.update.mock.calls[0][2];
      expect(updateArgs.splits).toHaveLength(3);
      expect(updateArgs.splits[2]).toMatchObject({
        transferAccountId: accountId,
        amount: -200,
        memo: "Dodatkowa spłata kapitału",
      });
    });

    // REV-20260803-028, second reopen: the rebuilt extra split copied only
    // transferAccountId/amount/memo and dropped categoryId, so a split first
    // recognized via the account's configured overpayment category lost that
    // category in the payload. The *next* sync would then read back a split
    // with no categoryId and a memo that doesn't contain "extra", so it would
    // no longer be recognized at all -- permanently unrecoverable after one
    // sync. Prove the fix by running two sequential syncs and asserting the
    // categoryId survives the first rebuild.
    it("preserves the extra split's categoryId across two sequential syncs, so category-based recognition survives a rebuild", async () => {
      const account = makeAccount({ overpaymentCategoryId: "cat-overpayment" });
      accountsRepository.findOne.mockResolvedValue(account);
      manager.find.mockResolvedValue([
        makeRow({ effectiveDate: "2024-06-01", annualRate: 4.9 }),
      ]);
      scheduledTransactionsService.findOne.mockResolvedValueOnce({
        id: "sched-1",
        splits: [
          { transferAccountId: accountId, amount: -800, memo: "Principal" },
          { categoryId: "cat-interest", amount: -1700, memo: "Interest" },
          {
            transferAccountId: accountId,
            categoryId: "cat-overpayment",
            amount: -200,
            memo: "Additional principal",
          },
        ],
      });

      await service.create(userId, accountId, {
        effectiveDate: "2024-06-01",
        annualRate: 4.9,
      });

      const firstUpdateArgs =
        scheduledTransactionsService.update.mock.calls[0][2];
      const rebuiltExtraSplit = firstUpdateArgs.splits[2];
      expect(rebuiltExtraSplit.categoryId).toBe("cat-overpayment");

      // Second synchronization: feed back exactly what the first sync's
      // payload rebuilt (i.e. what would now be persisted), and confirm the
      // split is still recognized and its categoryId still survives.
      scheduledTransactionsService.findOne.mockResolvedValueOnce({
        id: "sched-1",
        splits: firstUpdateArgs.splits,
      });

      await service.create(userId, accountId, {
        effectiveDate: "2024-06-01",
        annualRate: 4.9,
      });

      const secondUpdateArgs =
        scheduledTransactionsService.update.mock.calls[1][2];
      expect(secondUpdateArgs.splits).toHaveLength(3);
      expect(secondUpdateArgs.splits[2]).toMatchObject({
        transferAccountId: accountId,
        categoryId: "cat-overpayment",
        amount: -200,
        memo: "Additional principal",
      });
    });

    // REV-20260803-028, second reopen: `splits.find` located only the first
    // recognized extra-principal split, so a scheduled payment with two
    // distinct extra splits (e.g. two separately configured recurring
    // overpayments) lost the second one entirely when the payload replaced
    // all splits.
    it("preserves both recognized extra-principal splits when a scheduled payment has more than one", async () => {
      const account = makeAccount({ overpaymentCategoryId: "cat-overpayment" });
      accountsRepository.findOne.mockResolvedValue(account);
      manager.find.mockResolvedValue([
        makeRow({ effectiveDate: "2024-06-01", annualRate: 4.9 }),
      ]);
      scheduledTransactionsService.findOne.mockResolvedValue({
        id: "sched-1",
        splits: [
          { transferAccountId: accountId, amount: -800, memo: "Principal" },
          { categoryId: "cat-interest", amount: -1700, memo: "Interest" },
          {
            transferAccountId: accountId,
            categoryId: "cat-overpayment",
            amount: -150,
            memo: "Biweekly overpayment",
          },
          {
            transferAccountId: accountId,
            amount: -50,
            memo: "Extra lump sum",
          },
        ],
      });

      await service.create(userId, accountId, {
        effectiveDate: "2024-06-01",
        annualRate: 4.9,
      });

      const updateArgs = scheduledTransactionsService.update.mock.calls[0][2];
      // Principal + interest + both extra splits -- four splits total, not
      // collapsed down to only the first recognized extra split.
      expect(updateArgs.splits).toHaveLength(4);
      expect(updateArgs.amount).toBe(-2700);
      expect(updateArgs.splits[2]).toMatchObject({
        transferAccountId: accountId,
        categoryId: "cat-overpayment",
        amount: -150,
        memo: "Biweekly overpayment",
      });
      expect(updateArgs.splits[3]).toMatchObject({
        transferAccountId: accountId,
        amount: -50,
        memo: "Extra lump sum",
      });
    });

    it("leaves scalars and the scheduled payment untouched for future-dated changes", async () => {
      const account = makeAccount();
      accountsRepository.findOne.mockResolvedValue(account);
      const future = "2099-01-01";
      manager.find.mockResolvedValue([
        makeRow({ effectiveDate: future, annualRate: 9.9 }),
      ]);

      await service.create(userId, accountId, {
        effectiveDate: future,
        annualRate: 9.9,
      });

      expect(account.interestRate).toBe(5.5);
      expect(scheduledTransactionsService.update).not.toHaveBeenCalled();
    });

    it("persists rows on closed accounts without touching scalars or the schedule", async () => {
      const account = makeAccount({ isClosed: true });
      accountsRepository.findOne.mockResolvedValue(account);

      await service.create(userId, accountId, {
        effectiveDate: "2024-06-01",
        annualRate: 4.9,
      });

      expect(manager.save).toHaveBeenCalled();
      expect(manager.find).not.toHaveBeenCalled();
      expect(account.interestRate).toBe(5.5);
      expect(scheduledTransactionsService.update).not.toHaveBeenCalled();
    });

    it("propagates a write failure out of the transaction without syncing", async () => {
      manager.save.mockRejectedValue(new Error("db down"));

      await expect(
        service.create(userId, accountId, {
          effectiveDate: "2024-06-01",
          annualRate: 4.9,
        }),
      ).rejects.toThrow("db down");
      // Two scoped transactions: the account lookup, then the write block that
      // rolls back when the callback throws -- so the post-commit scheduled
      // sync never runs.
      expect(dataSource.transaction).toHaveBeenCalledTimes(2);
      expect(scheduledTransactionsService.update).not.toHaveBeenCalled();
    });

    it("does not fail the request when the scheduled-payment sync fails", async () => {
      manager.find.mockResolvedValue([
        makeRow({ effectiveDate: "2024-06-01", annualRate: 4.9 }),
      ]);
      scheduledTransactionsService.update.mockRejectedValue(
        new Error("sync failed"),
      );

      await expect(
        service.create(userId, accountId, {
          effectiveDate: "2024-06-01",
          annualRate: 4.9,
        }),
      ).resolves.toBeDefined();
    });

    it("defers the scheduled-payment sync and returns a preview instead of applying it", async () => {
      const account = makeAccount();
      accountsRepository.findOne.mockResolvedValue(account);
      manager.find.mockResolvedValue([
        makeRow({ effectiveDate: "2024-06-01", annualRate: 4.9 }),
      ]);
      scheduledTransactionsService.findOne.mockResolvedValue({
        id: "sched-1",
        name: "Mortgage",
        currencyCode: "CAD",
        amount: -2500,
        splits: [
          { transferAccountId: accountId, amount: -800, memo: "Principal" },
          { categoryId: "cat-interest", amount: -1700, memo: "Interest" },
        ],
      });

      const result = await service.create(
        userId,
        accountId,
        { effectiveDate: "2024-06-01", annualRate: 4.9 },
        { deferScheduledSync: true },
      );

      // Nothing is applied to the schedule yet -- the user must confirm first
      expect(scheduledTransactionsService.update).not.toHaveBeenCalled();

      const expectedInterest =
        Math.round(400000 * (4.9 / 100 / 12) * 10000) / 10000;
      expect(result.scheduledPaymentPreview).toMatchObject({
        scheduledTransactionId: "sched-1",
        scheduledTransactionName: "Mortgage",
        currencyCode: "CAD",
        currentPaymentAmount: 2500,
        proposedPaymentAmount: 2500,
        currentPrincipal: 800,
        proposedPrincipal: 2500 - expectedInterest,
        currentInterest: 1700,
        proposedInterest: expectedInterest,
        extraPrincipal: 0,
      });
      // REV-20260803-029: hash must be returned so the confirmation call can
      // bind to the exact state the user authorized.
      expect(result.scheduledPaymentPreviewHash).toMatch(/^[0-9a-f]{64}$/);
      // The hash must match what hashScheduledPaymentPreview produces for the
      // same preview -- so the confirmation endpoint can reproduce it.
      expect(result.scheduledPaymentPreviewHash).toBe(
        hashScheduledPaymentPreview(result.scheduledPaymentPreview!),
      );
    });

    it("returns a null preview when deferring on an account with no linked schedule", async () => {
      const account = makeAccount({ scheduledTransactionId: null });
      accountsRepository.findOne.mockResolvedValue(account);
      manager.find.mockResolvedValue([
        makeRow({ effectiveDate: "2024-06-01", annualRate: 4.9 }),
      ]);

      const result = await service.create(
        userId,
        accountId,
        { effectiveDate: "2024-06-01", annualRate: 4.9 },
        { deferScheduledSync: true },
      );

      expect(result.scheduledPaymentPreview).toBeNull();
      expect(result.scheduledPaymentPreviewHash).toBeNull();
      expect(scheduledTransactionsService.update).not.toHaveBeenCalled();
    });
  });

  describe("applyScheduledPaymentSync", () => {
    it("resyncs the linked scheduled payment and returns the applied change", async () => {
      const account = makeAccount({ interestRate: 4.9 });
      accountsRepository.findOne.mockResolvedValue(account);
      scheduledTransactionsService.findOne.mockResolvedValue({
        id: "sched-1",
        name: "Mortgage",
        currencyCode: "CAD",
        amount: -2500,
        splits: [],
      });

      const result = await service.applyScheduledPaymentSync(userId, accountId);

      const expectedInterest =
        Math.round(400000 * (4.9 / 100 / 12) * 10000) / 10000;
      expect(scheduledTransactionsService.update).toHaveBeenCalledWith(
        userId,
        "sched-1",
        expect.objectContaining({
          amount: -2500,
          splits: [
            expect.objectContaining({
              transferAccountId: accountId,
              amount: -(2500 - expectedInterest),
              memo: "Principal",
            }),
            expect.objectContaining({
              categoryId: "cat-interest",
              amount: -expectedInterest,
              memo: "Interest",
            }),
          ],
        }),
      );
      expect(result?.proposedInterest).toBe(expectedInterest);
    });

    it("returns null and applies nothing when there is no linked schedule", async () => {
      accountsRepository.findOne.mockResolvedValue(
        makeAccount({ scheduledTransactionId: null }),
      );

      const result = await service.applyScheduledPaymentSync(userId, accountId);

      expect(result).toBeNull();
      expect(scheduledTransactionsService.update).not.toHaveBeenCalled();
    });

    it("rejects for an account the user does not own", async () => {
      accountsRepository.findOne.mockResolvedValue(null);

      await expect(
        service.applyScheduledPaymentSync(userId, accountId),
      ).rejects.toThrow(NotFoundException);
    });

    // REV-20260803-029: applyScheduledPaymentSync re-resolved the timeline from
    // the database without comparing to what the user was shown. If the rate,
    // payment, or extra split changed between preview and confirmation, the
    // newer (user-unauthorized) state was applied silently.
    it("applies when the hash matches the freshly computed preview", async () => {
      const account = makeAccount({ interestRate: 4.9 });
      accountsRepository.findOne.mockResolvedValue(account);
      scheduledTransactionsService.findOne.mockResolvedValue({
        id: "sched-1",
        name: "Mortgage",
        currencyCode: "CAD",
        amount: -2500,
        splits: [],
      });

      const expectedInterest =
        Math.round(400000 * (4.9 / 100 / 12) * 10000) / 10000;
      const previewForHashing = {
        scheduledTransactionId: "sched-1",
        scheduledTransactionName: "Mortgage",
        currencyCode: "CAD",
        currentPaymentAmount: 2500,
        proposedPaymentAmount: 2500,
        currentPrincipal: null,
        proposedPrincipal: 2500 - expectedInterest,
        currentInterest: null,
        proposedInterest: expectedInterest,
        extraPrincipal: 0,
      };
      const correctHash = hashScheduledPaymentPreview(previewForHashing);

      const result = await service.applyScheduledPaymentSync(
        userId,
        accountId,
        correctHash,
      );

      expect(scheduledTransactionsService.update).toHaveBeenCalled();
      expect(result?.proposedInterest).toBe(expectedInterest);
    });

    it("rejects with ConflictException and fresh preview when the hash does not match", async () => {
      // Simulate: user saw a preview at rate 4.9%, but by confirmation time the
      // rate changed to 5.5% (the account default). The fresh plan will differ
      // from the hash the user's client holds.
      const account = makeAccount({ interestRate: 5.5 });
      accountsRepository.findOne.mockResolvedValue(account);
      scheduledTransactionsService.findOne.mockResolvedValue({
        id: "sched-1",
        name: "Mortgage",
        currencyCode: "CAD",
        amount: -2500,
        splits: [],
      });

      // Hash built for a different rate (4.9%) -- does not match the 5.5% plan
      // the service will compute from the current DB state.
      const staleHash = hashScheduledPaymentPreview({
        scheduledTransactionId: "sched-1",
        scheduledTransactionName: "Mortgage",
        currencyCode: "CAD",
        currentPaymentAmount: 2500,
        proposedPaymentAmount: 2500,
        currentPrincipal: null,
        // 4.9% interest -- what the user saw, not what the DB now resolves to
        proposedPrincipal:
          2500 - Math.round(400000 * (4.9 / 100 / 12) * 10000) / 10000,
        proposedInterest:
          Math.round(400000 * (4.9 / 100 / 12) * 10000) / 10000,
        currentInterest: null,
        extraPrincipal: 0,
      });

      await expect(
        service.applyScheduledPaymentSync(userId, accountId, staleHash),
      ).rejects.toThrow(ConflictException);

      // Nothing was applied -- the user must review and re-authorize.
      expect(scheduledTransactionsService.update).not.toHaveBeenCalled();

      // The exception body must carry the fresh preview for the UI to display.
      let thrown: ConflictException | undefined;
      try {
        await service.applyScheduledPaymentSync(userId, accountId, staleHash);
      } catch (err) {
        thrown = err as ConflictException;
      }
      const body = thrown!.getResponse() as Record<string, unknown>;
      expect(body.freshPreview).toBeDefined();
      expect(body.freshPreviewHash).toBeDefined();
      // The fresh preview reflects the current 5.5% rate, not 4.9%.
      const freshPreview = body.freshPreview as { proposedInterest: number };
      const expectedFreshInterest =
        Math.round(400000 * (5.5 / 100 / 12) * 10000) / 10000;
      expect(freshPreview.proposedInterest).toBe(expectedFreshInterest);
    });

    it("applies without a hash when the caller omits expectedPreviewHash (backward-compatible)", async () => {
      const account = makeAccount({ interestRate: 4.9 });
      accountsRepository.findOne.mockResolvedValue(account);
      scheduledTransactionsService.findOne.mockResolvedValue({
        id: "sched-1",
        splits: [],
      });

      // No hash supplied -- should apply unconditionally (legacy behaviour).
      await service.applyScheduledPaymentSync(userId, accountId, undefined);

      expect(scheduledTransactionsService.update).toHaveBeenCalled();
    });
  });

  describe("hashScheduledPaymentPreview", () => {
    it("produces a 64-character hex SHA-256 string", () => {
      const preview = {
        scheduledTransactionId: "sched-1",
        scheduledTransactionName: "Mortgage",
        currencyCode: "CAD",
        currentPaymentAmount: 2500,
        proposedPaymentAmount: 2500,
        currentPrincipal: 800,
        proposedPrincipal: 1700,
        currentInterest: 1700,
        proposedInterest: 800,
        extraPrincipal: 0,
      };
      const hash = hashScheduledPaymentPreview(preview);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("produces different hashes for different proposed amounts", () => {
      const base = {
        scheduledTransactionId: "sched-1",
        scheduledTransactionName: null,
        currencyCode: "CAD",
        currentPaymentAmount: null,
        proposedPaymentAmount: 2500,
        currentPrincipal: null,
        proposedPrincipal: 1700,
        currentInterest: null,
        proposedInterest: 800,
        extraPrincipal: 0,
      };
      const changed = { ...base, proposedInterest: 900 };
      expect(hashScheduledPaymentPreview(base)).not.toBe(
        hashScheduledPaymentPreview(changed),
      );
    });
  });

  describe("buildScheduledUpdate near payoff", () => {
    // REV-20260803-027: principal was capped at the outstanding balance but
    // proposedPaymentAmount (the parent transaction amount) was left at the
    // full contractual payment, so the payload's amount no longer equalled
    // the sum of its principal/interest splits -- ScheduledTransactionsService
    // rejects that mismatch via validateSplitAmountSum.
    it("derives the parent amount from capped principal plus interest, not the full contractual payment", async () => {
      const account = makeAccount({
        accountType: AccountType.LOAN,
        currentBalance: -100,
        paymentAmount: 500,
      });
      scheduledTransactionsService.findOne.mockResolvedValue({
        id: "sched-1",
        name: "Loan Payment",
        currencyCode: "USD",
        amount: -500,
        splits: [],
      });

      const plan = await service.buildScheduledUpdate(userId, account, {
        annualRate: 5,
        paymentAmount: 500,
      });

      expect(plan).not.toBeNull();
      // 5% annual / 12 monthly periods against a $100 balance
      const expectedInterest = Math.round(100 * (5 / 100 / 12) * 10000) / 10000;
      expect(expectedInterest).toBe(0.4167);

      const splitTotal = plan!.payload.splits!.reduce(
        (sum, s) => sum + Number(s.amount),
        0,
      );
      // The finding's exact numbers: principal capped to the $100 balance,
      // interest ~$0.42, so the combined splits are ~$100.42 -- not the
      // uncapped $500 contractual payment.
      expect(splitTotal).toBeCloseTo(-100.4167, 4);
      expect(plan!.payload.amount).toBe(splitTotal);
      expect(plan!.payload.amount).toBe(-100.4167);
      expect(plan!.preview.proposedPrincipal).toBe(100);
      expect(plan!.preview.proposedInterest).toBe(expectedInterest);
      expect(plan!.preview.proposedPaymentAmount).toBe(100.4167);
    });

    it("caps combined regular + extra principal at the remaining balance rather than only the regular split", async () => {
      const account = makeAccount({
        accountType: AccountType.LOAN,
        currentBalance: -100,
        paymentAmount: 500,
      });
      scheduledTransactionsService.findOne.mockResolvedValue({
        id: "sched-1",
        name: "Loan Payment",
        currencyCode: "USD",
        amount: -500,
        splits: [
          {
            transferAccountId: accountId,
            amount: -50,
            memo: "Extra Principal",
          },
        ],
      });

      const plan = await service.buildScheduledUpdate(userId, account, {
        annualRate: 5,
        paymentAmount: 500,
      });

      expect(plan).not.toBeNull();
      const splitTotal = plan!.payload.splits!.reduce(
        (sum, s) => sum + Number(s.amount),
        0,
      );
      expect(plan!.payload.amount).toBe(splitTotal);
      // Regular principal (100) already consumes the entire remaining
      // balance, so the extra split must be capped down to 0, not left at
      // its requested 50 (which would overshoot the balance).
      expect(plan!.preview.extraPrincipal).toBe(0);
    });
  });

  describe("update", () => {
    beforeEach(() => {
      rateChangesRepository.findOne.mockResolvedValue(makeRow());
    });

    it("merges provided fields without touching the account scalars", async () => {
      const account = makeAccount();
      accountsRepository.findOne.mockResolvedValue(account);
      manager.find.mockResolvedValue([
        makeRow({ annualRate: 5.1, effectiveDate: "2024-06-01" }),
      ]);

      const result = await service.update(userId, accountId, "rc-1", {
        annualRate: 5.1,
      });

      expect(result.annualRate).toBe(5.1);
      // Editing the timeline never rewrites the account's own rate.
      expect(account.interestRate).toBe(5.5);
    });

    it("flips an inferred row to manual when edited", async () => {
      rateChangesRepository.findOne.mockResolvedValue(
        makeRow({ source: "inferred" }),
      );

      const result = await service.update(userId, accountId, "rc-1", {
        annualRate: 5.05,
      });

      expect(result.source).toBe("manual");
    });

    it("keeps the source when a manual row is edited", async () => {
      const result = await service.update(userId, accountId, "rc-1", {
        annualRate: 5.05,
      });

      expect(result.source).toBe("manual");
    });

    it("409s when moving onto another row's effective date", async () => {
      manager.findOne.mockResolvedValue(makeRow({ id: "rc-other" }));

      await expect(
        service.update(userId, accountId, "rc-1", {
          effectiveDate: "2024-07-01",
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("skips the duplicate check when the date is unchanged", async () => {
      await service.update(userId, accountId, "rc-1", {
        effectiveDate: "2024-06-01",
      });

      expect(manager.findOne).not.toHaveBeenCalled();
    });

    it("404s for a rate change on another account or user", async () => {
      rateChangesRepository.findOne.mockResolvedValue(null);

      await expect(
        service.update(userId, accountId, "rc-1", { annualRate: 5 }),
      ).rejects.toThrow(NotFoundException);
    });

    it("propagates a scheduled-payment sync failure instead of returning success", async () => {
      const account = makeAccount();
      accountsRepository.findOne.mockResolvedValue(account);
      manager.find.mockResolvedValue([
        makeRow({ annualRate: 5.1, effectiveDate: "2024-06-01" }),
      ]);
      scheduledTransactionsService.update.mockRejectedValue(
        new Error("sync failed"),
      );

      await expect(
        service.update(userId, accountId, "rc-1", { annualRate: 5.1 }),
      ).rejects.toThrow("sync failed");

      // verifyLoanAccount + the private findOne lookup + the write block share
      // no transaction with the write itself, so there are three scoped calls
      // total -- but the write and the scheduled-payment sync happen inside
      // the *same* (last) transaction, so a sync failure rolls that write
      // back too, rather than leaving it already committed with the sync
      // merely attempted afterwards.
      expect(dataSource.transaction).toHaveBeenCalledTimes(3);
    });

    it("propagates a non-not-found failure looking up the scheduled transaction, rather than treating it as nothing to sync (REV-20260803-030)", async () => {
      const account = makeAccount();
      accountsRepository.findOne.mockResolvedValue(account);
      manager.find.mockResolvedValue([
        makeRow({ annualRate: 5.1, effectiveDate: "2024-06-01" }),
      ]);
      // A transient/real failure (timeout, DB error, etc) -- NOT the
      // scheduled transaction genuinely not existing.
      scheduledTransactionsService.findOne.mockRejectedValue(
        new Error("connection timeout"),
      );

      await expect(
        service.update(userId, accountId, "rc-1", { annualRate: 5.1 }),
      ).rejects.toThrow("connection timeout");

      // The lookup failure must never be silently treated as "no plan, no
      // sync needed": scheduledTransactionsService.update must not have run
      // (buildScheduledUpdate threw before ever reaching it), and the rate
      // edit itself must not be left committed.
      expect(scheduledTransactionsService.update).not.toHaveBeenCalled();
    });

    it("still succeeds cleanly when the linked scheduled transaction genuinely no longer exists", async () => {
      const account = makeAccount();
      accountsRepository.findOne.mockResolvedValue(account);
      manager.find.mockResolvedValue([
        makeRow({ annualRate: 5.1, effectiveDate: "2024-06-01" }),
      ]);
      scheduledTransactionsService.findOne.mockRejectedValue(
        new NotFoundException(
          "Scheduled transaction with ID sched-1 not found",
        ),
      );

      const result = await service.update(userId, accountId, "rc-1", {
        annualRate: 5.1,
      });

      expect(result.annualRate).toBe(5.1);
      expect(scheduledTransactionsService.update).not.toHaveBeenCalled();
    });
  });

  describe("remove", () => {
    it("removes the row without rewriting the account scalars", async () => {
      const account = makeAccount({ interestRate: 4.9 });
      accountsRepository.findOne.mockResolvedValue(account);
      const row = makeRow();
      rateChangesRepository.findOne.mockResolvedValue(row);
      manager.find.mockResolvedValue([
        makeRow({
          source: "initial",
          effectiveDate: "2022-01-01",
          annualRate: 5.5,
          newPaymentAmount: 2500,
        }),
      ]);

      await service.remove(userId, accountId, "rc-1");

      expect(manager.remove).toHaveBeenCalledWith(row);
      // Account rate stays as the user set it; deletion never restores a row's value.
      expect(account.interestRate).toBe(4.9);
    });

    it("leaves scalars alone when no applicable rows remain", async () => {
      const account = makeAccount({ interestRate: 4.9 });
      accountsRepository.findOne.mockResolvedValue(account);
      rateChangesRepository.findOne.mockResolvedValue(makeRow());
      manager.find.mockResolvedValue([]);

      await service.remove(userId, accountId, "rc-1");

      expect(account.interestRate).toBe(4.9);
    });

    it("404s when the rate change does not exist", async () => {
      rateChangesRepository.findOne.mockResolvedValue(null);

      await expect(
        service.remove(userId, accountId, "missing"),
      ).rejects.toThrow(NotFoundException);
    });

    it("propagates a scheduled-payment sync failure instead of silently succeeding", async () => {
      const account = makeAccount();
      accountsRepository.findOne.mockResolvedValue(account);
      const row = makeRow();
      rateChangesRepository.findOne.mockResolvedValue(row);
      manager.find.mockResolvedValue([
        makeRow({
          source: "initial",
          effectiveDate: "2022-01-01",
          annualRate: 5.5,
          newPaymentAmount: 2500,
        }),
      ]);
      scheduledTransactionsService.update.mockRejectedValue(
        new Error("sync failed"),
      );

      await expect(service.remove(userId, accountId, "rc-1")).rejects.toThrow(
        "sync failed",
      );

      // The row removal must not be left committed while the linked scheduled
      // payment silently keeps its stale split: the removal and the sync run
      // in the same transaction, so the failure rolls both back.
      expect(manager.remove).toHaveBeenCalledWith(row);
    });

    it("propagates a non-not-found failure looking up the scheduled transaction, rather than treating it as nothing to sync (REV-20260803-030)", async () => {
      const account = makeAccount();
      accountsRepository.findOne.mockResolvedValue(account);
      const row = makeRow();
      rateChangesRepository.findOne.mockResolvedValue(row);
      manager.find.mockResolvedValue([
        makeRow({
          source: "initial",
          effectiveDate: "2022-01-01",
          annualRate: 5.5,
          newPaymentAmount: 2500,
        }),
      ]);
      // A transient/real failure (timeout, DB error, etc) -- NOT the
      // scheduled transaction genuinely not existing.
      scheduledTransactionsService.findOne.mockRejectedValue(
        new Error("connection timeout"),
      );

      await expect(service.remove(userId, accountId, "rc-1")).rejects.toThrow(
        "connection timeout",
      );

      expect(scheduledTransactionsService.update).not.toHaveBeenCalled();
    });

    it("still succeeds cleanly when the linked scheduled transaction genuinely no longer exists", async () => {
      const account = makeAccount();
      accountsRepository.findOne.mockResolvedValue(account);
      const row = makeRow();
      rateChangesRepository.findOne.mockResolvedValue(row);
      manager.find.mockResolvedValue([
        makeRow({
          source: "initial",
          effectiveDate: "2022-01-01",
          annualRate: 5.5,
          newPaymentAmount: 2500,
        }),
      ]);
      scheduledTransactionsService.findOne.mockRejectedValue(
        new NotFoundException(
          "Scheduled transaction with ID sched-1 not found",
        ),
      );

      await expect(
        service.remove(userId, accountId, "rc-1"),
      ).resolves.toBeUndefined();

      expect(manager.remove).toHaveBeenCalledWith(row);
      expect(scheduledTransactionsService.update).not.toHaveBeenCalled();
    });
  });

  describe("resolveCurrentTimeline", () => {
    it("returns the latest applicable rate and latest non-null payment without mutating the account", async () => {
      const account = makeAccount();
      const today = todayYMD();
      manager.find.mockResolvedValue([
        makeRow({
          source: "initial",
          effectiveDate: "2022-01-01",
          annualRate: 5.5,
          newPaymentAmount: 2500,
        }),
        makeRow({
          id: "rc-2",
          effectiveDate: "2023-01-01",
          annualRate: 6.2,
          newPaymentAmount: 2650,
        }),
        makeRow({ id: "rc-3", effectiveDate: "2024-01-01", annualRate: 5.9 }),
        makeRow({ id: "rc-4", effectiveDate: "2099-01-01", annualRate: 4.0 }),
      ]);

      const resolved = await service.resolveCurrentTimeline(
        manager as any,
        account,
      );

      expect(today >= "2024-01-01").toBe(true);
      expect(resolved).toEqual({ annualRate: 5.9, paymentAmount: 2650 });
      // Read-only: the account's own scalars are never touched.
      expect(account.interestRate).toBe(5.5);
      expect(account.paymentAmount).toBe(2500);
      expect(manager.save).not.toHaveBeenCalledWith(account);
    });

    it("returns null for a closed account", async () => {
      const resolved = await service.resolveCurrentTimeline(
        manager as any,
        makeAccount({ isClosed: true }),
      );
      expect(resolved).toBeNull();
      expect(manager.find).not.toHaveBeenCalled();
    });
  });
});
