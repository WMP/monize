import { EntityManager } from "typeorm";
import {
  LockScope,
  acquireAdvisoryLock,
  acquireAdvisoryLocks,
  lockAccountsForBalanceWrite,
  lockHoldingScope,
  lockTokenFamily,
  lockTransactionRow,
  lockTransactionRows,
} from "./locks";

/**
 * These specs assert the SQL each helper emits and the order it emits it in.
 *
 * Whether the locks actually exclude anything is a question only two real
 * connections can answer, and the integration suites cover that. What a unit
 * spec can pin down is the part that goes wrong silently: a lock that ends up
 * *after* the read it was meant to protect, or a set of ids locked in whatever
 * order the query returned them, which is how two writers deadlock on each
 * other's second lock.
 */
describe("common/db/locks", () => {
  let manager: { query: jest.Mock };

  beforeEach(() => {
    manager = { query: jest.fn().mockResolvedValue([]) };
  });

  const asManager = () => manager as unknown as EntityManager;

  describe("advisory locks", () => {
    it("keys the lock on a namespace and a hashed id", async () => {
      await acquireAdvisoryLock(asManager(), LockScope.Holdings, "acc-1");

      expect(manager.query).toHaveBeenCalledWith(
        "SELECT pg_advisory_xact_lock($1::int, hashtext($2))",
        [LockScope.Holdings, "acc-1"],
      );
    });

    it("locks a set in ascending order, de-duplicated", async () => {
      // The deadlock guard: a transfer locking two accounts and a rebuild
      // locking the same two must take them in the same order, or each can end
      // up holding the other's next lock.
      await acquireAdvisoryLocks(asManager(), LockScope.Holdings, [
        "acc-c",
        "acc-a",
        "acc-b",
        "acc-a",
      ]);

      expect(manager.query.mock.calls.map((c) => c[1][1])).toEqual([
        "acc-a",
        "acc-b",
        "acc-c",
      ]);
    });

    it("gives each kind of lock its own namespace", async () => {
      // Two different kinds of lock must not be able to collide on a hashed id.
      await lockHoldingScope(asManager(), ["x"]);
      await lockTokenFamily(asManager(), "x");

      const namespaces = manager.query.mock.calls.map((c) => c[1][0]);
      expect(new Set(namespaces).size).toBe(2);
    });
  });

  describe("lockAccountsForBalanceWrite", () => {
    it("row-locks the accounts in ascending id order", async () => {
      await lockAccountsForBalanceWrite(asManager(), ["b", "a", "b"]);

      const [sql, params] = manager.query.mock.calls[0];
      expect(sql).toContain("FROM accounts");
      expect(sql).toContain("ORDER BY id");
      expect(sql).toContain("FOR UPDATE");
      expect(params).toEqual([["a", "b"]]);
    });

    it("issues nothing for an empty set", async () => {
      await lockAccountsForBalanceWrite(asManager(), []);

      expect(manager.query).not.toHaveBeenCalled();
    });
  });

  describe("lockTransactionRow", () => {
    it("selects FOR UPDATE, scoped to the owner", async () => {
      manager.query.mockResolvedValue([
        {
          id: "tx-1",
          account_id: "acc-1",
          amount: "-20.0000",
          transaction_date: "2026-01-15",
          status: "CLEARED",
          is_split: false,
          linked_transaction_id: null,
          parent_transaction_id: null,
        },
      ]);

      const row = await lockTransactionRow(asManager(), "tx-1", "user-1");

      const [sql, params] = manager.query.mock.calls[0];
      expect(sql).toContain("FOR UPDATE");
      expect(sql).toContain("user_id = $2");
      expect(params).toEqual(["tx-1", "user-1"]);
      // The amount arrives as a decimal string from the driver and must reach
      // the caller as a number -- a balance delta computed from a string
      // concatenates.
      expect(row).toEqual({
        id: "tx-1",
        accountId: "acc-1",
        amount: -20,
        transactionDate: "2026-01-15",
        status: "CLEARED",
        isSplit: false,
        linkedTransactionId: null,
        parentTransactionId: null,
      });
    });

    it("selects the date as text, not as a Date", async () => {
      // A raw select bypasses the entity transformer, so a DATE column comes back
      // as a JS Date parsed in UTC -- and reading it can shift the day. See the
      // raw-select rule in backend/CLAUDE.md.
      await lockTransactionRow(asManager(), "tx-1", "user-1");

      expect(manager.query.mock.calls[0][0]).toContain(
        "TO_CHAR(transaction_date, 'YYYY-MM-DD')",
      );
    });

    it("returns null when no row matched", async () => {
      manager.query.mockResolvedValue([]);

      expect(
        await lockTransactionRow(asManager(), "tx-1", "user-1"),
      ).toBeNull();
    });
  });

  describe("lockTransactionRows", () => {
    it("locks in ascending id order and returns what it found", async () => {
      manager.query.mockResolvedValue([
        {
          id: "tx-a",
          account_id: "acc-1",
          amount: "10.0000",
          transaction_date: "2026-01-15",
          status: null,
          is_split: false,
          linked_transaction_id: null,
          parent_transaction_id: null,
        },
      ]);

      const found = await lockTransactionRows(
        asManager(),
        ["tx-b", "tx-a", "tx-b"],
        "user-1",
      );

      const [sql, params] = manager.query.mock.calls[0];
      expect(sql).toContain("ORDER BY id");
      expect(sql).toContain("FOR UPDATE");
      expect(params).toEqual([["tx-a", "tx-b"], "user-1"]);
      // A row that is gone is absent, not zero-valued: a caller must be able to
      // tell "no longer there" from "there with amount 0", because reversing a
      // balance for a row another request already deleted is the double-delete
      // corruption in P4-003.
      expect([...found.keys()]).toEqual(["tx-a"]);
      expect(found.get("tx-a")!.amount).toBe(10);
    });

    it("issues nothing for an empty set", async () => {
      const found = await lockTransactionRows(asManager(), [], "user-1");

      expect(manager.query).not.toHaveBeenCalled();
      expect(found.size).toBe(0);
    });
  });
});
