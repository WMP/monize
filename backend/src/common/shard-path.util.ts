/**
 * Fan-out layout shared by every store that keys files by a server-generated
 * UUID: attachment bytes under ATTACHMENT_CONTAINER_DIR, and each user's
 * automatic backups under BACKUP_CONTAINER_DIR.
 *
 * A flat layout piles every entry into one directory, and a directory with tens
 * of thousands of entries stalls on filesystems that scan it linearly (ext3) or
 * reach it over the network (NFS/CIFS/overlay): enumeration by backups, rsync
 * and `ls` degrades even where individual lookups stay fast. Two hex bytes give
 * 65536 buckets, so a directory only approaches the ~10k-entry danger zone past
 * hundreds of millions of ids; the ids are random UUIDs, so the spread is even
 * for free.
 *
 * There is one layout, defined here. A second store that shards by hand will
 * drift from this one, and the drift only shows up as files that cannot be
 * found later.
 */

/**
 * Ids are server-generated UUIDs. The allowlist deliberately excludes `.`, so
 * traversal segments (`.`, `..`) and separators cannot be expressed at all --
 * a path built from segments that pass this stays inside its base directory by
 * construction.
 */
const SAFE_SHARD_ID = /^[A-Za-z0-9_-]+$/;

/** Number of leading characters consumed by each shard directory level. */
const SHARD_WIDTH = 2;

/** Number of shard directory levels between the base folder and the id. */
const SHARD_LEVELS = 2;

/**
 * Whether `id` may be used to build a sharded path. Callers validate before
 * resolving and raise their own domain error (a missing attachment, a rejected
 * backup path) rather than sharing one message across unrelated surfaces.
 */
export function isShardableId(id: string | null | undefined): boolean {
  if (typeof id !== "string") return false;
  if (id.includes("\0")) return false;
  if (id.length < SHARD_WIDTH * SHARD_LEVELS) return false;
  return SAFE_SHARD_ID.test(id);
}

/**
 * Path segments for `id`, relative to the store's base folder:
 * `['ab', 'cd', 'abcd...']`. Callers must have checked `isShardableId` first;
 * an unchecked id throws rather than silently producing a traversable path.
 */
export function shardedSegments(id: string): string[] {
  if (!isShardableId(id)) {
    throw new Error("Cannot shard an id outside the safe id alphabet");
  }
  const levels: string[] = [];
  for (let level = 0; level < SHARD_LEVELS; level++) {
    levels.push(id.slice(level * SHARD_WIDTH, (level + 1) * SHARD_WIDTH));
  }
  return [...levels, id];
}
