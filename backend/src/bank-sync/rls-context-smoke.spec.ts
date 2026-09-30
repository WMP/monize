import { Test, TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";
import { getRequestContext } from "../common/request-context";
import { JobClaimService } from "../common/jobs/job-claim.service";
import { createScopedDbMocks } from "../test-helpers/scoped-db-testing";
import { BankSyncCronService } from "./bank-sync-cron.service";
import { BankSyncService } from "./bank-sync.service";
import type { BankSyncResult } from "./bank-sync.types";
import { USER_ID } from "./bank-sync-testing";

/**
 * RLS smoke for the bank-sync cron (docs/specs/bank-sync.md section 11).
 *
 * Unlike the per-service specs, this suite does NOT mock `withScopedDb`: the
 * real implementation runs, so every database access on the cron path must find
 * the ambient identity its wrappers seed, or `withScopedDb` throws its
 * "DB access outside request/user/system context" error. `JobClaimService` is
 * the real one too, because a job claim is database access and the wrapper has
 * to go around it, not only around the body.
 */
describe("bank sync RLS context smoke (real withScopedDb)", () => {
  const BANK_ACCOUNT_ID = "b0b0b0b0-0000-4000-8000-000000000001";
  const syncResult: BankSyncResult = {
    bankAccountId: BANK_ACCOUNT_ID,
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
  };

  async function build() {
    const { manager, dataSource } = createScopedDbMocks();
    const seen: Array<{ sql: string; system: boolean; userId?: string }> = [];
    manager.query.mockImplementation(async (sql: string) => {
      const context = getRequestContext();
      seen.push({
        sql: String(sql),
        system: context?.system === true,
        userId: context?.userId,
      });
      if (String(sql).includes("SELECT DISTINCT c.user_id")) {
        return [{ user_id: USER_ID }];
      }
      if (String(sql).includes("INSERT INTO job_claims")) return [{ id: "c1" }];
      if (String(sql).includes("SELECT a.id")) {
        return [{ id: BANK_ACCOUNT_ID }];
      }
      return [];
    });
    const bankSync: jest.Mocked<Pick<BankSyncService, "syncAccount">> = {
      syncAccount: jest.fn().mockResolvedValue(syncResult),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BankSyncCronService,
        JobClaimService,
        { provide: DataSource, useValue: dataSource },
        { provide: BankSyncService, useValue: bankSync },
      ],
    }).compile();
    const service = module.get(BankSyncCronService);
    const errorSpy = jest
      .spyOn(service["logger"], "error")
      .mockImplementation(() => undefined);
    jest.spyOn(service["logger"], "log").mockImplementation(() => undefined);
    return { service, seen, errorSpy, bankSync };
  }

  it("runs the fan-out under the system context and each user's claim and reads under that user", async () => {
    const { service, seen, errorSpy, bankSync } = await build();

    await service.handleDailySync();

    // A missing wrapper would surface as a logged "DB access outside ... context".
    expect(errorSpy).not.toHaveBeenCalled();
    expect(
      seen.map((s) => [s.sql.includes("job_claims"), s.system, s.userId]),
    ).toEqual([
      [false, true, undefined],
      [true, false, USER_ID],
      [false, false, USER_ID],
    ]);
    expect(seen[0].sql).toContain("SELECT DISTINCT c.user_id");
    expect(bankSync.syncAccount).toHaveBeenCalledWith(
      USER_ID,
      BANK_ACCOUNT_ID,
      null,
    );
  });

  it("refuses the same paths without their context wrappers", async () => {
    const { service } = await build();
    await expect(service["usersToSync"]()).rejects.toThrow(
      /outside request\/user\/system context/,
    );
    await expect(service["syncUser"](USER_ID, "2026-09-30")).rejects.toThrow(
      /outside request\/user\/system context/,
    );
  });
});
