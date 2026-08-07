/**
 * Reading a raw `manager.query()` result correctly, in one place.
 *
 * TypeORM's postgres driver returns **two different shapes**, and which one you
 * get depends on the statement's command tag, not on whether it has a
 * `RETURNING` clause (`PostgresQueryRunner.query`, the `switch (raw.command)`):
 *
 * - `UPDATE` and `DELETE` -> the tuple `[rows, rowCount]`, always, with or
 *   without `RETURNING`;
 * - **everything else, `INSERT` included** -> bare rows, `[{...}, {...}]`.
 *
 * That `INSERT` sits with `SELECT` rather than with its fellow data-modifying
 * statements is the part that catches people out, and getting it backwards fails
 * silently in the worst possible direction. On the tuple `result.length > 0` is
 * *always* true, so a guarded `UPDATE ... WHERE ... RETURNING` looks like it
 * matched a row and `length === 0` never fires -- which is exactly how
 * `TourService.saveProgress` ended up with a missing-row fallback that could not
 * run. The reading is therefore not open-coded per call site.
 *
 * `returnedRows` and `affectedRowCount` are correct for both shapes, so a call
 * site does not have to know which one it is looking at -- which is the point,
 * because the command tag is not visible where the result is consumed.
 *
 * The `.mny` job service found this the hard way; its concurrency spec is what
 * keeps it honest.
 */

/**
 * The rows a `query()` returned, whichever of the two shapes it used.
 *
 * A row is always an object, so an array in position 0 can only be the
 * `UPDATE`/`DELETE` tuple's row list -- there is no ambiguity to resolve.
 */
export function returnedRows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) {
    return [];
  }
  return Array.isArray(result[0]) ? (result[0] as T[]) : (result as T[]);
}

/**
 * How many rows a statement actually matched.
 *
 * Use this for a guarded `UPDATE`/`DELETE` (with or without `RETURNING`) or an
 * `INSERT ... ON CONFLICT ... RETURNING`. Zero means the predicate refused,
 * which for a compare-and-set is the answer, not an error to ignore.
 *
 * The driver's own `rowCount` is preferred when it is there, because it is the
 * only truthful answer for an `UPDATE`/`DELETE` **without** a `RETURNING`
 * clause: that comes back as `[[], 3]`, and counting the (empty) row list would
 * report zero rows changed for a statement that changed three.
 *
 * **An `INSERT` must carry a `RETURNING`.** The driver discards `rowCount` for
 * `INSERT` (see the shape note above: `INSERT` comes back as bare rows, never
 * the `[rows, rowCount]` tuple), so a bare `INSERT ... ON CONFLICT DO NOTHING`
 * with no `RETURNING` yields `[]` whether it inserted a row or hit the conflict
 * -- and this reports 0 for both. Every guarded insert here therefore ends in
 * `RETURNING`, so the count reflects the row it actually wrote.
 */
export function affectedRowCount(result: unknown): number {
  if (
    Array.isArray(result) &&
    Array.isArray(result[0]) &&
    typeof result[1] === "number"
  ) {
    return result[1];
  }
  return returnedRows(result).length;
}
