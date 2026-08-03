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

  await manager.query(BYPASS_ON_SQL);
  try {
    return await fn(manager);
  } finally {
    // Restore even when `fn` threw. A caller that catches the error keeps
    // working in the same transaction, and it must not keep working elevated.
    await manager.query(BYPASS_OFF_SQL);
  }
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
