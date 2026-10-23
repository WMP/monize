import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { withScopedDb } from "../../common/db/scoped-db";
import { addDaysYMD, todayInTimezone } from "../../common/date-utils";
import { getEffectiveTimezoneOfUser } from "../../common/users-by-timezone.util";
import { Transaction } from "../../transactions/entities/transaction.entity";
import { TransactionAnalyticsService } from "../../transactions/transaction-analytics.service";
import { RecurringCharge } from "../../transactions/recurring-charges.util";

export interface CategorySpending {
  categoryName: string;
  categoryId: string | null;
  currentMonthTotal: number;
  previousMonthTotal: number;
  averageMonthlyTotal: number;
  monthCount: number;
  transactionCount: number;
}

export interface MonthlySpending {
  month: string;
  total: number;
  categoryBreakdown: Array<{
    categoryName: string;
    total: number;
  }>;
}

export { RecurringCharge };

export interface SpendingAggregates {
  categorySpending: CategorySpending[];
  monthlySpending: MonthlySpending[];
  recurringCharges: RecurringCharge[];
  totalSpendingCurrentMonth: number;
  totalSpendingPreviousMonth: number;
  averageMonthlySpending: number;
  daysElapsedInMonth: number;
  daysInMonth: number;
  currency: string;
}

/** First day of the month `delta` months from `ymd`'s month; pure string arithmetic. */
function firstOfMonthShifted(ymd: string, delta: number): string {
  const total = Number(ymd.slice(0, 4)) * 12 + (Number(ymd.slice(5, 7)) - 1);
  const shifted = total + delta;
  const year = Math.floor(shifted / 12);
  const month = (shifted % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

/** Days in the month of a `YYYY-MM-DD` string (UTC arithmetic on a zoneless date). */
function daysInMonthOf(ymd: string): number {
  return new Date(
    Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), 0),
  ).getUTCDate();
}

@Injectable()
export class InsightsAggregatorService {
  private readonly logger = new Logger(InsightsAggregatorService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly transactionAnalytics: TransactionAnalyticsService,
  ) {}

  async computeAggregates(
    userId: string,
    currency: string,
  ): Promise<SpendingAggregates> {
    // The user's financial today (A26-L29), never a local-midnight Date read
    // back in UTC: the month a person is in follows their own zone.
    const today = await withScopedDb(this.dataSource, async (manager) => {
      const timezone = await getEffectiveTimezoneOfUser(manager, userId);
      return (todayInTimezone(timezone) ?? todayInTimezone("UTC")) as string;
    });
    const currentMonthStart = `${today.slice(0, 7)}-01`;
    const sixMonthsAgo = firstOfMonthShifted(currentMonthStart, -6);
    const previousMonthStart = firstOfMonthShifted(currentMonthStart, -1);
    const previousMonthEnd = addDaysYMD(currentMonthStart, -1);

    const [categorySpending, monthlySpending, recurringCharges] =
      await Promise.all([
        this.getCategorySpending(
          userId,
          sixMonthsAgo,
          today,
          currentMonthStart,
          previousMonthStart,
          previousMonthEnd,
        ),
        this.getMonthlySpending(userId, sixMonthsAgo, today),
        this.transactionAnalytics.getRecurringCharges(
          userId,
          sixMonthsAgo,
          today,
        ),
      ]);

    const currentMonth = monthlySpending.find(
      (m) => m.month === currentMonthStart.substring(0, 7),
    );
    const previousMonthKey = previousMonthStart.substring(0, 7);
    const previousMonth = monthlySpending.find(
      (m) => m.month === previousMonthKey,
    );

    const totalSpendingCurrentMonth = currentMonth?.total ?? 0;
    const totalSpendingPreviousMonth = previousMonth?.total ?? 0;

    const completedMonths = monthlySpending.filter(
      (m) => m.month !== currentMonthStart.substring(0, 7),
    );
    const averageMonthlySpending =
      completedMonths.length > 0
        ? completedMonths.reduce((sum, m) => sum + m.total, 0) /
          completedMonths.length
        : 0;

    const daysElapsedInMonth = Number(today.slice(8, 10));
    const daysInMonth = daysInMonthOf(today);

    return {
      categorySpending,
      monthlySpending,
      recurringCharges,
      totalSpendingCurrentMonth,
      totalSpendingPreviousMonth,
      averageMonthlySpending,
      daysElapsedInMonth,
      daysInMonth,
      currency,
    };
  }

  private async getCategorySpending(
    userId: string,
    startDate: string,
    endDate: string,
    currentMonthStart: string,
    previousMonthStart: string,
    previousMonthEnd: string,
  ): Promise<CategorySpending[]> {
    const rows = await withScopedDb(this.dataSource, (manager) =>
      manager
        .getRepository(Transaction)
        .createQueryBuilder("t")
        .innerJoin("t.category", "cat")
        .select("cat.name", "categoryName")
        .addSelect("cat.id", "categoryId")
        .addSelect("SUM(ABS(t.amount))", "total")
        .addSelect("COUNT(*)", "txnCount")
        .addSelect(
          `SUM(CASE WHEN t.transactionDate >= :currentMonthStart THEN ABS(t.amount) ELSE 0 END)`,
          "currentMonthTotal",
        )
        .addSelect(
          `SUM(CASE WHEN t.transactionDate >= :previousMonthStart AND t.transactionDate <= :previousMonthEnd THEN ABS(t.amount) ELSE 0 END)`,
          "previousMonthTotal",
        )
        .addSelect(
          `COUNT(DISTINCT TO_CHAR(t.transactionDate, 'YYYY-MM'))`,
          "monthCount",
        )
        .where("t.userId = :userId", { userId })
        .andWhere("t.transactionDate >= :startDate", { startDate })
        .andWhere("t.transactionDate <= :endDate", { endDate })
        .andWhere("t.amount < 0")
        .andWhere("t.status != 'VOID'")
        .andWhere("t.isTransfer = false")
        .andWhere("t.parentTransactionId IS NULL")
        .setParameter("currentMonthStart", currentMonthStart)
        .setParameter("previousMonthStart", previousMonthStart)
        .setParameter("previousMonthEnd", previousMonthEnd)
        .groupBy("cat.id")
        .addGroupBy("cat.name")
        .orderBy("total", "DESC")
        .getRawMany(),
    );

    return rows.map((r) => ({
      categoryName: r.categoryName,
      categoryId: r.categoryId || null,
      currentMonthTotal: Number(r.currentMonthTotal) || 0,
      previousMonthTotal: Number(r.previousMonthTotal) || 0,
      averageMonthlyTotal:
        Number(r.monthCount) > 0 ? Number(r.total) / Number(r.monthCount) : 0,
      monthCount: Number(r.monthCount),
      transactionCount: Number(r.txnCount),
    }));
  }

  private async getMonthlySpending(
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<MonthlySpending[]> {
    const rows = await withScopedDb(this.dataSource, (manager) =>
      manager
        .getRepository(Transaction)
        .createQueryBuilder("t")
        .innerJoin("t.category", "cat")
        .select("TO_CHAR(t.transactionDate, 'YYYY-MM')", "month")
        .addSelect("cat.name", "categoryName")
        .addSelect("SUM(ABS(t.amount))", "total")
        .where("t.userId = :userId", { userId })
        .andWhere("t.transactionDate >= :startDate", { startDate })
        .andWhere("t.transactionDate <= :endDate", { endDate })
        .andWhere("t.amount < 0")
        .andWhere("t.status != 'VOID'")
        .andWhere("t.isTransfer = false")
        .andWhere("t.parentTransactionId IS NULL")
        .groupBy("TO_CHAR(t.transactionDate, 'YYYY-MM')")
        .addGroupBy("cat.name")
        .orderBy("month", "ASC")
        .getRawMany(),
    );

    const monthMap = new Map<
      string,
      { total: number; breakdown: Map<string, number> }
    >();

    for (const row of rows) {
      const existing = monthMap.get(row.month) || {
        total: 0,
        breakdown: new Map<string, number>(),
      };
      const amount = Number(row.total);
      existing.total += amount;
      existing.breakdown.set(
        row.categoryName,
        (existing.breakdown.get(row.categoryName) || 0) + amount,
      );
      monthMap.set(row.month, existing);
    }

    return Array.from(monthMap.entries()).map(([month, data]) => ({
      month,
      total: data.total,
      categoryBreakdown: Array.from(data.breakdown.entries())
        .map(([categoryName, total]) => ({ categoryName, total }))
        .sort((a, b) => b.total - a.total),
    }));
  }
}
