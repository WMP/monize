import { EntityManager } from "typeorm";

/**
 * The administrators that exist right now, with their rows locked for the rest
 * of the caller's transaction.
 *
 * "Never leave the instance with zero administrators" is an invariant over a
 * *set* of rows, and counting cannot enforce it. Two transactions each demoting
 * or deleting a different admin both count two and both proceed -- at any
 * isolation level below serializable, because neither sees the other's
 * uncommitted change. Putting the count in the same transaction as the mutation
 * does not help; only contending over the rows does.
 *
 * `FOR UPDATE` gives that contention. The second transaction blocks until the
 * first commits, and PostgreSQL then re-evaluates `role = 'admin'` against the
 * committed row, so a just-demoted or just-deleted admin drops out of the result
 * and the count the caller checks is the real one. A concurrently *added* admin
 * is a phantom this does not block, which is safe in the only direction that
 * matters: another administrator can never turn an allowed operation into one
 * that empties the set.
 *
 * Call this before reading the row being changed, so that read also sees the
 * committed outcome of whatever the lock waited for, and hold the transaction
 * until the mutation is written. A guard in one transaction and the delete in
 * the next is the same defect with extra steps: the lock is gone by then.
 *
 * @param manager the EntityManager of the ACTIVE transaction performing the
 *   mutation -- a lock taken in a transaction that then commits protects nothing.
 */
export async function lockAdminsForUpdate(
  manager: EntityManager,
): Promise<string[]> {
  const rows: Array<{ id: string }> = await manager.query(
    `SELECT id FROM users WHERE role = 'admin' FOR UPDATE`,
  );
  return rows.map((row) => row.id);
}

/**
 * True when removing this user's administrator status would leave none, given
 * the locked admin set. `adminIds` must come from `lockAdminsForUpdate` in the
 * same transaction.
 */
export function wouldRemoveLastAdmin(
  adminIds: string[],
  targetUserId: string,
): boolean {
  return adminIds.length <= 1 && adminIds.includes(targetUserId);
}
