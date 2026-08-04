import { Test, TestingModule } from "@nestjs/testing";
import { ConflictException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DataSource, EntityManager } from "typeorm";

import { ImportJob } from "@/import/mny/entities/import-job.entity";
import { ImportStagedFile } from "@/import/mny/entities/import-staged-file.entity";
import {
  JOB_STALLED_ERROR_KEY,
  MnyImportJobService,
  MnyImportSlotLostError,
} from "@/import/mny/mny-import-job.service";
import { MnyStagingService } from "@/import/mny/mny-staging.service";
import { MnyPasswordIncorrectError } from "@/import/mny/mny-errors";
import { DEFAULT_MNY_IMPORT_OPTIONS } from "@/import/mny/model/mny-import-options";
import { MnyImportResult } from "@/import/mny/model/mny-import-job";
import { withUserContext } from "@/common/db/with-context";
import { withScopedDb } from "@/common/db/scoped-db";

import {
  INTEGRATION_TYPEORM_OPTIONS,
  cleanTables,
  createTestUserDirect,
} from "../helpers/integration-setup";

/**
 * Job concurrency against a real database, because the properties that matter
 * are properties of Postgres, not of the service: the partial unique index that
 * lets only one start per user insert a row, the conditional UPDATE that makes a
 * claim atomic, and the interval arithmetic the reaper depends on.
 *
 * A mocked repository can express any of these and prove none: the losing INSERT
 * has to actually block on the winner and then fail.
 */
describe("MnyImportJobService (integration)", () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let jobs: MnyImportJobService;
  let staging: MnyStagingService;
  let userA: string;
  let userB: string;

  const EMPTY_RESULT: MnyImportResult = {
    accountsCreated: 0,
    payeesCreated: 0,
    categoriesCreated: 0,
    transactionsCreated: 0,
    splitsCreated: 0,
    transfersLinked: 0,
    securitiesCreated: 0,
    investmentTransactionsCreated: 0,
    pricesImported: 0,
    exchangeRatesImported: 0,
    billsCreated: 0,
    skipped: {
      accounts: 0,
      payees: 0,
      categories: 0,
      transactions: 0,
      bills: 0,
    },
    existingDataRemoved: false,
    verification: [],
    holdings: [],
    warnings: [],
  };

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

    userA = (await createTestUserDirect(dataSource)).id;
    userB = (await createTestUserDirect(dataSource)).id;
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await cleanTables(dataSource, ["import_jobs", "import_staged_files"]);
  });

  const asUser = <T>(userId: string, fn: () => Promise<T>): Promise<T> =>
    withUserContext(userId, fn);

  async function newJob(userId = userA): Promise<string> {
    const staged = await asUser(userId, () =>
      staging.stage(userId, {
        filename: "money.mny",
        data: Buffer.from("bytes"),
      }),
    );
    const job = await asUser(userId, () =>
      jobs.create(userId, staged.id, DEFAULT_MNY_IMPORT_OPTIONS),
    );
    return job.id;
  }

  describe("create", () => {
    it("starts pending with the options it was given", async () => {
      const jobId = await newJob();
      const job = await asUser(userA, () => jobs.findOne(userA, jobId));

      expect(job).toMatchObject({ status: "pending", retryable: false });
      expect(job!.options.referencedOnlyPayees).toBe(true);
      expect(job!.startedAt).toBeNull();
    });

    it("is not visible to another user", async () => {
      const jobId = await newJob();

      expect(await asUser(userB, () => jobs.findOne(userB, jobId))).toBeNull();
    });
  });

  describe("one active job per user", () => {
    /**
     * A staged file of this user's, inserted directly.
     *
     * `MnyStagingService.stage` drops the user's previous file, so it cannot
     * produce the two-live-files case at all -- and the rule under test is one
     * import per *user*, which has to hold however many staged rows exist.
     */
    async function stage(userId: string): Promise<string> {
      const row = await asUser(userId, () =>
        withScopedDb(dataSource, (manager) => {
          const repo = manager.getRepository(ImportStagedFile);
          return repo.save(
            repo.create({
              userId,
              filename: "money.mny",
              sourceFormat: "mny",
              sizeBytes: 5,
              sha256: "0".repeat(64),
              data: Buffer.from("bytes"),
              expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            }),
          );
        }),
      );
      return row.id;
    }

    const activeCount = async (userId: string): Promise<number> => {
      const rows = await dataSource.query(
        `SELECT COUNT(*)::int AS count FROM import_jobs
          WHERE user_id = $1 AND status IN ('pending', 'running')`,
        [userId],
      );
      return rows[0].count;
    };

    const settle = async (
      results: PromiseSettledResult<ImportJob>[],
    ): Promise<{ created: ImportJob[]; refused: unknown[] }> => ({
      created: results
        .filter(
          (result): result is PromiseFulfilledResult<ImportJob> =>
            result.status === "fulfilled",
        )
        .map((result) => result.value),
      refused: results
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        )
        .map((result) => result.reason),
    });

    it("has exactly one winner when two starts race over the same staged file", async () => {
      // The defect this index exists for: `hasActiveJob` then `create` are two
      // transactions, so both requests could count zero and both insert. Each
      // parse generates fresh transaction UUIDs, so the second import would not
      // deduplicate -- it would double the user's history and balances.
      const stagedFileId = await stage(userA);

      const { created, refused } = await settle(
        await Promise.allSettled([
          asUser(userA, () =>
            jobs.create(userA, stagedFileId, DEFAULT_MNY_IMPORT_OPTIONS),
          ),
          asUser(userA, () =>
            jobs.create(userA, stagedFileId, DEFAULT_MNY_IMPORT_OPTIONS),
          ),
        ]),
      );

      expect(created).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0]).toBeInstanceOf(ConflictException);
      expect(await activeCount(userA)).toBe(1);
    });

    it("has one winner across four concurrent starts", async () => {
      const stagedFileId = await stage(userA);

      const { created, refused } = await settle(
        await Promise.allSettled(
          Array.from({ length: 4 }, () =>
            asUser(userA, () =>
              jobs.create(userA, stagedFileId, DEFAULT_MNY_IMPORT_OPTIONS),
            ),
          ),
        ),
      );

      expect(created).toHaveLength(1);
      expect(refused).toHaveLength(3);
      for (const error of refused) {
        expect(error).toBeInstanceOf(ConflictException);
      }
      expect(await activeCount(userA)).toBe(1);
    });

    it("refuses a second start over a different staged file", async () => {
      // The rule is one import per user, not one import per file: two files
      // racing write the same accounts, payees and balances.
      const first = await stage(userA);
      const second = await stage(userA);

      const { created, refused } = await settle(
        await Promise.allSettled([
          asUser(userA, () =>
            jobs.create(userA, first, DEFAULT_MNY_IMPORT_OPTIONS),
          ),
          asUser(userA, () =>
            jobs.create(userA, second, DEFAULT_MNY_IMPORT_OPTIONS),
          ),
        ]),
      );

      expect(created).toHaveLength(1);
      expect(refused[0]).toBeInstanceOf(ConflictException);
      expect(await activeCount(userA)).toBe(1);
    });

    it("lets two users start imports concurrently", async () => {
      // The guard is per user. Making it global would mean one user's 200 MB
      // import locks out everyone else on the deployment.
      const forA = await stage(userA);
      const forB = await stage(userB);

      const { created, refused } = await settle(
        await Promise.allSettled([
          asUser(userA, () =>
            jobs.create(userA, forA, DEFAULT_MNY_IMPORT_OPTIONS),
          ),
          asUser(userB, () =>
            jobs.create(userB, forB, DEFAULT_MNY_IMPORT_OPTIONS),
          ),
        ]),
      );

      expect(refused).toHaveLength(0);
      expect(created).toHaveLength(2);
      expect(await activeCount(userA)).toBe(1);
      expect(await activeCount(userB)).toBe(1);
    });

    it("refuses a start while the first job is running, not merely pending", async () => {
      const jobId = await newJob(userA);
      await asUser(userA, () => jobs.claim(jobId));
      const stagedFileId = await stage(userA);

      await expect(
        asUser(userA, () =>
          jobs.create(userA, stagedFileId, DEFAULT_MNY_IMPORT_OPTIONS),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("allows a fresh import once the previous one completed", async () => {
      const jobId = await newJob(userA);
      await asUser(userA, () => jobs.claim(jobId));
      await asUser(userA, () => jobs.complete(jobId, EMPTY_RESULT));

      const stagedFileId = await stage(userA);
      const next = await asUser(userA, () =>
        jobs.create(userA, stagedFileId, DEFAULT_MNY_IMPORT_OPTIONS),
      );

      expect(next.status).toBe("pending");
    });

    it("allows Retry once the previous job failed", async () => {
      // Retry is one click on the failure screen, so a failed row must not
      // count against the slot.
      const jobId = await newJob(userA);
      await asUser(userA, () => jobs.claim(jobId));
      await asUser(userA, () => jobs.fail(jobId, "mnyImportFailed", "x", true));

      const stagedFileId = await stage(userA);
      await expect(
        asUser(userA, () =>
          jobs.create(userA, stagedFileId, DEFAULT_MNY_IMPORT_OPTIONS),
        ),
      ).resolves.toMatchObject({ status: "pending" });
    });
  });

  describe("discard", () => {
    it("gives the slot back so the user can start again immediately", async () => {
      const jobId = await newJob(userA);

      await asUser(userA, () => jobs.discard(userA, jobId));

      expect(await asUser(userA, () => jobs.findOne(userA, jobId))).toBeNull();
      await expect(asUser(userA, () => newJob(userA))).resolves.toBeDefined();
    });

    it("leaves a claimed job alone -- it belongs to its worker now", async () => {
      const jobId = await newJob(userA);
      await asUser(userA, () => jobs.claim(jobId));

      await asUser(userA, () => jobs.discard(userA, jobId));

      const job = await asUser(userA, () => jobs.findOne(userA, jobId));
      expect(job!.status).toBe("running");
    });

    it("cannot discard another user's job", async () => {
      const jobId = await newJob(userA);

      await asUser(userB, () => jobs.discard(userB, jobId));

      expect(
        (await asUser(userA, () => jobs.findOne(userA, jobId)))!.status,
      ).toBe("pending");
    });
  });

  describe("claim", () => {
    it("has exactly one winner when two workers race", async () => {
      const jobId = await newJob();

      const outcomes = await Promise.all([
        asUser(userA, () => jobs.claim(jobId)),
        asUser(userA, () => jobs.claim(jobId)),
      ]);

      expect(outcomes.filter(Boolean)).toHaveLength(1);
    });

    it("has one winner across four concurrent workers", async () => {
      const jobId = await newJob();

      const outcomes = await Promise.all(
        Array.from({ length: 4 }, () => asUser(userA, () => jobs.claim(jobId))),
      );

      expect(outcomes.filter(Boolean)).toHaveLength(1);
    });

    it("stamps the row running with a heartbeat", async () => {
      const jobId = await newJob();
      await asUser(userA, () => jobs.claim(jobId));

      const job = await asUser(userA, () => jobs.findOne(userA, jobId));
      expect(job!.status).toBe("running");
      expect(job!.startedAt).not.toBeNull();
      expect(job!.heartbeatAt).not.toBeNull();
    });

    it("refuses a job that already completed", async () => {
      const jobId = await newJob();
      await asUser(userA, () => jobs.claim(jobId));
      await asUser(userA, () => jobs.complete(jobId, EMPTY_RESULT));

      expect(await asUser(userA, () => jobs.claim(jobId))).toBe(false);
    });
  });

  describe("progress", () => {
    it("is visible to a reader while the import transaction is still open", async () => {
      // The reason runOutsideActiveScopedManager exists: a progress write inside
      // the import's transaction would be invisible until commit.
      const jobId = await newJob();
      await asUser(userA, () => jobs.claim(jobId));

      await asUser(userA, () =>
        withScopedDb(dataSource, async () => {
          await jobs.reportProgress(jobId, {
            phase: "transactions",
            processed: 250,
            total: 1000,
          });

          const seenByPoller = await dataSource
            .getRepository(ImportJob)
            .findOne({ where: { id: jobId } });
          expect(seenByPoller!.progress).toEqual({
            phase: "transactions",
            processed: 250,
            total: 1000,
          });
        }),
      );
    });

    it("is ignored once the job is no longer running", async () => {
      const jobId = await newJob();

      await asUser(userA, () =>
        jobs.reportProgress(jobId, {
          phase: "preparing",
          processed: 0,
          total: 0,
        }),
      );

      const job = await asUser(userA, () => jobs.findOne(userA, jobId));
      expect(job!.progress).toBeNull();
    });
  });

  /**
   * The slot lease, against real transactions.
   *
   * The one-active-job index stops a *new* start from racing. It does not stop a
   * job that already claimed its slot from losing it mid-flight, and two things
   * do exactly that: the migration that retires pre-existing duplicates on a
   * database that raced before the index existed, and `reapStaleJobs` failing a
   * `running` job whose heartbeat lapsed. Every backend container runs migrations
   * at start-up and the Helm StatefulSet rolls pods one at a time, so a new pod
   * can retire a job an old pod is still importing.
   *
   * What made that dangerous was where the status was checked. `complete()` runs
   * *after* the body, so the financial rows are committed by the time anything
   * notices -- a retired duplicate could still double a user's history. The lease
   * check runs as the last statement of the writing transaction instead, so the
   * refusal rolls those rows back.
   */
  describe("assertStillHoldsSlot", () => {
    /** A table the body can write into, standing in for the imported rows. */
    const writeMarker = (manager: EntityManager, jobId: string) =>
      manager.query(
        `UPDATE import_jobs SET error_detail = 'wrote-financial-rows' WHERE id = $1`,
        [jobId],
      );

    const detailOf = async (jobId: string): Promise<string | null> => {
      const rows = await asUser(userA, () =>
        withScopedDb(dataSource, (manager) =>
          manager.query(`SELECT error_detail FROM import_jobs WHERE id = $1`, [
            jobId,
          ]),
        ),
      );
      return rows[0]?.error_detail ?? null;
    };

    it("passes while the job is running", async () => {
      const jobId = await newJob();
      await asUser(userA, () => jobs.claim(jobId));

      await expect(
        asUser(userA, () =>
          withScopedDb(dataSource, (manager) =>
            jobs.assertStillHoldsSlot(manager, jobId),
          ),
        ),
      ).resolves.toBeUndefined();
    });

    it("rolls the body's writes back when the job was retired mid-flight", async () => {
      const jobId = await newJob();
      await asUser(userA, () => jobs.claim(jobId));

      // Retire it the way migration 135 does, from outside the body's transaction.
      await asUser(userA, () =>
        withScopedDb(dataSource, (manager) =>
          manager.query(
            `UPDATE import_jobs SET status = 'failed', error_key = $2,
                    retryable = true WHERE id = $1`,
            [jobId, JOB_STALLED_ERROR_KEY],
          ),
        ),
      );

      await expect(
        asUser(userA, () =>
          withScopedDb(dataSource, async (manager) => {
            await writeMarker(manager, jobId);
            await jobs.assertStillHoldsSlot(manager, jobId);
          }),
        ),
      ).rejects.toBeInstanceOf(MnyImportSlotLostError);

      // The whole transaction rolled back, so the write is gone. Before the lease
      // check existed this was the point at which imported rows were committed.
      expect(await detailOf(jobId)).toBeNull();
    });

    it("refuses a job that is still pending -- it never claimed the slot", async () => {
      const jobId = await newJob();

      await expect(
        asUser(userA, () =>
          withScopedDb(dataSource, (manager) =>
            jobs.assertStillHoldsSlot(manager, jobId),
          ),
        ),
      ).rejects.toBeInstanceOf(MnyImportSlotLostError);
    });

    it("refuses a job row that no longer exists", async () => {
      // Distinguishable from "not yours": both are a lost slot, and neither may
      // let the body commit.
      await expect(
        asUser(userA, () =>
          withScopedDb(dataSource, (manager) =>
            jobs.assertStillHoldsSlot(
              manager,
              "00000000-0000-0000-0000-000000000000",
            ),
          ),
        ),
      ).rejects.toBeInstanceOf(MnyImportSlotLostError);
    });

    it("does not resurrect a retired job through complete()", async () => {
      // The second line of defence: `complete` carries AND status = 'running',
      // so a row the migration marked failed cannot later read as completed.
      const jobId = await newJob();
      await asUser(userA, () => jobs.claim(jobId));
      await asUser(userA, () => jobs.fail(jobId, "x", "retired", true));

      await asUser(userA, () => jobs.complete(jobId, EMPTY_RESULT));

      const job = await asUser(userA, () => jobs.findOne(userA, jobId));
      expect(job!.status).toBe("failed");
      expect(job!.result).toBeNull();
    });

    it("leaves the retiring party's explanation on the row", async () => {
      // A lost slot must not overwrite error_key with the generic failure key:
      // the row already says why it was retired.
      const jobId = await newJob();

      const ran = await asUser(userA, () =>
        jobs.runClaimed(userA, jobId, async (context) => {
          await asUser(userA, () =>
            withScopedDb(dataSource, (manager) =>
              manager.query(
                `UPDATE import_jobs SET status = 'failed', error_key = $2,
                        retryable = true WHERE id = $1`,
                [context.jobId, JOB_STALLED_ERROR_KEY],
              ),
            ),
          );
          throw new MnyImportSlotLostError(context.jobId, "failed");
        }),
      );

      const job = await asUser(userA, () => jobs.findOne(userA, jobId));
      expect(ran).toBe(true);
      expect(job!.status).toBe("failed");
      expect(job!.errorKey).toBe(JOB_STALLED_ERROR_KEY);
      expect(job!.retryable).toBe(true);
    });
  });

  describe("runClaimed", () => {
    it("completes with the body's result and clears progress", async () => {
      const jobId = await newJob();

      const ran = await asUser(userA, () =>
        jobs.runClaimed(userA, jobId, async (context) => {
          await context.reportProgress({
            phase: "reference",
            processed: 1,
            total: 2,
          });
          return { ...EMPTY_RESULT, transactionsCreated: 7 };
        }),
      );

      const job = await asUser(userA, () => jobs.findOne(userA, jobId));
      expect(ran).toBe(true);
      expect(job!.status).toBe("completed");
      expect(job!.result!.transactionsCreated).toBe(7);
      expect(job!.progress).toBeNull();
      expect(job!.completedAt).not.toBeNull();
    });

    it("does not run the body when another worker holds the job", async () => {
      const jobId = await newJob();
      await asUser(userA, () => jobs.claim(jobId));
      const body = jest.fn();

      const ran = await asUser(userA, () =>
        jobs.runClaimed(userA, jobId, body as never),
      );

      expect(ran).toBe(false);
      expect(body).not.toHaveBeenCalled();
    });

    it("marks a parse failure not retryable -- the same bytes cannot succeed", async () => {
      const jobId = await newJob();

      await asUser(userA, () =>
        jobs.runClaimed(userA, jobId, () => {
          throw new MnyPasswordIncorrectError();
        }),
      );

      const job = await asUser(userA, () => jobs.findOne(userA, jobId));
      expect(job!.status).toBe("failed");
      expect(job!.errorKey).toBe("mnyPasswordIncorrect");
      expect(job!.retryable).toBe(false);
    });

    it("marks any other failure retryable, since the staged file survives", async () => {
      const jobId = await newJob();

      await asUser(userA, () =>
        jobs.runClaimed(userA, jobId, () => {
          throw new Error("connection terminated");
        }),
      );

      const job = await asUser(userA, () => jobs.findOne(userA, jobId));
      expect(job).toMatchObject({
        status: "failed",
        errorKey: "mnyImportFailed",
        retryable: true,
        errorDetail: "connection terminated",
      });
      expect(job!.stagedFileId).not.toBeNull();
    });
  });

  describe("hasActiveJob", () => {
    it("is true for a pending job and false once it finished", async () => {
      const jobId = await newJob();
      expect(await asUser(userA, () => jobs.hasActiveJob(userA))).toBe(true);

      await asUser(userA, () => jobs.claim(jobId));
      expect(await asUser(userA, () => jobs.hasActiveJob(userA))).toBe(true);

      await asUser(userA, () => jobs.complete(jobId, EMPTY_RESULT));
      expect(await asUser(userA, () => jobs.hasActiveJob(userA))).toBe(false);
    });

    it("does not see another user's in-flight job", async () => {
      await newJob(userA);

      expect(await asUser(userB, () => jobs.hasActiveJob(userB))).toBe(false);
    });
  });

  describe("reapStaleJobs", () => {
    it("fails a running job whose heartbeat went stale, retryably", async () => {
      const jobId = await newJob();
      await asUser(userA, () => jobs.claim(jobId));
      await dataSource.query(
        "UPDATE import_jobs SET heartbeat_at = CURRENT_TIMESTAMP - INTERVAL '10 minutes' WHERE id = $1",
        [jobId],
      );

      await jobs.reapStaleJobs();

      const job = await asUser(userA, () => jobs.findOne(userA, jobId));
      expect(job).toMatchObject({
        status: "failed",
        errorKey: JOB_STALLED_ERROR_KEY,
        retryable: true,
      });
      // Retry has to be one click, so the bytes must still be there.
      expect(job!.stagedFileId).not.toBeNull();
    });

    it("leaves a job whose heartbeat is recent alone", async () => {
      const jobId = await newJob();
      await asUser(userA, () => jobs.claim(jobId));

      await jobs.reapStaleJobs();

      const job = await asUser(userA, () => jobs.findOne(userA, jobId));
      expect(job!.status).toBe("running");
    });

    it("leaves a freshly pending job alone -- its worker is about to claim it", async () => {
      const jobId = await newJob();
      // A pending row has never heartbeated, so the running rule must not read
      // its null heartbeat as stale.
      await dataSource.query(
        "UPDATE import_jobs SET heartbeat_at = CURRENT_TIMESTAMP - INTERVAL '1 day' WHERE id = $1",
        [jobId],
      );

      await jobs.reapStaleJobs();

      const job = await asUser(userA, () => jobs.findOne(userA, jobId));
      expect(job!.status).toBe("pending");
    });

    it("reaps a pending job no worker ever claimed", async () => {
      // `start` inserts the row and claims it from an unawaited task, so a pod
      // that dies in between leaves this. Nothing else clears it, and
      // `hasActiveJob` counts pending -- so without the reaper this one row
      // refuses every future import the user starts.
      const jobId = await newJob();
      await dataSource.query(
        "UPDATE import_jobs SET created_at = CURRENT_TIMESTAMP - INTERVAL '10 minutes' WHERE id = $1",
        [jobId],
      );

      await jobs.reapStaleJobs();

      expect(await asUser(userA, () => jobs.hasActiveJob(userA))).toBe(false);
      const job = await asUser(userA, () => jobs.findOne(userA, jobId));
      expect(job).toMatchObject({
        status: "failed",
        errorKey: JOB_STALLED_ERROR_KEY,
        retryable: true,
      });
      // Retryable is only honest if the bytes survived.
      expect(job!.stagedFileId).not.toBeNull();
    });

    it("is idempotent: a second sweep changes nothing", async () => {
      const jobId = await newJob();
      await asUser(userA, () => jobs.claim(jobId));
      await dataSource.query(
        "UPDATE import_jobs SET heartbeat_at = CURRENT_TIMESTAMP - INTERVAL '10 minutes' WHERE id = $1",
        [jobId],
      );

      await jobs.reapStaleJobs();
      const first = await asUser(userA, () => jobs.findOne(userA, jobId));
      await jobs.reapStaleJobs();
      const second = await asUser(userA, () => jobs.findOne(userA, jobId));

      expect(second!.completedAt).toEqual(first!.completedAt);
    });

    it("reaps across users, since it runs under a system context", async () => {
      const jobA = await newJob(userA);
      const jobB = await newJob(userB);
      await asUser(userA, () => jobs.claim(jobA));
      await asUser(userB, () => jobs.claim(jobB));
      await dataSource.query(
        "UPDATE import_jobs SET heartbeat_at = CURRENT_TIMESTAMP - INTERVAL '10 minutes'",
      );

      await jobs.reapStaleJobs();

      expect(
        (await asUser(userA, () => jobs.findOne(userA, jobA)))!.status,
      ).toBe("failed");
      expect(
        (await asUser(userB, () => jobs.findOne(userB, jobB)))!.status,
      ).toBe("failed");
    });
  });
});
