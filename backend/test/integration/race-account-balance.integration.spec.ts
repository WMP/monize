import { TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";

import { AccountsService } from "@/accounts/accounts.service";
import { AccountsModule } from "@/accounts/accounts.module";
import { Account } from "@/accounts/entities/account.entity";
import { withUserContext } from "@/common/db/with-context";

import {
  createIntegrationModule,
  cleanTables,
  createTestUserDirect,
} from "../helpers/integration-setup";
import { createTestAccount } from "../helpers/test-factories";
import {
  RowGate,
  raceAll,
  waitForBlockedBackends,
  winners,
} from "../helpers/race-harness";

/**
 * P4-003 and P4-005 / audit races 2 and 4: a balance recompute against a
 * concurrent write to the same account.
 *
 * A recompute is triggered from a dozen places -- creating a future-dated
 * transaction, voiding one, an import, a timezone change, the hourly cron -- so
 * "a recompute is running while the user edits the account" is an ordinary
 * Tuesday, not an adversarial scenario. Two things could go wrong, and both did:
 *
 * - The recompute read the account in one transaction and summed the
 *   transactions in another, so the opening balance it added the sum to could
 *   already be superseded.
 * - It then persisted the *whole entity* it had loaded, which reverted every
 *   other column a concurrent edit had committed. That failure is silent: no
 *   error, no conflict, the user's rename or credit-limit change is simply gone
 *   the next time the page loads.
 *
 * The second is the interesting one to test, because it is invisible to any
 * assertion about balances -- which is presumably why it survived a suite that
 * checked balances thoroughly.
 */
describe("Account balance recompute under contention (integration)", () => {
  let module: TestingModule;
  let accounts: AccountsService;
  let dataSource: DataSource;
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    module = await createIntegrationModule([AccountsModule]);
    accounts = module.get(AccountsService);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await cleanTables(dataSource, [
      "action_history",
      "transaction_splits",
      "transactions",
      "accounts",
      "categories",
      "payees",
      "scheduled_transaction_splits",
      "scheduled_transaction_overrides",
      "scheduled_transactions",
      "investment_transactions",
      "monthly_account_balances",
      "users",
    ]);
    userId = (await createTestUserDirect(dataSource)).id;
    const account = await createTestAccount(dataSource, userId, {
      name: "Chequing",
      openingBalance: 1000,
      currentBalance: 1000,
    });
    accountId = account.id;
  });

  const stored = (): Promise<Account> =>
    dataSource.getRepository(Account).findOneByOrFail({ id: accountId });

  it("does not revert a concurrent rename", async () => {
    // Both participants must go through the account row, so the gate holds it and
    // lets each of them queue up inside its own transaction first.
    const gate = await RowGate.hold(
      dataSource,
      `SELECT id FROM accounts WHERE id = $1 FOR UPDATE`,
      [accountId],
    );

    let outcomes;
    try {
      const running = raceAll([
        () =>
          withUserContext(userId, () =>
            accounts.recalculateCurrentBalance(accountId),
          ),
        () =>
          withUserContext(userId, () =>
            accounts.update(userId, accountId, { name: "Chequing (joint)" }),
          ),
      ]);
      await waitForBlockedBackends(dataSource, 2);
      await gate.release();
      outcomes = await running;
    } finally {
      await gate.release();
    }

    expect(winners(outcomes)).toHaveLength(2);
    // Whichever order the two ran in, the rename is a committed user edit and a
    // recompute has no mandate to undo it.
    expect((await stored()).name).toBe("Chequing (joint)");
  });

  it("does not revert a concurrent opening-balance change, and agrees with it", async () => {
    // The sharper version: the edit changes an input the recompute *reads*, so a
    // stale snapshot shows up in the balance as well as in the reverted column.
    await dataSource.query(
      `INSERT INTO transactions (user_id, account_id, transaction_date, amount, currency_code, description)
         VALUES ($1, $2, CURRENT_DATE, 250, 'CAD', 'deposit')`,
      [userId, accountId],
    );

    const gate = await RowGate.hold(
      dataSource,
      `SELECT id FROM accounts WHERE id = $1 FOR UPDATE`,
      [accountId],
    );

    try {
      const running = raceAll([
        () =>
          withUserContext(userId, () =>
            accounts.recalculateCurrentBalance(accountId),
          ),
        () =>
          withUserContext(userId, () =>
            accounts.update(userId, accountId, { openingBalance: 2000 }),
          ),
      ]);
      await waitForBlockedBackends(dataSource, 2);
      await gate.release();
      await running;
    } finally {
      await gate.release();
    }

    const account = await stored();
    expect(Number(account.openingBalance)).toBe(2000);
    // The stored balance has to be reachable from the stored opening balance:
    // 2000 + 250. A recompute that used the pre-edit opening balance would leave
    // 1250 sitting against an opening balance of 2000 -- a row that describes no
    // state the account was ever in.
    expect(Number(account.currentBalance)).toBe(2250);
  });

  it("still recomputes correctly with no contention", async () => {
    await dataSource.query(
      `INSERT INTO transactions (user_id, account_id, transaction_date, amount, currency_code, description)
         VALUES ($1, $2, CURRENT_DATE, -125.5, 'CAD', 'groceries')`,
      [userId, accountId],
    );

    const result = await withUserContext(userId, () =>
      accounts.recalculateCurrentBalance(accountId),
    );

    expect(Number(result.currentBalance)).toBe(874.5);
    expect(Number((await stored()).currentBalance)).toBe(874.5);
    // The returned entity must not have lost the rest of its fields either.
    expect(result.name).toBe("Chequing");
  });

  it("refuses an account that does not exist", async () => {
    await expect(
      withUserContext(userId, () =>
        accounts.recalculateCurrentBalance(
          "00000000-0000-0000-0000-000000000000",
        ),
      ),
    ).rejects.toThrow(/not found/i);
  });
});
