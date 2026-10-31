import { assertAutomaticRuleSources } from "@/transaction-rules/rule-accrual";
import { assertImportAccrualIds } from "@/import/import-accrual-guard";
import { lockPayeeSources } from "@/payees/payee-source-metadata";
import { prepareCategoryMutation } from "@/categories/category-mutation";
import { createTestAccount } from "../helpers/test-factories";
import { randomUUID } from "node:crypto";
import { beginTaxonomyOperation } from "@/accruals/accrual-taxonomy-operation";
import { withScopedDb } from "@/common/db/scoped-db";
import { withDelegateContext } from "@/common/db/with-context";
import { createTestUserDirect } from "../helpers/integration-setup";
import { createAccrualTaxonomyFixture } from "../helpers/accrual-taxonomy-fixture";

describe("Accrual taxonomy lock scope (enforced PostgreSQL)", () => {
  jest.setTimeout(180000);
  let f: Awaited<ReturnType<typeof createAccrualTaxonomyFixture>>;
  beforeAll(async () => {
    f = await createAccrualTaxonomyFixture();
  });
  beforeEach(async () => f.reset());
  afterAll(async () => f?.close());

  it.each(["category", "payee"] as const)(
    "leaves unrelated %s ledger and taxonomy rows unlocked",
    async (kind) => {
      const { tx } = await f.source();
      await f.accrue(tx.id);
      const { tx: unrelated } = await f.source({ categoryId: f.other });
      const payee = await f.as(() =>
        f.payees.create(f.user, { name: "Unrelated vendor" }),
      );
      const scheduled = await f.scheduled(f.other);
      const alias = randomUUID();
      await f.h.owner.query("UPDATE transactions SET payee_id=$1 WHERE id=$2", [
        payee.id,
        unrelated.id,
      ]);
      await f.h.owner.query(
        "UPDATE scheduled_transactions SET payee_id=$1 WHERE id=$2",
        [payee.id, scheduled.id],
      );
      await f.h.owner.query(
        "INSERT INTO payee_aliases(id,user_id,payee_id,alias) VALUES($1,$2,$3,'Unrelated alias')",
        [alias, f.user, payee.id],
      );
      await f.as(() =>
        withScopedDb(f.h.app, async (m) => {
          const state = await beginTaxonomyOperation(m, f.user, kind, [
            kind === "payee" ? f.payee : f.root,
          ]);
          expect(state?.scope.sourceIds).toEqual([tx.id]);
          // A separate PostgreSQL connection proves these rows are not frozen.
          await f.h.owner.transaction(async (other) => {
            for (const [table, id] of [
              ["transactions", unrelated.id],
              ["payees", payee.id],
              ["categories", f.other],
              ["scheduled_transactions", scheduled.id],
              ["payee_aliases", alias],
            ]) {
              expect(
                await other.query(
                  `SELECT id FROM ${table} WHERE id=$1 FOR UPDATE NOWAIT`,
                  [id],
                ),
              ).toHaveLength(1);
            }
          });
        }),
      );
    },
  );

  it("uses the same bounded hierarchy locks in the category editor", async () => {
    await f.as(() =>
      withScopedDb(f.h.app, async (m) => {
        await prepareCategoryMutation(m, f.user, f.root, {
          operation: "update",
          dto: { name: "Updated label" },
        });
        await f.h.owner.transaction(async (other) => {
          expect(
            await other.query(
              "SELECT id FROM categories WHERE id=$1 FOR UPDATE NOWAIT",
              [f.other],
            ),
          ).toHaveLength(1);
        });
      }),
    );
  });

  it.each(["taxonomy", "category", "payee", "import", "automatic"] as const)(
    "locks an owning split parent before its selected transfer leg through %s",
    async (writer) => {
      const other = await createTestAccount(f.h.owner, f.user, {
        name: "Transfer target",
      });
      const tx = await f.as(() =>
        f.transactions.create(f.user, {
          accountId: f.account,
          currencyCode: "USD",
          transactionDate: "2026-06-15",
          amount: -1200,
          splits: [
            { categoryId: f.root, amount: -600 },
            { transferAccountId: other.id, amount: -600 },
          ],
        }),
      );
      const lines = await f.h.owner.query(
        "SELECT id,linked_transaction_id FROM transaction_splits WHERE transaction_id=$1",
        [tx.id],
      );
      const category = lines.find(
        (r: { linked_transaction_id: string | null }) =>
          !r.linked_transaction_id,
      );
      const leg = lines.find(
        (r: { linked_transaction_id: string | null }) =>
          r.linked_transaction_id,
      ).linked_transaction_id;
      await f.accrue(tx.id, category.id);
      await f.h.owner.query("UPDATE transactions SET payee_id=$1 WHERE id=$2", [
        f.payee,
        leg,
      ]);
      if (writer === "category")
        await f.h.owner.query(
          "UPDATE transactions SET category_id=$1 WHERE id=$2",
          [f.root, leg],
        );
      if (writer === "payee")
        await f.h.owner.query(
          "UPDATE transactions SET payee_id=$1 WHERE id=$2",
          [f.payee, tx.id],
        );
      await f.as(() =>
        withScopedDb(f.h.app, async (m) => {
          const query = m.query.bind(m);
          const locked: string[][] = [];
          m.query = (async (sql: string, params?: any[]) => {
            const rows = await query(sql, params);
            if (sql.includes("FROM transactions") && sql.includes("FOR UPDATE"))
              locked.push(rows.map((r: { id: string }) => r.id));
            return rows;
          }) as typeof m.query;
          try {
            if (writer === "taxonomy") {
              const state = await beginTaxonomyOperation(m, f.user, "payee", [
                f.payee,
              ]);
              expect(state?.scope.sourceIds).toEqual([leg]);
            } else if (writer === "category") {
              await prepareCategoryMutation(m, f.user, f.root, {
                operation: "delete",
              });
            } else if (writer === "automatic") {
              expect(
                await assertAutomaticRuleSources(m, f.user, [leg]),
              ).toEqual(new Set([leg]));
            } else if (writer === "import") {
              await expect(
                assertImportAccrualIds(m, f.user, [leg]),
              ).rejects.toMatchObject({ status: 409 });
            } else {
              await lockPayeeSources(m, f.user, [f.payee]);
            }
            expect(locked[0]).toEqual([tx.id]);
            expect(locked[1]).toEqual([leg]);
          } finally {
            m.query = query;
          }
        }),
      );
    },
  );

  it("rechecks membership committed between source discovery and taxonomy locking", async () => {
    const { tx } = await f.source();
    await f.accrue(tx.id);
    await expect(
      f.as(() =>
        withScopedDb(f.h.app, async (m) => {
          const query = m.query.bind(m);
          let inserted = false;
          m.query = (async (sql: string, params?: any[]) => {
            if (
              !inserted &&
              sql.includes("FROM payees") &&
              sql.includes("FOR UPDATE")
            ) {
              inserted = true;
              await f.h.owner.query(
                "INSERT INTO transactions(id,user_id,account_id,payee_id,amount,currency_code,transaction_date) VALUES($1,$2,$3,$4,-1,'USD','2026-06-15')",
                [randomUUID(), f.user, f.account, f.payee],
              );
            }
            return query(sql, params);
          }) as typeof m.query;
          try {
            await beginTaxonomyOperation(m, f.user, "payee", [f.payee]);
          } finally {
            m.query = query;
          }
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("does not cache absence of schedules before acquiring the affected source lock", async () => {
    const { tx } = await f.source();
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Start outside the scoped transaction's ALS context so this writer uses
    // a second connection and commits before the first source lock executes.
    const writer = (async () => {
      await ready;
      await f.accrue(tx.id);
    })();
    try {
      await f.as(() =>
        withScopedDb(f.h.app, async (m) => {
          const query = m.query.bind(m);
          let scheduled = false;
          m.query = (async (sql: string, params?: any[]) => {
            if (
              !scheduled &&
              sql.includes("FROM transactions") &&
              sql.includes("FOR UPDATE")
            ) {
              scheduled = true;
              release();
              await writer;
            }
            return query(sql, params);
          }) as typeof m.query;
          try {
            const state = await beginTaxonomyOperation(m, f.user, "payee", [
              f.payee,
            ]);
            expect(scheduled).toBe(true);
            expect(state?.sources[0].accrualState.schedules).toHaveLength(1);
          } finally {
            m.query = query;
          }
        }),
      );
    } finally {
      release();
      await writer;
    }
  });

  it("does not reject an unrelated delegated cash operation because the owner has accruals elsewhere", async () => {
    const { tx } = await f.source();
    await f.accrue(tx.id);
    const other = await f.as(() =>
      f.payees.create(f.user, { name: "Cash vendor" }),
    );
    const delegate = await createTestUserDirect(f.h.owner);
    await expect(
      withDelegateContext(f.user, delegate.id, () =>
        withScopedDb(f.h.app, (m) =>
          beginTaxonomyOperation(m, f.user, "payee", [other.id]),
        ),
      ),
    ).resolves.toBeDefined();
    await expect(
      withDelegateContext(f.user, delegate.id, () =>
        withScopedDb(f.h.app, (m) =>
          beginTaxonomyOperation(m, f.user, "payee", [f.payee]),
        ),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
