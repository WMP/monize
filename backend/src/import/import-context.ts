import { EntityManager } from "typeorm";
import { Account } from "../accounts/entities/account.entity";
import { applyAccountBalanceDelta } from "../accounts/accounts.service";
import { roundMoney } from "../common/round.util";
import { TransactionRule } from "../transaction-rules/transaction-rule.entity";
import { ImportResultDto } from "./dto/import.dto";

export interface ImportContext {
  manager: EntityManager;
  userId: string;
  accountId: string;
  account: Account;
  categoryMap: Map<string, string | null>;
  accountMap: Map<string, string | null>;
  loanCategoryMap: Map<string, string>;
  securityMap: Map<string, string | null>;
  /** Maps tag name (case-insensitive key) to tag ID */
  tagMap: Map<string, string>;
  importStartTime: Date;
  dateCounters: Map<string, number>;
  affectedAccountIds: Set<string>;
  /**
   * The scheduled payments a `settle_loan_installment` rule claimed an
   * occurrence of; the import's post-processing reprices each template after
   * the commit (INV-CACHE-001).
   */
  settledScheduleIds: Set<string>;
  importResult: ImportResultDto;
  /** Tracks how many QIF entries with each transfer signature have been seen in the current block,
   *  used to distinguish genuinely different transfers that share date/amount/account. */
  transferDupCounts: Map<string, number>;
  /**
   * The user's enabled rules with trigger "import", loaded once per file by
   * the import service (design 6.3). Absent or empty means no rule runs.
   */
  importRules?: readonly TransactionRule[];
}

/**
 * Move an account's balance by `amount`, through the same atomic delta
 * statement every balance writer uses (`applyAccountBalanceDelta` in
 * `accounts/accounts.service.ts`; `docs/concurrency-and-idempotency.md`
 * section 2, row 1).
 *
 * One statement, so the read and the write cannot be interleaved: a second
 * delta committing in between composes instead of being overwritten, which a
 * `findOne` followed by an absolute `update` could not promise. The `UPDATE`
 * row-locks `accounts` exactly where the previous one did, so the import's lock
 * order (the `lockHoldingScope` advisory lock is the transaction's first
 * statement) is unchanged.
 *
 * The delta itself is rounded through `roundMoney` (4dp, the column's
 * precision); the sum is rounded by the database. A row that does not exist is
 * a no-op, as before.
 */
export async function updateAccountBalance(
  manager: EntityManager,
  accountId: string,
  amount: number,
): Promise<void> {
  const delta = roundMoney(Number(amount) || 0);
  await applyAccountBalanceDelta(manager, accountId, delta, {
    openOnly: false,
  });
}
