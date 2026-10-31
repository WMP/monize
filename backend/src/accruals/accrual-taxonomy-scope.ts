import { categoryLockScope } from "../categories/category-lock-scope";
import type { EntityManager } from "typeorm";
import { lockSourceFamily } from "../common/db/source-family-lock";
import { equalAccrualSnapshots as same } from "./accrual-source-edit";
import { accrualErrors } from "./accrual-errors";

export interface TaxonomyScope {
  kind: "category" | "payee";
  ids: string[];
  sourceIds: string[];
  payeeIds: string[];
  scheduledIds: string[];
}
const sorted = (ids: readonly string[]) => [...new Set(ids)].sort();
async function discover(
  m: EntityManager,
  userId: string,
  kind: TaxonomyScope["kind"],
  ids: string[],
) {
  const sources: { id: string }[] = await m.query(
    kind === "payee"
      ? "SELECT id FROM transactions WHERE user_id=$1 AND payee_id=ANY($2::uuid[]) ORDER BY id"
      : "SELECT t.id FROM transactions t WHERE t.user_id=$1 AND (t.category_id=ANY($2::uuid[]) OR EXISTS(SELECT 1 FROM transaction_splits s WHERE s.transaction_id=t.id AND s.category_id=ANY($2::uuid[]))) ORDER BY t.id",
    [userId, ids],
  );
  const scheduled: { id: string }[] = await m.query(
    kind === "payee"
      ? "SELECT id FROM scheduled_transactions WHERE user_id=$1 AND payee_id=ANY($2::uuid[]) ORDER BY id"
      : "SELECT t.id FROM scheduled_transactions t WHERE t.user_id=$1 AND (t.category_id=ANY($2::uuid[]) OR EXISTS(SELECT 1 FROM scheduled_transaction_splits s WHERE s.scheduled_transaction_id=t.id AND s.category_id=ANY($2::uuid[]))) ORDER BY t.id",
    [userId, ids],
  );
  const payees: { id: string }[] =
    kind === "payee"
      ? ids.map((id) => ({ id }))
      : await m.query(
          "SELECT id FROM payees WHERE user_id=$1 AND default_category_id=ANY($2::uuid[]) ORDER BY id",
          [userId, ids],
        );
  return {
    sourceIds: sources.map((r) => r.id),
    scheduledIds: scheduled.map((r) => r.id),
    payeeIds: sorted(payees.map((r) => r.id)),
  };
}

/** Source parents, then legs, then affected FK targets; recheck membership on a fresh snapshot. */
export async function freezeTaxonomyScope(
  m: EntityManager,
  userId: string,
  kind: TaxonomyScope["kind"],
  selected: readonly string[],
  recorded?: TaxonomyScope,
  references?: { payeeIds: string[]; categoryIds: string[] },
): Promise<TaxonomyScope> {
  const ids = sorted(selected);
  const initial = await discover(m, userId, kind, ids);
  // Replay retains identities detached by the original operation. Parents of
  // selected legs are lock witnesses, not extra rows in the history payload.
  const sourceIds = sorted([
    ...initial.sourceIds,
    ...(recorded?.sourceIds ?? []),
  ]);
  if (!(await lockSourceFamily(m, userId, sourceIds)))
    throw accrualErrors.conflict();
  const payeeIds = sorted([
    ...initial.payeeIds,
    ...(recorded?.payeeIds ?? []),
    ...(references?.payeeIds ?? []),
  ]);
  await m.query(
    "SELECT id FROM payees WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
    [userId, payeeIds],
  );
  const categoryIds = sorted([
    ...(kind === "category" ? ids : []),
    ...(references?.categoryIds ?? []),
  ]);
  const graph: { id: string; parentId: string | null }[] = categoryIds.length
    ? await m.query(
        'SELECT id,parent_id AS "parentId" FROM categories WHERE user_id=$1 ORDER BY id',
        [userId],
      )
    : [];
  const categoryLocks = categoryLockScope(graph, categoryIds);
  await m.query(
    "SELECT id FROM categories WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
    [userId, categoryLocks],
  );
  if (categoryIds.length) {
    const freshGraph = await m.query(
      'SELECT id,parent_id AS "parentId" FROM categories WHERE user_id=$1 ORDER BY id',
      [userId],
    );
    if (!same(graph, freshGraph)) throw accrualErrors.conflict();
  }
  const scheduledIds = sorted([
    ...initial.scheduledIds,
    ...(recorded?.scheduledIds ?? []),
  ]);
  await m.query(
    "SELECT id FROM scheduled_transactions WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
    [userId, scheduledIds],
  );
  await m.query(
    "SELECT s.id FROM scheduled_transaction_splits s JOIN scheduled_transactions t ON t.id=s.scheduled_transaction_id WHERE t.user_id=$1 AND t.id=ANY($2::uuid[]) ORDER BY s.id FOR UPDATE OF s",
    [userId, scheduledIds],
  );
  await m.query(
    "SELECT id FROM payee_aliases WHERE user_id=$1 AND payee_id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
    [userId, payeeIds],
  );
  // FK KEY SHARE conflicts with the target locks: new references cannot slip
  // in after this check. Rows committed while locks queued must cause retry.
  const fresh = await discover(m, userId, kind, ids);
  if (!same(initial, fresh)) throw accrualErrors.conflict();
  return { kind, ids, ...fresh };
}
