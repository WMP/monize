import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DataSource } from "typeorm";
import { returnedRows } from "../common/db/query-result";
import { withScopedDb } from "../common/db/scoped-db";
import { withSystemContext, withUserContext } from "../common/db/with-context";
import {
  JobClaimService,
  JobClaimType,
} from "../common/jobs/job-claim.service";
import { BankSyncService } from "./bank-sync.service";
import { describeSyncFailure } from "./bank-sync-errors";

/**
 * The daily bank sync (docs/specs/bank-sync.md section 8), once a day at 05:17
 * UTC.
 *
 * Every replica fires every cron, so what stops a second replica syncing the
 * same user is the claim: `claimOnce(BankSyncDaily, userId, <UTC date>)`, a
 * permanent `INSERT ... ON CONFLICT DO NOTHING RETURNING` row that one replica
 * wins per user per day. It is deliberately not handed back on failure: a
 * retry the same day would spend the bank's unattended-access allowance
 * (PSD2 allows about four reads a day), and the next day's window re-reads a
 * week, so a missed day is caught up.
 *
 * The shape is the ordinary out-of-request one: `withSystemContext` for the
 * cross-user fan-out, `withUserContext(userId)` around each user's whole body
 * -- the claim included, because a job claim is database access too -- and a
 * failure of one account or one user is logged and the loop continues.
 */
@Injectable()
export class BankSyncCronService {
  private readonly logger = new Logger(BankSyncCronService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly jobClaims: JobClaimService,
    private readonly bankSync: BankSyncService,
  ) {}

  @Cron("17 5 * * *", { timeZone: "UTC" })
  async handleDailySync(): Promise<void> {
    // The UTC day, read once: a run that crosses midnight keys every user alike.
    const day = new Date().toISOString().slice(0, 10);

    let userIds: string[];
    try {
      userIds = await withSystemContext(() => this.usersToSync());
    } catch (error) {
      this.logger.error(
        `Daily bank sync could not list its users: ${describeSyncFailure(error)}`,
      );
      return;
    }

    let synced = 0;
    for (const userId of userIds) {
      try {
        const ran = await withUserContext(userId, () =>
          this.syncUser(userId, day),
        );
        if (ran) synced += 1;
      } catch (error) {
        this.logger.error(
          `Daily bank sync failed for user ${userId}: ${describeSyncFailure(error)}`,
        );
      }
    }
    if (userIds.length > 0) {
      this.logger.log(
        `Daily bank sync: ${synced} of ${userIds.length} user(s) synced by this replica`,
      );
    }
  }

  /**
   * The users with at least one `active`, `auto_sync` connection that has a
   * linked bank account. Cross-user by construction, so it runs under the
   * system context and returns ids only.
   */
  private async usersToSync(): Promise<string[]> {
    return withScopedDb(this.dataSource, async (m) => {
      const rows = returnedRows<{ user_id: string }>(
        await m.query(
          `SELECT DISTINCT c.user_id
             FROM bank_sync_connections c
             JOIN bank_sync_accounts a ON a.connection_id = c.id
            WHERE c.status = 'active'
              AND c.auto_sync = true
              AND a.account_id IS NOT NULL
            ORDER BY c.user_id`,
        ),
      );
      return rows.map((row) => row.user_id);
    });
  }

  /** One user's day: claim it, then every linked account in turn. */
  private async syncUser(userId: string, day: string): Promise<boolean> {
    const won = await this.jobClaims.claimOnce(
      JobClaimType.BankSyncDaily,
      userId,
      day,
    );
    if (!won) return false;

    const bankAccountIds = await withScopedDb(this.dataSource, async (m) => {
      const rows = returnedRows<{ id: string }>(
        await m.query(
          `SELECT a.id
             FROM bank_sync_accounts a
             JOIN bank_sync_connections c ON c.id = a.connection_id
            WHERE a.user_id = $1
              AND a.account_id IS NOT NULL
              AND c.status = 'active'
              AND c.auto_sync = true
            ORDER BY a.created_at, a.id`,
          [userId],
        ),
      );
      return rows.map((row) => row.id);
    });

    for (const bankAccountId of bankAccountIds) {
      try {
        // No PSU context: nobody is at the keyboard, so the bank counts it as an
        // unattended read.
        await this.bankSync.syncAccount(userId, bankAccountId, null);
      } catch (error) {
        // Already recorded on the bank account by the sync itself.
        this.logger.warn(
          `Daily sync of bank account ${bankAccountId} failed: ${describeSyncFailure(error)}`,
        );
      }
    }
    return true;
  }
}
