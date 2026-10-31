import { randomUUID } from "node:crypto";
import { ActionHistory } from "@/action-history/entities/action-history.entity";
import {
  ActionHistoryService,
  settlePendingHistoryWrites,
} from "@/action-history/action-history.service";
import { MAX_JSONB_SIZE_BYTES } from "@/action-history/history-limits";
import { withScopedDb } from "@/common/db/scoped-db";
import { withUserContext } from "@/common/db/with-context";
import { TRANSACTION_NOTE_MAX_LENGTH } from "@/common/transaction-note";
import { saveRequiredAccrualHistory } from "@/accruals/accrual-history-storage";
import { ACCRUAL_HISTORY_CHUNK_BYTES } from "@/accruals/entities/accrual-history-chunk.entity";
import { createAccrualTaxonomyFixture } from "../helpers/accrual-taxonomy-fixture";
import { createTestUserDirect } from "../helpers/integration-setup";

describe("oversized accrual history with enforced PostgreSQL ownership", () => {
  jest.setTimeout(300000);
  let f: Awaited<ReturnType<typeof createAccrualTaxonomyFixture>>,
    history: ActionHistoryService;
  beforeAll(async () => {
    f = await createAccrualTaxonomyFixture();
    history = f.h.module.get(ActionHistoryService);
  });
  beforeEach(async () => f.reset());
  afterAll(async () => f?.close());
  const sources = () =>
    f.h.owner.query(
      "SELECT id,amount::text,description,payee_id,payee_name,category_id FROM transactions WHERE user_id=$1 ORDER BY id",
      [f.user],
    );
  async function seedMixed() {
    const { tx } = await f.source();
    const note = "x".repeat(TRANSACTION_NOTE_MAX_LENGTH);
    await f.as(() =>
      f.transactions.update(f.user, tx.id, { description: note }),
    );
    await f.h.owner.query(
      "INSERT INTO transactions(user_id,account_id,transaction_date,amount,currency_code,category_id,payee_id,payee_name,description) SELECT $1,$2,'2026-06-15'::date,-1,'USD',$3,$4,'Tax office',$5 FROM generate_series(1,499)",
      [f.user, f.account, f.root, f.payee, note],
    );
    await f.h.owner.query(
      "UPDATE accounts SET current_balance=1000+(SELECT SUM(amount) FROM transactions WHERE user_id=$1) WHERE id=$2",
      [f.user, f.account],
    );
    await f.accrue(tx.id);
    await settlePendingHistoryWrites();
    return tx.id;
  }
  const remove = () =>
    f.as(() =>
      f.transactions.bulkDelete(f.user, {
        mode: "filter",
        filters: { accountIds: [f.account] },
      }),
    );
  async function bulkAction() {
    return f.h.owner.getRepository(ActionHistory).findOneOrFail({
      where: { userId: f.user, action: "bulk_delete" },
      order: { createdAt: "DESC" },
    });
  }
  it("round-trips a large mixed deletion without dropping its ordinary sources", async () => {
    const id = await seedMixed(),
      before = await sources(),
      initialBank = await f.bank();
    await remove();
    const action = await bulkAction();
    expect(action.beforeData).toHaveProperty("accrualHistoryPayload");
    expect(Buffer.byteLength(JSON.stringify(action.beforeData))).toBeLessThan(
      MAX_JSONB_SIZE_BYTES,
    );
    expect(await sources()).toHaveLength(0);
    await f.as(() => history.undo(f.user));
    expect(await sources()).toEqual(before);
    expect(await f.bank()).toBe(initialBank);
    expect(await f.states(id)).toHaveLength(1);
    await f.as(() => history.redo(f.user));
    expect(await sources()).toHaveLength(0);
    expect(await f.bank()).toBe("1000.0000");
  });
  it.each(["payee", "category"] as const)(
    "retains complete large %s relationship undo and redo",
    async (kind) => {
      const id = await seedMixed(),
        before = await sources(),
        initialBank = await f.bank();
      if (kind === "payee")
        await f.as(() =>
          f.payees.update(f.user, f.payee, { name: "Renamed office" }),
        );
      else {
        const preview = await f.as(() =>
          f.categories.previewCategoryReassignment(f.user, f.root, f.other),
        );
        await f.as(() =>
          f.categories.reassignTransactions(
            f.user,
            f.root,
            f.other,
            preview.fingerprint ?? undefined,
          ),
        );
      }
      const after = await sources();
      expect(after).not.toEqual(before);
      await f.as(() => history.undo(f.user));
      expect(await sources()).toEqual(before);
      expect(await f.bank()).toBe(initialBank);
      expect(await f.states(id)).toHaveLength(1);
      await f.as(() => history.redo(f.user));
      expect(await sources()).toEqual(after);
      expect(await f.bank()).toBe(initialBank);
    },
  );
  it("refuses missing parts without restoring sources, balances or history state", async () => {
    await seedMixed();
    await remove();
    const action = await bulkAction();
    await f.h.owner.query(
      "DELETE FROM accrual_history_chunks WHERE action_id=$1 AND side='before' AND part_index=0",
      [action.id],
    );
    await expect(f.as(() => history.undo(f.user))).rejects.toMatchObject({
      status: 409,
      response: { code: "ACCRUAL_HISTORY_INCOMPLETE" },
    });
    expect(await sources()).toHaveLength(0);
    expect(await f.bank()).toBe("1000.0000");
    expect((await bulkAction()).isUndone).toBe(false);
  });
  it("rolls back deletion when required chunk storage fails", async () => {
    await seedMixed();
    const before = await sources(),
      initialBank = await f.bank();
    await f.h.owner.query(
      "CREATE FUNCTION test_fail_accrual_chunk() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic chunk failure'; END $$",
    );
    await f.h.owner.query(
      "CREATE TRIGGER test_fail_accrual_chunk BEFORE INSERT ON accrual_history_chunks FOR EACH ROW EXECUTE FUNCTION test_fail_accrual_chunk()",
    );
    try {
      await expect(remove()).rejects.toThrow("Synthetic chunk failure");
      expect(await sources()).toEqual(before);
      expect(await f.bank()).toBe(initialBank);
      expect(
        await f.h.owner.query(
          "SELECT id FROM action_history WHERE user_id=$1 AND action='bulk_delete'",
          [f.user],
        ),
      ).toHaveLength(0);
    } finally {
      await f.h.owner.query(
        "DROP TRIGGER IF EXISTS test_fail_accrual_chunk ON accrual_history_chunks",
      );
      await f.h.owner.query(
        "DROP FUNCTION IF EXISTS test_fail_accrual_chunk()",
      );
    }
  });
  async function storeBlob(userId: string) {
    const id = randomUUID();
    await withUserContext(userId, () =>
      withScopedDb(f.h.app, (m) =>
        saveRequiredAccrualHistory(m, {
          id,
          userId,
          entityType: "storage_fixture",
          action: "update",
          description: "Generated storage fixture",
          beforeData: { text: "x".repeat(MAX_JSONB_SIZE_BYTES + 1) },
          afterData: null,
        }),
      ),
    );
    return id;
  }
  it("enforces owner isolation, the composite FK, part bounds and cascade cleanup", async () => {
    const foreign = (await createTestUserDirect(f.h.owner)).id;
    const ownId = await storeBlob(f.user),
      foreignId = await storeBlob(foreign);
    await f.as(() =>
      withScopedDb(f.h.app, async (m) => {
        expect(
          await m.query(
            "SELECT action_id FROM accrual_history_chunks WHERE action_id=$1",
            [foreignId],
          ),
        ).toEqual([]);
        expect(
          (
            await m.query(
              "SELECT action_id FROM accrual_history_chunks WHERE action_id=$1",
              [ownId],
            )
          ).length,
        ).toBeGreaterThan(1);
      }),
    );
    await expect(
      f.h.owner.query(
        "INSERT INTO accrual_history_chunks(action_id,user_id,side,part_index,payload) VALUES($1,$2,'after',0,$3)",
        [foreignId, f.user, Buffer.from("x")],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      f.h.owner.query(
        "INSERT INTO accrual_history_chunks(action_id,user_id,side,part_index,payload) VALUES($1,$2,'after',0,$3)",
        [ownId, f.user, Buffer.alloc(ACCRUAL_HISTORY_CHUNK_BYTES + 1)],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await f.as(() =>
      withScopedDb(f.h.app, (m) =>
        m.getRepository(ActionHistory).delete({ id: ownId, userId: f.user }),
      ),
    );
    expect(
      await f.h.owner.query(
        "SELECT action_id FROM accrual_history_chunks WHERE action_id=$1",
        [ownId],
      ),
    ).toHaveLength(0);
    expect(
      (
        await f.h.owner.query(
          "SELECT action_id FROM accrual_history_chunks WHERE action_id=$1",
          [foreignId],
        )
      ).length,
    ).toBeGreaterThan(0);
  });
});
