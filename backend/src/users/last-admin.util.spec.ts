import { EntityManager } from "typeorm";
import { lockAdminsForUpdate, wouldRemoveLastAdmin } from "./last-admin.util";

describe("lockAdminsForUpdate", () => {
  const managerWith = (
    rows: unknown,
  ): { manager: EntityManager; query: jest.Mock } => {
    const query = jest.fn().mockResolvedValue(rows);
    return { manager: { query } as unknown as EntityManager, query };
  };

  it("locks the admin rows rather than counting them", async () => {
    // A plain count cannot refuse two concurrent demotions of two different
    // admins -- neither transaction sees the other's uncommitted change. The
    // `FOR UPDATE` is the entire guard, so its absence is the defect.
    const { manager, query } = managerWith([{ id: "a" }, { id: "b" }]);

    await lockAdminsForUpdate(manager);

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toMatch(/FOR UPDATE/);
    expect(sql).toMatch(/role = 'admin'/);
  });

  it("returns the locked administrator ids", async () => {
    const { manager } = managerWith([{ id: "a" }, { id: "b" }]);

    expect(await lockAdminsForUpdate(manager)).toEqual(["a", "b"]);
  });

  it("returns an empty list when there are none", async () => {
    const { manager } = managerWith([]);

    expect(await lockAdminsForUpdate(manager)).toEqual([]);
  });
});

describe("wouldRemoveLastAdmin", () => {
  it("refuses when the target is the only administrator", () => {
    expect(wouldRemoveLastAdmin(["a"], "a")).toBe(true);
  });

  it("allows when another administrator remains", () => {
    expect(wouldRemoveLastAdmin(["a", "b"], "a")).toBe(false);
  });

  it("allows when the target is not an administrator at all", () => {
    // The sole admin is someone else; demoting a non-admin cannot empty the set,
    // and a bare length check would have refused this.
    expect(wouldRemoveLastAdmin(["a"], "b")).toBe(false);
  });

  it("allows when the set is already empty", () => {
    // Nothing to protect: refusing here would make an instance with no admin
    // permanently unable to delete anyone.
    expect(wouldRemoveLastAdmin([], "a")).toBe(false);
  });
});
