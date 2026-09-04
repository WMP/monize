import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import {
  runOutsideActiveScopedManager,
  withScopedDb,
} from "../../../common/db/scoped-db";
import { withSystemContext } from "../../../common/db/with-context";

/**
 * Whose key a request would spend, and what limit applies to it.
 *
 * `operator` is the deployment's `GOOGLE_PLACES_API_KEY`, counted once for the
 * whole instance; `user` is a key the user configured, counted per user. The
 * two are separate counters because they are separate bills.
 */
export type QuotaScope =
  | { kind: "operator"; capEnabled: boolean; cap: number }
  | { kind: "user"; userId: string; capEnabled: boolean; cap: number };

/**
 * The monthly request cap on Google Places lookups, claimed one request at a
 * time.
 *
 * The claim is a single conditional upsert -- mechanism 3 in
 * `docs/concurrency-and-idempotency.md`: the row is created at 1 or
 * incremented, and the `WHERE` refuses to increment past the cap, so the
 * database decides and two replicas racing for the last slot produce one
 * winner. Zero rows back means the cap is reached. A read-then-write would let
 * both callers past a cap of one.
 *
 * **The claim commits before the request goes out** (INV-PAYEE-002). Google
 * bills an attempt whatever comes back, so a slot released because the request
 * then failed would under-count what the user is paying for -- and an
 * under-count is the direction that spends money. `runOutsideActiveScopedManager`
 * is what makes that true even when a caller happens to be inside a
 * transaction: the count of what has been spent must not be rolled back by
 * whatever operation discovered it, exactly as `ProviderHealthService` records
 * an outage outside the request that found it.
 *
 * The month is `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')`, evaluated by
 * PostgreSQL rather than in JavaScript, so every replica rolls over on one
 * clock and no caller can disagree with the row it is incrementing.
 */
@Injectable()
export class PayeeLookupQuotaService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Take one request's worth of quota.
   *
   * @returns the count including this request, or `null` when the cap is
   *   already reached. `null` is a decision, not a failure: the caller falls
   *   back to the AI adapter.
   */
  async claim(scope: QuotaScope): Promise<number | null> {
    return scope.kind === "user"
      ? this.claimUser(scope.userId, scope.capEnabled, scope.cap)
      : this.claimInstance(scope.capEnabled, scope.cap);
  }

  /** What this scope has spent in the current UTC month. */
  async usedThisMonth(scope: QuotaScope): Promise<number> {
    return scope.kind === "user"
      ? this.readUsage(
          (m) =>
            m.query(
              `SELECT google_places_requests AS used FROM payee_lookup_usage
                WHERE user_id = $1
                  AND month = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')`,
              [scope.userId],
            ),
          false,
        )
      : this.readUsage(
          (m) =>
            m.query(
              `SELECT requests AS used FROM google_places_instance_usage
                WHERE month = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')`,
            ),
          true,
        );
  }

  private async claimUser(
    userId: string,
    capEnabled: boolean,
    cap: number,
  ): Promise<number | null> {
    const rows = await runOutsideActiveScopedManager(() =>
      withScopedDb(this.dataSource, (m) =>
        m.query(
          `INSERT INTO payee_lookup_usage (user_id, month, google_places_requests)
           VALUES ($1, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'), 1)
           ON CONFLICT (user_id, month) DO UPDATE
              SET google_places_requests = payee_lookup_usage.google_places_requests + 1
            WHERE $2::boolean = false
               OR payee_lookup_usage.google_places_requests < $3
        RETURNING google_places_requests AS used`,
          [userId, capEnabled, cap],
        ),
      ),
    );
    return this.claimedCount(rows);
  }

  /**
   * The operator's counter, under system context: the row belongs to the
   * deployment rather than to whoever's lookup happened to spend it, and the
   * table is RLS-exempt for that reason.
   */
  private async claimInstance(
    capEnabled: boolean,
    cap: number,
  ): Promise<number | null> {
    const rows = await runOutsideActiveScopedManager(() =>
      withSystemContext(() =>
        withScopedDb(this.dataSource, (m) =>
          m.query(
            `INSERT INTO google_places_instance_usage (month, requests)
             VALUES (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'), 1)
             ON CONFLICT (month) DO UPDATE
                SET requests = google_places_instance_usage.requests + 1
              WHERE $1::boolean = false
                 OR google_places_instance_usage.requests < $2
          RETURNING requests AS used`,
            [capEnabled, cap],
          ),
        ),
      ),
    );
    return this.claimedCount(rows);
  }

  private async readUsage(
    read: (m: EntityManager) => Promise<unknown>,
    system: boolean,
  ): Promise<number> {
    const run = () =>
      withScopedDb(this.dataSource, (m) => read(m) as Promise<unknown>);
    const rows = await (system ? withSystemContext(run) : run());
    const first = Array.isArray(rows) ? rows[0] : undefined;
    const used = (first as { used?: unknown } | undefined)?.used;
    return typeof used === "number" ? used : Number(used ?? 0) || 0;
  }

  /**
   * `RETURNING` on a refused upsert yields no rows, which is the cap being
   * reached. An `ON CONFLICT DO UPDATE ... WHERE` that matches nothing is the
   * only way this statement declines, so there is no other reading of an empty
   * result.
   */
  private claimedCount(rows: unknown): number | null {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const used = (rows[0] as { used?: unknown }).used;
    const parsed = typeof used === "number" ? used : Number(used);
    return Number.isFinite(parsed) ? parsed : null;
  }
}
