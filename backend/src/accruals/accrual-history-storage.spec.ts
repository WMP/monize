import type { EntityManager } from "typeorm";
import { instanceToPlain } from "class-transformer";
import { withUserContext } from "../common/db/with-context";
import { ActionHistory } from "../action-history/entities/action-history.entity";
import { MAX_JSONB_SIZE_BYTES } from "../action-history/history-limits";
import {
  AccrualHistoryChunk,
  ACCRUAL_HISTORY_CHUNK_BYTES,
} from "./entities/accrual-history-chunk.entity";
import {
  loadAccrualHistoryPayload,
  saveRequiredAccrualHistory,
  replaceAccrualHistorySide,
  presentAccrualHistoryAction,
} from "./accrual-history-storage";

const USER = "11111111-1111-4111-8111-111111111111";
const ACTION = "22222222-2222-4222-8222-222222222222";
function fixture() {
  let parent: ActionHistory;
  let parts: AccrualHistoryChunk[] = [];
  let affected = 1;
  const events: string[] = [];
  const history = {
    create: (value: unknown) => Object.assign(new ActionHistory(), value),
    save: jest.fn(async (value: ActionHistory) => {
      events.push("parent");
      parent = Object.assign(
        new ActionHistory(),
        { id: ACTION, isUndone: false },
        value,
      );
      return parent;
    }),
    findOne: jest.fn(async () => parent),
  };
  const chunks = {
    insert: jest.fn(async (rows: AccrualHistoryChunk[]) => {
      events.push("parts");
      parts.push(...rows);
    }),
    find: jest.fn(
      async ({
        where,
      }: {
        where: { actionId: string; userId: string; side: string };
      }) =>
        parts
          .filter(
            (part) =>
              part.actionId === where.actionId &&
              part.userId === where.userId &&
              part.side === where.side,
          )
          .sort((a, b) => a.partIndex - b.partIndex),
    ),
    delete: jest.fn(async () => {
      events.push("delete-parts");
      parts = [];
    }),
  };
  let update: Partial<ActionHistory> = {};
  const qb = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn((value: Partial<ActionHistory>) => {
      update = value;
      return qb;
    }),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn(async () => {
      events.push("cas");
      if (affected) parent = Object.assign(new ActionHistory(), parent, update);
      return { affected };
    }),
  };
  const m = {
    getRepository: (entity: unknown) =>
      entity === ActionHistory
        ? history
        : entity === AccrualHistoryChunk
          ? chunks
          : undefined,
    createQueryBuilder: () => qb,
  } as unknown as EntityManager;
  return {
    m,
    history,
    chunks,
    events,
    qb,
    get parent() {
      return parent;
    },
    get parts() {
      return parts;
    },
    setAffected: (value: number) => {
      affected = value;
    },
  };
}
const as = <T>(fn: () => Promise<T>) => withUserContext(USER, fn);
const large = () => ({
  amount: "-1200.0001",
  text: "🚗".repeat(150000),
  tags: ["one", "two"],
});

describe("required accrual history byte storage", () => {
  it("retains ordinary inline shape and hydrates it without reads or a new owner requirement", async () => {
    const f = fixture();
    const data = { amount: "-12.0001" };
    await as(() =>
      saveRequiredAccrualHistory(f.m, {
        userId: USER,
        entityType: "bulk_transaction",
        beforeData: data,
        afterData: null,
      }),
    );
    expect(f.parent.beforeData).toEqual(data);
    expect(f.chunks.insert).not.toHaveBeenCalled();
    const legacy = Object.assign(new ActionHistory(), f.parent, {
      entityType: "bulk_transaction",
      accrualEntityType: null,
    });
    expect(await loadAccrualHistoryPayload(f.m, legacy)).toBe(legacy);
    expect(
      (await as(() => loadAccrualHistoryPayload(f.m, f.parent))).entityType,
    ).toBe("bulk_transaction");
    expect(f.chunks.find).not.toHaveBeenCalled();
  });
  it("round-trips exact numeric text and UTF-8 split across bounded byte parts", async () => {
    const f = fixture(),
      data = large();
    await as(() =>
      saveRequiredAccrualHistory(f.m, {
        userId: USER,
        entityType: "bulk_transaction",
        beforeData: data,
        afterData: null,
      }),
    );
    expect(f.events[0]).toBe("parent");
    expect(f.parent.beforeData).toHaveProperty("accrualHistoryPayload");
    expect(f.parts.length).toBeGreaterThan(1);
    expect(
      f.parts.every(
        (part) => part.payload.length <= ACCRUAL_HISTORY_CHUNK_BYTES,
      ),
    ).toBe(true);
    const loaded = await as(() => loadAccrualHistoryPayload(f.m, f.parent));
    expect(loaded).toBeInstanceOf(ActionHistory);
    expect(loaded.beforeData).toEqual(data);
    expect(f.parent.beforeData).not.toHaveProperty("text");
    expect(f.parent.entityType).toBe("accrual_history_v1");
    const shown = presentAccrualHistoryAction(f.parent);
    expect(shown.entityType).toBe("bulk_transaction");
    const publicValue = instanceToPlain(shown);
    expect(publicValue).not.toHaveProperty("beforeData");
    expect(publicValue).not.toHaveProperty("afterData");
    expect(publicValue).not.toHaveProperty("accrualEntityType");
  });
  it("keeps the combined inline limit when each side individually fits", async () => {
    const f = fixture(),
      data = { text: "x".repeat(300000) };
    await as(() =>
      saveRequiredAccrualHistory(f.m, {
        userId: USER,
        entityType: "bulk_transaction",
        beforeData: data,
        afterData: data,
      }),
    );
    expect(
      Buffer.byteLength(
        JSON.stringify({
          before: f.parent.beforeData,
          after: f.parent.afterData,
        }),
      ),
    ).toBeLessThan(MAX_JSONB_SIZE_BYTES);
    expect(f.parent.beforeData).toHaveProperty("accrualHistoryPayload");
    expect(f.parent.afterData).toHaveProperty("accrualHistoryPayload");
  });
  it.each(["missing", "corrupt", "ordinal", "manifest"])(
    "refuses %s data instead of returning a partial history",
    async (defect) => {
      const f = fixture();
      await as(() =>
        saveRequiredAccrualHistory(f.m, {
          userId: USER,
          entityType: "bulk_transaction",
          beforeData: large(),
          afterData: null,
        }),
      );
      if (defect === "missing") f.parts.pop();
      if (defect === "corrupt") f.parts[0].payload = Buffer.from("changed");
      if (defect === "ordinal") f.parts[0].partIndex = 99;
      if (defect === "manifest")
        f.parent.beforeData!.accrualHistoryPayload.parts = -1;
      await expect(
        as(() => loadAccrualHistoryPayload(f.m, f.parent)),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: "ACCRUAL_HISTORY_INCOMPLETE" },
      });
    },
  );
  it("takes the parent CAS before replacing children and preserves physical sides during redo", async () => {
    const f = fixture(),
      before = large(),
      after = { ...large(), amount: "-2400.0001" };
    await as(() =>
      saveRequiredAccrualHistory(f.m, {
        userId: USER,
        entityType: "bulk_transaction",
        beforeData: before,
        afterData: after,
      }),
    );
    f.parent.isUndone = true;
    f.events.length = 0;
    const inverted = Object.assign(new ActionHistory(), f.parent, {
      beforeData: after,
      afterData: before,
    });
    const next = { ...after, revision: 2 };
    await as(() => replaceAccrualHistorySide(f.m, inverted, "afterData", next));
    expect(f.events.indexOf("cas")).toBeLessThan(
      f.events.indexOf("delete-parts"),
    );
    const loaded = await as(() => loadAccrualHistoryPayload(f.m, f.parent));
    expect(loaded.beforeData).toEqual(before);
    expect(loaded.afterData).toEqual(next);
  });
  it("does not replace children when the conditional parent update loses", async () => {
    const f = fixture();
    await as(() =>
      saveRequiredAccrualHistory(f.m, {
        userId: USER,
        entityType: "bulk_transaction",
        beforeData: large(),
        afterData: null,
      }),
    );
    f.setAffected(0);
    f.chunks.insert.mockClear();
    await expect(
      as(() => replaceAccrualHistorySide(f.m, f.parent, "beforeData", large())),
    ).rejects.toMatchObject({ status: 409 });
    expect(f.chunks.delete).not.toHaveBeenCalled();
    expect(f.chunks.insert).not.toHaveBeenCalled();
  });
});
