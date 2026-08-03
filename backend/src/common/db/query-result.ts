/**
 * Reading a raw `manager.query()` result correctly, in one place.
 *
 * The pg driver hands TypeORM two different shapes and the difference is
 * invisible at the call site:
 *
 * - a `SELECT` comes back as bare rows -- `[{...}, {...}]`;
 * - a data-modifying statement with `RETURNING` comes back as
 *   `[rows, rowCount]`.
 *
 * Getting that wrong fails silently in the worst possible direction. On the
 * tuple, `result.length > 0` is *always* true -- so every conditional claim
 * looks like a winner, every `ON CONFLICT DO NOTHING` looks like an insert, and
 * every guarded `UPDATE ... WHERE ... RETURNING` looks like it matched a row.
 * That is exactly the class of bug the guarded statements in this codebase exist
 * to prevent, so the reading of their results is not open-coded per call site.
 *
 * The `.mny` job service found this the hard way; its concurrency spec is what
 * keeps it honest.
 */

/** The rows a `query()` returned, whichever of the two shapes it used. */
export function returnedRows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) {
    return [];
  }
  return Array.isArray(result[0]) ? (result[0] as T[]) : (result as T[]);
}

/**
 * How many rows a guarded statement actually matched.
 *
 * Use this for `UPDATE/INSERT/DELETE ... RETURNING`: zero means the predicate
 * refused, which for a compare-and-set is the answer, not an error to ignore.
 */
export function affectedRowCount(result: unknown): number {
  return returnedRows(result).length;
}
