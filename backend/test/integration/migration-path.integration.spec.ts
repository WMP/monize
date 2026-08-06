import * as fs from "fs";
import * as path from "path";
import { DataSource } from "typeorm";

import { withUserContext } from "@/common/db/with-context";
import { JobClaimService, JobClaimType } from "@/common/jobs/job-claim.service";

import {
  INTEGRATION_TYPEORM_OPTIONS,
  createTestUserDirect,
} from "../helpers/integration-setup";

/**
 * The production upgrade path, executed rather than assumed (review STACK-003).
 *
 * Every other integration suite builds its schema with `synchronize: true`, which
 * derives tables from entity metadata and creates no triggers -- so those suites
 * can pass against migrations that would not apply, and their trigger coverage
 * comes from the harness reapplying migration files onto a synchronized schema.
 * The schema an existing install actually runs is neither of those things: it is
 * current main's schema.sql state with this branch's migration files replayed on
 * top by db-migrate, triggers and all.
 *
 * This suite builds exactly that database: the committed pre-Phase4 fixture
 * (main's schema.sql, max migration 135) plus the full migrations directory in
 * filename order, `synchronize: false` throughout. Replaying the whole directory
 * matches db-migrate's behaviour on such an install -- files <= 135 are no-ops
 * there, 136+ do the real work. Then it runs the real services against the
 * result, because "the migrations apply" and "the migrated schema serves the
 * code" are different claims and production needs both.
 */
describe("production migration path (pre-Phase4 schema + migrations)", () => {
  const SCRATCH_DB = "monize_migration_path_test";
  const FIXTURE = path.join(__dirname, "fixtures/schema-pre-phase4.sql");
  const MIGRATIONS_DIR = path.join(__dirname, "../../../database/migrations");

  let admin: DataSource;
  let db: DataSource;
  let jobClaims: JobClaimService;
  let owner: string;

  beforeAll(async () => {
    admin = new DataSource({
      ...INTEGRATION_TYPEORM_OPTIONS,
      entities: [],
      synchronize: false,
      dropSchema: false,
    } as never);
    await admin.initialize();
    await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
    await admin.query(`CREATE DATABASE ${SCRATCH_DB}`);

    db = new DataSource({
      ...INTEGRATION_TYPEORM_OPTIONS,
      database: SCRATCH_DB,
      synchronize: false,
      dropSchema: false,
    } as never);
    await db.initialize();

    await db.query(fs.readFileSync(FIXTURE, "utf8"));
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      try {
        await db.query(
          fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"),
        );
      } catch (error) {
        throw new Error(
          `migration ${file} failed against the pre-Phase4 schema: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    jobClaims = new JobClaimService(db);
    owner = (
      await createTestUserDirect(db, { email: "migration-path@example.com" })
    ).id;
  }, 180000);

  afterAll(async () => {
    if (db?.isInitialized) {
      await db.destroy();
    }
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
      await admin.destroy();
    }
  });

  const triggerExists = async (name: string): Promise<boolean> => {
    const rows: { count: string }[] = await db.query(
      `SELECT COUNT(*) AS count FROM pg_trigger WHERE tgname = $1 AND NOT tgisinternal`,
      [name],
    );
    return Number(rows[0].count) > 0;
  };

  const columnExists = async (
    table: string,
    column: string,
  ): Promise<boolean> => {
    const rows: { count: string }[] = await db.query(
      `SELECT COUNT(*) AS count FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, column],
    );
    return Number(rows[0].count) > 0;
  };

  it("creates every Phase 4 object the code depends on", async () => {
    // Not redundant with the replay in beforeAll: a migration whose guards
    // accidentally skip its own work applies cleanly and creates nothing.
    await expect(columnExists("job_claims", "lease_token")).resolves.toBe(true);
    await expect(columnExists("job_claims", "delivered_at")).resolves.toBe(
      true,
    );
    await expect(columnExists("import_jobs", "attempt_token")).resolves.toBe(
      true,
    );
    await expect(
      columnExists("attachment_blob_tombstones", "late_write_quarantine_until"),
    ).resolves.toBe(true);
    await expect(
      columnExists("emergency_access_contacts", "notified_grant_generation"),
    ).resolves.toBe(true);
    await expect(
      columnExists("emergency_access_settings", "grant_generation"),
    ).resolves.toBe(true);

    await expect(triggerExists("trg_job_claims_guard_delete")).resolves.toBe(
      true,
    );
    await expect(triggerExists("trg_job_claims_guard_update")).resolves.toBe(
      true,
    );
    await expect(
      triggerExists("trg_eac_backfill_notified_generation"),
    ).resolves.toBe(true);
    await expect(
      triggerExists("trg_eac_reject_legacy_token_rotation"),
    ).resolves.toBe(true);
  });

  it("runs the lease protocol end to end on the migrated schema", async () => {
    await withUserContext(owner, async () => {
      const token = await jobClaims.claimLease(
        JobClaimType.BillReminder,
        owner,
        "migration-path-key",
        60_000,
      );
      expect(token).toBeTruthy();

      // A live lease refuses a second attempt.
      await expect(
        jobClaims.claimLease(
          JobClaimType.BillReminder,
          owner,
          "migration-path-key",
          60_000,
        ),
      ).resolves.toBeNull();

      await expect(
        jobClaims.wasDelivered(
          JobClaimType.BillReminder,
          owner,
          "migration-path-key",
        ),
      ).resolves.toBe(false);

      await jobClaims.markDelivered(
        JobClaimType.BillReminder,
        owner,
        "migration-path-key",
        token as string,
      );
      await expect(
        jobClaims.wasDelivered(
          JobClaimType.BillReminder,
          owner,
          "migration-path-key",
        ),
      ).resolves.toBe(true);

      // A delivered claim is never retaken, however stale its lease.
      await db.query(
        `UPDATE job_claims SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 hour'
          WHERE user_id = $1 AND claim_key = $2`,
        [owner, "migration-path-key"],
      );
      await expect(
        jobClaims.claimLease(
          JobClaimType.BillReminder,
          owner,
          "migration-path-key",
          60_000,
        ),
      ).resolves.toBeNull();
    });
  });

  it("refuses an untokenized mutation of a live lease, as the old binary writes it", async () => {
    const token = await withUserContext(owner, () =>
      jobClaims.claimLease(
        JobClaimType.AiInsightGeneration,
        owner,
        "guard-key",
        60_000,
      ),
    );
    expect(token).toBeTruthy();

    // The previous release's release(): a DELETE naming the work, carrying no
    // token and no GUC. The migration-139 trigger, installed here by the real
    // migration file rather than a test harness, must refuse it.
    await expect(
      db.query(
        `DELETE FROM job_claims
          WHERE claim_type = $1 AND user_id = $2 AND claim_key = $3`,
        [JobClaimType.AiInsightGeneration, owner, "guard-key"],
      ),
    ).rejects.toThrow(/lease/i);

    // The holder, declaring its token, may release.
    await withUserContext(owner, () =>
      jobClaims.releaseLease(
        JobClaimType.AiInsightGeneration,
        owner,
        "guard-key",
        token as string,
      ),
    );
    const rows: unknown[] = await db.query(
      `SELECT 1 FROM job_claims WHERE user_id = $1 AND claim_key = $2`,
      [owner, "guard-key"],
    );
    expect(rows).toHaveLength(0);
  });

  it("arms the emergency-access legacy-rotation fence on the migrated schema", async () => {
    await db.query(
      `INSERT INTO emergency_access_settings (owner_user_id, enabled, grant_after_days, reminder_after_days)
       VALUES ($1, true, 14, 7)`,
      [owner],
    );
    const inserted: { id: string }[] = await db.query(
      `INSERT INTO emergency_access_contacts (owner_user_id, first_name, email, claim_token_hash, claim_token_expires_at, claim_token_ciphertext)
       VALUES ($1, 'Carol', 'carol@example.com', 'hash-a', CURRENT_TIMESTAMP + INTERVAL '30 days', 'ciphertext-a')
       RETURNING id`,
      [owner],
    );
    const contactId = inserted[0].id;

    // Current main's grant-loop rotation, verbatim shape: new hash, blind to the
    // ciphertext and the generation. With an undelivered credential on the row,
    // migration 150's fence must refuse it.
    await expect(
      db.query(
        `UPDATE emergency_access_contacts
            SET claim_token_hash = 'hash-b',
                claim_token_expires_at = CURRENT_TIMESTAMP + INTERVAL '30 days',
                claim_token_used_at = NULL,
                claim_voided_reason = NULL
          WHERE id = $1`,
        [contactId],
      ),
    ).rejects.toThrow(/newer release owns this credential cycle/);

    // Revocation -- clearing the hash -- stays open to every binary.
    await db.query(
      `UPDATE emergency_access_contacts
          SET claim_token_hash = NULL, claim_token_ciphertext = NULL,
              claim_token_used_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [contactId],
    );
    const after: { claim_token_hash: string | null }[] = await db.query(
      `SELECT claim_token_hash FROM emergency_access_contacts WHERE id = $1`,
      [contactId],
    );
    expect(after[0].claim_token_hash).toBeNull();
  });
});
