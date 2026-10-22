import { Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { withScopedDb, getActiveScopedManager } from "../common/db/scoped-db";
import { tr } from "../i18n/translate";

export const SIMPLEFIN_DAILY_REQUEST_LIMIT = 24;
export interface SimplefinRequestBudget {
  remaining: number;
  nextEligibleAt: string | null;
}
export type SimplefinReservation = SimplefinRequestBudget & {
  allowed: boolean;
};

/** All request-budget writers lock the owned credential row before counting/inserting. */
@Injectable()
export class SimplefinRequestBudgetService {
  constructor(private readonly dataSource: DataSource) {}

  async status(
    userId: string,
    credentialId: string,
  ): Promise<SimplefinRequestBudget> {
    return withScopedDb(this.dataSource, async (m) => {
      await this.lockCredential(m, userId, credentialId);
      return this.readBudget(m, userId, credentialId);
    });
  }

  /** The caller must await commit before HTTP. A failed HTTP attempt still spends its reservation. */
  async reserve(
    userId: string,
    credentialId: string,
  ): Promise<SimplefinReservation> {
    if (getActiveScopedManager())
      throw new Error(
        "Reserve SimpleFIN requests outside an active database transaction",
      );
    return withScopedDb(this.dataSource, async (m) => {
      await this.lockCredential(m, userId, credentialId);
      const budget = await this.readBudget(m, userId, credentialId);
      if (budget.remaining === 0) return { ...budget, allowed: false };
      await m.query(
        "INSERT INTO bank_sync_provider_requests (user_id, credential_id, requested_at) VALUES ($1, $2, clock_timestamp())",
        [userId, credentialId],
      );
      const after = await this.readBudget(m, userId, credentialId);
      return { ...after, allowed: true };
    });
  }

  private async lockCredential(
    m: EntityManager,
    userId: string,
    credentialId: string,
  ): Promise<void> {
    const rows: { id: string }[] = await m.query(
      "SELECT id FROM bank_sync_credentials WHERE id = $1 AND user_id = $2 AND provider = 'simplefin' FOR UPDATE",
      [credentialId, userId],
    );
    if (rows.length === 0)
      throw new NotFoundException(
        tr(
          "errors.bankSync.simplefinCredentialsMissing",
          "Connect SimpleFIN before syncing accounts.",
        ),
      );
  }

  private async readBudget(
    m: EntityManager,
    userId: string,
    credentialId: string,
  ): Promise<SimplefinRequestBudget> {
    const rows: { used: string; next_at: Date | null }[] = await m.query(
      `SELECT COUNT(*)::text AS used, MIN(requested_at) + INTERVAL '24 hours' AS next_at
       FROM bank_sync_provider_requests
       WHERE credential_id = $1 AND user_id = $2
         AND requested_at > clock_timestamp() - INTERVAL '24 hours'`,
      [credentialId, userId],
    );
    const remaining = Math.max(
      0,
      SIMPLEFIN_DAILY_REQUEST_LIMIT - Number(rows[0].used),
    );
    return {
      remaining,
      nextEligibleAt:
        remaining === 0 && rows[0].next_at
          ? rows[0].next_at.toISOString()
          : null,
    };
  }
}
