import { EntityManager } from "typeorm";
import { BackupRestoreDatabaseService } from "./backup-restore-database.service";
import type { BackupData } from "./backup-format";

/**
 * `currencies` is a table every user shares, so a restored row is validated the
 * way the create DTO validates a typed one before it is inserted.
 */
describe("BackupRestoreDatabaseService.ensureCurrenciesExist (restored currency rows)", () => {
  const userId = "user-1";
  let inserts: { sql: string; params: unknown[] }[];
  let manager: EntityManager;

  beforeEach(() => {
    inserts = [];
    manager = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (/information_schema\.columns/.test(sql)) {
          return [
            "code",
            "name",
            "symbol",
            "decimal_places",
            "is_active",
            "created_by_user_id",
          ].map((column_name) => ({ column_name }));
        }
        if (/INSERT INTO "currencies"/.test(sql)) {
          inserts.push({ sql, params });
          return [];
        }
        // The existence check: nothing is missing once the rows are in.
        return (params[0] as string[] | undefined)?.map((code) => ({ code }));
      }),
    } as unknown as EntityManager;
  });

  const restore = (currencies: Record<string, unknown>[]) =>
    new BackupRestoreDatabaseService().ensureCurrenciesExist(
      manager,
      {
        accounts: [{ currency_code: "ZZZ" }],
        currencies,
      } as unknown as BackupData,
      userId,
    );

  const paramsByColumn = (insert: { sql: string; params: unknown[] }) => {
    const columns = [...insert.sql.matchAll(/"(\w+)"/g)]
      .map((m) => m[1])
      .slice(1, 1 + insert.params.length);
    return Object.fromEntries(columns.map((c, i) => [c, insert.params[i]]));
  };

  it("skips a row whose code is not three capital letters", async () => {
    await restore([
      { code: "usd", name: "Dollar", symbol: "$" },
      { code: "TOOLONG", name: "Dollar", symbol: "$" },
      { code: 12, name: "Dollar", symbol: "$" },
      { name: "No code", symbol: "$" },
    ]);

    expect(inserts).toEqual([]);
  });

  it("clamps decimal_places to an integer from 0 to 4, and defaults a non-number to 2", async () => {
    await restore([
      { code: "AAA", name: "A", symbol: "A", decimal_places: -2 },
      { code: "BBB", name: "B", symbol: "B", decimal_places: 99 },
      { code: "CCC", name: "C", symbol: "C", decimal_places: 2.7 },
      { code: "DDD", name: "D", symbol: "D", decimal_places: "x" },
    ]);

    expect(inserts.map((i) => paramsByColumn(i).decimal_places)).toEqual([
      0, 4, 2, 2,
    ]);
  });

  it("strips angle brackets and caps name and symbol at the column lengths", async () => {
    await restore([
      {
        code: "AAA",
        name: `<b>${"n".repeat(200)}</b>`,
        symbol: `<i>${"s".repeat(40)}</i>`,
      },
    ]);

    const row = paramsByColumn(inserts[0]);
    expect(row.name).toBe("b" + "n".repeat(99));
    expect(row.symbol).toBe("i" + "s".repeat(9));
    expect(row.created_by_user_id).toBe(userId);
  });

  it("skips a row whose name or symbol is empty after sanitizing", async () => {
    await restore([
      { code: "AAA", name: "<>", symbol: "$" },
      { code: "BBB", name: "Bee", symbol: "<>" },
      { code: "CCC", name: 5, symbol: "$" },
      { code: "DDD", name: "Dee", symbol: "D" },
    ]);

    expect(inserts.map((i) => paramsByColumn(i).code)).toEqual(["DDD"]);
  });
});
