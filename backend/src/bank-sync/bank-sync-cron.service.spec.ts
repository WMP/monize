import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { getRequestContext } from "../common/request-context";
import { JobClaimService } from "../common/jobs/job-claim.service";
import {
  createJobClaimMock,
  JobClaimMock,
} from "../test-helpers/job-claim-testing";
import { createScopedDbMocks } from "../test-helpers/scoped-db-testing";
import { BankSyncCronService } from "./bank-sync-cron.service";
import { BankSyncService } from "./bank-sync.service";
import type { BankSyncResult } from "./bank-sync.types";
import { OTHER_USER_ID, USER_ID } from "./bank-sync-testing";

jest.mock("../common/db/scoped-db", () =>
  jest.requireActual("../test-helpers/scoped-db-testing").scopedDbMockModule(),
);

const ID_A = "b0b0b0b0-0000-4000-8000-00000000000a";
const ID_B = "b0b0b0b0-0000-4000-8000-00000000000b";
const ID_C = "b0b0b0b0-0000-4000-8000-00000000000c";

const result = (bankAccountId: string): BankSyncResult => ({
  bankAccountId,
  imported: 0,
  skipped: 0,
  refused: {
    missing_date: 0,
    future_date: 0,
    invalid_amount: 0,
    unknown_direction: 0,
    currency_mismatch: 0,
  },
  pending: 0,
  beforeCutoff: 0,
  bankBalance: null,
});

describe("BankSyncCronService", () => {
  const { manager, dataSource } = createScopedDbMocks();
  const bankSync: jest.Mocked<Pick<BankSyncService, "syncAccount">> = {
    syncAccount: jest.fn(),
  };
  let jobClaims: JobClaimMock;
  let service: BankSyncCronService;

  /** The users the fan-out finds, and each user's linked bank accounts. */
  let users: string[];
  let accountsByUser: Record<string, string[]>;

  beforeEach(async () => {
    jest.useFakeTimers({
      now: new Date("2026-09-30T05:17:00.000Z"),
      doNotFake: [
        "nextTick",
        "queueMicrotask",
        "setImmediate",
        "clearImmediate",
        "setInterval",
        "clearInterval",
        "setTimeout",
        "clearTimeout",
        "hrtime",
        "performance",
      ],
    });
    jest.clearAllMocks();
    jobClaims = createJobClaimMock();
    users = [USER_ID, OTHER_USER_ID];
    accountsByUser = { [USER_ID]: [ID_A, ID_B], [OTHER_USER_ID]: [ID_C] };
    manager.query.mockImplementation(
      async (sql: string, params?: unknown[]) => {
        if (String(sql).includes("SELECT DISTINCT c.user_id")) {
          return users.map((user_id) => ({ user_id }));
        }
        if (String(sql).includes("SELECT a.id")) {
          return (accountsByUser[params![0] as string] ?? []).map((id) => ({
            id,
          }));
        }
        return [];
      },
    );
    bankSync.syncAccount.mockImplementation(async (_user, id) => result(id));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BankSyncCronService,
        { provide: DataSource, useValue: dataSource },
        { provide: JobClaimService, useValue: jobClaims },
        { provide: BankSyncService, useValue: bankSync },
      ],
    }).compile();
    service = module.get(BankSyncCronService);
    jest.spyOn(service["logger"], "log").mockImplementation(() => undefined);
    jest.spyOn(service["logger"], "warn").mockImplementation(() => undefined);
    jest.spyOn(service["logger"], "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("lists users with an active, auto-sync connection that has a linked bank account", async () => {
    await service.handleDailySync();
    const sql = String(manager.query.mock.calls[0][0]);
    expect(sql).toContain("SELECT DISTINCT c.user_id");
    expect(sql).toContain("c.status = 'active'");
    expect(sql).toContain("c.auto_sync = true");
    expect(sql).toContain("a.account_id IS NOT NULL");
  });

  it("claims each user once for the UTC day, then syncs their linked accounts unattended, in order", async () => {
    await service.handleDailySync();

    expect(jobClaims.claimOnce.mock.calls).toEqual([
      ["bank_sync_daily", USER_ID, "2026-09-30"],
      ["bank_sync_daily", OTHER_USER_ID, "2026-09-30"],
    ]);
    expect(bankSync.syncAccount.mock.calls).toEqual([
      [USER_ID, ID_A, null],
      [USER_ID, ID_B, null],
      [OTHER_USER_ID, ID_C, null],
    ]);
  });

  it("runs each user's claim and syncs under that user's own identity", async () => {
    const seen: Array<[string, string | undefined]> = [];
    jobClaims.claimOnce.mockImplementation(async (_type, userId) => {
      seen.push(["claim", getRequestContext()?.userId]);
      expect(getRequestContext()?.userId).toBe(userId);
      return true;
    });
    bankSync.syncAccount.mockImplementation(async (userId, id) => {
      seen.push(["sync", getRequestContext()?.userId]);
      expect(getRequestContext()?.userId).toBe(userId);
      return result(id);
    });

    await service.handleDailySync();

    expect(seen.map(([, user]) => user)).toEqual([
      USER_ID,
      USER_ID,
      USER_ID,
      OTHER_USER_ID,
      OTHER_USER_ID,
    ]);
  });

  it("syncs nobody a second replica already claimed for the day", async () => {
    jobClaims.claimOnce.mockResolvedValue(false);
    await service.handleDailySync();
    expect(bankSync.syncAccount).not.toHaveBeenCalled();
  });

  it("claims once per user per day: a second run the same day syncs nothing", async () => {
    const claimed = new Set<string>();
    jobClaims.claimOnce.mockImplementation(async (type, userId, key) => {
      const id = `${type}:${userId}:${key}`;
      if (claimed.has(id)) return false;
      claimed.add(id);
      return true;
    });

    await service.handleDailySync();
    expect(bankSync.syncAccount).toHaveBeenCalledTimes(3);

    await service.handleDailySync();
    expect(bankSync.syncAccount).toHaveBeenCalledTimes(3);

    // The next UTC day is a new key.
    jest.setSystemTime(new Date("2026-10-01T05:17:00.000Z"));
    await service.handleDailySync();
    expect(bankSync.syncAccount).toHaveBeenCalledTimes(6);
  });

  it("does not hand the claim back when accounts fail: a retry would spend the bank's allowance", async () => {
    bankSync.syncAccount.mockRejectedValue(new Error("bank said no"));
    await service.handleDailySync();
    expect(jobClaims.releasePermanentClaim).not.toHaveBeenCalled();
    expect(jobClaims.releaseLease).not.toHaveBeenCalled();
  });

  it("carries on with the user's next account after one fails", async () => {
    bankSync.syncAccount.mockImplementation(async (_user, id) => {
      if (id === ID_A) throw new Error("bank said no");
      return result(id);
    });
    await service.handleDailySync();
    expect(bankSync.syncAccount.mock.calls.map((call) => call[1])).toEqual([
      ID_A,
      ID_B,
      ID_C,
    ]);
  });

  it("isolates a failing user, pre-checks included: the claim itself may throw", async () => {
    jobClaims.claimOnce.mockImplementation(async (_type, userId) => {
      if (userId === USER_ID) throw new Error("claim failed");
      return true;
    });
    await service.handleDailySync();
    expect(bankSync.syncAccount.mock.calls).toEqual([
      [OTHER_USER_ID, ID_C, null],
    ]);
  });

  it("isolates a user whose account list cannot be read", async () => {
    manager.query.mockImplementation(
      async (sql: string, params?: unknown[]) => {
        if (String(sql).includes("SELECT DISTINCT c.user_id")) {
          return users.map((user_id) => ({ user_id }));
        }
        if (params![0] === USER_ID) throw new Error("db hiccup");
        return [{ id: ID_C }];
      },
    );
    await service.handleDailySync();
    expect(bankSync.syncAccount.mock.calls).toEqual([
      [OTHER_USER_ID, ID_C, null],
    ]);
  });

  it("logs and stops when the fan-out itself fails, without throwing", async () => {
    manager.query.mockRejectedValue(new Error("db down"));
    await expect(service.handleDailySync()).resolves.toBeUndefined();
    expect(jobClaims.claimOnce).not.toHaveBeenCalled();
    expect(service["logger"].error).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no user has a connection to sync", async () => {
    users = [];
    await service.handleDailySync();
    expect(jobClaims.claimOnce).not.toHaveBeenCalled();
    expect(service["logger"].log).not.toHaveBeenCalled();
  });
});
