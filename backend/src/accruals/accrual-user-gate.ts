import type { EntityManager } from "typeorm";
import { getRequestContext } from "../common/request-context";

const gateKey = Symbol("accrualUserGate");

function queryHasAnySchedule(
  m: EntityManager,
  userId: string,
): Promise<boolean> {
  return m
    .query(
      "SELECT EXISTS(SELECT 1 FROM accrual_schedules WHERE user_id=$1) AS present",
      [userId],
    )
    .then(([row]: { present: boolean }[]) => row?.present === true);
}

/** One cached existence check per request/job identity scope, shared by every accrual-edit helper. */
export function userHasAnyAccrualSchedule(
  m: EntityManager,
  userId: string,
): Promise<boolean> {
  const context = getRequestContext();
  if (!context) return queryHasAnySchedule(m, userId);
  context.memo ??= new Map();
  let values = context.memo.get(gateKey) as
    Map<string, Promise<boolean>> | undefined;
  if (!values) {
    values = new Map();
    context.memo.set(gateKey, values);
  }
  const cached = values.get(userId);
  if (cached) return cached;
  const entries = values;
  const pending = queryHasAnySchedule(m, userId).catch((error) => {
    if (entries.get(userId) === pending) entries.delete(userId);
    throw error;
  });
  entries.set(userId, pending);
  return pending;
}

/** Call right after a schedule is written: a cached "no schedules yet" answer from
 * earlier in this same request/job must not survive the user's first schedule. */
export function markAccrualScheduleExists(userId: string): void {
  const context = getRequestContext();
  if (!context) return;
  context.memo ??= new Map();
  let values = context.memo.get(gateKey) as
    Map<string, Promise<boolean>> | undefined;
  if (!values) {
    values = new Map();
    context.memo.set(gateKey, values);
  }
  values.set(userId, Promise.resolve(true));
}
