import { EntityManager } from "typeorm";
import { UserPreference } from "./entities/user-preference.entity";
import { buildDefaultPreferences } from "./user-preference.factory";
import { currentRequestLocale } from "../i18n/request-locale";

/**
 * The one way to write a few columns of a user's preferences row.
 *
 * `user_preferences` is a single row per user written from many unrelated
 * places: the Settings form, a dismissed tour, a "What's New" acknowledgement,
 * an update banner, enabling 2FA. Every one of those used the same shape --
 * `findOne`, mutate one field, `repo.save(entity)` -- and that shape loses
 * writes.
 *
 * Not because `save` is careless: it re-reads the row and writes the columns that
 * differ from the entity in hand. That is exactly the problem. The entity in hand
 * still holds whatever the *other* columns looked like when it was read, so a
 * column another request has since changed reads as a deliberate change back.
 * Dismiss a tour in one tab while switching the theme in another and the theme
 * reverts, with no error and nothing in the logs. Under `READ COMMITTED` the
 * read and the write are separate statement snapshots even inside one
 * transaction, so there is no version of this that a transaction alone fixes --
 * only writing *just* the columns you mean to write does.
 *
 * So: `patchUserPreferences` for a set of literal values, and
 * `ensureUserPreferencesRow` when the caller needs the row to exist before its
 * own expression-valued `UPDATE` (a JSONB merge, say).
 */

/**
 * The columns a patch may set.
 *
 * `Partial<UserPreference>` rather than TypeORM's own
 * `QueryDeepPartialEntity`: that type lives at
 * `typeorm/query-builder/QueryPartialEntity`, a deep path which type-checks
 * under `tsc` and does **not** resolve under ts-jest -- importing it takes every
 * suite in the repo down. `common/db/scoped-db.ts` documents the same trap for
 * the isolation-level type.
 */
export type UserPreferencePatch = Partial<UserPreference>;

/**
 * Create this user's preferences row if it does not exist yet.
 *
 * `ON CONFLICT DO NOTHING` rather than "check then insert": two first-time
 * writers both find no row, and inside a transaction a unique violation cannot
 * be caught and recovered from -- it aborts the transaction, so the loser's whole
 * request fails on a cosmetic write. Letting the primary key arbitrate makes the
 * loser a no-op instead.
 *
 * The defaults come from the shared factory so a row materialized here has the
 * same baseline as one created at registration.
 */
export async function ensureUserPreferencesRow(
  manager: EntityManager,
  userId: string,
): Promise<void> {
  await manager
    .getRepository(UserPreference)
    .createQueryBuilder()
    .insert()
    .values(buildDefaultPreferences(userId, currentRequestLocale()))
    .orIgnore()
    .execute();
}

/**
 * Write exactly `patch` onto this user's preferences, materializing the row
 * first when it does not exist.
 *
 * Every column outside `patch` is left alone, so a concurrent write to a
 * different setting survives. Returns nothing: the row is guaranteed to exist by
 * the time the update runs, so there is no "did it match" question to answer.
 */
export async function patchUserPreferences(
  manager: EntityManager,
  userId: string,
  patch: UserPreferencePatch,
): Promise<void> {
  if (Object.keys(patch).length === 0) {
    // Nothing to write, but the row is still expected to exist afterwards --
    // callers use this to lazily materialize preferences on first access.
    await ensureUserPreferencesRow(manager, userId);
    return;
  }

  await ensureUserPreferencesRow(manager, userId);
  await manager
    .getRepository(UserPreference)
    .createQueryBuilder()
    .update()
    .set(patch)
    .where("user_id = :userId", { userId })
    .execute();
}
