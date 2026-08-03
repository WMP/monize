import { Logger } from "@nestjs/common";
import { LockScope } from "./locks";

/**
 * Pre-boot code, so `Logger` is constructed directly: it works without an
 * application context, and every startup line keeps the one log shape
 * (`startup-logging.spec.ts` scans for a stray `console` call here).
 */
const logger = new Logger("BootstrapLock");

/**
 * Serializes schema bootstrap across processes.
 *
 * `db-init` and `db-migrate` are both check-then-act: init reads
 * `information_schema` for a `users` table and applies `schema.sql` when it is
 * absent, and the migration runner reads `schema_migrations` and applies every
 * file that snapshot did not list. On k8s with more than one backend replica
 * both containers start at once, both read the same "not done yet" answer, and
 * the loser dies -- on `duplicate_table` from `schema.sql`, or on the
 * `schema_migrations` primary key when it tries to record a migration the winner
 * already recorded. Neither database is damaged, but the pod restarts and the
 * rollout reports a crash-loop for what is really a race.
 *
 * A session-level advisory lock held across the whole check-and-act closes it:
 * the loser waits, then re-reads and finds the work already done. It is
 * session-level rather than transaction-level because `schema.sql` and the
 * migration loop each run several transactions, and the exclusion has to span
 * all of them.
 *
 * Both scripts take the SAME key, so init and migrate are also serialized
 * against each other -- a replica must not start migrating while another is
 * still applying `schema.sql`.
 */

/**
 * Advisory-lock namespace for schema bootstrap.
 *
 * Postgres keeps one space for two-int advisory locks, so this must not collide
 * with any `LockScope` used by request-time locks in `locks.ts`. It sits well
 * clear of that range on purpose, and `bootstrap-lock.spec.ts` fails if a new
 * `LockScope` ever reaches it.
 */
export const BOOTSTRAP_LOCK_NAMESPACE = 1000;

/** Second key component; one bootstrap lock exists, so it is a constant. */
export const BOOTSTRAP_LOCK_KEY = 1;

/** How long a replica waits for the peer holding the lock before giving up. */
export const BOOTSTRAP_LOCK_TIMEOUT_MS = 10 * 60 * 1000;

/** Gap between attempts while another replica holds the lock. */
export const BOOTSTRAP_LOCK_POLL_MS = 500;

/** The narrow slice of `pg`'s `Client` the lock helpers need. */
export interface BootstrapLockClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface BootstrapLockOptions {
  /** Total time to wait for the lock. Defaults to `BOOTSTRAP_LOCK_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Poll interval. Defaults to `BOOTSTRAP_LOCK_POLL_MS`. */
  pollMs?: number;
  /** Where progress goes. Defaults to this module's NestJS `Logger`. */
  log?: (message: string) => void;
  /** Sleep, injected so specs do not spend real time waiting. */
  sleep?: (ms: number) => Promise<void>;
  /** Clock, injected for the same reason. */
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Try once to take the bootstrap lock. Returns false when another session holds
 * it. Uses `pg_try_advisory_lock` rather than the blocking form so the caller
 * can report progress and bound the wait instead of hanging a pod forever with
 * no output.
 */
async function tryAcquire(client: BootstrapLockClient): Promise<boolean> {
  const result = await client.query(
    "SELECT pg_try_advisory_lock($1::int, $2::int) AS acquired",
    [BOOTSTRAP_LOCK_NAMESPACE, BOOTSTRAP_LOCK_KEY],
  );
  const row = result.rows[0] as { acquired?: boolean } | undefined;
  return row?.acquired === true;
}

/**
 * Take the bootstrap lock, waiting for a peer that holds it.
 *
 * Throws when the wait runs out. The caller treats that as fatal: continuing
 * without the lock would reintroduce exactly the race the lock exists for, and a
 * ten-minute wait means the peer is stuck rather than slow.
 */
export async function acquireBootstrapLock(
  client: BootstrapLockClient,
  options: BootstrapLockOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? BOOTSTRAP_LOCK_TIMEOUT_MS;
  const pollMs = options.pollMs ?? BOOTSTRAP_LOCK_POLL_MS;
  const log = options.log ?? ((message: string) => logger.log(message));
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => Date.now());

  const startedAt = now();
  let waited = false;

  for (;;) {
    if (await tryAcquire(client)) {
      if (waited) {
        log(
          `Acquired schema bootstrap lock after waiting ${now() - startedAt}ms.`,
        );
      }
      return;
    }

    if (now() - startedAt >= timeoutMs) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for the schema bootstrap lock ` +
          `(pg_advisory_lock ${BOOTSTRAP_LOCK_NAMESPACE}/${BOOTSTRAP_LOCK_KEY}). ` +
          "Another process is initializing or migrating this database and has not " +
          "finished. Inspect pg_locks for locktype = 'advisory'; a lock left behind " +
          "by a killed process is released when its backend disconnects.",
      );
    }

    if (!waited) {
      waited = true;
      log(
        "Another process holds the schema bootstrap lock; waiting for it to finish.",
      );
    }
    await sleep(pollMs);
  }
}

/**
 * Release the bootstrap lock.
 *
 * Best-effort: a session-level advisory lock is released when the connection
 * closes, and both callers close theirs in a `finally`, so a failure here must
 * not mask the outcome of the work the lock protected.
 */
export async function releaseBootstrapLock(
  client: BootstrapLockClient,
  log: (message: string) => void = (message) => logger.warn(message),
): Promise<void> {
  try {
    await client.query("SELECT pg_advisory_unlock($1::int, $2::int)", [
      BOOTSTRAP_LOCK_NAMESPACE,
      BOOTSTRAP_LOCK_KEY,
    ]);
  } catch (error) {
    log(
      `Failed to release the schema bootstrap lock (it is released on disconnect anyway): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** The `LockScope` values the bootstrap namespace must stay clear of. */
export const REQUEST_LOCK_NAMESPACES: readonly number[] = Object.values(
  LockScope,
).filter((value): value is number => typeof value === "number");
