import type { EntityManager } from "typeorm";
import { LEDGER_TOP_LEVEL_ONLY } from "../ledger-balance.sql";

/** Parent-first source locks. False means membership/role changed while queued; the caller must refuse before writing. */
export async function lockSourceFamily(
  m: EntityManager,
  userId: string,
  selected: readonly string[],
): Promise<boolean> {
  const ids = [...new Set(selected)].sort();
  if (!ids.length) return true;
  const scope = `(t.id=ANY($2::uuid[]) OR t.id IN (
    SELECT parent_transaction_id FROM transactions WHERE user_id=$1 AND id=ANY($2::uuid[])
    UNION SELECT transaction_id FROM transaction_splits WHERE linked_transaction_id=ANY($2::uuid[])))`;
  const locked = new Set<string>();
  for (const parent of [true, false]) {
    const rows: { id: string }[] = await m.query(
      `SELECT t.id FROM transactions t WHERE t.user_id=$1 AND ${scope} AND
       ${parent ? "" : "NOT "}(${LEDGER_TOP_LEVEL_ONLY} AND NOT EXISTS(SELECT 1 FROM transaction_splits leg_split WHERE leg_split.linked_transaction_id=t.id))
       ORDER BY t.id FOR UPDATE`,
      [userId, ids],
    );
    for (const row of rows) locked.add(row.id);
  }
  // Do not acquire a newly discovered parent after a leg. Retry instead.
  const required: { id: string }[] = await m.query(
    `SELECT t.id FROM transactions t WHERE t.user_id=$1 AND ${scope} ORDER BY t.id`,
    [userId, ids],
  );
  return (
    ids.every((id) => locked.has(id)) &&
    required.every((row) => locked.has(row.id))
  );
}
