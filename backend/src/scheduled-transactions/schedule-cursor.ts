import { EntityManager } from "typeorm";
import { ScheduledTransaction } from "./entities/scheduled-transaction.entity";
import { ScheduledTransactionOverride } from "./entities/scheduled-transaction-override.entity";
import { calculateNextDueDate, ensureYMD } from "../common/recurrence";
import { todayYMD } from "../common/date-utils";

/** The cursor columns `advanceScheduleCursor` wrote. */
export interface ScheduleCursorAdvance {
  nextDueDate: string;
  occurrencesRemaining: number | null;
  /** True when the advance deactivated the schedule. */
  deactivated: boolean;
  /** How many slots the cursor stepped over, the claimed one included. */
  slotsConsumed: number;
}

/**
 * Advance a recurring schedule's cursor past the occurrences that have been
 * consumed: `next_due_date` to the next unclaimed slot, overrides dated before
 * it pruned, `last_posted_date` set, `occurrences_remaining` decremented once
 * per slot and the schedule deactivated at zero or past `end_date`.
 *
 * Lifted out of `ScheduledTransactionsService.post()`, which calls it with the
 * one slot it claimed, so the settlement of a bank debit against an occurrence
 * (`docs/specs/loan-installment-settlement.md` section 12.3) advances the
 * cursor through the same code when it claims the due slot.
 *
 * `schedule` is the LOCKED row (`SELECT ... FOR UPDATE`), never a snapshot
 * taken before the transaction: a concurrent edit to `occurrences_remaining`
 * or `end_date` would otherwise be reverted by this advancement.
 * `consumedSlots` holds the slot dates (YYYY-MM-DD) already claimed on the
 * schedule, the row's current `next_due_date` among them; the cursor steps
 * past every consecutive claimed slot so the bill never offers an occurrence
 * whose own claim key is taken. With exactly the current slot in the set, this
 * is one step: what `post()` always did.
 *
 * A ONCE schedule has no next slot; `post()` deletes it instead and never
 * calls this.
 */
export async function advanceScheduleCursor(
  m: EntityManager,
  schedule: Pick<
    ScheduledTransaction,
    "id" | "nextDueDate" | "frequency" | "occurrencesRemaining" | "endDate"
  >,
  consumedSlots: ReadonlySet<string>,
): Promise<ScheduleCursorAdvance> {
  let newNextDueDateStr = ensureYMD(schedule.nextDueDate);
  let slotsConsumed = 0;
  do {
    newNextDueDateStr = calculateNextDueDate(
      newNextDueDateStr,
      schedule.frequency,
    );
    slotsConsumed += 1;
  } while (consumedSlots.has(newNextDueDateStr));

  await m
    .createQueryBuilder()
    .delete()
    .from(ScheduledTransactionOverride)
    .where("scheduledTransactionId = :id", { id: schedule.id })
    .andWhere("originalDate < :newNextDueDate", {
      newNextDueDate: newNextDueDateStr,
    })
    .execute();

  const updateFields: Partial<ScheduledTransaction> = {
    lastPostedDate: todayYMD(),
    nextDueDate: newNextDueDateStr,
  };

  let occurrencesRemaining = schedule.occurrencesRemaining;
  if (
    schedule.occurrencesRemaining !== null &&
    schedule.occurrencesRemaining > 0
  ) {
    occurrencesRemaining = Math.max(
      0,
      schedule.occurrencesRemaining - slotsConsumed,
    );
    updateFields.occurrencesRemaining = occurrencesRemaining;
    if (occurrencesRemaining === 0) {
      updateFields.isActive = false;
    }
  }

  if (schedule.endDate && newNextDueDateStr > ensureYMD(schedule.endDate)) {
    updateFields.isActive = false;
  }

  await m.update(ScheduledTransaction, schedule.id, updateFields);
  return {
    nextDueDate: newNextDueDateStr,
    occurrencesRemaining,
    deactivated: updateFields.isActive === false,
    slotsConsumed,
  };
}
