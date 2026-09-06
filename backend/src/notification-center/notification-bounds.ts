import type { Logger } from "@nestjs/common";

export type BoundsLogger = Pick<Logger, "warn" | "error">;

// The three column widths the door truncates on. Each is checked against
// `database/schema.sql` by `notification-category.spec.ts`: a bound that is too
// low silently shortens copy the column would have taken, and one that is too
// high hands PostgreSQL a value it refuses with 22001 -- inside a producer's
// never-throws catch, which is the failure the truncation exists to prevent.

/** Matches notifications.title. */
export const TITLE_MAX_LENGTH = 255;

/** Matches notifications.dedupe_key. */
export const DEDUPE_KEY_MAX_LENGTH = 120;

/** Matches notifications.target. */
export const TARGET_MAX_LENGTH = 255;

/**
 * A title the `title VARCHAR(255)` column will accept.
 *
 * Producers interpolate names they do not control -- a scheduled
 * transaction's, an account's -- and an over-long one makes PostgreSQL raise
 * 22001, which a producer's never-throws contract then swallows: the
 * notification silently never exists, and for SCHEDULED_POST_FAILED that
 * means the user is never told their money did not move. Truncating is the
 * honest failure, and it happens once, here, rather than at each producer.
 */
export function boundedTitle(
  type: string,
  title: string,
  logger: BoundsLogger,
): string {
  if (title.length <= TITLE_MAX_LENGTH) return title;
  logger.warn(
    `Title for ${type} exceeds ${TITLE_MAX_LENGTH} chars and was truncated`,
  );
  return `${title.slice(0, TITLE_MAX_LENGTH - 1)}…`;
}

/**
 * Keys are bounded by construction (type + UUID + date is well under the
 * column); a longer one is a producer bug, reported and truncated
 * deterministically rather than thrown, because the notification still
 * deduping -- slightly too coarsely -- beats the sweep that raised it dying
 * here.
 */
export function boundedDedupeKey(
  type: string,
  dedupeKey: string | null | undefined,
  logger: BoundsLogger,
): string | null {
  if (dedupeKey === null || dedupeKey === undefined) return null;
  if (dedupeKey.length <= DEDUPE_KEY_MAX_LENGTH) return dedupeKey;
  logger.error(
    `Dedupe key for ${type} exceeds ${DEDUPE_KEY_MAX_LENGTH} chars ` +
      `and was truncated: ${dedupeKey.slice(0, 60)}...`,
  );
  return dedupeKey.slice(0, DEDUPE_KEY_MAX_LENGTH);
}

/**
 * A truncated path points somewhere else, so an over-long target is dropped
 * rather than cut: a notification with no link is worse than one with the
 * right link and better than one that navigates to the wrong page.
 */
export function boundedTarget(
  type: string,
  target: string | null | undefined,
  logger: BoundsLogger,
): string | null {
  if (target === null || target === undefined) return null;
  if (target.length <= TARGET_MAX_LENGTH) return target;
  logger.error(
    `Target for ${type} exceeds ${TARGET_MAX_LENGTH} chars and was dropped`,
  );
  return null;
}
