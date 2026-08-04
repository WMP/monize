import { BadRequestException } from "@nestjs/common";
import { FindOperator } from "typeorm";
import { RateChangeInferenceService } from "./rate-change-inference.service";
import { LoanRateChange } from "./entities/loan-rate-change.entity";
import { Account, AccountType } from "../accounts/entities/account.entity";
import {
  Transaction,
  TransactionStatus,
} from "../transactions/entities/transaction.entity";
import {
  LoanPaymentDetectorService,
  type PaymentRecord,
} from "../accounts/loan-payment-detector.service";
import { todayYMD } from "../common/date-utils";
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
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
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

  it("excludes future-dated transactions from the inference query so they cannot distort the reconstructed balance (REV-20260803-024)", async () => {
    // A genuine monthly 5.5% history, same construction as the other tests,
    // so each payment's interestAmount/principalAmount are real amortization
    // splits rather than arbitrary numbers.
    const { records } = generateHistory(400000, [
      { annualRate: 5.5, payments: 24, paymentAmount: 2500 },
    ]);
    detector.buildPaymentRecords.mockResolvedValue(records);

    // Wire the REAL (pure, no-DB) buildRunningBalanceMap in place of a canned
    // balanceMap, so this test exercises the actual reconstruction that walks
    // backwards from account.currentBalance through whatever `transactions`
    // the service fetched -- the exact path the finding says was contaminated.
    const realDetector = new LoanPaymentDetectorService({} as never);
    detector.buildRunningBalanceMap.mockImplementation(
      (account: Account, transactions: Transaction[]) =>
        realDetector.buildRunningBalanceMap(account, transactions),
    );

    // The loan-side ledger only ever carries the principal leg (interest is a
    // separate split/expense that never touches the loan account itself),
    // matching how the real transactions the service fetches would look.
    const pastTransactions = records.map(
      (r, i) =>
        ({
          id: `past-${i}`,
          transactionDate: r.date,
          amount: r.principalAmount,
          status: TransactionStatus.CLEARED,
        }) as Transaction,
    );
    const finalBalance =
      400000 - records.reduce((sum, r) => sum + (r.principalAmount ?? 0), 0);
    rateChangesService.verifyLoanAccount.mockResolvedValue(
      makeAccount({ currentBalance: -finalBalance }),
    );

    // A future scheduled/split payment: excluded from currentBalance (which
    // never reflects future-dated transactions), but a large principal
    // reduction if it leaks into the reconstruction.
    const futureTransaction = {
      id: "future-1",
      transactionDate: "2099-01-01",
      amount: 100000,
      status: TransactionStatus.CLEARED,
    } as Transaction;

    // Stand in for the real query: honor an upper date bound when the
    // service supplies one (the fix), otherwise behave like the pre-fix
    // query and return every row regardless of date.
    transactionsRepository.find.mockImplementation(
      (options: { where?: { transactionDate?: FindOperator<string> } }) => {
        const dateOp = options?.where?.transactionDate;
        const all = [...pastTransactions, futureTransaction];
        if (
          dateOp instanceof FindOperator &&
          dateOp.type === "lessThanOrEqual"
        ) {
          expect(dateOp.value).toBe(todayYMD());
          return Promise.resolve(
            all.filter((t) => t.transactionDate <= dateOp.value),
          );
        }
        return Promise.resolve(all);
      },
    );

    const result = await service.detectAndPersist(userId, accountId);

    // Without the upper bound, the future $100,000 principal payment gets
    // "undone" from currentBalance and inflates every earlier reconstructed
    // balance, understating every inferred rate well below the true 5.5%.
    expect(result.created.length).toBeGreaterThan(0);
    const initial = createdRows()[0];
    expect(Math.abs(initial.annualRate - 5.5)).toBeLessThanOrEqual(0.05);
  });

  it("discards a rate observation whose interest pairSeparateInterest recovered from a future-dated expense (REV-20260803-024, second reopen)", async () => {
    // Three historical principal-only payments (interest booked as a
    // separate categorized expense, not a split leg). The first two have a
    // real, already-booked interest expense nearby; the latest genuinely has
    // none -- except a future-dated scheduled/recurring transaction in the
    // same category and source account, within pairSeparateInterest's own
    // (uncapped) 45-day tolerance of the latest payment.
    const today = todayYMD();
    const addDays = (dateKey: string, days: number): string => {
      const d = new Date(`${dateKey}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().split("T")[0];
    };

    const { records, balanceMap: canonicalBalanceMap } = generateHistory(
      400000,
      [{ annualRate: 5.5, payments: 3, paymentAmount: 2500 }],
    );
    // Spaced far apart (not the real monthly cadence) so that the earlier
    // payments' real interest evidence cannot coincidentally fall inside the
    // 45-day tolerance window around the latest, today-dated payment --
    // that would confound the scenario this test is isolating.
    const customDates = [addDays(today, -200), addDays(today, -100), today];
    const balanceMap = new Map<string, number>();
    const stripped: PaymentRecord[] = records.map((r, i) => {
      const date = customDates[i];
      balanceMap.set(date, canonicalBalanceMap.get(r.date)!);
      return {
        ...r,
        date,
        amount: r.principalAmount!,
        interestAmount: null,
      };
    });

    detector.buildPaymentRecords.mockResolvedValue(stripped);
    detector.buildRunningBalanceMap.mockReturnValue(balanceMap);
    rateChangesService.verifyLoanAccount.mockResolvedValue(
      makeAccount({ interestCategoryId: "cat-interest" }),
    );

    const realInterest = [
      records[0].interestAmount!,
      records[1].interestAmount!,
    ];
    // Stand-in for the real (buggy, pre-fix) pairSeparateInterest: it
    // recovers genuine interest for the first two payments and -- because
    // its own query window is bounded by `lastPaymentDate + 45 days` with no
    // cap at today -- also attaches an interest amount to the latest payment
    // that in reality came from a transaction dated in the future.
    const leakedInterest = 1800;
    detector.pairSeparateInterest.mockImplementation(
      async (
        _userId: string,
        _account: Account,
        consolidatedRecords: PaymentRecord[],
      ) =>
        consolidatedRecords.map((p, i) => {
          const interestAmount = i < 2 ? realInterest[i] : leakedInterest;
          return {
            ...p,
            amount: p.amount + interestAmount,
            interestAmount,
            interestCategoryId: "cat-interest",
          };
        }),
    );

    const realInterestTxn1 = {
      id: "int-1",
      transactionDate: customDates[0],
      categoryId: "cat-interest",
      accountId: "src-1",
      amount: realInterest[0],
      status: TransactionStatus.CLEARED,
    } as Transaction;
    const realInterestTxn2 = {
      id: "int-2",
      transactionDate: customDates[1],
      categoryId: "cat-interest",
      accountId: "src-1",
      amount: realInterest[1],
      status: TransactionStatus.CLEARED,
    } as Transaction;
    // The future-dated leak the reopened finding describes: within 45 days
    // of the latest payment (today), but dated after today, so it must never
    // be visible to a query bounded at today.
    const futureInterestTxn = {
      id: "int-future",
      transactionDate: addDays(today, 10),
      categoryId: "cat-interest",
      accountId: "src-1",
      amount: leakedInterest,
      status: TransactionStatus.CLEARED,
    } as Transaction;

    transactionsRepository.find.mockImplementation(
      (options: {
        where?: {
          categoryId?: string;
          transactionDate?: FindOperator<string>;
        };
      }) => {
        // The verification query added for this fix is the only one with a
        // `categoryId` clause; the main loan-account transaction query has
        // none, and its result is irrelevant here since buildPaymentRecords
        // and buildRunningBalanceMap are mocked directly above.
        if (options?.where?.categoryId) {
          const dateOp = options.where.transactionDate;
          const all = [realInterestTxn1, realInterestTxn2, futureInterestTxn];
          if (
            dateOp instanceof FindOperator &&
            dateOp.type === "lessThanOrEqual"
          ) {
            expect(dateOp.value).toBe(today);
            return Promise.resolve(
              all.filter((t) => t.transactionDate <= dateOp.value),
            );
          }
          return Promise.resolve(all);
        }
        return Promise.resolve([]);
      },
    );

    // Once the future-leaked interest is discarded, only 2 genuine
    // observations remain -- below MIN_USABLE_PAYMENTS -- so detection must
    // report insufficient data rather than persist a rate inferred in part
    // from a transaction that has not happened yet.
    await expect(service.detectAndPersist(userId, accountId)).rejects.toThrow(
      BadRequestException,
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it("rejects a future-derived pairing even when real evidence for an adjacent payment coincidentally falls within a wide tolerance window of the payment under test (REV-20260803-024, third reopen)", async () => {
    // Payments 30 days apart: today-60, today-30, today. Genuine interest
    // for the first two payments. The latest payment's recovered interest
    // comes only from a future-dated expense (today+1) that
    // pairSeparateInterest's own, uncapped-at-today window paired to it --
    // exactly like the second-reopen scenario above. What this test isolates
    // is the second pass's actual defect: its verification asked only "is
    // there ANY real, today-bounded interest expense within a fixed 45-day
    // window of THIS payment's date" rather than "is there real evidence
    // that is actually the nearest match to THIS payment". The genuine
    // expense for today-30 sits only 30 days from today's payment -- well
    // inside a fixed 45-day window -- even though it is the evidence for a
    // *different* payment (today-30's own) and has nothing to do with the
    // future-dated expense actually paired to today's payment. A correct
    // verification must attribute that evidence to today-30 (its true
    // nearest payment) and find nothing left over to corroborate today's.
    const today = todayYMD();
    const addDays = (dateKey: string, days: number): string => {
      const d = new Date(`${dateKey}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().split("T")[0];
    };

    const { records, balanceMap: canonicalBalanceMap } = generateHistory(
      400000,
      [{ annualRate: 5.5, payments: 3, paymentAmount: 2500 }],
    );
    const customDates = [addDays(today, -60), addDays(today, -30), today];
    const balanceMap = new Map<string, number>();
    const stripped: PaymentRecord[] = records.map((r, i) => {
      const date = customDates[i];
      balanceMap.set(date, canonicalBalanceMap.get(r.date)!);
      return {
        ...r,
        date,
        amount: r.principalAmount!,
        interestAmount: null,
      };
    });

    detector.buildPaymentRecords.mockResolvedValue(stripped);
    detector.buildRunningBalanceMap.mockReturnValue(balanceMap);
    rateChangesService.verifyLoanAccount.mockResolvedValue(
      makeAccount({ interestCategoryId: "cat-interest" }),
    );

    const realInterest = [
      records[0].interestAmount!,
      records[1].interestAmount!,
    ];
    // Stand-in for the real (buggy, pre-third-fix) pairSeparateInterest: it
    // recovers genuine interest for the first two payments and attaches a
    // future-derived amount to the latest one.
    const leakedInterest = 1800;
    detector.pairSeparateInterest.mockImplementation(
      async (
        _userId: string,
        _account: Account,
        consolidatedRecords: PaymentRecord[],
      ) =>
        consolidatedRecords.map((p, i) => {
          const interestAmount = i < 2 ? realInterest[i] : leakedInterest;
          return {
            ...p,
            amount: p.amount + interestAmount,
            interestAmount,
            interestCategoryId: "cat-interest",
          };
        }),
    );

    // Genuine, today-bounded interest expenses for the first two payments --
    // each dated exactly on its own payment, so a correct nearest-match
    // recomputation attributes it there and nowhere else.
    const realInterestTxn1 = {
      id: "int-1",
      transactionDate: customDates[0],
      categoryId: "cat-interest",
      accountId: "src-1",
      amount: realInterest[0],
      status: TransactionStatus.CLEARED,
    } as Transaction;
    const realInterestTxn2 = {
      id: "int-2",
      transactionDate: customDates[1],
      categoryId: "cat-interest",
      accountId: "src-1",
      amount: realInterest[1],
      status: TransactionStatus.CLEARED,
    } as Transaction;
    // Never returned by the today-bounded query: this is the actual leak,
    // dated the day after today.
    const futureInterestTxn = {
      id: "int-future",
      transactionDate: addDays(today, 1),
      categoryId: "cat-interest",
      accountId: "src-1",
      amount: leakedInterest,
      status: TransactionStatus.CLEARED,
    } as Transaction;

    transactionsRepository.find.mockImplementation(
      (options: {
        where?: {
          categoryId?: string;
          transactionDate?: FindOperator<string>;
        };
      }) => {
        if (options?.where?.categoryId) {
          const dateOp = options.where.transactionDate;
          const all = [realInterestTxn1, realInterestTxn2, futureInterestTxn];
          if (
            dateOp instanceof FindOperator &&
            dateOp.type === "lessThanOrEqual"
          ) {
            expect(dateOp.value).toBe(today);
            return Promise.resolve(
              all.filter((t) => t.transactionDate <= dateOp.value),
            );
          }
          return Promise.resolve(all);
        }
        return Promise.resolve([]);
      },
    );

    // A broad "any real evidence somewhere nearby" check would wrongly
    // validate today's payment off the today-30 evidence. The correct
    // per-payment nearest-match recomputation leaves today's payment
    // unverifiable, so only 2 genuine observations remain -- below
    // MIN_USABLE_PAYMENTS -- and detection must report insufficient data
    // rather than persist a rate inferred in part from a future transaction.
    await expect(service.detectAndPersist(userId, accountId)).rejects.toThrow(
      BadRequestException,
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it("keeps newPaymentAmount for a split segment even when a later segment books interest separately (REV-20260803-005)", async () => {
    // A history that starts with split $500 installments (interest as a
    // split leg, produced by generateHistory) and later changes to a plain
    // $450 principal transfer plus a separately categorized $50 interest
    // expense -- a real convention change mid-loan. The rate also steps
    // (5.5% -> 6.5%) so the two periods land in separate segments.
    const { records, balanceMap } = generateHistory(400000, [
      { annualRate: 5.5, payments: 12, paymentAmount: 500 },
      { annualRate: 6.5, payments: 12, paymentAmount: 500 },
    ]);

    const splitRecords = records.slice(0, 12);
    // The later payments arrive from buildPaymentRecords with no split leg
    // (interestAmount null) and an observed transfer amount that is
    // principal-only ($450), never the $500 full installment.
    const separateRawRecords = records.slice(12).map((r) => ({
      ...r,
      amount: 450,
      interestAmount: null,
      principalAmount: null,
    }));
    const rawRecords = [...splitRecords, ...separateRawRecords];

    detector.buildPaymentRecords.mockResolvedValue(rawRecords);
    // Simulate pairSeparateInterest recovering the separately booked interest
    // for the later payments (so they still yield a rate observation) while
    // leaving the observed `amount` at its principal-only value -- the
    // shape this service must not mistake for a normal, full installment.
    detector.pairSeparateInterest.mockImplementation(
      (
        _userId: string,
        _account: Account,
        consolidatedRecords: PaymentRecord[],
      ) =>
        Promise.resolve(
          consolidatedRecords.map((p, i) =>
            p.interestAmount != null
              ? p
              : { ...p, interestAmount: records[i].interestAmount },
          ),
        ),
    );
    detector.buildRunningBalanceMap.mockReturnValue(balanceMap);

    const result = await service.detectAndPersist(userId, accountId);

    expect(result.created).toHaveLength(2);
    const rows = createdRows();
    const splitSegmentRow = rows.find(
      (row) => row.effectiveDate === "2020-01-01",
    );
    const separateSegmentRow = rows.find(
      (row) => row.effectiveDate === "2021-01-01",
    );

    // The split-installment segment is unaffected by the later segment's
    // separate booking: its newPaymentAmount is still set normally.
    expect(splitSegmentRow?.newPaymentAmount).toBe(500);
    // The later segment's payments are principal-only subtotals, so its
    // newPaymentAmount must be suppressed, independent of the earlier
    // segment's (split) booking style.
    expect(separateSegmentRow?.newPaymentAmount).toBeNull();
  });
});
