import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { Category } from "../categories/entities/category.entity";
import { ScheduledTransaction } from "../scheduled-transactions/entities/scheduled-transaction.entity";
import { createScopedDbMocks } from "../test-helpers/scoped-db-testing";
import { PayrollDeductionRule } from "./entities/payroll-deduction-rule.entity";
import { PayrollDeductionsService } from "./payroll-deductions.service";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);
jest.mock("../common/date-utils", () => ({
  ...jest.requireActual("../common/date-utils"),
  todayYMD: () => "2026-04-10",
}));

const USER = "11111111-1111-4111-8111-111111111111";
const BILL = "22222222-2222-4222-8222-222222222222";
const EI = "33333333-3333-4333-8333-333333333333";
const CPP = "44444444-4444-4444-8444-444444444444";
const RULE = "55555555-5555-4555-8555-555555555555";

const bill = (splits: { categoryId: string; amount: number }[] = []) => ({
  id: BILL,
  userId: USER,
  name: "Paycheque",
  currencyCode: "CAD",
  splits,
});

const rule = (over: Partial<PayrollDeductionRule> = {}): PayrollDeductionRule =>
  ({
    id: RULE,
    userId: USER,
    scheduledTransactionId: BILL,
    categoryId: EI,
    yearlyMaximum: 1077.48,
    resetPeriod: "YEARLY",
    resetDate: "2026-01-01",
    expectedPerPaycheque: null,
    createdAt: new Date("2026-01-05T00:00:00Z"),
    updatedAt: new Date("2026-01-05T00:00:00Z"),
    category: { id: EI, name: "EI" } as Category,
    scheduledTransaction: bill([
      { categoryId: EI, amount: -64 },
    ]) as unknown as ScheduledTransaction,
    ...over,
  }) as PayrollDeductionRule;

describe("PayrollDeductionsService", () => {
  let service: PayrollDeductionsService;
  let mocks: ReturnType<typeof createScopedDbMocks>;
  let rulesRepo: Record<string, jest.Mock>;
  let scheduledRepo: Record<string, jest.Mock>;
  let categoryRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    rulesRepo = {
      find: jest.fn().mockResolvedValue([rule()]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: Partial<PayrollDeductionRule>) => value),
      save: jest.fn(async (value: Partial<PayrollDeductionRule>) => ({
        id: RULE,
        ...value,
      })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1, raw: [] }),
    };
    scheduledRepo = {
      findOne: jest.fn(
        async ({ where }: { where: { id: string; userId: string } }) =>
          where.id === BILL && where.userId === USER
            ? bill([{ categoryId: EI, amount: -64 }])
            : null,
      ),
    };
    categoryRepo = {
      findOne: jest.fn(
        async ({ where }: { where: { id: string; userId: string } }) =>
          [EI, CPP].includes(where.id) && where.userId === USER
            ? { id: where.id, name: where.id === EI ? "EI" : "CPP" }
            : null,
      ),
    };
    mocks = createScopedDbMocks([
      [PayrollDeductionRule, rulesRepo],
      [ScheduledTransaction, scheduledRepo],
      [Category, categoryRepo],
    ]);
    // The ledger: EI has collected 1,024 in the period.
    mocks.manager.query.mockImplementation(async (sql: string) =>
      String(sql).includes("foreign_rows")
        ? [{ total: "-1024", foreign_rows: "0" }]
        : [{ amount: "-61.5" }],
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollDeductionsService,
        { provide: DataSource, useValue: mocks.dataSource },
      ],
    }).compile();
    service = module.get(PayrollDeductionsService);
  });

  describe("findAll", () => {
    it("answers each rule with its names and today's figures", async () => {
      const [view] = await service.findAll(USER);
      expect(rulesRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER } }),
      );
      expect(view).toMatchObject({
        id: RULE,
        categoryName: "EI",
        scheduledTransactionName: "Paycheque",
        yearlyMaximum: 1077.48,
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        nextResetOn: "2027-01-01",
        paidToDate: 1024,
        remaining: 53.48,
        currencyCode: "CAD",
        expectedPerPaycheque: 64,
        expectedSource: "line",
      });
      expect(view).not.toHaveProperty("scheduledTransaction");
    });
  });

  describe("suggestExpected", () => {
    it("prefers the bill's line, and estimates no maximum without a reset date", async () => {
      await expect(service.suggestExpected(USER, BILL, EI)).resolves.toEqual({
        expectedPerPaycheque: 64,
        expectedSource: "line",
        yearlyMaximum: null,
        yearlyMaximumSource: null,
      });
      expect(mocks.manager.query).not.toHaveBeenCalled();
    });

    it("estimates the maximum from the last full period, the current one when it already collected more, or the current one when the bill's later paycheques stopped deducting", async () => {
      // Per call: the previous period's paid, the current period's paid, then
      // the bill's postings in the current period, latest first.
      const paid = (
        previous: string,
        current: string,
        postings: boolean[] = [],
      ) => {
        let call = 0;
        mocks.manager.query.mockImplementation(async (sql: string) =>
          String(sql).includes("foreign_rows")
            ? [{ total: call++ === 0 ? previous : current, foreign_rows: "0" }]
            : String(sql).includes("scheduled_transaction_postings")
              ? postings.map((deducted) => ({ deducted }))
              : [],
        );
      };
      // The two latest paycheques carry no EI line after ones that did: the
      // period's total is the maximum, even though last year's was higher.
      paid("-1100", "-1049.12", [false, false, true, true]);
      await expect(
        service.suggestExpected(USER, BILL, EI, "2026-01-01"),
      ).resolves.toMatchObject({
        yearlyMaximum: 1049.12,
        yearlyMaximumSource: "currentPeriodCapped",
      });
      // A category never deducted on this bill's postings is not "stopped".
      paid("-1100", "-50", [false, false]);
      await expect(
        service.suggestExpected(USER, BILL, EI, "2026-01-01"),
      ).resolves.toMatchObject({ yearlyMaximumSource: "previousPeriod" });
      mocks.manager.query.mockClear();
      // Deducted on every paycheque so far: nothing says the cap was reached.
      paid("-1049.12", "-800", [true, true, true]);
      await expect(
        service.suggestExpected(USER, BILL, EI, "2026-01-01"),
      ).resolves.toMatchObject({
        yearlyMaximum: 1049.12,
        yearlyMaximumSource: "previousPeriod",
      });
      const [, previousParams] = mocks.manager.query.mock.calls[0];
      const [, currentParams] = mocks.manager.query.mock.calls[1];
      expect(previousParams).toEqual(
        expect.arrayContaining(["2025-01-01", "2025-12-31"]),
      );
      expect(currentParams).toEqual(
        expect.arrayContaining(["2026-01-01", "2026-12-31"]),
      );
      paid("-1049.12", "-1077.48");
      await expect(
        service.suggestExpected(USER, BILL, EI, "2026-01-01"),
      ).resolves.toMatchObject({
        yearlyMaximum: 1077.48,
        yearlyMaximumSource: "currentPeriod",
      });
      paid("0", "0");
      await expect(
        service.suggestExpected(USER, BILL, EI, "2026-01-01"),
      ).resolves.toMatchObject({
        yearlyMaximum: null,
        yearlyMaximumSource: null,
      });
    });

    it("falls back to the figure the category's rows most often carry over the last year, then to nothing", async () => {
      await expect(service.suggestExpected(USER, BILL, CPP)).resolves.toEqual({
        expectedPerPaycheque: 61.5,
        expectedSource: "ledger",
        yearlyMaximum: null,
        yearlyMaximumSource: null,
      });
      const [sql, params] = mocks.manager.query.mock.calls[0];
      // The mode, not the latest row: a capped or zeroed final paycheque of
      // the year must not become next year's expected amount.
      expect(String(sql)).toMatch(/GROUP BY x\.amount/);
      expect(String(sql)).toMatch(
        /ORDER BY COUNT\(\*\) DESC, MAX\(x\.transaction_date\) DESC/,
      );
      expect(String(sql)).toMatch(
        /x\.amount < 0 AND x\.transaction_date >= \$4/,
      );
      expect(params).toEqual([USER, CPP, "CAD", "2025-04-10"]);
      mocks.manager.query.mockResolvedValue([]);
      await expect(service.suggestExpected(USER, BILL, CPP)).resolves.toEqual({
        expectedPerPaycheque: null,
        expectedSource: null,
        yearlyMaximum: null,
        yearlyMaximumSource: null,
      });
    });

    it("refuses a bill the user does not own", async () => {
      await expect(
        service.suggestExpected(USER, CPP, EI),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("create", () => {
    const dto = {
      scheduledTransactionId: BILL,
      categoryId: EI,
      yearlyMaximum: 1077.48,
      resetDate: "2026-01-01",
    };

    it("stores the rule without an entered amount when the bill's line gives it", async () => {
      rulesRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(rule());
      const view = await service.create(USER, {
        ...dto,
        expectedPerPaycheque: 99,
      });
      expect(rulesRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER,
          scheduledTransactionId: BILL,
          categoryId: EI,
          yearlyMaximum: 1077.48,
          resetPeriod: "YEARLY",
          resetDate: "2026-01-01",
          expectedPerPaycheque: null,
        }),
      );
      expect(view.remaining).toBe(53.48);
    });

    it("insists on an entered amount when the bill has no line for the category", async () => {
      await expect(
        service.create(USER, { ...dto, categoryId: CPP }),
      ).rejects.toBeInstanceOf(BadRequestException);
      rulesRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(
          rule({ categoryId: CPP, expectedPerPaycheque: 150 }),
        );
      await service.create(USER, {
        ...dto,
        categoryId: CPP,
        expectedPerPaycheque: 150,
      });
      expect(rulesRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ categoryId: CPP, expectedPerPaycheque: 150 }),
      );
    });

    it("refuses a second rule for the same line, a foreign bill and a foreign category", async () => {
      rulesRepo.findOne.mockResolvedValueOnce(rule());
      await expect(service.create(USER, dto)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(
        service.create(USER, { ...dto, scheduledTransactionId: CPP }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.create(USER, { ...dto, categoryId: RULE }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(rulesRepo.save).not.toHaveBeenCalled();
    });
  });

  describe("createMany", () => {
    const batch = {
      scheduledTransactionId: BILL,
      resetDate: "2026-01-01",
      lines: [
        { categoryId: EI, yearlyMaximum: 1077.48 },
        { categoryId: CPP, yearlyMaximum: 4034.1, expectedPerPaycheque: 150 },
      ],
    };

    it("saves every line in one transaction and answers a view per line", async () => {
      rulesRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(rule())
        .mockResolvedValueOnce(
          rule({ categoryId: CPP, expectedPerPaycheque: 150 }),
        );
      const views = await service.createMany(USER, batch);
      expect(views).toHaveLength(2);
      expect(rulesRepo.save).toHaveBeenCalledTimes(2);
      expect(rulesRepo.save.mock.calls[0][0]).toMatchObject({
        categoryId: EI,
        resetDate: "2026-01-01",
        resetPeriod: "YEARLY",
        expectedPerPaycheque: null,
      });
      expect(rulesRepo.save.mock.calls[1][0]).toMatchObject({
        categoryId: CPP,
        expectedPerPaycheque: 150,
      });
      expect(mocks.dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it("writes nothing when a later line is refused", async () => {
      await expect(
        service.createMany(USER, {
          ...batch,
          lines: [batch.lines[0], { categoryId: CPP, yearlyMaximum: 4034.1 }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.createMany(USER, {
          ...batch,
          lines: [batch.lines[0], batch.lines[0]],
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(rulesRepo.save).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("writes only the changed columns and answers the fresh view", async () => {
      rulesRepo.findOne
        .mockResolvedValueOnce(rule())
        .mockResolvedValueOnce(rule({ yearlyMaximum: 1100 }));
      const view = await service.update(USER, RULE, { yearlyMaximum: 1100 });
      expect(rulesRepo.update).toHaveBeenCalledWith(
        { id: RULE },
        expect.objectContaining({
          yearlyMaximum: 1100,
          resetDate: "2026-01-01",
          expectedPerPaycheque: null,
        }),
      );
      expect(view.remaining).toBe(76);
    });

    it("refuses a move onto a line another rule holds, and an unknown id", async () => {
      rulesRepo.findOne
        .mockResolvedValueOnce(rule())
        .mockResolvedValueOnce(rule({ id: "other", categoryId: CPP }));
      await expect(
        service.update(USER, RULE, {
          categoryId: CPP,
          expectedPerPaycheque: 1,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(service.update(USER, "missing", {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("remove", () => {
    it("deletes by id and owner, and reports an unknown id", async () => {
      await service.remove(USER, RULE);
      expect(rulesRepo.delete).toHaveBeenCalledWith({ id: RULE, userId: USER });
      rulesRepo.delete.mockResolvedValue({ affected: 0, raw: [] });
      await expect(service.remove(USER, RULE)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
