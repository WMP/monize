import {
  saveRequiredAccrualHistory,
  replaceAccrualHistorySide,
} from "./accrual-history-storage";
import { captureAccrualHistorySnapshots } from "./accrual-history-capture";
import { requireAccrualOwner } from "./accrual-source";
import { type EntityManager } from "typeorm";
import { ActionHistory } from "../action-history/entities/action-history.entity";
import { Category } from "../categories/entities/category.entity";
import { Payee } from "../payees/entities/payee.entity";
import { PayeeAlias } from "../payees/entities/payee-alias.entity";
import { Transaction } from "../transactions/entities/transaction.entity";
import { TransactionSplit } from "../transactions/entities/transaction-split.entity";
import { ScheduledTransaction } from "../scheduled-transactions/entities/scheduled-transaction.entity";
import { ScheduledTransactionSplit } from "../scheduled-transactions/entities/scheduled-transaction-split.entity";
import { assertReconciledRowsMutable } from "../transactions/reconciled-lock.util";
import {
  assertAccrualHistoryState,
  restoreAccrualHistoryState,
} from "./accrual-history-snapshot";
import { equalAccrualSnapshots as same } from "./accrual-source-edit";
import { accrualErrors } from "./accrual-errors";

type Row = Record<string, any>;
import {
  freezeTaxonomyScope,
  type TaxonomyScope as Scope,
} from "./accrual-taxonomy-scope";
export interface TaxonomyOperation {
  version: 2;
  scope: Scope;
  categories: Row[];
  payees: Row[];
  aliases: Row[];
  sources: Row[];
  scheduled: Row[];
  scheduledSplits: Row[];
}
async function capture(
  m: EntityManager,
  userId: string,
  scope: Scope,
): Promise<TaxonomyOperation> {
  const raw = async (table: string, ids: string[]) =>
    (
      await m.query(
        `SELECT to_jsonb(r)-'updated_at' AS row FROM ${table} r WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY id`,
        [userId, ids],
      )
    ).map((r: { row: Row }) => r.row);
  const categories =
    scope.kind === "category" ? await raw("categories", scope.ids) : [];
  const payees = await raw("payees", scope.payeeIds);
  const aliases = (
    await m.query(
      "SELECT to_jsonb(a) AS row FROM payee_aliases a WHERE user_id=$1 AND payee_id=ANY($2::uuid[]) ORDER BY id",
      [userId, scope.payeeIds],
    )
  ).map((r: { row: Row }) => r.row);
  const scheduled = await raw("scheduled_transactions", scope.scheduledIds);
  const scheduledSplits = (
    await m.query(
      "SELECT to_jsonb(s) AS row FROM scheduled_transaction_splits s JOIN scheduled_transactions t ON t.id=s.scheduled_transaction_id WHERE t.user_id=$1 AND t.id=ANY($2::uuid[]) ORDER BY s.id",
      [userId, scope.scheduledIds],
    )
  ).map((r: { row: Row }) => r.row);
  const sources = [
    ...(
      await captureAccrualHistorySnapshots(m, userId, scope.sourceIds, true)
    ).values(),
  ];
  const state = JSON.parse(
    JSON.stringify({
      version: 2,
      scope,
      categories,
      payees,
      aliases,
      sources,
      scheduled,
      scheduledSplits,
    }),
  ) as TaxonomyOperation;
  return state;
}
export async function beginTaxonomyOperation(
  m: EntityManager,
  userId: string,
  kind: Scope["kind"],
  selected: string[],
): Promise<TaxonomyOperation | undefined> {
  // Lock affected sources even with no schedules: a first schedule may be
  // committed while those locks queue. Never reuse an earlier absence probe.
  const scope = await freezeTaxonomyScope(m, userId, kind, selected);
  const affected = await m.query(
    "SELECT id FROM accrual_schedules WHERE user_id=$1 AND source_transaction_id=ANY($2::uuid[]) LIMIT 1",
    [userId, scope.sourceIds],
  );
  if (affected.length) requireAccrualOwner(userId);
  // Preserve versioned undo for ordinary taxonomy changes alongside existing
  // accruals, without making unrelated schedules an owner-only write fence.
  const accrued = affected.length
    ? affected
    : await m.query(
        "SELECT id FROM accrual_schedules WHERE user_id=$1 LIMIT 1",
        [userId],
      );
  if (!accrued.length) return undefined;
  const state = await capture(m, userId, scope);
  return state;
}
export async function recordTaxonomyOperation(
  m: EntityManager,
  userId: string,
  before: TaxonomyOperation | undefined,
): Promise<void> {
  if (!before) return;
  const after = await capture(m, userId, before.scope);
  const repo = m.getRepository(ActionHistory);
  await repo.delete({ userId, isUndone: true });
  await saveRequiredAccrualHistory(m, {
    userId,
    entityType: "accrual_relationship_operation",
    entityId: before.scope.ids[0],
    action: "update",
    beforeData: { taxonomyOperation: before },
    afterData: { taxonomyOperation: after },
    description: `Updated ${before.scope.kind} relationships`,
    descriptionKey:
      before.scope.kind === "payee" ? "updatedPayee" : "updatedCategory",
    descriptionParams: {
      name: String(before.payees[0]?.name ?? before.categories[0]?.name ?? ""),
    },
  });
}
function parse(value: unknown, action: ActionHistory): TaxonomyOperation {
  const s = value as TaxonomyOperation;
  if (
    !s ||
    s.version !== 2 ||
    !s.scope ||
    !["category", "payee"].includes(s.scope.kind)
  )
    throw accrualErrors.conflict();
  for (const key of ["ids", "sourceIds", "payeeIds", "scheduledIds"] as const) {
    const ids = s.scope[key];
    if (
      !Array.isArray(ids) ||
      !ids.every((id) => typeof id === "string") ||
      !same(ids, [...new Set(ids)].sort())
    )
      throw accrualErrors.conflict();
  }
  for (const key of [
    "categories",
    "payees",
    "aliases",
    "sources",
    "scheduled",
    "scheduledSplits",
  ] as const)
    if (!Array.isArray(s[key])) throw accrualErrors.conflict();
  for (const row of [
    ...s.categories,
    ...s.payees,
    ...s.aliases,
    ...s.scheduled,
  ])
    if (row.user_id !== action.userId) throw accrualErrors.conflict();
  if (
    !same(
      s.sources.map((r) => r.id),
      s.scope.sourceIds,
    )
  )
    throw accrualErrors.conflict();
  return s;
}
function fields(m: EntityManager, entity: any, row: Row): Row {
  const result: Row = {};
  for (const col of m.getRepository(entity).metadata.columns)
    if (col.databaseName in row)
      result[col.propertyName] = row[col.databaseName];
  return result;
}
/** PostgreSQL parses its own timestamp text without JavaScript millisecond truncation. */
async function insertExact(
  m: EntityManager,
  table: "categories" | "payees" | "payee_aliases",
  row: Row,
): Promise<void> {
  await m.query(
    `INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table}, $1::jsonb)`,
    [JSON.stringify(row)],
  );
}

/** Restore only relationships and settings. Financial source fields are comparison witnesses, never replayed. */
export async function replayTaxonomyOperation(
  m: EntityManager,
  action: ActionHistory,
): Promise<void> {
  const target = parse(action.beforeData?.taxonomyOperation, action),
    expected = parse(action.afterData?.taxonomyOperation, action);
  if (!same(target.scope, expected.scope)) throw accrualErrors.conflict();
  const scope = target.scope;
  const refs = await freezeTaxonomyScope(
    m,
    action.userId,
    scope.kind,
    scope.ids,
    scope,
    {
      payeeIds: target.sources
        .flatMap((r) => (r.payeeId ? [r.payeeId] : []))
        .concat(
          target.scheduled.flatMap((r) => (r.payee_id ? [r.payee_id] : [])),
        ),
      categoryIds: target.categories
        .flatMap((r) => (r.parent_id ? [r.parent_id] : []))
        .concat(
          target.payees.flatMap((r) =>
            r.default_category_id ? [r.default_category_id] : [],
          ),
        )
        .concat(
          target.sources.flatMap((r) =>
            [
              r.categoryId,
              ...(r.splits ?? []).map((s: Row) => s.categoryId),
            ].filter(Boolean),
          ),
        )
        .concat(
          target.scheduled.flatMap((r) =>
            r.category_id ? [r.category_id] : [],
          ),
        )
        .concat(
          target.scheduledSplits.flatMap((r) =>
            r.category_id ? [r.category_id] : [],
          ),
        ),
    },
  );
  for (const key of ["sourceIds", "scheduledIds", "payeeIds"] as const)
    if (refs[key].some((id) => !scope[key].includes(id)))
      throw accrualErrors.conflict();
  if (!same(await capture(m, action.userId, scope), expected))
    throw accrualErrors.conflict();
  const locked: { id: string; status: string; isSplit: boolean }[] =
    await m.query(
      'SELECT id,status,is_split AS "isSplit" FROM transactions WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',
      [action.userId, scope.sourceIds],
    );
  if (locked.length !== scope.sourceIds.length) throw accrualErrors.conflict();
  await assertReconciledRowsMutable(m, action.userId, locked);
  for (const row of expected.sources)
    await assertAccrualHistoryState(m, action.userId, row.id, row.accrualState);
  // Validate all external references before writes; recreated roots are the only permitted missing targets.
  const categoryIds = new Set<string>(),
    payeeIds = new Set<string>();
  for (const row of target.categories)
    if (row.parent_id) categoryIds.add(row.parent_id);
  for (const row of target.payees)
    if (row.default_category_id) categoryIds.add(row.default_category_id);
  for (const row of target.sources) {
    if (row.categoryId) categoryIds.add(row.categoryId);
    if (row.payeeId) payeeIds.add(row.payeeId);
    for (const line of row.splits ?? [])
      if (line.categoryId) categoryIds.add(line.categoryId);
  }
  for (const row of target.scheduled) {
    if (row.category_id) categoryIds.add(row.category_id);
    if (row.payee_id) payeeIds.add(row.payee_id);
  }
  for (const row of target.scheduledSplits)
    if (row.category_id) categoryIds.add(row.category_id);
  const cats: Row[] = await m.query(
    "SELECT id,is_income,parent_id FROM categories WHERE user_id=$1 ORDER BY id",
    [action.userId],
  );
  const projected = new Map(
    cats
      .filter((r) => !scope.ids.includes(r.id) || scope.kind !== "category")
      .map((r) => [r.id, r]),
  );
  for (const row of target.categories) projected.set(row.id, row);
  const existingPayees: Row[] = await m.query(
    "SELECT id FROM payees WHERE user_id=$1",
    [action.userId],
  );
  const projectedPayees = new Set(
    existingPayees
      .filter((r) => !scope.payeeIds.includes(r.id))
      .map((r) => r.id),
  );
  for (const row of target.payees) projectedPayees.add(row.id);
  if (
    [...categoryIds].some((id) => !projected.has(id)) ||
    [...payeeIds].some((id) => !projectedPayees.has(id))
  )
    throw accrualErrors.conflict();
  for (const row of projected.values()) {
    const seen = new Set<string>();
    let current: Row | undefined = row;
    while (current?.parent_id) {
      if (seen.has(current.id) || !projected.has(current.parent_id))
        throw accrualErrors.conflict();
      seen.add(current.id);
      current = projected.get(current.parent_id);
    }
  }
  for (const source of target.sources)
    for (const schedule of source.accrualState?.schedules ?? []) {
      const categoryId = schedule.sourceSplitId
        ? source.splits?.find((r: Row) => r.id === schedule.sourceSplitId)
            ?.categoryId
        : source.categoryId;
      if (
        categoryId &&
        (projected.get(categoryId)?.is_income ? "income" : "expense") !==
          schedule.family
      )
        throw accrualErrors.conflict();
    }
  const saveRoots = async (entity: any, rows: Row[], existing: Row[]) => {
    const pending = [...rows];
    while (pending.length) {
      const i = pending.findIndex(
        (row) => !row.parent_id || !pending.some((p) => p.id === row.parent_id),
      );
      if (i < 0) throw accrualErrors.conflict();
      const row = pending.splice(i, 1)[0],
        data = fields(m, entity, row);
      if (existing.some((r) => r.id === row.id)) {
        delete data.id;
        delete data.userId;
        delete data.createdAt;
        await m.update(entity, { id: row.id, userId: action.userId }, data);
      } else
        await insertExact(
          m,
          entity === Category ? "categories" : "payees",
          row,
        );
    }
  };
  await saveRoots(Category, target.categories, expected.categories);
  await saveRoots(Payee, target.payees, expected.payees);
  for (const row of target.sources) {
    await m.update(
      Transaction,
      { id: row.id, userId: action.userId },
      {
        categoryId: row.categoryId,
        payeeId: row.payeeId,
        payeeName: row.payeeName,
      },
    );
    for (const line of row.splits ?? [])
      await m.update(
        TransactionSplit,
        { id: line.id, transactionId: row.id },
        { categoryId: line.categoryId },
      );
    await restoreAccrualHistoryState(
      m,
      action.userId,
      row.id,
      row.accrualState,
    );
  }
  for (const row of target.scheduled)
    await m.update(
      ScheduledTransaction,
      { id: row.id, userId: action.userId },
      {
        categoryId: row.category_id,
        payeeId: row.payee_id,
        payeeName: row.payee_name,
      },
    );
  for (const row of target.scheduledSplits)
    await m.update(
      ScheduledTransactionSplit,
      { id: row.id, scheduledTransactionId: row.scheduled_transaction_id },
      { categoryId: row.category_id },
    );
  for (const row of expected.aliases)
    await m.delete(PayeeAlias, { id: row.id, userId: action.userId });
  for (const row of target.aliases) await insertExact(m, "payee_aliases", row);
  for (const row of expected.payees)
    if (!target.payees.some((r) => r.id === row.id))
      await m.delete(Payee, { id: row.id, userId: action.userId });
  for (const row of expected.categories)
    if (!target.categories.some((r) => r.id === row.id))
      await m.delete(Category, { id: row.id, userId: action.userId });
  const actual = await capture(m, action.userId, scope);
  const side = action.isUndone ? "afterData" : "beforeData";
  await replaceAccrualHistorySide(m, action, side, {
    taxonomyOperation: actual,
  });
}
