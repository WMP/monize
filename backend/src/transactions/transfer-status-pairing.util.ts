import { EntityManager, In } from "typeorm";
import { Transaction } from "./entities/transaction.entity";
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
 * Expand a set of transaction ids to the transfer legs that must change status
 * with them.
 *
 * A linked transfer is one economic event, so a balance-affecting status change
 * -- above all entering or leaving `VOID` -- has to land on both legs or on
 * neither. Voiding only the source leg restores the source balance while the
 * destination leg stays active, so 1,000.00 spread across two accounts becomes
 * 1,100.00, and no error is raised anywhere.
 *
 * Rules:
 * - A plain transfer leg brings its mirror leg.
 * - A selected split parent brings the counterpart legs of its transfer splits.
 * - A split-transfer leg is **refused**: its `linkedTransactionId` names the
 *   split parent, not a mirror leg, so pairing it here would void the parent.
 *   Change it through the split instead.
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
): Promise<TransferStatusExpansion> {
  if (ids.length === 0) {
    return { ids: [], refusedIds: [], reasons: [] };
  }

  const repo = m.getRepository(Transaction);
  const rows = await repo
    .createQueryBuilder("t")
    .select(["t.id", "t.linkedTransactionId", "t.isTransfer", "t.isSplit"])
    .where("t.id IN (:...ids)", { ids })
    .andWhere("t.userId = :userId", { userId })
    .getMany();

  const legs = rows.filter((r) => r.isTransfer && r.linkedTransactionId);
  const splitParentIds = rows.filter((r) => r.isSplit).map((r) => r.id);

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
      `${refusedIds.size} transfer leg${plural} skipped (a transfer's status must change on both legs; edit the transfer itself)`,
    );
  }

  return { ids: [...resolved], refusedIds: [...refusedIds], reasons };
}
