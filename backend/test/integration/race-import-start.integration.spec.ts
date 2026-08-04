import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConflictException } from "@nestjs/common";
import { DataSource } from "typeorm";

import { ImportJob } from "@/import/mny/entities/import-job.entity";
import { ImportStagedFile } from "@/import/mny/entities/import-staged-file.entity";
import {
  MnyImportJobService,
  isActiveJobConflict,
} from "@/import/mny/mny-import-job.service";
import { MnyStagingService } from "@/import/mny/mny-staging.service";
import { DEFAULT_MNY_IMPORT_OPTIONS } from "@/import/mny/model/mny-import-options";
import { withUserContext } from "@/common/db/with-context";

import {
  INTEGRATION_TYPEORM_OPTIONS,
  cleanTables,
  createTestUserDirect,
} from "../helpers/integration-setup";
import { applyRlsPolicies } from "../helpers/rls-setup";
import {
  describeOutcomes,
  losers,
  raceAll,
  winners,
} from "../helpers/race-harness";

/**
 * P4-001 / audit race 1: two `start` requests for the same owner.
 *
 * `start` counted the owner's in-flight jobs and then, in a separate
 * transaction, inserted a new one. That is a check-then-act across two
 * transactions, so two requests arriving together -- a double-clicked Start
 * button, two replicas behind a load balancer, a retried fetch -- both counted
 * zero and both inserted. Two workers then parsed the same file into the same
 * accounts, and every transaction in it landed twice.
 *
 * The guard is now a partial unique index, which is why this suite needs a real
 * database: the constraint *is* the fix, and nothing about it exists in the
 * TypeScript. A mocked repository would happily accept both inserts.
 *
 * Note this race does not need the gate. The window here is not a lock-ordering
 * one -- both requests are simply inserting, and the index arbitrates whichever
 * order they arrive in -- so `raceAll` is enough, and adding a gate would only
 * make the test look more careful than it is.
 */
describe("Import start reservation (integration)", () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let jobs: MnyImportJobService;
  let staging: MnyStagingService;
  let userId: string;
  let otherUserId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot(INTEGRATION_TYPEORM_OPTIONS),
        TypeOrmModule.forFeature([ImportJob, ImportStagedFile]),
      ],
      providers: [MnyImportJobService, MnyStagingService],
    }).compile();

    dataSource = module.get(DataSource);
    jobs = module.get(MnyImportJobService);
    staging = module.get(MnyStagingService);

    // `synchronize: true` builds tables from entity metadata and knows nothing
    // about a partial unique index declared in schema.sql, so the constraint
    // under test has to be created here or this suite would prove the opposite
    // of what it claims.
    await applyRlsPolicies(dataSource);
    await dataSource.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_import_jobs_one_active_per_user
         ON import_jobs (user_id) WHERE status IN ('pending', 'running')`,
    );
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await cleanTables(dataSource, [
      "import_jobs",
      "import_staged_files",
      "users",
    ]);
    userId = (await createTestUserDirect(dataSource)).id;
    otherUserId = (await createTestUserDirect(dataSource)).id;
  });

  async function stage(owner: string): Promise<string> {
    const staged = await withUserContext(owner, () =>
      staging.stage(owner, {
        filename: "money.mny",
        data: Buffer.from(`bytes-${owner}`),
      }),
    );
    return staged.id;
  }

  const activeJobCount = (owner: string) =>
    dataSource.query(
      `SELECT COUNT(*)::int AS n FROM import_jobs
        WHERE user_id = $1 AND status IN ('pending', 'running')`,
      [owner],
    ) as Promise<Array<{ n: number }>>;

  it("creates one job when two requests reserve the slot at once", async () => {
    const stagedId = await stage(userId);

    const outcomes = await raceAll([
      () =>
        withUserContext(userId, () =>
          jobs.create(userId, stagedId, DEFAULT_MNY_IMPORT_OPTIONS),
        ),
      () =>
        withUserContext(userId, () =>
          jobs.create(userId, stagedId, DEFAULT_MNY_IMPORT_OPTIONS),
        ),
    ]);

    expect(winners(outcomes)).toHaveLength(1);
    expect((await activeJobCount(userId))[0].n).toBe(1);
    // The loser is a conflict, not a leaked driver error: the wizard shows this.
    expect(losers(outcomes)[0]).toBeInstanceOf(ConflictException);
    expect(describeOutcomes(outcomes)).toContain("ConflictException");
  });

  it("holds at four simultaneous requests, not just two", async () => {
    const stagedId = await stage(userId);

    const outcomes = await raceAll(
      Array.from(
        { length: 4 },
        () => () =>
          withUserContext(userId, () =>
            jobs.create(userId, stagedId, DEFAULT_MNY_IMPORT_OPTIONS),
          ),
      ),
    );

    expect(winners(outcomes)).toHaveLength(1);
    expect(losers(outcomes)).toHaveLength(3);
    expect((await activeJobCount(userId))[0].n).toBe(1);
  });

  it("does not let one owner's import block another's", async () => {
    // The constraint is per-owner, and a global one would be an outage for
    // everybody the moment two people imported at the same time.
    const [mine, theirs] = await Promise.all([
      stage(userId),
      stage(otherUserId),
    ]);

    const outcomes = await raceAll([
      () =>
        withUserContext(userId, () =>
          jobs.create(userId, mine, DEFAULT_MNY_IMPORT_OPTIONS),
        ),
      () =>
        withUserContext(otherUserId, () =>
          jobs.create(otherUserId, theirs, DEFAULT_MNY_IMPORT_OPTIONS),
        ),
    ]);

    expect(winners(outcomes)).toHaveLength(2);
    expect((await activeJobCount(userId))[0].n).toBe(1);
    expect((await activeJobCount(otherUserId))[0].n).toBe(1);
  });

  it("frees the slot once the previous job finishes, so a second import is allowed", async () => {
    const stagedId = await stage(userId);
    const first = await withUserContext(userId, () =>
      jobs.create(userId, stagedId, DEFAULT_MNY_IMPORT_OPTIONS),
    );
    await withUserContext(userId, () => jobs.claim(first.id));
    await withUserContext(userId, () =>
      jobs.fail(first.id, "mnyImportFailed", "boom", true),
    );

    // Retry has to work, so the constraint must cover only the active statuses.
    const second = await withUserContext(userId, () =>
      jobs.create(userId, stagedId, DEFAULT_MNY_IMPORT_OPTIONS),
    );

    expect(second.id).not.toBe(first.id);
    expect((await activeJobCount(userId))[0].n).toBe(1);
    expect(
      await dataSource.getRepository(ImportJob).count({ where: { userId } }),
    ).toBe(2);
  });

  it("recognises its own constraint and nothing else", async () => {
    // The translation from driver error to 409 keys off the constraint name, so
    // an unrelated unique violation must not be reported as "an import is
    // already running".
    expect(
      isActiveJobConflict({
        code: "23505",
        constraint: "idx_import_jobs_one_active_per_user",
      }),
    ).toBe(true);
    expect(
      isActiveJobConflict({ code: "23505", constraint: "users_email_key" }),
    ).toBe(false);
    expect(isActiveJobConflict({ code: "23503" })).toBe(false);
    expect(isActiveJobConflict(new Error("nope"))).toBe(false);
    expect(isActiveJobConflict(null)).toBe(false);
  });
});
