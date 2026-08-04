import { ConflictException } from "@nestjs/common";
import { DataSource, EntityManager, QueryFailedError } from "typeorm";
import {
  runOutsideActiveScopedManager,
  withScopedDb,
} from "../../common/db/scoped-db";
import { ImportJob, ONE_ACTIVE_JOB_INDEX } from "./entities/import-job.entity";
import { MnyNotAMoneyFileError } from "./mny-errors";
import {
  JOB_FAILED_ERROR_KEY,
  JOB_HEARTBEAT_INTERVAL_MS,
  JOB_STALE_AFTER_MS,
  JOB_STALLED_ERROR_KEY,
  JOB_COMMITTED_STALLED_ERROR_KEY,
  MnyImportJobService,
  MnyJobFencedError,
  isActiveJobConflict,
  returnedRows,
} from "./mny-import-job.service";

import { DEFAULT_MNY_IMPORT_OPTIONS } from "./model/mny-import-options";

jest.mock("../../common/db/scoped-db", () => ({
  withScopedDb: jest.fn(),
  runOutsideActiveScopedManager: jest.fn((fn: () => unknown) => fn()),
}));

jest.mock("../../common/db/with-context", () => ({
  withSystemContext: <T>(fn: () => T): T => fn(),
  withUserContext: <T>(_userId: string, fn: () => T): T => fn(),
}));

const mockedScopedDb = withScopedDb as jest.MockedFunction<typeof withScopedDb>;
const mockedOutside = runOutsideActiveScopedManager as jest.MockedFunction<
  typeof runOutsideActiveScopedManager
>;

/**
 * What `pg` actually raises when the partial unique index refuses an INSERT.
 * The constraint name is the whole signal, so it comes from the same constant
 * the entity declares the index with.
 */
const activeJobViolation = (): QueryFailedError =>
  new QueryFailedError("INSERT", [], {
    code: "23505",
    constraint: ONE_ACTIVE_JOB_INDEX,
  } as unknown as Error);

/**
 * The claim's atomicity and the reaper's interval arithmetic are properties of
 * Postgres and are asserted in `test/integration/mny-import-job.integration.spec.ts`.
 * What is asserted here is the code around them: the statements the service
 * issues, the connection they issue them on, and the status a failed body leaves
 * behind.
 */
describe("returnedRows", () => {
  it("unwraps the [rows, rowCount] tuple a data-modifying query returns", () => {
    expect(returnedRows([[{ id: "job-1" }], 1])).toEqual([{ id: "job-1" }]);
  });

  it("reports no rows when the conditional update matched nothing", () => {
    expect(returnedRows([[], 0])).toEqual([]);
  });

  it("passes bare SELECT rows through", () => {
    expect(returnedRows([{ id: "job-1" }, { id: "job-2" }])).toEqual([
      { id: "job-1" },
      { id: "job-2" },
    ]);
  });

  it("treats an empty result as no rows", () => {
    expect(returnedRows([])).toEqual([]);
  });

  it("treats a non-array result as no rows rather than throwing", () => {
    expect(returnedRows(undefined)).toEqual([]);
    expect(returnedRows(null)).toEqual([]);
    expect(returnedRows({ rowCount: 1 })).toEqual([]);
  });

  it("does not mistake a tuple for two rows", () => {
    // The actual defect: length 2 on the tuple read as "two rows updated".
    expect(returnedRows([[], 0])).toHaveLength(0);
  });
});

/** A stable attempt token, so a spec can assert what the fence compares. */
const TOKEN = "9f1b7c2e-0000-4000-8000-abcdefabcdef";

describe("MnyImportJobService", () => {
  let repo: Record<string, jest.Mock>;
  let query: jest.Mock;
  let service: MnyImportJobService;

  const sql = (call: unknown[]): string => String(call[0]).replace(/\s+/g, " ");
  const lastCall = (): unknown[] =>
    query.mock.calls[query.mock.calls.length - 1] as unknown[];

  beforeEach(() => {
    repo = {
      create: jest.fn((entity) => entity),
      save: jest.fn((entity) => Promise.resolve({ id: "job-1", ...entity })),
      findOne: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
    };
    query = jest.fn().mockResolvedValue([[], 0]);

    const manager = {
      getRepository: jest.fn(() => repo),
      query,
    } as unknown as EntityManager;

    mockedScopedDb.mockImplementation((_dataSource, fn) => fn(manager));
    mockedOutside.mockImplementation((fn) => fn());

    service = new MnyImportJobService({} as DataSource);
    jest.spyOn(service["logger"], "log").mockImplementation(() => undefined);
    jest.spyOn(service["logger"], "warn").mockImplementation(() => undefined);
    jest.spyOn(service["logger"], "error").mockImplementation(() => undefined);
  });

  afterEach(() => jest.clearAllMocks());

  describe("create", () => {
    it("inserts a pending, non-retryable job for the caller", async () => {
      const job = await service.create(
        "user-1",
        "staged-1",
        DEFAULT_MNY_IMPORT_OPTIONS,
      );

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user-1",
          stagedFileId: "staged-1",
          sourceFormat: "mny",
          status: "pending",
          options: DEFAULT_MNY_IMPORT_OPTIONS,
          retryable: false,
        }),
      );
      expect(job.id).toBe("job-1");
    });

    it("translates the one-active-job index into the 409 the wizard renders", async () => {
      repo.save.mockRejectedValue(activeJobViolation());

      await expect(
        service.create("user-1", "staged-1", DEFAULT_MNY_IMPORT_OPTIONS),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("rethrows a violation of any other constraint untouched", async () => {
      // "An import is already running" is a specific claim, and a foreign-key
      // failure on the staged file is not evidence for it.
      const other = new QueryFailedError("INSERT", [], {
        code: "23503",
        constraint: "import_jobs_staged_file_id_fkey",
      } as unknown as Error);
      repo.save.mockRejectedValue(other);

      await expect(
        service.create("user-1", "staged-1", DEFAULT_MNY_IMPORT_OPTIONS),
      ).rejects.toBe(other);
    });

    it("rethrows a plain error, which carries no driver code at all", async () => {
      const boom = new Error("connection terminated");
      repo.save.mockRejectedValue(boom);

      await expect(
        service.create("user-1", "staged-1", DEFAULT_MNY_IMPORT_OPTIONS),
      ).rejects.toBe(boom);
    });
  });

  describe("isActiveJobConflict", () => {
    it("recognizes the unique violation the partial index raises", () => {
      expect(isActiveJobConflict(activeJobViolation())).toBe(true);
    });

    it("rejects a unique violation from a different index", () => {
      expect(
        isActiveJobConflict(
          new QueryFailedError("INSERT", [], {
            code: "23505",
            constraint: "some_other_unique_index",
          } as unknown as Error),
        ),
      ).toBe(false);
    });

    it("rejects anything that is not a query failure", () => {
      expect(isActiveJobConflict(new Error("nope"))).toBe(false);
      expect(isActiveJobConflict(undefined)).toBe(false);
    });
  });

  describe("discard", () => {
    it("deletes only this user's job, and only while it is still pending", async () => {
      await service.discard("user-1", "job-1");

      expect(sql(lastCall())).toContain(
        "DELETE FROM import_jobs WHERE id = $1 AND user_id = $2 AND status = 'pending'",
      );
      expect(lastCall()[1]).toEqual(["job-1", "user-1"]);
    });
  });

  describe("findOne", () => {
    it("scopes the lookup to the caller", async () => {
      await service.findOne("user-1", "job-1");

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { id: "job-1", userId: "user-1" },
      });
    });

    it("returns null for another user's job", async () => {
      expect(await service.findOne("user-1", "job-1")).toBeNull();
    });
  });

  describe("hasActiveJob", () => {
    it("counts both pending and running jobs", async () => {
      expect(await service.hasActiveJob("user-1")).toBe(false);

      expect(repo.count).toHaveBeenCalledWith({
        where: [
          { userId: "user-1", status: "pending" },
          { userId: "user-1", status: "running" },
        ],
      });
    });

    it("is true once one exists", async () => {
      repo.count.mockResolvedValue(1);

      expect(await service.hasActiveJob("user-1")).toBe(true);
    });
  });

  describe("claim", () => {
    it("only claims a job still pending", async () => {
      await service.claim("job-1");

      expect(sql(query.mock.calls[0])).toContain(
        "WHERE id = $1 AND status = 'pending'",
      );
      expect(query.mock.calls[0][1][0]).toBe("job-1");
    });

    it("wins when the conditional update returned the row", async () => {
      query.mockResolvedValue([[{ id: "job-1" }], 1]);

      // The claim mints this attempt's fencing token and hands it back; every
      // subsequent worker write names it (audit RV4-001).
      const token = await service.claim("job-1");
      expect(token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(sql(query.mock.calls[0])).toContain("attempt_token = $2");
      expect(query.mock.calls[0][1][1]).toBe(token);
    });

    it("loses when another worker got there first", async () => {
      query.mockResolvedValue([[], 0]);

      expect(await service.claim("job-1")).toBeNull();
    });
  });

  describe("reportProgress", () => {
    it("publishes on its own connection, outside the import transaction", async () => {
      await service.reportProgress("job-1", TOKEN, {
        phase: "transactions",
        processed: 10,
        total: 100,
      });

      // Progress written inside the import's transaction would stay invisible
      // until commit -- a frozen progress bar for the whole run.
      expect(mockedOutside).toHaveBeenCalledTimes(1);
      expect(sql(query.mock.calls[0])).toContain("SET progress = $3::jsonb");
      expect(query.mock.calls[0][1][2]).toBe(
        JSON.stringify({ phase: "transactions", processed: 10, total: 100 }),
      );
    });

    it("only touches a job that is still running", async () => {
      await service.reportProgress("job-1", TOKEN, {
        phase: "preparing",
        processed: 0,
        total: 0,
      });

      expect(sql(query.mock.calls[0])).toContain(
        "WHERE id = $1 AND status = 'running' AND attempt_token = $2",
      );
    });
  });

  describe("heartbeat", () => {
    it("stamps the heartbeat outside the import transaction", async () => {
      await service.heartbeat("job-1", TOKEN);

      expect(mockedOutside).toHaveBeenCalledTimes(1);
      expect(sql(query.mock.calls[0])).toContain(
        "SET heartbeat_at = CURRENT_TIMESTAMP",
      );
      // Token-scoped: a reaped worker's heartbeat must not make the job look
      // alive again.
      expect(sql(query.mock.calls[0])).toContain("attempt_token = $2");
      expect(query.mock.calls[0][1]).toEqual(["job-1", TOKEN]);
    });
  });

  /**
   * The fence (audit RV4-001).
   *
   * The reaper decides a job is dead from a *separate* connection while the
   * import transaction runs on another, so the worker can be blocked long enough
   * to be written off and then wake up. Before the token, its checkpoint was an
   * unconditional `SET data_committed = true WHERE id = $1`: it committed the
   * whole file behind the reaper's back, beside a job row inviting a retry that
   * would import it again.
   */
  describe("markDataCommitted", () => {
    const manager = (): EntityManager =>
      ({ query }) as unknown as EntityManager;

    it("checkpoints only while this worker still owns the running job", async () => {
      query.mockResolvedValue([[{ id: "job-1" }], 1]);

      await service.markDataCommitted(manager(), "job-1", TOKEN);

      const statement = sql(lastCall());
      expect(statement).toContain("SET data_committed = true");
      expect(statement).toContain(
        "WHERE id = $1 AND status = 'running' AND attempt_token = $2",
      );
      expect(statement).toContain("RETURNING id");
      expect(lastCall()[1]).toEqual(["job-1", TOKEN]);
    });

    it("throws when the reaper has already revoked this attempt", async () => {
      // Zero rows: the job is no longer running, or its token was cleared. This
      // is the last statement in the import transaction, so throwing here is what
      // rolls the whole import back instead of committing it.
      query.mockResolvedValue([[], 0]);

      await expect(
        service.markDataCommitted(manager(), "job-1", TOKEN),
      ).rejects.toBeInstanceOf(MnyJobFencedError);
    });

    it("reads the row count rather than the result's length", async () => {
      // `UPDATE ... RETURNING` comes back as the tuple `[rows, rowCount]`, so
      // `result.length` is 2 whether or not anything was updated -- a length check
      // here would make every fenced worker a winner, which is the exact bug the
      // fence exists to prevent.
      query.mockResolvedValue([[], 0]);

      await expect(
        service.markDataCommitted(manager(), "job-1", TOKEN),
      ).rejects.toBeInstanceOf(MnyJobFencedError);
    });
  });

  describe("complete", () => {
    it("stores the result and clears progress", async () => {
      await service.complete("job-1", TOKEN, {
        accountsCreated: 2,
      } as never);

      const statement = sql(query.mock.calls[0]);
      expect(statement).toContain("SET status = 'completed'");
      expect(statement).toContain("progress = NULL");
      // A completed job has no attempt left to fence.
      expect(statement).toContain("attempt_token = NULL");
      expect(statement).toContain("attempt_token = $2");
      expect(query.mock.calls[0][1][2]).toBe(
        JSON.stringify({ accountsCreated: 2 }),
      );
    });
  });

  describe("fail", () => {
    it("records the key, the detail and whether a retry could help", async () => {
      await service.fail("job-1", "mnyImportFailed", "connection reset", true);

      expect(sql(query.mock.calls[0])).toContain("SET status = 'failed'");
      expect(query.mock.calls[0][1]).toEqual([
        "job-1",
        "mnyImportFailed",
        "connection reset",
        true,
        // No token: this caller failed the job before any worker claimed it, so
        // the statement's `$5 IS NULL` arm applies.
        null,
      ]);
    });
  });

  describe("runClaimed", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      query.mockResolvedValue([[{ id: "job-1" }], 1]);
    });

    afterEach(() => jest.useRealTimers());

    it("does nothing when another worker already claimed the job", async () => {
      query.mockResolvedValue([[], 0]);
      const body = jest.fn();

      expect(await service.runClaimed("user-1", "job-1", body)).toBe(false);
      expect(body).not.toHaveBeenCalled();
    });

    it("runs the body and completes the job", async () => {
      const body = jest.fn().mockResolvedValue({ accountsCreated: 1 });

      expect(await service.runClaimed("user-1", "job-1", body)).toBe(true);
      expect(body).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: "job-1", userId: "user-1" }),
      );
      expect(sql(lastCall())).toContain("SET status = 'completed'");
    });

    it("gives the body a progress channel wired to this job", async () => {
      const body = jest.fn(async (context) => {
        await context.reportProgress({
          phase: "reference",
          processed: 1,
          total: 2,
        });
        return { accountsCreated: 0 } as never;
      });

      await service.runClaimed("user-1", "job-1", body);

      const progressCall = query.mock.calls.find((call) =>
        sql(call).includes("SET progress = $3::jsonb"),
      );
      expect(progressCall?.[1][0]).toBe("job-1");
    });

    it("marks a parse failure as not retryable, under its own error code", async () => {
      const body = jest
        .fn()
        .mockRejectedValue(new MnyNotAMoneyFileError("Standard Jet DB"));

      expect(await service.runClaimed("user-1", "job-1", body)).toBe(true);
      const failure = lastCall();
      expect(sql(failure)).toContain("SET status = 'failed'");
      // Retrying the same bytes cannot help.
      expect((failure[1] as unknown[])[1]).toBe("mnyNotAMoneyFile");
      expect((failure[1] as unknown[])[3]).toBe(false);
    });

    it("marks any other failure retryable, since the staged file survives", async () => {
      const body = jest.fn().mockRejectedValue(new Error("connection reset"));

      await service.runClaimed("user-1", "job-1", body);

      const failure = lastCall();
      expect((failure[1] as unknown[])[1]).toBe(JOB_FAILED_ERROR_KEY);
      expect((failure[1] as unknown[])[2]).toBe("connection reset");
      expect((failure[1] as unknown[])[3]).toBe(true);
    });

    it("records a non-Error rejection rather than losing it", async () => {
      const body = jest.fn().mockRejectedValue("something odd");

      await service.runClaimed("user-1", "job-1", body);

      expect((lastCall()[1] as unknown[])[2]).toBe("something odd");
    });

    it("heartbeats while the body runs and stops when it finishes", async () => {
      let release: () => void = () => undefined;
      const body = jest.fn(
        () =>
          new Promise<never>((resolve) => {
            release = () => resolve({ accountsCreated: 0 } as never);
          }),
      );

      const run = service.runClaimed("user-1", "job-1", body);
      // The claim is a few awaits deep; the interval only exists once it wins.
      for (let tick = 0; tick < 10 && body.mock.calls.length === 0; tick++) {
        await Promise.resolve();
      }

      jest.advanceTimersByTime(JOB_HEARTBEAT_INTERVAL_MS);
      await Promise.resolve();
      await Promise.resolve();
      expect(
        query.mock.calls.filter((call) =>
          sql(call).includes("SET heartbeat_at = CURRENT_TIMESTAMP WHERE"),
        ),
      ).toHaveLength(1);

      release();
      await run;

      const afterCompletion = query.mock.calls.length;
      jest.advanceTimersByTime(JOB_HEARTBEAT_INTERVAL_MS * 3);
      await Promise.resolve();
      await Promise.resolve();
      expect(query.mock.calls).toHaveLength(afterCompletion);
    });

    it("swallows a failed heartbeat rather than killing the import", async () => {
      const body = jest.fn().mockResolvedValue({ accountsCreated: 0 });
      mockedOutside.mockImplementationOnce(() =>
        Promise.reject(new Error("connection reset")),
      );

      await expect(service.runClaimed("user-1", "job-1", body)).resolves.toBe(
        true,
      );
    });
  });

  describe("reapStaleJobs", () => {
    it("revokes the attempt token, so a reaped worker cannot commit", async () => {
      await service.reapStaleJobs();

      // Clearing the token is what makes the reap stick: the worker's own commit
      // checkpoint names it, so once it is gone that worker's import transaction
      // refuses and rolls back rather than landing behind the reaper's back
      // (audit RV4-001). Failing the row alone never stopped the write.
      expect(sql(query.mock.calls[0])).toContain("attempt_token = NULL");
    });

    it("fails running jobs whose heartbeat went stale", async () => {
      await service.reapStaleJobs();

      const statement = sql(query.mock.calls[0]);
      expect(statement).toContain("status = 'running'");
      expect(statement).toContain("heartbeat_at < CURRENT_TIMESTAMP");
      expect(query.mock.calls[0][1]).toEqual([
        String(JOB_STALE_AFTER_MS),
        JOB_STALLED_ERROR_KEY,
        JOB_COMMITTED_STALLED_ERROR_KEY,
      ]);
    });

    it("derives retryability from data_committed, not from being a reap", async () => {
      // The regression this test previously enshrined: it asserted
      // `retryable = true` outright. Dying between the import transaction's
      // commit and `complete()` is exactly what the reaper exists to clean up, so
      // hard-coding retryable there routes around the one rule that stops a
      // retry inserting every imported row a second time (audit FV4-001).
      await service.reapStaleJobs();

      const statement = sql(query.mock.calls[0]);
      expect(statement).toContain("retryable = (data_committed = false)");
      expect(statement).not.toContain("retryable = true");
    });

    it("gives a committed-then-stalled job its own error key", async () => {
      // The two states need different advice: one can be retried and the other
      // must not be, so they cannot share a message.
      await service.reapStaleJobs();

      const statement = sql(query.mock.calls[0]);
      expect(statement).toContain("WHEN data_committed THEN $3");
      expect(statement).toContain("not safe to repeat");
    });

    it("reports a committed stalled job at error level, naming it", async () => {
      // Its rows are in the database but the job never reported a result, so the
      // user sees a failure over data that actually landed. An operator has to
      // know which job that was.
      query.mockResolvedValue([
        [
          { id: "job-1", data_committed: false },
          { id: "job-2", data_committed: true },
        ],
        2,
      ]);
      const error = jest.spyOn(service["logger"], "error");

      await service.reapStaleJobs();

      expect(error).toHaveBeenCalledWith(expect.stringContaining("job-2"));
      expect(error.mock.calls[0][0]).toContain("NOT retryable");
      expect(error.mock.calls[0][0]).not.toContain("job-1");
    });

    it("fails pending jobs no worker ever claimed, measured from creation", async () => {
      // A row stuck pending is worse than a stuck running one: `hasActiveJob`
      // counts it, so it refuses every future import for that user, forever.
      await service.reapStaleJobs();

      const statement = sql(query.mock.calls[0]);
      expect(statement).toContain("status = 'pending'");
      expect(statement).toContain("created_at < CURRENT_TIMESTAMP");
    });

    it("logs the jobs it reaped", async () => {
      query.mockResolvedValue([
        [
          { id: "job-1", data_committed: false },
          { id: "job-2", data_committed: false },
        ],
        2,
      ]);
      const warn = jest.spyOn(service["logger"], "warn");

      await service.reapStaleJobs();

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Reaped 2 stalled import job(s)"),
      );
    });

    it("says nothing when there was nothing to reap", async () => {
      const warn = jest.spyOn(service["logger"], "warn");

      await service.reapStaleJobs();

      expect(warn).not.toHaveBeenCalled();
    });

    it("never throws, so one bad sweep cannot kill the scheduler", async () => {
      query.mockRejectedValue(new Error("connection reset"));

      await expect(service.reapStaleJobs()).resolves.toBeUndefined();
    });
  });

  it("exposes the job entity it operates on", () => {
    // Guards the repository the scoped manager is asked for -- a typo here
    // would silently operate on the wrong table.
    expect(ImportJob.name).toBe("ImportJob");
  });
});
