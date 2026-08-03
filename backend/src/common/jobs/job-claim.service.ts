import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { DataSource } from "typeorm";
import { withScopedDb } from "../db/scoped-db";
import { withSystemContext } from "../db/with-context";
import { JobClaim } from "./entities/job-claim.entity";

/**
 * The one durable claim mechanism for work that must happen at most once per
 * user, however many backend replicas fire the same cron.
 *
 * Two verbs, because the multi-replica jobs in this codebase need exactly two
 * shapes and previously invented a different ad hoc guard for each (audit
 * DR-04-04):
 *
 * - `claimOnce` -- a **delivery**. One bill-reminder email per user per local
 *   day, one grant email per contact. Permanent: nothing retakes it, so a
 *   second replica simply does not send. `release` exists only so a *failed*
 *   send can hand the day back instead of consuming it.
 *
 * - `claimLease` -- an **exclusion**. Only one replica may call the AI provider
 *   for a user at a time. Expires, so a replica killed mid-generation does not
 *   lock the user out until someone notices; `release` returns it early on the
 *   happy path.
 *
 * Both are a single statement, so the claim is the serialization point: there is
 * no window between deciding and recording. Every call must sit inside an
 * ambient identity context (`withUserContext` / `withSystemContext`) like any
 * other database access.
 */

/** How long claim rows are kept before the sweep removes them. */
export const JOB_CLAIM_RETENTION_DAYS = 30;

/** Claim types in use. Spelled out so a typo is a compile error, not a duplicate email. */
export const JobClaimType = {
  BillReminder: "bill_reminder",
  MortgageReminder: "mortgage_reminder",
  EmergencyAccessReminder: "emergency_access_reminder",
  AiInsightGeneration: "ai_insight_generation",
} as const;

export type JobClaimType = (typeof JobClaimType)[keyof typeof JobClaimType];

@Injectable()
export class JobClaimService {
  private readonly logger = new Logger(JobClaimService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Claim `(type, userId, key)` permanently. True for the one caller that won.
   *
   * `ON CONFLICT DO NOTHING` with `RETURNING` is what makes this safe across
   * replicas: the loser gets an empty result from the database, not a stale
   * "nothing exists yet" from its own read.
   */
  async claimOnce(
    claimType: JobClaimType,
    userId: string,
    claimKey: string,
  ): Promise<boolean> {
    const rows = await withScopedDb(this.dataSource, (manager) =>
      manager.query(
        `INSERT INTO job_claims (claim_type, user_id, claim_key, expires_at)
         VALUES ($1, $2, $3, NULL)
         ON CONFLICT (claim_type, user_id, claim_key) DO NOTHING
         RETURNING id`,
        [claimType, userId, claimKey],
      ),
    );
    return returnedRowCount(rows) > 0;
  }

  /**
   * Claim `(type, userId, key)` for `ttlMs`. True for the caller that won.
   *
   * The `DO UPDATE ... WHERE` arm is the lease: an existing row is only retaken
   * when its own expiry has passed, which is how a worker killed mid-run stops
   * blocking the next one without a human. A live lease returns no row, so the
   * loser knows to stand down rather than doing the work twice.
   */
  async claimLease(
    claimType: JobClaimType,
    userId: string,
    claimKey: string,
    ttlMs: number,
  ): Promise<boolean> {
    const rows = await withScopedDb(this.dataSource, (manager) =>
      manager.query(
        `INSERT INTO job_claims (claim_type, user_id, claim_key, expires_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP + ($4::text || ' milliseconds')::interval)
         ON CONFLICT (claim_type, user_id, claim_key) DO UPDATE
            SET claimed_at = CURRENT_TIMESTAMP,
                expires_at = CURRENT_TIMESTAMP + ($4::text || ' milliseconds')::interval
          WHERE job_claims.expires_at IS NOT NULL
            AND job_claims.expires_at < CURRENT_TIMESTAMP
         RETURNING id`,
        [claimType, userId, claimKey, String(Math.max(1, Math.round(ttlMs)))],
      ),
    );
    return returnedRowCount(rows) > 0;
  }

  /**
   * Give a claim back.
   *
   * On the happy path this ends a lease early. After a failure it un-consumes a
   * delivery, so a transient SMTP outage costs a retry rather than the whole
   * day's reminder -- which is the behaviour the pre-claim code had by accident
   * and which claiming first would otherwise take away.
   */
  async release(
    claimType: JobClaimType,
    userId: string,
    claimKey: string,
  ): Promise<void> {
    await withScopedDb(this.dataSource, (manager) =>
      manager.getRepository(JobClaim).delete({ claimType, userId, claimKey }),
    );
  }

  /**
   * Drop claim rows older than the retention window.
   *
   * Idempotent by construction -- the predicate is "already old" -- so two
   * replicas racing the sweep delete the same rows and the loser deletes none.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async sweepOldClaims(): Promise<void> {
    try {
      const removed = await withSystemContext(() =>
        withScopedDb(this.dataSource, async (manager) => {
          const result = await manager.query(
            `DELETE FROM job_claims
              WHERE claimed_at < CURRENT_TIMESTAMP - ($1::text || ' days')::interval`,
            [String(JOB_CLAIM_RETENTION_DAYS)],
          );
          return Array.isArray(result) ? (result[1] as number) : 0;
        }),
      );
      if (removed > 0) {
        this.logger.log(`Swept ${removed} expired job claim(s)`);
      }
    } catch (error) {
      this.logger.warn(
        `Job claim sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/**
 * How many rows a data-modifying `query()` with `RETURNING` actually returned.
 *
 * The pg driver hands TypeORM `[rows, rowCount]` for those, and bare rows for a
 * `SELECT`. Reading that wrong fails in the worst direction: `result.length > 0`
 * on the tuple is always true, so every claim would look like a winner and every
 * replica would send. The `.mny` job service learned this the same way -- see
 * `returnedRows` there.
 */
function returnedRowCount(result: unknown): number {
  if (!Array.isArray(result)) return 0;
  const rows = Array.isArray(result[0]) ? (result[0] as unknown[]) : result;
  return rows.length;
}
