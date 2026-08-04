import { BadRequestException } from "@nestjs/common";
import { RateChangeInferenceService } from "./rate-change-inference.service";
import { LoanRateChange } from "./entities/loan-rate-change.entity";
import { Account, AccountType } from "../accounts/entities/account.entity";
import { Transaction } from "../transactions/entities/transaction.entity";
import type { PaymentRecord } from "../accounts/loan-payment-detector.service";
import {
  createScopedDbMocks,
  ManagerMock,
} from "../test-helpers/scoped-db-testing";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);

interface SyntheticSegment {
  /** Quoted annual rate as a percentage */
  annualRate: number;
  /** Number of monthly payments at this rate */
  payments: number;
  /** Total payment per period */
  paymentAmount: number;
}

/**
 * Generate a synthetic monthly payment history with exact amortization math
 * (interest rounded to cents like real transactions), returning the payment
 * records and the balance-before-payment map the detector would produce.
 */
function generateHistory(
  startingBalance: number,
  segments: SyntheticSegment[],
  options: { isCanadianFixed?: boolean; startYear?: number } = {},
): { records: PaymentRecord[]; balanceMap: Map<string, number> } {
  const records: PaymentRecord[] = [];
  const balanceMap = new Map<string, number>();
  let balance = startingBalance;
  let year = options.startYear ?? 2020;
  let month = 1;

  for (const segment of segments) {
    for (let i = 0; i < segment.payments; i++) {
      const date = `${year}-${String(month).padStart(2, "0")}-01`;
      // Real amortization (loan-amortization.util.ts / mortgage-amortization
      // .util.ts) books interest as balance x periodicRate, where periodicRate
      // is fixed by payment frequency (annualRate / periodsPerYear) -- never
      // by the calendar-day gap since the last payment. A Canadian fixed
      // mortgage compounds semi-annually instead. Booking it this way (rather
      // than by day count) is what lets the detector recover the quoted rate
      // regardless of month length.
      const interest = options.isCanadianFixed
        ? Math.round(
            balance *
              (Math.pow(1 + segment.annualRate / 100 / 2, 2 / 12) - 1) *
              100,
          ) / 100
        : Math.round(balance * (segment.annualRate / 100 / 12) * 100) / 100;
      const principal =
        Math.round((segment.paymentAmount - interest) * 100) / 100;

      balanceMap.set(date, balance);
      records.push({
        date,
        amount: segment.paymentAmount,
        sourceAccountId: "src-1",
        sourceAccountName: "Chequing",
        interestAmount: interest,
        principalAmount: principal,
        extraPrincipalAmount: null,
        principalSplitAmounts: [],
        interestCategoryId: "cat-interest",
        interestCategoryName: "Interest",
      });

      balance -= principal;
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    }
  }

  return { records, balanceMap };
}

describe("RateChangeInferenceService", () => {
  let service: RateChangeInferenceService;
  let detector: Record<string, jest.Mock>;
  let rateChangesService: Record<string, jest.Mock>;
  let manager: ManagerMock;
  let transactionsRepository: Record<string, jest.Mock>;

  const userId = "user-1";
  const accountId = "account-1";

  const makeAccount = (overrides: Partial<Account> = {}): Account =>
    ({
      id: accountId,
      userId,
      accountType: AccountType.MORTGAGE,
      currentBalance: 0,
      interestRate: 5.5,
      paymentAmount: 2500,
      paymentFrequency: "MONTHLY",
      isCanadianMortgage: false,
      isVariableRate: true,
      isClosed: true,
      scheduledTransactionId: null,
      ...overrides,
    }) as unknown as Account;

  function setHistory(
    records: PaymentRecord[],
    balanceMap: Map<string, number>,
  ): void {
    detector.buildPaymentRecords.mockResolvedValue(records);
    detector.buildRunningBalanceMap.mockReturnValue(balanceMap);
  }

  function createdRows(): Array<Record<string, any>> {
    return manager.save.mock.calls.map((call) => call[0]);
  }

  beforeEach(() => {
    transactionsRepository = {
      find: jest.fn().mockResolvedValue([]),
    };

    detector = {
      buildPaymentRecords: jest.fn().mockResolvedValue([]),
      consolidatePaymentsByDate: jest
        .fn()
        .mockImplementation((records) => records),
      pairSeparateInterest: jest
        .fn()
        .mockImplementation((_userId, _account, records) => records),
      buildRunningBalanceMap: jest.fn().mockReturnValue(new Map()),
    };

    rateChangesService = {
      verifyLoanAccount: jest.fn().mockResolvedValue(makeAccount()),
    };

    const { manager: managerMock, dataSource } = createScopedDbMocks([
      [Transaction, transactionsRepository],
      [LoanRateChange, {}],
    ]);
    manager = managerMock;
    manager.find.mockResolvedValue([]);
    manager.create.mockImplementation((_entity, data) => ({ ...data }));
    manager.save.mockImplementation((data) =>
      Promise.resolve({ ...data, id: `rc-${Math.random()}` }),
    );
    manager.delete.mockResolvedValue({ affected: 0 });

    service = new RateChangeInferenceService(
      dataSource as never,
      detector as never,
      rateChangesService as never,
    );
  });

  it("detects only the initial rate for a constant-rate history", async () => {
    const { records, balanceMap } = generateHistory(400000, [
      { annualRate: 5.5, payments: 24, paymentAmount: 2500 },
    ]);
    setHistory(records, balanceMap);

    const result = await service.detectAndPersist(userId, accountId);

    expect(result.created).toHaveLength(1);
    const initial = createdRows()[0];
    expect(initial.source).toBe("initial");
    expect(initial.effectiveDate).toBe("2020-01-01");
    expect(Math.abs(initial.annualRate - 5.5)).toBeLessThanOrEqual(0.05);
    expect(initial.newPaymentAmount).toBe(2500);
  });

  it("recovers a consistent annual rate for a monthly loan across 28-day and 31-day gaps (REV-20260803-004)", async () => {
    // 2021 is not a leap year: Jan-1 -> Feb-1 is a 31-day gap and
    // Feb-1 -> Mar-1 is a 28-day gap, on the same true 5%/12 monthly rate.
    // A calendar-day-gap annualization (`x 365/days`) reads that as ~4.91%
    // and ~5.43% respectively; the account's configured MONTHLY frequency
    // must recover ~5% either way.
    const { records, balanceMap } = generateHistory(
      400000,
      [{ annualRate: 5, payments: 8, paymentAmount: 3000 }],
      { startYear: 2021 },
    );
    setHistory(records, balanceMap);

    const result = await service.detectAndPersist(userId, accountId);

    expect(result.created).toHaveLength(1);
    const initial = createdRows()[0];
    expect(initial.source).toBe("initial");
    expect(Math.abs(initial.annualRate - 5)).toBeLessThanOrEqual(0.05);
  });

  it("recovers separately-booked interest via pairSeparateInterest so detection succeeds", async () => {
    const { records, balanceMap } = generateHistory(400000, [
      { annualRate: 5.5, payments: 24, paymentAmount: 2500 },
    ]);
    // The payments were entered without an interest split; buildPaymentRecords
    // sees no interest, and pairSeparateInterest recovers it from the loan's
    // designated interest category.
    const stripped = records.map((r) => ({ ...r, interestAmount: null }));
    detector.buildPaymentRecords.mockResolvedValue(stripped);
    detector.pairSeparateInterest.mockResolvedValue(records);
    detector.buildRunningBalanceMap.mockReturnValue(balanceMap);

    const result = await service.detectAndPersist(userId, accountId);

    expect(detector.pairSeparateInterest).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({ id: accountId }),
      stripped,
    );
    expect(result.created.length).toBeGreaterThanOrEqual(1);
  });

  it("skips separate-interest pairing in SPLIT mode (interest comes only from splits)", async () => {
    rateChangesService.verifyLoanAccount.mockResolvedValue(
      makeAccount({ interestBookingMode: "SPLIT" }),
    );
    const { records, balanceMap } = generateHistory(400000, [
      { annualRate: 5.5, payments: 24, paymentAmount: 2500 },
    ]);
    detector.buildPaymentRecords.mockResolvedValue(records);
    detector.buildRunningBalanceMap.mockReturnValue(balanceMap);

    const result = await service.detectAndPersist(userId, accountId);

    expect(detector.pairSeparateInterest).not.toHaveBeenCalled();
    expect(result.created.length).toBeGreaterThanOrEqual(1);
  });

  it("still reports insufficient data when no interest can be recovered", async () => {
    const { records, balanceMap } = generateHistory(400000, [
      { annualRate: 5.5, payments: 24, paymentAmount: 2500 },
    ]);
    const stripped = records.map((r) => ({ ...r, interestAmount: null }));
    detector.buildPaymentRecords.mockResolvedValue(stripped);
    detector.pairSeparateInterest.mockResolvedValue(stripped);
    detector.buildRunningBalanceMap.mockReturnValue(balanceMap);

    await expect(service.detectAndPersist(userId, accountId)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("detects multiple rate steps with an unchanged payment", async () => {
    const { records, balanceMap } = generateHistory(400000, [
      { annualRate: 5.5, payments: 12, paymentAmount: 2500 },
      { annualRate: 4.9, payments: 12, paymentAmount: 2500 },
      { annualRate: 5.7, payments: 12, paymentAmount: 2500 },
    ]);
    setHistory(records, balanceMap);

    const result = await service.detectAndPersist(userId, accountId);

    expect(result.created).toHaveLength(3);
    const rows = createdRows();
    expect(rows[0]).toMatchObject({
      source: "initial",
      effectiveDate: "2020-01-01",
    });
    expect(rows[1]).toMatchObject({
      source: "inferred",
      effectiveDate: "2021-01-01",
      newPaymentAmount: null,
    });
    expect(rows[2]).toMatchObject({
      source: "inferred",
      effectiveDate: "2022-01-01",
      newPaymentAmount: null,
    });
    expect(Math.abs(rows[0].annualRate - 5.5)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(rows[1].annualRate - 4.9)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(rows[2].annualRate - 5.7)).toBeLessThanOrEqual(0.05);
  });

  it("recovers the quoted rate for Canadian semi-annual compounding", async () => {
    rateChangesService.verifyLoanAccount.mockResolvedValue(
      makeAccount({ isCanadianMortgage: true, isVariableRate: false }),
    );
    const { records, balanceMap } = generateHistory(
      400000,
      [{ annualRate: 5.5, payments: 24, paymentAmount: 2500 }],
      { isCanadianFixed: true },
    );
    setHistory(records, balanceMap);

    await service.detectAndPersist(userId, accountId);

    const initial = createdRows()[0];
    expect(Math.abs(initial.annualRate - 5.5)).toBeLessThanOrEqual(0.05);
  });

  it("records the new payment when it steps together with the rate", async () => {
    const { records, balanceMap } = generateHistory(400000, [
      { annualRate: 5.5, payments: 12, paymentAmount: 2500 },
      { annualRate: 6.5, payments: 12, paymentAmount: 2750 },
    ]);
    setHistory(records, balanceMap);

    await service.detectAndPersist(userId, accountId);

    const inferred = createdRows().find((row) => row.source === "inferred");
    expect(inferred).toMatchObject({
      effectiveDate: "2021-01-01",
      newPaymentAmount: 2750,
    });
  });

  it("ignores a single outlier payment instead of opening a segment", async () => {
    const { records, balanceMap } = generateHistory(400000, [
      { annualRate: 5.5, payments: 24, paymentAmount: 2500 },
    ]);
    // A one-off anomaly (e.g. a misclassified fee) doubles one interest amount
    records[10] = {
      ...records[10],
      interestAmount: records[10].interestAmount! * 2,
    };
    setHistory(records, balanceMap);

    const result = await service.detectAndPersist(userId, accountId);

    expect(result.created).toHaveLength(1);
    expect(createdRows()[0].source).toBe("initial");
  });

  it("400s when there are not enough payments with interest details", async () => {
    const { records, balanceMap } = generateHistory(400000, [
      { annualRate: 5.5, payments: 6, paymentAmount: 2500 },
    ]);
    const stripped = records.map((record) => ({
      ...record,
      interestAmount: null,
    }));
    setHistory(stripped, balanceMap);

    await expect(service.detectAndPersist(userId, accountId)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("skips observations where the balance is too small to be reliable", async () => {
    const { records, balanceMap } = generateHistory(700, [
      { annualRate: 5.5, payments: 6, paymentAmount: 200 },
    ]);
    setHistory(records, balanceMap);

    // Only the first payments have balanceBefore >= $500; too few remain
    await expect(service.detectAndPersist(userId, accountId)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("replaces inferred rows and preserves manual rows on re-detect", async () => {
    const { records, balanceMap } = generateHistory(400000, [
      { annualRate: 5.5, payments: 12, paymentAmount: 2500 },
      { annualRate: 4.9, payments: 12, paymentAmount: 2500 },
    ]);
    setHistory(records, balanceMap);

    manager.delete.mockResolvedValue({ affected: 2 });
    // The user already has an initial row plus a manual correction exactly
    // where the detected step lands
    manager.find.mockResolvedValue([
      { effectiveDate: "2020-01-01", source: "initial" },
      { effectiveDate: "2021-01-01", source: "manual" },
    ]);

    const result = await service.detectAndPersist(userId, accountId);

    expect(manager.delete).toHaveBeenCalledWith(LoanRateChange, {
      accountId,
      source: "inferred",
    });
    expect(result.replacedCount).toBe(2);
    // Initial exists and the manual row occupies the step date: nothing new
    expect(result.created).toHaveLength(0);
  });

  it("warns when payment cadence disagrees with the configured frequency", async () => {
    rateChangesService.verifyLoanAccount.mockResolvedValue(
      makeAccount({ paymentFrequency: "WEEKLY" }),
    );
    const { records, balanceMap } = generateHistory(400000, [
      { annualRate: 5.5, payments: 24, paymentAmount: 2500 },
    ]);
    setHistory(records, balanceMap);

    const result = await service.detectAndPersist(userId, accountId);

    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("persists inferred rows without touching account scalars or the schedule", async () => {
    rateChangesService.verifyLoanAccount.mockResolvedValue(
      makeAccount({ isClosed: false }),
    );
    const { records, balanceMap } = generateHistory(400000, [
      { annualRate: 5.5, payments: 24, paymentAmount: 2500 },
    ]);
    setHistory(records, balanceMap);

    const result = await service.detectAndPersist(userId, accountId);

    // Detection is historical inference: it only writes timeline rows. It must
    // never resolve/sync the account's user-owned rate/payment or the bill.
    expect(result.created.length).toBeGreaterThan(0);
    expect(rateChangesService.resolveCurrentTimeline).toBeUndefined();
    expect(rateChangesService.syncScheduledTransaction).toBeUndefined();
  });
});
