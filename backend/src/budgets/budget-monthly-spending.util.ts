import { EntityManager } from "typeorm";
import { Transaction } from "../transactions/entities/transaction.entity";
import { TransactionSplit } from "../transactions/entities/transaction-split.entity";
import { BudgetCategory } from "./entities/budget-category.entity";
import { getMonthEndYMD } from "../common/date-utils";
import {
  queryCategorySpending,
  resolveCategorySpent,
} from "./budget-spending.util";

/** What a per-month spending sweep knows, and what it could not convert. */
export interface MonthlyCategorySpent {
  /** categoryId -> calendar month (1-12) -> net spent in the budget currency. */
  byCategory: Map<string, Map<number, number>>;
  /** Categories with a month that had a row with no rate: a subtotal. */
  incompleteCategoryIds: Set<string>;
  /** `"JPY->CAD"` for each pair with no admissible rate, sorted. */
  missingRatePairs: string[];
}

/**
 * Net spent per category per calendar month over the 13 months ending with
 * `today`'s, through `queryCategorySpending` so the figure is the budget page's
 * own: signed net within the category, converted into the budget's currency,
 * the budget's excluded accounts left out, and a row with no rate reported
 * rather than added unconverted. A category with no row in a month has no entry
 * for it. Months run in turn on the caller's scoped manager (one connection).
 */
export async function queryMonthlyCategorySpent(
  m: EntityManager,
  userId: string,
  budgetCategories: BudgetCategory[],
  today: Date = new Date(),
): Promise<MonthlyCategorySpent> {
  const byCategory = new Map<string, Map<number, number>>();
  const incompleteCategoryIds = new Set<string>();
  const pairs = new Set<string>();

  for (let back = 12; back >= 0; back--) {
    const d = new Date(today.getFullYear(), today.getMonth() - back, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const spending = await queryCategorySpending(
      m.getRepository(Transaction),
      m.getRepository(TransactionSplit),
      userId,
      budgetCategories,
      start,
      getMonthEndYMD(year, month),
    );
    for (const pair of spending.missingRatePairs) pairs.add(pair);

    for (const bc of budgetCategories) {
      const catId = bc.categoryId;
      if (!catId) continue;
      const incomplete = spending.incompleteCategoryIds.has(catId);
      if (!spending.spendingMap.has(catId) && !incomplete) continue;
      if (incomplete) incompleteCategoryIds.add(catId);
      const monthMap = byCategory.get(catId) ?? new Map<number, number>();
      byCategory.set(catId, monthMap);
      monthMap.set(
        month,
        (monthMap.get(month) ?? 0) +
          resolveCategorySpent(
            bc,
            spending.spendingMap,
            spending.transferSpendingMap,
          ),
      );
    }
  }

  return {
    byCategory,
    incompleteCategoryIds,
    missingRatePairs: [...pairs].sort(),
  };
}
