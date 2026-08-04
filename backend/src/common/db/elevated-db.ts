import { Logger } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { getRequestContext } from "../request-context";
import { getRlsMode } from "./rls-config";

/**
 * A narrow, audited window of cross-user access **inside** the caller's own
 * transaction.
 *
 * Some correct operations have to read or write a row that is not the caller's,
 * and have to do it atomically with the caller's work:
 *
 *  - Deciding whether a shared `currencies` row is still referenced. The answer
 *    must count every tenant's rows, and it authorizes a DELETE that has to be
 *    atomic with the count -- a second transaction lets a concurrent user
 *    activate the code between the count and the delete (P2-009).
 *  - Looking up or creating the *identity* row of a delegate an owner is adding.
 *    `users_self` reaches only the caller's own row by design, and its migration
 *    comment says so, but the delegation row and its grants must be written in
 *    the same transaction as the identity or a failure strands one of them
 *    (P2-007).
 *  - Counting administrators before allowing the last one to self-delete. A
 *    tenant-filtered count returns 1 (themselves) and refuses forever.
 *
 * `withSystemContext` cannot express this. It seeds a new *ambient* context, and
 * a `withScopedDb` inside an open transaction joins that transaction -- whose
 * GUCs were already set -- so the bypass never reaches the database. Since
 * DR-01 that mistake throws instead of passing silently, which is why this
 * helper exists rather than a comment telling the next author not to try.
 *
 * What it does: flips `app.bypass_rls` on for the duration of `fn` and back off
 * afterwards, on the transaction's own connection. The GUC is transaction-local,
 * so it cannot leak to a pooled reuse even if the restore is skipped by a
 * process death; the explicit restore in `finally` is what stops the *rest of
 * the same transaction* from running elevated.
 *
 * Nesting and concurrency are both safe: the window is reference-counted per
 * connection and closes when the last caller inside it leaves, so neither a
 * nested call nor a `Promise.all` sibling can turn the bypass off while another
 * participant still depends on it.
 *
 * How to use it:
 *  - Wrap the smallest possible unit -- one query, ideally. Everything inside is
 *    unfiltered.
 *  - Never let a value derived from request input select the row: elevated
 *    access means the policy is no longer checking ownership, so the code must.
 *  - `reason` is logged with the call site. It is the audit record, so write what
 *    the elevation is for, not what the query does.
 *
 * Import of this module is lint-restricted to an explicit allowlist, exactly as
 * `with-context` is.
 */

const elevationLogger = new Logger("ElevatedDb");

// Same rate-limiting shape as the withSystemContext audit log: every distinct
// call site stays observable without a hot path flooding the log.
const ELEVATION_LOG_INTERVAL_MS = 60 * 1000;
const lastElevationLog = new Map<string, number>();

export const BYPASS_ON_SQL = "SELECT set_config('app.bypass_rls', 'on', true)";
export const BYPASS_OFF_SQL = "SELECT set_config('app.bypass_rls', '', true)";
export const BYPASS_READ_SQL =
  "SELECT current_setting('app.bypass_rls', true) AS bypass";

/**
 * One in-flight elevation window, and how many callers are inside it.
 *
 * The count is what makes *concurrent siblings* safe, and reading the GUC alone
 * cannot: two `Promise.all` branches both probe before either sets, both read
 * "off", both conclude they own the restore, and the first to finish turns the
 * bypass off while the second is still working (RV-001 -- `listDelegates`
 * mapping every delegate to an eligibility check was exactly that shape). The
 * claim below is taken *synchronously*, before any `await`, so two entrants can
 * never both see zero.
 */
interface ElevationState {
  depth: number;
  /** Resolves once the bypass is on, so a joiner never reads a row before it is. */
  ready: Promise<void>;
  /** Whether THIS window set the GUC, and therefore owes the restore. */
  emitted: boolean;
}

/**
 * Keyed by the transaction's connection rather than by the `EntityManager`: the
 * GUC is transaction-local, so two managers wrapping one `QueryRunner` are one
 * window. Weak, so a finished transaction's entry goes away with it.
 */
const activeElevations = new WeakMap<object, ElevationState>();

function elevationKey(manager: EntityManager): object {
  return (manager as { queryRunner?: object }).queryRunner ?? manager;
}

export async function withElevatedDb<T>(
  manager: EntityManager,
  reason: string,
  fn: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  auditElevation(reason);

  // An already-elevated transaction (a cron fan-out, a seeder) needs no second
  // flip, and must not have the GUC turned OFF underneath it when this returns.
  if (getRequestContext()?.system || getRlsMode() === "off") {
    return fn(manager);
  }

  const key = elevationKey(manager);
  const joined = activeElevations.get(key);
  if (joined) {
    // Synchronous claim. Whether this is a nested call or a concurrent sibling
    // makes no difference: the window stays open until the last one leaves.
    joined.depth += 1;
    try {
      await joined.ready;
      return await fn(manager);
    } finally {
      await releaseElevation(key, manager);
    }
  }

  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // The opener does not await `ready`; without this a failed open would surface
  // as an unhandled rejection rather than as the error it already throws.
  ready.catch(() => undefined);
  const state: ElevationState = { depth: 1, ready, emitted: false };
  activeElevations.set(key, state);

  try {
    // Still ask the connection, for the case the count cannot see: an outer
    // window opened by code this call does not know about. `emitted` stays false
    // then, so the restore below leaves that code's bypass alone.
    if (!(await alreadyElevated(manager))) {
      await manager.query(BYPASS_ON_SQL);
      state.emitted = true;
    }
    resolveReady();
    return await fn(manager);
  } catch (error) {
    // A joiner must not proceed believing the window was established.
    rejectReady(error);
    throw error;
  } finally {
    // Restore even when `fn` threw. A caller that catches the error keeps
    // working in the same transaction, and it must not keep working elevated.
    await releaseElevation(key, manager);
  }
}

async function releaseElevation(
  key: object,
  manager: EntityManager,
): Promise<void> {
  const state = activeElevations.get(key);
  if (!state) return;
  state.depth -= 1;
  if (state.depth > 0) return;
  activeElevations.delete(key);
  if (state.emitted) await manager.query(BYPASS_OFF_SQL);
}

async function alreadyElevated(manager: EntityManager): Promise<boolean> {
  const rows = await manager.query(BYPASS_READ_SQL);
  const row = Array.isArray(rows)
    ? rows[0]
    : (rows as { rows?: unknown[] })?.rows?.[0];
  return (row as { bypass?: string } | undefined)?.bypass === "on";
}

function auditElevation(reason: string): void {
  const callSite = callSiteFromStack(new Error().stack);
  const key = `${callSite}|${reason}`;
  const now = Date.now();
  if (now - (lastElevationLog.get(key) ?? 0) < ELEVATION_LOG_INTERVAL_MS) {
    return;
  }
  lastElevationLog.set(key, now);
  elevationLogger.log(`RLS elevation (${reason}) from ${callSite}`);
}

const OWN_FRAME = /elevated-db\.(?:ts|js)/;

/** First stack frame outside this module. Exported for its unit test. */
export function callSiteFromStack(stack: string | undefined): string {
  if (!stack) return "unknown";
  for (const raw of stack.split("\n").slice(1)) {
    const line = raw.trim();
    if (line.startsWith("at ") && !OWN_FRAME.test(line)) {
      return line.replace(/^at\s+/, "");
    }
  }
  return "unknown";
}
