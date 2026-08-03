import { affectedRowCount, returnedRows } from "./query-result";

/**
 * These two helpers exist because TypeORM's postgres driver returns two shapes
 * and which one you get depends on the command tag, not on the presence of a
 * `RETURNING` clause: `UPDATE`/`DELETE` give `[rows, rowCount]`, and everything
 * else -- **`INSERT` included** -- gives bare rows.
 *
 * Every case below is a shape the driver actually produces, named by the
 * statement that produces it. Reading one of them wrong does not throw; it
 * quietly reports the opposite of the truth, which is how a guarded statement
 * turns every caller into a winner.
 */
describe("common/db/query-result", () => {
  // The shapes, exactly as PostgresQueryRunner.query hands them over.
  const selectRows = [{ id: "a" }, { id: "b" }];
  const selectEmpty: unknown[] = [];
  const insertReturning = [{ id: "a" }];
  const insertOnConflictSkipped: unknown[] = [];
  const updateReturningMatched = [[{ id: "a" }], 1];
  const updateReturningRefused = [[], 0];
  const deleteWithoutReturning = [[], 3];
  const deleteWithoutReturningNoop = [[], 0];

  describe("returnedRows", () => {
    it("reads a SELECT's bare rows", () => {
      expect(returnedRows(selectRows)).toEqual(selectRows);
      expect(returnedRows(selectEmpty)).toEqual([]);
    });

    it("reads an INSERT ... RETURNING as bare rows, not as a tuple", () => {
      // The trap: treating this as `[rows, rowCount]` would make `result[0]` the
      // first row rather than the row list, so `result[0].id` would be undefined
      // and every seeded id would come back missing.
      expect(returnedRows<{ id: string }>(insertReturning)).toEqual([
        { id: "a" },
      ]);
      expect(returnedRows(insertOnConflictSkipped)).toEqual([]);
    });

    it("unwraps an UPDATE/DELETE tuple", () => {
      expect(returnedRows(updateReturningMatched)).toEqual([{ id: "a" }]);
      expect(returnedRows(updateReturningRefused)).toEqual([]);
    });

    it("returns nothing for a non-array result", () => {
      // A statement with no result set at all (`SET`, `BEGIN`) must not throw
      // here -- a caller that reads it is asking a meaningless question, and
      // "no rows" is the honest answer to it.
      for (const value of [undefined, null, 0, "", {}]) {
        expect(returnedRows(value)).toEqual([]);
      }
    });
  });

  describe("affectedRowCount", () => {
    it("counts a matched guarded UPDATE and a refused one", () => {
      // The whole point of a compare-and-set: zero is the answer, not an error.
      expect(affectedRowCount(updateReturningMatched)).toBe(1);
      expect(affectedRowCount(updateReturningRefused)).toBe(0);
    });

    it("does not report a tuple's length as a row count", () => {
      // `[[], 0].length` is 2. An open-coded `result.length > 0` here makes every
      // replica the winner of every claim -- the exact bug the guards prevent.
      expect(affectedRowCount(updateReturningRefused)).not.toBe(
        (updateReturningRefused as unknown[]).length,
      );
    });

    it("counts an INSERT ... ON CONFLICT DO NOTHING RETURNING honestly", () => {
      expect(affectedRowCount(insertReturning)).toBe(1);
      expect(affectedRowCount(insertOnConflictSkipped)).toBe(0);
    });

    it("uses the driver's count for an UPDATE/DELETE with no RETURNING", () => {
      // `[[], 3]`: the rows are empty because nothing was asked for, but three
      // rows changed. Counting the row list would report zero -- a delete that
      // did work looking like a no-op, which is how a reversal gets skipped.
      expect(affectedRowCount(deleteWithoutReturning)).toBe(3);
      expect(affectedRowCount(deleteWithoutReturningNoop)).toBe(0);
    });

    it("agrees with returnedRows wherever both are meaningful", () => {
      for (const shape of [
        selectRows,
        insertReturning,
        insertOnConflictSkipped,
        updateReturningMatched,
        updateReturningRefused,
      ]) {
        expect(affectedRowCount(shape)).toBe(returnedRows(shape).length);
      }
    });
  });
});
