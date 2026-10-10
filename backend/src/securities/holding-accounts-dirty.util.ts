import { EntityManager } from "typeorm";
import { lockAccountsForBalanceWrite } from "../common/db/locks";

/**
 * Advance `accounts.updated_at` on every account holding `securityId`, in the
 * caller's transaction, and return those account ids.
 *
 * A price write that moves no balance (a manual price, a bond-engine price)
 * leaves nothing for `NetWorthService.sweepStaleSnapshots` to find unless the
 * account row says it changed: that sweep recovers a lost post-commit recompute
 * from `updated_at > computed_at`. So the marker is written atomically with the
 * price, and the caller dispatches the debounced recompute for the returned
 * accounts after the commit (INV-CACHE-001).
 *
 * Account row locks are taken in ascending-id order before the UPDATE, as every
 * other account writer does (`common/db/locks.ts`), so two price writes over the
 * same holding accounts cannot deadlock (review MZ-1242, audit RV4-005). The
 * security is per-user, so every holder is an account of `userId`. The marker
 * is recovery and the debounce is latency; the one residual window of the
 * transaction-start timestamp is explained on
 * `SecurityPriceService.markHoldingAccountsDirty`.
 */
export async function markHoldingAccountsDirty(
  manager: EntityManager,
  securityId: string,
  userId: string,
): Promise<string[]> {
  const rows: Array<{ account_id: string }> = await manager.query(
    `SELECT DISTINCT account_id FROM investment_transactions
      WHERE security_id = $1 AND status != 'VOID'`,
    [securityId],
  );
  const accountIds = (rows ?? []).map((r) => r.account_id);
  if (accountIds.length > 0) {
    await lockAccountsForBalanceWrite(manager, accountIds, userId);
    await manager.query(
      `UPDATE accounts SET updated_at = now()
        WHERE id = ANY($1::UUID[]) AND user_id = $2`,
      [accountIds, userId],
    );
  }
  return accountIds;
}
