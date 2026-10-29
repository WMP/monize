import { isUUID } from "class-validator";
import type { EntityManager } from "typeorm";
import { AccrualSchedule } from "./entities/accrual-schedule.entity";
import { findAccrual, writeAccrual, type StoredAccrual } from "./accrual-store";
import { loadAccrualSource, requireAccrualOwner } from "./accrual-source";
import { buildAccrualPlan, type AccrualPeriod } from "./accrual-allocation";
import {
  accrualContentFingerprint,
  type AccrualSourceSnapshot,
} from "./accrual-fingerprint";
import { canonical } from "./accrual-source-edit";
import {
  captureAccrualHistorySnapshots,
  readAccrualHistoryStates,
} from "./accrual-history-capture";
import { accrualErrors } from "./accrual-errors";

export interface AccrualHistoryState {
  version: 1;
  schedules: StoredAccrual[];
}
type Snapshot = Record<string, unknown>;

/** Caller holds the source row lock. Compact settings, never 600 allocation rows. */
export async function readAccrualHistoryState(
  m: EntityManager,
  userId: string,
  transactionId: string,
): Promise<AccrualHistoryState> {
  return (await readAccrualHistoryStates(m, userId, [transactionId])).get(
    transactionId,
  )!;
}

function stateFrom(value: unknown, transactionId: string): AccrualHistoryState {
  if (!value || typeof value !== "object") throw accrualErrors.conflict();
  const state = value as AccrualHistoryState;
  if (
    state.version !== 1 ||
    !Array.isArray(state.schedules) ||
    state.schedules.length > 100
  )
    throw accrualErrors.conflict();
  const components = new Set<string | null>();
  for (const row of state.schedules) {
    if (
      !row ||
      !isUUID(row.id) ||
      row.sourceTransactionId !== transactionId ||
      (row.sourceSplitId !== null && !isUUID(row.sourceSplitId)) ||
      !["income", "expense"].includes(row.family) ||
      !["LTM", "NTM", "CUSTOM"].includes(row.preset) ||
      (row.recognitionDateRule !== undefined &&
        !["MONTH_END", "FIRST_BUSINESS_DAY"].includes(
          row.recognitionDateRule,
        )) ||
      !/^[0-9]{4}-[0-9]{2}$/.test(row.startMonth) ||
      !Number.isInteger(row.monthCount) ||
      row.monthCount < 1 ||
      row.monthCount > 600 ||
      !Number.isInteger(row.revision) ||
      row.revision < 1 ||
      !/^[A-Z]{3}$/.test(row.currencyCode) ||
      !/^[a-f0-9]{64}$/.test(row.sourceFingerprint) ||
      components.has(row.sourceSplitId)
    )
      throw accrualErrors.conflict();
    components.add(row.sourceSplitId);
  }
  return state;
}

function periodOf(row: StoredAccrual): AccrualPeriod {
  return row.preset === "CUSTOM"
    ? {
        preset: "CUSTOM",
        startMonth: row.startMonth,
        monthCount: row.monthCount,
        dateRule: row.recognitionDateRule,
      }
    : { preset: row.preset, dateRule: row.recognitionDateRule };
}

/** Old buggy snapshots omitted the rule. Recover only a plan witnessed by its content hash. */
function historyPeriod(
  row: StoredAccrual,
  source: AccrualSourceSnapshot,
): AccrualPeriod {
  if (row.recognitionDateRule !== undefined) return periodOf(row);
  const matches = (["MONTH_END", "FIRST_BUSINESS_DAY"] as const).flatMap(
    (dateRule) => {
      const period = periodOf({ ...row, recognitionDateRule: dateRule });
      const plan = buildAccrualPlan(
        source.paymentDate,
        source.amount,
        source.currencyDecimals,
        period,
      );
      return accrualContentFingerprint(source, row.family, period, plan) ===
        row.sourceFingerprint
        ? [period]
        : [];
    },
  );
  if (matches.length !== 1) throw accrualErrors.conflict();
  return matches[0];
}

/** Refuse changed/recreated schedules and unmaintained source edits before writes. */
export async function assertAccrualHistoryState(
  m: EntityManager,
  userId: string,
  transactionId: string,
  expected: unknown,
): Promise<AccrualHistoryState> {
  const current = await readAccrualHistoryState(m, userId, transactionId);
  if (expected === undefined) {
    if (current.schedules.length) throw accrualErrors.conflict();
    return current; // Legacy cash-only history remains replayable.
  }
  const parsed = stateFrom(expected, transactionId);
  const prior = {
    ...parsed,
    schedules: parsed.schedules.map((row) => {
      if (row.recognitionDateRule !== undefined) return row;
      const matching = current.schedules.find(
        (value) =>
          value.id === row.id &&
          value.sourceFingerprint === row.sourceFingerprint,
      );
      return matching
        ? { ...row, recognitionDateRule: matching.recognitionDateRule }
        : row;
    }),
  };
  if (JSON.stringify(canonical(prior)) !== JSON.stringify(canonical(current)))
    throw accrualErrors.conflict();
  if (current.schedules.length) requireAccrualOwner(userId);
  for (const row of current.schedules) {
    const source = await loadAccrualSource(
      m,
      userId,
      transactionId,
      row.sourceSplitId,
      false,
      false,
    );
    const period = periodOf(row);
    const plan = buildAccrualPlan(
      source.snapshot.paymentDate,
      source.snapshot.amount,
      source.snapshot.currencyDecimals,
      period,
    );
    if (
      !source.kindEligible ||
      accrualContentFingerprint(
        source.snapshot,
        source.family ?? row.family,
        period,
        plan,
      ) !== row.sourceFingerprint
    )
      throw accrualErrors.conflict();
  }
  return current;
}

/** Capture exact money and split tags under the same source lock as the mutation. */
export async function captureAccrualHistorySnapshot(
  m: EntityManager,
  userId: string,
  transactionId: string,
  snapshot: Snapshot,
  force = false,
): Promise<void> {
  const row = (
    await captureAccrualHistorySnapshots(m, userId, [transactionId], force)
  ).get(transactionId);
  if (row) Object.assign(snapshot, row);
}

/** Existing transfer/investment history lacks a full structural restore contract. */
export function assertAccrualStructureRestorable(snapshot: Snapshot): void {
  const state =
    snapshot.accrualState === undefined
      ? undefined
      : stateFrom(snapshot.accrualState, String(snapshot.id));
  if (
    (snapshot.accrualExact || state?.schedules.length) &&
    Array.isArray(snapshot.splits) &&
    snapshot.splits.some(
      (line: Snapshot) =>
        (line.kind !== undefined && line.kind !== "category") ||
        line.linkedTransactionId,
    )
  )
    throw accrualErrors.conflict();
}

export async function restoreAccrualHistoryState(
  m: EntityManager,
  userId: string,
  transactionId: string,
  value: unknown,
): Promise<void> {
  if (value === undefined) return;
  const target = stateFrom(value, transactionId);
  const current = await readAccrualHistoryState(m, userId, transactionId);
  if (target.schedules.length || current.schedules.length)
    requireAccrualOwner(userId);
  const wanted = new Set(target.schedules.map((row) => row.sourceSplitId));
  for (const row of current.schedules) {
    if (!wanted.has(row.sourceSplitId))
      await m.delete(AccrualSchedule, { id: row.id, userId });
  }
  for (const row of target.schedules) {
    const source = await loadAccrualSource(
      m,
      userId,
      transactionId,
      row.sourceSplitId,
      false,
      false,
    );
    if (!source.kindEligible) throw accrualErrors.ineligible();
    if (source.snapshot.currencyCode !== row.currencyCode)
      throw accrualErrors.conflict();
    const family = source.family ?? row.family;
    const period = historyPeriod(row, source.snapshot);
    const plan = buildAccrualPlan(
      source.snapshot.paymentDate,
      source.snapshot.amount,
      source.snapshot.currencyDecimals,
      period,
    );
    const fingerprint = accrualContentFingerprint(
      source.snapshot,
      family,
      period,
      plan,
    );
    const existing = await findAccrual(
      m,
      userId,
      transactionId,
      row.sourceSplitId,
    );
    if (
      existing?.sourceFingerprint === fingerprint &&
      existing.preset === row.preset &&
      existing.startMonth === plan.startMonth &&
      existing.monthCount === plan.monthCount
    )
      continue;
    // Recreated schedules receive fresh IDs: an old preview cannot become valid again.
    await writeAccrual(
      m,
      userId,
      source.snapshot,
      family,
      period,
      plan,
      fingerprint,
      existing,
    );
  }
}

export async function restoreAccrualSplitTags(
  m: EntityManager,
  userId: string,
  transactionId: string,
  snapshot: Snapshot,
  requireAccrualSnapshot = true,
): Promise<void> {
  if (
    (requireAccrualSnapshot && !snapshot.accrualState) ||
    !Array.isArray(snapshot.splits)
  )
    return;
  for (const line of snapshot.splits as Snapshot[]) {
    if (!Array.isArray(line.tagIds) || !line.tagIds.length) continue;
    if (
      typeof line.id !== "string" ||
      !isUUID(line.id) ||
      line.tagIds.some((id) => typeof id !== "string" || !isUUID(id))
    )
      throw accrualErrors.conflict();
    const ids = [...new Set(line.tagIds)] as string[];
    const owned: { id: string }[] = await m.query(
      "SELECT id FROM tags WHERE user_id=$1 AND id=ANY($2)",
      [userId, ids],
    );
    if (owned.length !== ids.length) throw accrualErrors.conflict();
    await m.query(
      `INSERT INTO transaction_split_tags(transaction_split_id,tag_id)
       SELECT s.id,tag.id FROM transaction_splits s JOIN transactions t ON t.id=s.transaction_id
       CROSS JOIN tags tag WHERE t.id=$1 AND t.user_id=$2 AND s.id=$3 AND tag.user_id=$2 AND tag.id=ANY($4)
       ON CONFLICT DO NOTHING`,
      [transactionId, userId, line.id, ids],
    );
  }
}
