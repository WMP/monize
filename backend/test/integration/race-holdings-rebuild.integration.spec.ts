import { TestingModule } from "@nestjs/testing";
import { DataSource } from "typeorm";

// Import order matters here and is not cosmetic. `InvestmentTransactionsService`
// injects `HoldingsService` without a forwardRef, and the securities module has
// import cycles, so pulling `holdings.service` in first leaves that constructor
// parameter undefined at decoration time and Nest fails to resolve index [3].
// Loading the service that sits at the top of the cycle first is what the other
// securities integration suites do, for the same reason.
import { InvestmentTransactionsService } from "@/securities/investment-transactions.service";
import { SecuritiesModule } from "@/securities/securities.module";
import { SecuritiesService } from "@/securities/securities.service";
import { HoldingsService } from "@/securities/holdings.service";
import { Holding } from "@/securities/entities/holding.entity";
import { InvestmentAction } from "@/securities/entities/investment-transaction.entity";
import {
  Account,
  AccountSubType,
  AccountType,
} from "@/accounts/entities/account.entity";
import { withUserContext } from "@/common/db/with-context";

import {
  createIntegrationModule,
  cleanTables,
  createTestUserDirect,
} from "../helpers/integration-setup";
import { createTestAccount } from "../helpers/test-factories";
import {
  RowGate,
  blockedBackendCount,
  raceAll,
  waitForBlockedBackends,
  waitUntil,
} from "../helpers/race-harness";

/**
 * P4-006 / audit race 5: a holdings rebuild against a concurrent trade.
 *
 * The rebuild is not an administrative tool -- an hourly cron runs it to
 * materialize matured future-dated trades, and imports and undo call it too. So
 * "a rebuild is running while the user buys something" happens on its own.
 *
 * It read the accounts and the whole investment-transaction history in two
 * earlier transactions, then deleted every holding and re-inserted from that
 * replay in a third. A trade committing in between was therefore erased from
 * `holdings` while its `investment_transactions` row survived -- so the position
 * vanished from the portfolio and came back at the next rebuild, which is an
 * unusually confusing way to lose shares and leaves no error anywhere.
 *
 * Holdings cannot serialize on themselves, because the row a trade is about to
 * insert does not exist to be locked. The account row is the common parent both
 * sides now take, which is what this suite proves.
 */
describe("Holdings rebuild vs concurrent trade (integration)", () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let holdings: HoldingsService;
  let trades: InvestmentTransactionsService;
  let userId: string;
  let brokerageAccountId: string;
  let securityId: string;
  let otherSecurityId: string;

  beforeAll(async () => {
    module = await createIntegrationModule([SecuritiesModule]);
    holdings = module.get(HoldingsService);
    trades = module.get(InvestmentTransactionsService);
    dataSource = module.get(DataSource);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await cleanTables(dataSource, [
      "action_history",
      "holdings",
      "securities",
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
    await dataSource.query(
      `INSERT INTO currencies (code, name, symbol, decimal_places)
         VALUES ('USD', 'US Dollar', '$', 2) ON CONFLICT DO NOTHING`,
    );

    userId = (await createTestUserDirect(dataSource)).id;

    const cash = await createTestAccount(dataSource, userId, {
      name: "Brokerage Cash",
      openingBalance: 100000,
      currentBalance: 100000,
    });
    await dataSource.manager.update(Account, cash.id, {
      accountType: AccountType.INVESTMENT,
      accountSubType: AccountSubType.INVESTMENT_CASH,
    });

    const brokerage = await createTestAccount(dataSource, userId, {
      name: "Brokerage",
      openingBalance: 0,
      currentBalance: 0,
    });
    await dataSource.manager.update(Account, brokerage.id, {
      accountType: AccountType.INVESTMENT,
      accountSubType: AccountSubType.INVESTMENT_BROKERAGE,
      linkedAccountId: cash.id,
    });
    brokerageAccountId = brokerage.id;

    const securities = module.get(SecuritiesService);
    securityId = (
      await withUserContext(userId, () =>
        securities.create(userId, {
          symbol: "AAPL",
          name: "Apple Inc.",
          securityType: "STOCK",
          currencyCode: "USD",
        } as never),
      )
    ).id;
    otherSecurityId = (
      await withUserContext(userId, () =>
        securities.create(userId, {
          symbol: "MSFT",
          name: "Microsoft",
          securityType: "STOCK",
          currencyCode: "USD",
        } as never),
      )
    ).id;
  });

  const buy = (security: string, quantity: number, date = "2026-01-10") =>
    withUserContext(userId, () =>
      trades.create(userId, {
        accountId: brokerageAccountId,
        action: InvestmentAction.BUY,
        transactionDate: date,
        securityId: security,
        quantity,
        price: 100,
        commission: 0,
      } as never),
    );

  const heldQuantity = async (security: string): Promise<number> => {
    const row = await dataSource.getRepository(Holding).findOne({
      where: { accountId: brokerageAccountId, securityId: security },
    });
    return row ? Number(row.quantity) : 0;
  };

  /** Investment transactions committed and visible to a fresh read. */
  const committedTradeCount = async (): Promise<number> => {
    const rows: Array<{ n: number }> = await dataSource.query(
      `SELECT COUNT(*)::int AS n FROM investment_transactions WHERE account_id = $1`,
      [brokerageAccountId],
    );
    return rows[0].n;
  };

  /**
   * Runs a rebuild and a trade in the one interleaving that loses shares, and
   * returns once both have settled.
   *
   * The gate has to hold the **holdings** rows, not the account. Gating on the
   * account row parks the trade too -- inserting a holding takes a `FOR KEY
   * SHARE` lock on its account through the foreign key -- and with both parked
   * the rebuild's delete happens before the trade's insert, which is the *safe*
   * order. The damaging one is the opposite: the rebuild reads the history,
   * the trade then commits in full, and only afterwards does the rebuild delete
   * every holding and re-insert from the replay it took before the trade
   * existed. Holding the existing holding row is what parks the rebuild at
   * exactly that point while leaving the trade free.
   *
   * With the fix the trade is not free: the rebuild has taken the account row
   * first, so the trade waits. The wait below accepts either outcome --
   * committed, or blocked -- and the returned flag says which happened, because
   * *that* is the assertion that separates the two worlds. The final holdings
   * cannot separate them: the old code deleted the holdings it had read by id,
   * so a row inserted after that read survived, and the position was lost only
   * when the read landed on the other side of the trade's commit -- a window
   * with no lock in it, and so not reachable from outside the service without
   * putting a seam in production code for the test's benefit.
   *
   * What is reachable, and is the real invariant, is that a rebuild and a trade
   * for the same account cannot overlap at all.
   */
  async function raceRebuildAgainstTrade(): Promise<{
    tradeCommittedMidRebuild: boolean;
  }> {
    const gate = await RowGate.hold(
      dataSource,
      `SELECT id FROM holdings WHERE account_id = $1 FOR UPDATE`,
      [brokerageAccountId],
    );

    try {
      const rebuilding = raceAll<void>([
        async () => {
          await withUserContext(userId, () =>
            holdings.rebuildFromTransactions(userId, "2026-01-31"),
          );
        },
      ]);
      await waitForBlockedBackends(dataSource, 1);

      const trading = raceAll<void>([
        async () => {
          await buy(otherSecurityId, 25, "2026-01-20");
        },
      ]);
      await waitUntil(
        "the trade to commit or to block behind the rebuild",
        async () =>
          (await committedTradeCount()) === 2 ||
          (await blockedBackendCount(dataSource)) >= 2,
      );

      const tradeCommittedMidRebuild = (await committedTradeCount()) === 2;

      await gate.release();
      await rebuilding;
      await trading;
      return { tradeCommittedMidRebuild };
    } finally {
      await gate.release();
    }
  }

  it("does not lose a trade that commits while a rebuild is running", async () => {
    await buy(securityId, 10);
    expect(await heldQuantity(securityId)).toBe(10);

    const { tradeCommittedMidRebuild } = await raceRebuildAgainstTrade();

    // The decisive assertion: while the rebuild was parked inside its
    // transaction, the trade could not commit. Without the account lock it
    // committed straight through the middle of the rebuild, which is the state
    // from which shares go missing.
    expect(tradeCommittedMidRebuild).toBe(false);

    // And once both are done, holdings agrees with the history.
    expect(await committedTradeCount()).toBe(2);
    expect(await heldQuantity(securityId)).toBe(10);
    expect(await heldQuantity(otherSecurityId)).toBe(25);
  });

  it("keeps holdings and the transaction history agreeing afterwards", async () => {
    // The sharper statement of the invariant: `holdings` is a materialized view
    // of `investment_transactions`, so a rebuild run after the race must be a
    // no-op. If the race lost shares, this rebuild puts them back -- which is
    // exactly how the defect stayed invisible, since the next rebuild always
    // repaired it.
    await buy(securityId, 10);

    await raceRebuildAgainstTrade();

    const beforeRepair = [
      await heldQuantity(securityId),
      await heldQuantity(otherSecurityId),
    ];
    await withUserContext(userId, () =>
      holdings.rebuildFromTransactions(userId, "2026-01-31"),
    );
    const afterRepair = [
      await heldQuantity(securityId),
      await heldQuantity(otherSecurityId),
    ];

    expect(beforeRepair).toEqual(afterRepair);
  });

  /**
   * The share-only paths (RFR7-003).
   *
   * `BUY` goes through `createOrUpdate`, which took the account lock from the
   * first round of this fix. `ADD_SHARES`, `REMOVE_SHARES` and `SPLIT` go
   * through `adjustQuantity` and `applySplit`, which did not -- so a delete or
   * edit of one of those could still run straight through a rebuild and leave
   * `holdings` disagreeing with the history it is supposed to materialize. That
   * the original suite covered only `BUY` is exactly why it passed.
   */
  describe("share-only edit and delete paths", () => {
    const addShares = (
      security: string,
      quantity: number,
      date = "2026-01-10",
    ) =>
      withUserContext(userId, () =>
        trades.create(userId, {
          accountId: brokerageAccountId,
          action: InvestmentAction.ADD_SHARES,
          transactionDate: date,
          securityId: security,
          quantity,
        } as never),
      );

    const split = (security: string, ratio: number, date = "2026-01-12") =>
      withUserContext(userId, () =>
        trades.create(userId, {
          accountId: brokerageAccountId,
          action: InvestmentAction.SPLIT,
          transactionDate: date,
          securityId: security,
          quantity: ratio,
        } as never),
      );

    /**
     * Parks a rebuild mid-transaction, then runs `mutate` and reports whether it
     * managed to commit while the rebuild was still inside its transaction.
     *
     * Same construction as the trade case: the gate holds the existing holdings
     * rows, which parks the rebuild at its delete without parking the mutator,
     * so the answer is decided by whether the mutator contends on the account
     * lock the rebuild already holds.
     */
    async function commitsDuringRebuild(
      mutate: () => Promise<unknown>,
      expectedHistoryCount: number,
    ): Promise<boolean> {
      const gate = await RowGate.hold(
        dataSource,
        `SELECT id FROM holdings WHERE account_id = $1 FOR UPDATE`,
        [brokerageAccountId],
      );
      try {
        const rebuilding = raceAll<void>([
          async () => {
            await withUserContext(userId, () =>
              holdings.rebuildFromTransactions(userId, "2026-01-31"),
            );
          },
        ]);
        await waitForBlockedBackends(dataSource, 1);

        const mutating = raceAll<void>([
          async () => {
            await mutate();
          },
        ]);
        await waitUntil(
          "the mutation to commit or to block behind the rebuild",
          async () =>
            (await committedTradeCount()) === expectedHistoryCount ||
            (await blockedBackendCount(dataSource)) >= 2,
        );
        const committed =
          (await committedTradeCount()) === expectedHistoryCount;

        await gate.release();
        await rebuilding;
        await mutating;
        return committed;
      } finally {
        await gate.release();
      }
    }

    it("serializes deleting an ADD_SHARES against a rebuild", async () => {
      // The reviewer's scenario: history ends up with no share acquisition while
      // holdings still show the shares, because the rebuild wrote a replay taken
      // before the delete.
      const added = await addShares(securityId, 10);
      expect(await heldQuantity(securityId)).toBe(10);

      const committedMidRebuild = await commitsDuringRebuild(
        () => withUserContext(userId, () => trades.remove(userId, added.id)),
        0,
      );

      expect(committedMidRebuild).toBe(false);
      // History and holdings agree: no acquisition, no shares.
      expect(await committedTradeCount()).toBe(0);
      expect(await heldQuantity(securityId)).toBe(0);
    });

    it("serializes deleting a REMOVE_SHARES against a rebuild", async () => {
      await addShares(securityId, 10);
      const removed = await withUserContext(userId, () =>
        trades.create(userId, {
          accountId: brokerageAccountId,
          action: InvestmentAction.REMOVE_SHARES,
          transactionDate: "2026-01-11",
          securityId,
          quantity: 4,
        } as never),
      );
      expect(await heldQuantity(securityId)).toBe(6);

      const committedMidRebuild = await commitsDuringRebuild(
        () => withUserContext(userId, () => trades.remove(userId, removed.id)),
        1,
      );

      expect(committedMidRebuild).toBe(false);
      // Undoing the removal puts the four shares back.
      expect(await committedTradeCount()).toBe(1);
      expect(await heldQuantity(securityId)).toBe(10);
    });

    it("serializes deleting a SPLIT against a rebuild", async () => {
      // A split's quantity is a ratio, so a delete that races a rebuild can
      // leave the materialized quantity at the post-split figure with no split
      // in the history to justify it.
      //
      // Unlike the two cases above, this one and the insert case below pass with
      // or without the lock -- the split delete is followed by a post-commit
      // repair rebuild, and an insert creates a row the rebuild's by-id delete
      // never sees. They are guards on the paths, not regression proofs; the
      // ADD_SHARES and REMOVE_SHARES deletes are the proofs, and they fail with
      // 10 phantom shares and 6-instead-of-10 respectively when the locks in
      // `applySplit`/`adjustQuantity` are removed.
      await addShares(securityId, 10);
      const splitTx = await split(securityId, 2);
      expect(await heldQuantity(securityId)).toBe(20);

      const committedMidRebuild = await commitsDuringRebuild(
        () => withUserContext(userId, () => trades.remove(userId, splitTx.id)),
        1,
      );

      expect(committedMidRebuild).toBe(false);
      expect(await committedTradeCount()).toBe(1);
      expect(await heldQuantity(securityId)).toBe(10);
    });

    it("serializes adding shares against a rebuild", async () => {
      // The insert side of the same path: `adjustQuantity` rather than
      // `createOrUpdate`, so it needed its own lock and its own case.
      await addShares(securityId, 10);

      const committedMidRebuild = await commitsDuringRebuild(
        () => addShares(otherSecurityId, 7, "2026-01-20"),
        2,
      );

      expect(committedMidRebuild).toBe(false);
      expect(await heldQuantity(securityId)).toBe(10);
      expect(await heldQuantity(otherSecurityId)).toBe(7);
    });
  });

  it("still rebuilds correctly with no contention", async () => {
    await buy(securityId, 10);
    await buy(otherSecurityId, 4);
    // Corrupt the materialized state on purpose, so the rebuild has work to do
    // and a no-op cannot pass this test.
    await dataSource.query(`UPDATE holdings SET quantity = 999`);

    const result = await withUserContext(userId, () =>
      holdings.rebuildFromTransactions(userId, "2026-01-31"),
    );

    expect(await heldQuantity(securityId)).toBe(10);
    expect(await heldQuantity(otherSecurityId)).toBe(4);
    expect(result.holdingsCreated).toBe(2);
    expect(result.holdingsDeleted).toBe(2);
  });

  it("reports nothing to do for a user with no investment accounts", async () => {
    const other = (await createTestUserDirect(dataSource)).id;

    const result = await withUserContext(other, () =>
      holdings.rebuildFromTransactions(other, "2026-01-31"),
    );

    expect(result).toEqual({
      holdingsCreated: 0,
      holdingsUpdated: 0,
      holdingsDeleted: 0,
    });
  });
});
