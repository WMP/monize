import { Repository } from "typeorm";
import { Transaction } from "../transactions/entities/transaction.entity";
import { TransactionSplit } from "../transactions/entities/transaction-split.entity";
import { BudgetCategory } from "./entities/budget-category.entity";

/**
 * Queries transaction and split spending for budget categories within a period.
 * Returns maps of categoryId -> totalSpent and transferAccountId -> totalSpent.
 *
 * Shared between BudgetsService and BudgetAlertService to avoid duplication.
 */
export async function queryCategorySpending(
  transactionsRepository: Repository<Transaction>,
  splitsRepository: Repository<TransactionSplit>,
  userId: string,
  budgetCategories: BudgetCategory[],
  periodStart: string,
  periodEnd: string,
): Promise<{
  spendingMap: Map<string, number>;
  transferSpendingMap: Map<string, number>;
}> {
  const categoryIds = budgetCategories
    .filter((bc) => bc.categoryId !== null)
    .map((bc) => bc.categoryId as string);

  const spendingMap = new Map<string, number>();
  const transferSpendingMap = new Map<string, number>();
  const transferBudgetCategories = budgetCategories.filter(
    (bc) => bc.isTransfer && bc.transferAccountId,
  );

  // Run all independent queries in parallel
  const queries: Promise<void>[] = [];

  if (categoryIds.length > 0) {
    queries.push(
      transactionsRepository
        .createQueryBuilder("t")
        .select("t.category_id", "categoryId")
        .addSelect("COALESCE(SUM(t.amount), 0)", "total")
        .where("t.user_id = :userId", { userId })
        .andWhere("t.category_id IN (:...categoryIds)", { categoryIds })
        .andWhere("t.transaction_date >= :periodStart", { periodStart })
        .andWhere("t.transaction_date <= :periodEnd", { periodEnd })
        .andWhere("t.status != :void", { void: "VOID" })
        .andWhere("t.is_split = false")
        .groupBy("t.category_id")
        .getRawMany()
        .then((rows) => {
          for (const row of rows) {
            spendingMap.set(row.categoryId, parseFloat(row.total || "0"));
          }
        }),
    );

    queries.push(
      splitsRepository
        .createQueryBuilder("s")
        .innerJoin("s.transaction", "t")
        .select("s.category_id", "categoryId")
        .addSelect("COALESCE(SUM(s.amount), 0)", "total")
        .where("t.user_id = :userId", { userId })
        .andWhere("s.category_id IN (:...categoryIds)", { categoryIds })
        .andWhere("t.transaction_date >= :periodStart", { periodStart })
        .andWhere("t.transaction_date <= :periodEnd", { periodEnd })
        .andWhere("t.status != :void", { void: "VOID" })
        .groupBy("s.category_id")
        .getRawMany()
        .then((rows) => {
          for (const row of rows) {
            const existing = spendingMap.get(row.categoryId) || 0;
            spendingMap.set(
              row.categoryId,
              existing + parseFloat(row.total || "0"),
            );
          }
        }),
    );
  }

  if (transferBudgetCategories.length > 0) {
    const transferAccountIds = transferBudgetCategories.map(
      (bc) => bc.transferAccountId as string,
    );

    queries.push(
      transactionsRepository
        .createQueryBuilder("t")
        .innerJoin("t.linkedTransaction", "lt")
        .select("lt.account_id", "destinationAccountId")
        .addSelect("COALESCE(ABS(SUM(t.amount)), 0)", "total")
        .where("t.user_id = :userId", { userId })
        .andWhere("t.is_transfer = true")
        .andWhere("t.amount < 0")
        .andWhere("lt.account_id IN (:...transferAccountIds)", {
          transferAccountIds,
        })
        .andWhere("t.transaction_date >= :periodStart", { periodStart })
        .andWhere("t.transaction_date <= :periodEnd", { periodEnd })
        .andWhere("t.status != :void", { void: "VOID" })
        .groupBy("lt.account_id")
        .getRawMany()
        .then((rows) => {
          for (const row of rows) {
            transferSpendingMap.set(
              row.destinationAccountId,
              (transferSpendingMap.get(row.destinationAccountId) ?? 0) +
                parseFloat(row.total || "0"),
            );
          }
        }),
    );

    // A transfer can also be one component of a split. The parent is a split
    // transaction rather than a transfer row, so the query above -- which keys
    // off `t.is_transfer` on the parent -- never saw it, and a savings or
    // debt-payment budget under-reported its progress by the whole transfer
    // whenever the user recorded it alongside a category on one line
    // (audit P5-007).
    //
    // The split row carries `transfer_account_id` directly, so no join to the
    // counterpart is needed: filtering on the split's own target cannot
    // double-count, because a counterpart row is not itself a split.
    queries.push(
      splitsRepository
        .createQueryBuilder("s")
        .innerJoin("s.transaction", "t")
        .select("s.transfer_account_id", "destinationAccountId")
        .addSelect("COALESCE(ABS(SUM(s.amount)), 0)", "total")
        .where("t.user_id = :userId", { userId })
        .andWhere("s.transfer_account_id IN (:...transferAccountIds)", {
          transferAccountIds,
        })
        // Outflows only, matching the parent query's `t.amount < 0`: a transfer
        // INTO the budgeted account is progress, one out of it is not.
        .andWhere("s.amount < 0")
        .andWhere("t.transaction_date >= :periodStart", { periodStart })
        .andWhere("t.transaction_date <= :periodEnd", { periodEnd })
        .andWhere("t.status != :void", { void: "VOID" })
        .groupBy("s.transfer_account_id")
        .getRawMany()
        .then((rows) => {
          for (const row of rows) {
            transferSpendingMap.set(
              row.destinationAccountId,
              (transferSpendingMap.get(row.destinationAccountId) ?? 0) +
                parseFloat(row.total || "0"),
            );
          }
        }),
    );
  }

  await Promise.all(queries);

  return { spendingMap, transferSpendingMap };
}

/** Resolves the display name for a budget category. */
export function resolveCategoryName(bc: BudgetCategory): string {
  if (bc.isTransfer && bc.transferAccountId) {
    return bc.transferAccount?.name || "Transfer";
  }
  const cat = bc.category;
  return cat
    ? cat.parent
      ? `${cat.parent.name}: ${cat.name}`
      : cat.name
    : "Uncategorized";
}

/**
 * Resolves the actual spent/earned amount for a budget category from the
 * spending maps.  The maps now contain signed net sums (expenses negative,
 * income positive).  We convert to a non-negative "spent" / "earned" value:
 *   - Expense categories: negate the sum so spending is positive, clamp to 0
 *     when refunds exceed spending.
 *   - Income categories: keep the positive sum, clamp to 0 when deductions
 *     exceed income.
 *   - Transfers: already filtered to outgoing (amount < 0), returned as a
 *     positive value by the query.
 */
export function resolveCategorySpent(
  bc: BudgetCategory,
  spendingMap: Map<string, number>,
  transferSpendingMap: Map<string, number>,
): number {
  if (bc.isTransfer && bc.transferAccountId) {
    return transferSpendingMap.get(bc.transferAccountId) || 0;
  }
  const raw = bc.categoryId ? spendingMap.get(bc.categoryId) || 0 : 0;
  return bc.isIncome ? Math.max(raw, 0) : Math.max(-raw, 0);
}
