import type { EntityManager } from "typeorm";
import { accrualErrors } from "../accruals/accrual-errors";
import { lockSourceFamily } from "../common/db/source-family-lock";
import type { ImportContext } from "./import-context";

const prepared = new WeakMap<
  EntityManager,
  { userId: string; ids: Set<string> }
>();
/** Per-import lock memo; preparation performs no ledger scan or row locking. */
export async function prepareImportAccrualSources(
  m: EntityManager,
  userId: string,
): Promise<Set<string>> {
  const previous = prepared.get(m);
  if (previous) {
    if (previous.userId !== userId) throw accrualErrors.conflict();
    return previous.ids;
  }
  // Presence is not a safe write fence: a first schedule can be created while
  // an import is running. Lock only actual matches, below, before checking them.
  const ids = new Set<string>();
  prepared.set(m, { userId, ids });
  return ids;
}

/** Existing matches and placeholders cannot lose/reprice an accrual without review. */
export async function assertImportAccrualIds(
  m: EntityManager,
  userId: string,
  ids: readonly (string | null | undefined)[],
): Promise<void> {
  const frozen = await prepareImportAccrualSources(m, userId);
  const selected = [...new Set(ids.filter((id): id is string => !!id))].sort();
  if (!selected.length) return;
  const pending = selected.filter((id) => !frozen.has(id));
  if (pending.length) {
    if (!(await lockSourceFamily(m, userId, pending)))
      throw accrualErrors.conflict();
    for (const id of pending) frozen.add(id);
  }

  // Fresh statement after source/parent locks: schedule creation uses those
  // same source locks, so an import cannot miss a schedule committed while queued.
  const schedules: { id: string }[] = await m.query(
    `SELECT a.id FROM accrual_schedules a JOIN transactions t ON t.id=a.source_transaction_id
     WHERE a.user_id=$1 AND (t.id=ANY($2::uuid[]) OR t.id IN
       (SELECT parent_transaction_id FROM transactions WHERE user_id=$1 AND id=ANY($2::uuid[])) OR t.id IN
       (SELECT transaction_id FROM transaction_splits WHERE linked_transaction_id=ANY($2::uuid[])))
     LIMIT 1`,
    [userId, selected],
  );
  if (schedules.length) throw accrualErrors.conflict();
}

export async function assertImportAccrualMatch(
  ctx: ImportContext,
  ids: readonly (string | null | undefined)[],
): Promise<void> {
  return assertImportAccrualIds(ctx.manager, ctx.userId, ids);
}
/** Only call immediately after saving a newly created source in this import. */
export function rememberImportedAccrualSource(
  m: EntityManager,
  userId: string,
  id: string,
): void {
  const state = prepared.get(m);
  if (state?.userId === userId) state.ids.add(id);
}

/** Review the date's transfer match cohort before creating payees or source rows. */
export async function assertImportAccrualEntry(
  ctx: ImportContext,
  row: {
    date: string;
    isTransfer?: boolean;
    category?: string;
    splits?: {
      isTransfer?: boolean;
      transferAccount?: string;
      category?: string;
    }[];
  },
): Promise<void> {
  const transfer =
    row.isTransfer ||
    (row.category && ctx.loanCategoryMap.has(row.category)) ||
    row.splits?.some(
      (line) =>
        line.isTransfer ||
        line.transferAccount ||
        (line.category && ctx.loanCategoryMap.has(line.category)),
    );
  if (!transfer) return;
  const candidates: { id: string; linked: string | null }[] =
    await ctx.manager.query(
      "SELECT id,linked_transaction_id AS linked FROM transactions WHERE user_id=$1 AND transaction_date=$2 AND is_transfer=true ORDER BY id",
      [ctx.userId, row.date],
    );
  await assertImportAccrualMatch(
    ctx,
    candidates.flatMap((candidate) => [candidate.id, candidate.linked]),
  );
}
