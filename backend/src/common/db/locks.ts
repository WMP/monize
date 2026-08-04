import { EntityManager } from "typeorm";

/**
 * The serialization primitives every writer of derived financial state shares.
 *
 * Two protocols maintain derived state in this codebase and they are not
 * compatible with each other:
 *
 *   1. an atomic delta -- `current_balance = current_balance + $1`;
 *   2. an absolute recomputation -- read the ledger, write the total.
 *
 * (1) is safe against another (1): the `UPDATE` re-reads the row after it wins
 * the row lock, so two deltas compose. (1) is *not* safe against (2): under
 * `READ COMMITTED` the recomputation's `SELECT` and its `UPDATE` are separate
 * statement snapshots, so a delta that commits between them is silently
 * overwritten with a total that never saw it (audit P4-005).
 *
 * The fix is not to pick one protocol -- it is to make every writer take the
 * same lock before it reads the inputs it will write back:
 *
 *   - `lockAccountsForBalanceWrite` for `accounts.current_balance`. A real row
 *     lock, which is what makes (1) and (2) compose: an absolute writer holding
 *     it forces a concurrent delta to wait, and the delta's `+ $1` then applies
 *     to the total the recomputation just committed. Conversely a recomputation
 *     that arrives second blocks on the row, and its ledger `SELECT` -- issued
 *     after the lock, so on a fresh snapshot -- sees the delta's ledger row.
 *
 *   - `lockHoldingScope` for `holdings`. A holding cannot always be row-locked
 *     (the row may not exist yet) and a rebuild must serialize against
 *     *investment_transactions inserts*, not just against holding rows, so the
 *     lock is an advisory one keyed by account.
 *
 *   - `lockTokenFamily` for a refresh-token family, whose members are inserted
 *     concurrently with the revocation that has to cover them (P4-011).
 *
 * Ordering rule, to keep these deadlock-free: **advisory locks are always taken
 * before row locks**, and a set of ids is always locked in ascending order.
 * `lockHoldingScope` and `lockAccountsForBalanceWrite` both sort; a caller that
 * needs both takes the advisory one first.
 *
 * Every helper takes an `EntityManager` and must be called inside a
 * `withScopedDb` callback -- `pg_advisory_xact_lock` and `FOR UPDATE` are both
 * released by the enclosing transaction, which is the point: there is no
 * unlock to forget.
 */

/**
 * Advisory-lock namespaces. The first `pg_advisory_xact_lock` argument, so two
 * different kinds of lock cannot collide on a hashed id.
 *
 * Values are permanent: changing one silently stops serializing against every
 * other replica still running the old code during a rolling deploy.
 */
export enum LockScope {
  /** All holdings and investment-ledger work for one account. */
  Holdings = 1,
  /** One refresh-token family (rotation vs. revocation). */
  TokenFamily = 2,
  /** One user's import slot, held across a destructive wipe + import. */
  UserImport = 3,
}

/**
 * Take a transaction-scoped advisory lock on `(scope, id)`.
 *
 * `hashtext` maps the uuid onto the int4 the second lock argument needs. A hash
 * collision costs two unrelated ids one shared lock -- extra waiting, never a
 * missed exclusion -- which is the right direction for the failure to go.
 */
export async function acquireAdvisoryLock(
  manager: EntityManager,
  scope: LockScope,
  id: string,
): Promise<void> {
  await manager.query("SELECT pg_advisory_xact_lock($1::int, hashtext($2))", [
    scope,
    id,
  ]);
}

/**
 * Take advisory locks on every id, in ascending order.
 *
 * The ordering is the deadlock guard: a transfer locking two accounts and a
 * rebuild locking the same two in the order the query returned them would
 * otherwise be able to hold one another's next lock.
 */
export async function acquireAdvisoryLocks(
  manager: EntityManager,
  scope: LockScope,
  ids: readonly string[],
): Promise<void> {
  const ordered = [...new Set(ids)].sort();
  for (const id of ordered) {
    await acquireAdvisoryLock(manager, scope, id);
  }
}

/**
 * Serialize all holdings work for these accounts against every other holdings
 * writer -- incremental trades, splits, transfers and full rebuilds alike.
 *
 * A rebuild reads the investment ledger and then replaces the holdings derived
 * from it. A row lock on `holdings` cannot protect that: the trade it must not
 * lose inserts an `investment_transactions` row, which no holdings row locks.
 * So both sides take this lock before their first read instead.
 */
export function lockHoldingScope(
  manager: EntityManager,
  accountIds: readonly string[],
): Promise<void> {
  return acquireAdvisoryLocks(manager, LockScope.Holdings, accountIds);
}

/** Serialize refresh-token rotation against family revocation. */
export function lockTokenFamily(
  manager: EntityManager,
  familyId: string,
): Promise<void> {
  return acquireAdvisoryLock(manager, LockScope.TokenFamily, familyId);
}

/**
 * Row-lock these accounts for a balance write, in ascending id order.
 *
 * Call this as the first statement of a transaction that will compute a balance
 * from the ledger and write it back absolutely. Holding it from before the
 * ledger `SELECT` until commit is what stops an atomic delta committing into
 * the gap; see the protocol note at the top of this file.
 *
 * Returns nothing: the lock is the effect. Rows that do not exist are simply
 * not locked, and the caller's own `NotFound` handling still applies.
 */
export async function lockAccountsForBalanceWrite(
  manager: EntityManager,
  accountIds: readonly string[],
): Promise<void> {
  const ordered = [...new Set(accountIds)].sort();
  if (ordered.length === 0) return;
  await manager.query(
    `SELECT id FROM accounts WHERE id = ANY($1) ORDER BY id FOR UPDATE`,
    [ordered],
  );
}

/**
 * Row-lock one transaction and return the columns a balance delta is derived
 * from, or null when it is gone or not this user's.
 *
 * The whole point of this helper is *where* it is called: inside the write
 * transaction, so the "old" amount a delta reverses is the version the write
 * actually replaces. A snapshot loaded before the transaction is a different
 * claim -- that nothing changed in between -- and two concurrent updates each
 * reversing the same stale amount is the corruption in P4-003.
 */
export interface LockedTransactionRow {
  id: string;
  accountId: string;
  amount: number;
  transactionDate: string;
  status: string | null;
  isSplit: boolean;
  linkedTransactionId: string | null;
  parentTransactionId: string | null;
  /**
   * The parent's payee, carried for the same reason as `accountId` and
   * `transactionDate`: a split's transfer counterpart and its embedded
   * investment rows are *built* from the parent's fields, so building them from
   * the caller's snapshot writes a counterpart describing a parent that has
   * since moved account, date or payee (audit FV4-002).
   */
  payeeId: string | null;
  payeeName: string | null;
}

export async function lockTransactionRow(
  manager: EntityManager,
  id: string,
  userId: string,
): Promise<LockedTransactionRow | null> {
  const rows: {
    id: string;
    account_id: string;
    amount: string;
    transaction_date: string;
    status: string | null;
    is_split: boolean;
    linked_transaction_id: string | null;
    parent_transaction_id: string | null;
    payee_id: string | null;
    payee_name: string | null;
  }[] = await manager.query(
    `SELECT id,
            account_id,
            amount,
            TO_CHAR(transaction_date, 'YYYY-MM-DD') AS transaction_date,
            status,
            COALESCE(is_split, false) AS is_split,
            linked_transaction_id,
            parent_transaction_id,
            payee_id,
            payee_name
       FROM transactions
      WHERE id = $1 AND user_id = $2
        FOR UPDATE`,
    [id, userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    amount: Number(row.amount),
    transactionDate: row.transaction_date,
    status: row.status,
    isSplit: row.is_split,
    linkedTransactionId: row.linked_transaction_id,
    parentTransactionId: row.parent_transaction_id,
    payeeId: row.payee_id,
    payeeName: row.payee_name,
  };
}

/**
 * Row-lock several transactions at once, ascending by id, and return what was
 * found keyed by id. Missing ids are simply absent -- a bulk caller has to
 * decide whether that is a 404 or a row another request already deleted.
 */
export async function lockTransactionRows(
  manager: EntityManager,
  ids: readonly string[],
  userId: string,
): Promise<Map<string, LockedTransactionRow>> {
  const ordered = [...new Set(ids)].sort();
  const found = new Map<string, LockedTransactionRow>();
  if (ordered.length === 0) return found;
  const rows: {
    id: string;
    account_id: string;
    amount: string;
    transaction_date: string;
    status: string | null;
    is_split: boolean;
    linked_transaction_id: string | null;
    parent_transaction_id: string | null;
    payee_id: string | null;
    payee_name: string | null;
  }[] = await manager.query(
    `SELECT id,
            account_id,
            amount,
            TO_CHAR(transaction_date, 'YYYY-MM-DD') AS transaction_date,
            status,
            COALESCE(is_split, false) AS is_split,
            linked_transaction_id,
            parent_transaction_id,
            payee_id,
            payee_name
       FROM transactions
      WHERE id = ANY($1) AND user_id = $2
      ORDER BY id
        FOR UPDATE`,
    [ordered, userId],
  );
  for (const row of rows) {
    found.set(row.id, {
      id: row.id,
      accountId: row.account_id,
      amount: Number(row.amount),
      transactionDate: row.transaction_date,
      status: row.status,
      isSplit: row.is_split,
      linkedTransactionId: row.linked_transaction_id,
      parentTransactionId: row.parent_transaction_id,
      payeeId: row.payee_id,
      payeeName: row.payee_name,
    });
  }
  return found;
}
