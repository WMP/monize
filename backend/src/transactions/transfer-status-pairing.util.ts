import { EntityManager, In } from "typeorm";
import { Transaction, TransactionStatus } from "./entities/transaction.entity";
import { TransactionSplit } from "./entities/transaction-split.entity";

export interface TransferStatusExpansion {
  /** Every transaction whose status the caller should write. */
  ids: string[];
  /** Ids the caller must NOT write, because their pair cannot be kept in step. */
  refusedIds: string[];
  /** Human-readable summary lines, one per refusal reason. */
  reasons: string[];
}

/**
 * True when moving a row from `from` to `to` crosses the `VOID` boundary.
 *
 * This is the only status transition that is pair-wide, and the distinction is
 * the whole point of this module -- see `expandTransferLegsForStatus`.
 */
export function crossesVoidBoundary(
  from: TransactionStatus | null | undefined,
  to: TransactionStatus,
): boolean {
  return (from === TransactionStatus.VOID) !== (to === TransactionStatus.VOID);
}

/**
 * Expand a set of transaction ids to the transfer legs that must change status
 * with them -- and only for the transition where that is true.
 *
 * **`VOID` is economic; `CLEARED` and `RECONCILED` are not.** A linked transfer is
 * one economic event, so entering or leaving `VOID` moves both balances and has to
 * land on both legs or on neither: voiding only the source leg restores the source
 * balance while the destination leg stays active, so 1,000.00 across two accounts
 * becomes 1,100.00.
 *
 * `CLEARED`, `RECONCILED` and `reconciledDate` say something different -- whether
 * *that account's* bank statement has recognised *that leg*. The two statements
 * arrive separately and often in different months, and the rest of the codebase
 * already treats this as per-account: `unreconcile` writes one row,
 * `bulkReconcile` filters by `accountId`, and the cross-owner transfer path strips
 * `status` from a foreign leg as "per-ledger reconciliation state". Copying
 * `RECONCILED` onto the counterpart removes a transfer from the other account's
 * reconciliation candidates before its statement contains it, and puts the source
 * account's statement date on the destination leg as though it had been reconciled
 * there.
 *
 * So pairing keys on the transition, not on the fact that a row is a transfer leg.
 * A row whose voidness does not change is returned untouched, with no counterpart
 * and no refusal.
 *
 * For a row that does cross the boundary:
 * - A plain transfer leg brings its mirror leg.
 * - A selected split parent brings the counterpart legs of its transfer splits.
 * - A split-transfer leg is **refused**: its `linkedTransactionId` names the split
 *   parent, not a mirror leg, so pairing it here would void the parent. Change it
 *   through the split instead.
 * - A leg whose counterpart the caller cannot write (a cross-owner transfer) is
 *   **refused**: one-ledger semantics on a paired transfer is the defect.
 *
 * Shared by the bulk-update path and the single-transaction status endpoint,
 * because a rule enforced by only one of them is not a rule -- the bulk path was
 * fixed first and the single endpoint kept producing one-legged voids.
 */
export async function expandTransferLegsForStatus(
  m: EntityManager,
  userId: string,
  ids: string[],
  targetStatus: TransactionStatus,
): Promise<TransferStatusExpansion> {
  if (ids.length === 0) {
    return { ids: [], refusedIds: [], reasons: [] };
  }

  const repo = m.getRepository(Transaction);
  const rows = await repo
    .createQueryBuilder("t")
    .select([
      "t.id",
      "t.linkedTransactionId",
      "t.isTransfer",
      "t.isSplit",
      "t.status",
    ])
    .where("t.id IN (:...ids)", { ids })
    .andWhere("t.userId = :userId", { userId })
    .getMany();

  // Only a VOID boundary is pair-wide. Everything else is this account's own
  // statement state and stays on the row the caller named.
  const crossing = rows.filter((r) =>
    crossesVoidBoundary(r.status, targetStatus),
  );
  if (crossing.length === 0) {
    return { ids: [...ids], refusedIds: [], reasons: [] };
  }

  const legs = crossing.filter((r) => r.isTransfer && r.linkedTransactionId);
  const splitParentIds = crossing.filter((r) => r.isSplit).map((r) => r.id);

  // Legs owned by a transaction_splits row point at the split parent.
  const owningSplits =
    legs.length > 0
      ? await m.find(TransactionSplit, {
          where: { linkedTransactionId: In(legs.map((l) => l.id)) },
          select: ["id", "linkedTransactionId"],
        })
      : [];
  const splitOwnedLegIds = new Set(
    owningSplits.map((s) => s.linkedTransactionId),
  );

  const plainLegs = legs.filter((l) => !splitOwnedLegIds.has(l.id));
  const candidateCounterpartIds = plainLegs
    .map((l) => l.linkedTransactionId)
    .filter((id): id is string => id !== null);

  // Only counterparts this caller may actually write can be paired.
  const writableCounterpartIds = new Set(
    candidateCounterpartIds.length === 0
      ? []
      : (
          await repo
            .createQueryBuilder("t")
            .select(["t.id"])
            .where("t.id IN (:...ids)", { ids: candidateCounterpartIds })
            .andWhere("t.userId = :userId", { userId })
            .getMany()
        ).map((t) => t.id),
  );

  const resolved = new Set(ids);
  const refusedIds = new Set<string>();

  for (const leg of plainLegs) {
    const counterpartId = leg.linkedTransactionId!;
    if (writableCounterpartIds.has(counterpartId)) {
      resolved.add(counterpartId);
    } else {
      refusedIds.add(leg.id);
    }
  }

  for (const leg of legs) {
    if (splitOwnedLegIds.has(leg.id)) refusedIds.add(leg.id);
  }

  if (splitParentIds.length > 0) {
    const childLegs = await m.find(TransactionSplit, {
      where: { transactionId: In(splitParentIds) },
      select: ["id", "linkedTransactionId"],
    });
    const childLegIds = childLegs
      .map((s) => s.linkedTransactionId)
      .filter((id): id is string => id !== null);
    if (childLegIds.length > 0) {
      const writableChildLegIds = (
        await repo
          .createQueryBuilder("t")
          .select(["t.id"])
          .where("t.id IN (:...ids)", { ids: childLegIds })
          .andWhere("t.userId = :userId", { userId })
          .getMany()
      ).map((t) => t.id);
      for (const id of writableChildLegIds) resolved.add(id);
    }
  }

  for (const id of refusedIds) resolved.delete(id);

  const reasons: string[] = [];
  if (refusedIds.size > 0) {
    const plural = refusedIds.size !== 1 ? "s" : "";
    reasons.push(
      `${refusedIds.size} transfer leg${plural} skipped (voiding a transfer must change both legs; edit the transfer itself)`,
    );
  }

  return { ids: [...resolved], refusedIds: [...refusedIds], reasons };
}
