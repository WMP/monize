import { DataSource } from "typeorm";
import * as fs from "fs";
import * as path from "path";

import {
  INTEGRATION_TYPEORM_OPTIONS,
  cleanTables,
  createTestUserDirect,
} from "../helpers/integration-setup";
import { applyRlsPolicies } from "../helpers/rls-setup";

/**
 * Migration 145's backfill, against the states the *previous* implementation
 * could actually leave behind (audit RV4-003).
 *
 * The point of the fixture is the ordering the old code used: it persisted
 * `claim_token_hash` **before** calling `sendMail`. So a hash means only that
 * issuance was attempted, and a backfill that read it as delivery would mark a
 * contact whose send failed as notified -- putting them outside the recovery query
 * forever. Two shapes are reachable and both were mishandled:
 *
 *   * partial delivery -- one send succeeded, one failed, both hashes present, and
 *     `granted_at` stayed set because at least one landed;
 *   * total failure -- every hash present, every send failed, and the old code
 *     reset `granted_at` to null.
 *
 * A unit test cannot check this: the assertion is about what a SQL predicate
 * concludes from production-shaped rows, so the fixture is a real database and the
 * migration is read from disk.
 */
describe("migration 145 backfill over legacy delivery state", () => {
  let dataSource: DataSource;
  let owner: string;

  const MIGRATION = path.join(
    __dirname,
    "../../../database/migrations/145_emergency_access_delivery_state.sql",
  );

  const applyMigration = () =>
    dataSource.query(fs.readFileSync(MIGRATION, "utf8"));

  /** Undo migration 145, so the fixture starts from a genuinely pre-145 table. */
  const removeColumns = async () => {
    // Later migrations depend on the 145 columns: the generation column (146),
    // its rollout-compat trigger (147), and the legacy-rotation fence (148),
    // whose WHEN clause references `claim_token_ciphertext`. All have to come
    // off before the columns to reach the genuinely pre-145 shape this spec
    // seeds -- a pre-145 database has none of them either.
    await dataSource.query(
      `DROP TRIGGER IF EXISTS trg_eac_backfill_notified_generation ON emergency_access_contacts`,
    );
    await dataSource.query(
      `DROP TRIGGER IF EXISTS trg_eac_reject_legacy_token_rotation ON emergency_access_contacts`,
    );
    await dataSource.query(`DROP INDEX IF EXISTS idx_eac_pending_notify`);
    await dataSource.query(`DROP INDEX IF EXISTS idx_eac_awaiting_notice`);
    await dataSource.query(
      `ALTER TABLE emergency_access_contacts
         DROP COLUMN IF EXISTS claim_notified_at,
         DROP COLUMN IF EXISTS claim_token_ciphertext,
         DROP COLUMN IF EXISTS notified_grant_generation`,
    );
  };

  /**
   * A contact as the *old* code would have left it: the token hash written before
   * the send, so its presence says nothing about whether the email arrived.
   */
  const seedLegacyContact = async (
    id: string,
    fields: { email: string; hash: string | null; usedAt?: string | null },
  ): Promise<void> => {
    await dataSource.query(
      `INSERT INTO emergency_access_contacts
         (id, owner_user_id, first_name, email, claim_token_hash,
          claim_token_expires_at, claim_token_used_at, updated_at)
       VALUES ($1, $2, 'Legacy', $3, $4,
               CURRENT_TIMESTAMP + INTERVAL '30 days', $5, '2026-05-01')`,
      [id, owner, fields.email, fields.hash, fields.usedAt ?? null],
    );
  };

  const notifiedAt = async (id: string): Promise<Date | null> => {
    const [row] = await dataSource.query(
      `SELECT claim_notified_at FROM emergency_access_contacts WHERE id = $1`,
      [id],
    );
    return row.claim_notified_at;
  };

  beforeAll(async () => {
    if (!fs.existsSync(MIGRATION)) {
      throw new Error(`Migration 145 not found at ${MIGRATION}`);
    }
    dataSource = new DataSource(INTEGRATION_TYPEORM_OPTIONS as never);
    await dataSource.initialize();
    await applyRlsPolicies(dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await cleanTables(dataSource, [
      "emergency_access_contacts",
      "emergency_access_settings",
      "users",
    ]);
    owner = (
      await createTestUserDirect(dataSource, { email: "legacy@example.com" })
    ).id;
    await removeColumns();
  });

  it("leaves a partial legacy delivery discoverable for recovery", async () => {
    // Both hashes were written before their sends; only the first email landed,
    // and there is no record of which. Marking both notified -- which is what
    // reading the hash as delivery does -- put the failed one permanently outside
    // the recovery query.
    const succeeded = "10000000-0000-4000-8000-000000000001";
    const failed = "10000000-0000-4000-8000-000000000002";
    await seedLegacyContact(succeeded, {
      email: "landed@example.com",
      hash: "hash-a",
    });
    await seedLegacyContact(failed, {
      email: "bounced@example.com",
      hash: "hash-b",
    });

    await applyMigration();

    expect(await notifiedAt(succeeded)).toBeNull();
    expect(await notifiedAt(failed)).toBeNull();
  });

  it("leaves every contact of an all-failed legacy grant discoverable", async () => {
    // The old code reset `granted_at` when nothing was delivered. Marking every
    // contact notified left emergency access silently disarmed: the initial grant
    // path asks only for contacts whose delivery record is null and would find
    // none.
    const a = "20000000-0000-4000-8000-000000000001";
    const b = "20000000-0000-4000-8000-000000000002";
    await seedLegacyContact(a, { email: "a@example.com", hash: "hash-a" });
    await seedLegacyContact(b, { email: "b@example.com", hash: "hash-b" });
    await dataSource.query(
      `INSERT INTO emergency_access_settings
         (owner_user_id, enabled, granted_at, reminder_after_days,
          grant_after_days)
       VALUES ($1, true, NULL, 7, 14)`,
      [owner],
    );

    await applyMigration();

    expect(await notifiedAt(a)).toBeNull();
    expect(await notifiedAt(b)).toBeNull();
  });

  it("treats an opened link as proof of delivery, because it is", async () => {
    // The one true inference available: a used token cannot have been used unless
    // it arrived. This contact must NOT be re-notified -- they consumed their link.
    const used = "30000000-0000-4000-8000-000000000001";
    await seedLegacyContact(used, {
      email: "used@example.com",
      hash: "hash-used",
      usedAt: "2026-05-02 10:00:00",
    });

    await applyMigration();

    const at = await notifiedAt(used);
    expect(at).not.toBeNull();
    expect(new Date(at!).toISOString()).toContain("2026-05-02");
  });

  it("leaves a contact who never had a token alone", async () => {
    const never = "40000000-0000-4000-8000-000000000001";
    await seedLegacyContact(never, {
      email: "never@example.com",
      hash: null,
    });

    await applyMigration();

    expect(await notifiedAt(never)).toBeNull();
  });

  it("adds the credential column empty, so legacy tokens rotate deliberately", async () => {
    const legacy = "50000000-0000-4000-8000-000000000001";
    await seedLegacyContact(legacy, {
      email: "legacy@example.com",
      hash: "hash-legacy",
    });

    await applyMigration();

    const [row] = await dataSource.query(
      `SELECT claim_token_ciphertext FROM emergency_access_contacts WHERE id = $1`,
      [legacy],
    );
    // Nothing to re-send, so the service rotates and logs it rather than pretending
    // the old link is still good.
    expect(row.claim_token_ciphertext).toBeNull();
  });

  it("is re-runnable: a second apply changes nothing", async () => {
    const used = "60000000-0000-4000-8000-000000000001";
    const pending = "60000000-0000-4000-8000-000000000002";
    await seedLegacyContact(used, {
      email: "used@example.com",
      hash: "h1",
      usedAt: "2026-05-02 10:00:00",
    });
    await seedLegacyContact(pending, {
      email: "pending@example.com",
      hash: "h2",
    });

    await applyMigration();
    const first = await dataSource.query(
      `SELECT id, claim_notified_at FROM emergency_access_contacts ORDER BY id`,
    );
    await applyMigration();
    const second = await dataSource.query(
      `SELECT id, claim_notified_at FROM emergency_access_contacts ORDER BY id`,
    );

    expect(second).toEqual(first);
  });
});
