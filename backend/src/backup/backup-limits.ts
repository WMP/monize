/**
 * Size ceilings for the backup paths that hold a whole payload in memory.
 *
 * Two of them, for two different failure modes.
 *
 * **Restore decompression.** Express caps the *compressed* upload
 * (`BACKUP_RESTORE_LIMIT`, 500 MB by default), which bounds nothing about what
 * comes out of gzip: a few hundred kilobytes of repeated text expands to
 * gigabytes, and `gunzipSync` with no `maxOutputLength` allocated all of it --
 * before the version check, before the format check, before anything that could
 * refuse the request. On a single replica that is every user's backend.
 *
 * **Buffered export.** The encrypted, automatic and support export paths cannot
 * stream: GCM needs the whole plaintext to compute its auth tag, and the support
 * export has to hold every table at once to reconcile scaled balances. They
 * accumulate rows, base64 attachment bytes, JSON strings and a gzip buffer, and
 * the Helm chart's default backend limit is 400 MiB. Thirty 10 MiB attachments
 * are ~400 MiB of base64 on their own. Without a ceiling the pod is OOM-killed
 * mid-backup, which leaves no artifact and no error the user can read.
 *
 * Both are configurable, because the right number depends on the container's
 * memory limit, and both fail loudly rather than degrading.
 */

/** Bytes in a mebibyte, spelled out where the defaults are set. */
const MIB = 1024 * 1024;

/**
 * Default ceiling on a restore's decompressed payload. Generous next to any
 * real personal-finance dataset, and small enough that hitting it is a rejected
 * request rather than a dead process on a container sized for the chart's
 * defaults.
 */
export const DEFAULT_RESTORE_EXPANDED_LIMIT_BYTES = 1024 * MIB;

/** Default ceiling on the JSON a buffered export may accumulate. */
export const DEFAULT_EXPORT_BUFFER_LIMIT_BYTES = 512 * MIB;

const UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: MIB,
  gb: 1024 * MIB,
};

/**
 * Parses a `bytes`-style size ("512mb", "2gb", "1048576") into bytes.
 *
 * Written out rather than taken from body-parser's `bytes` dependency: that is a
 * transitive package, and a limit that silently becomes `undefined` because a
 * transitive dep moved is a ceiling that is not there.
 *
 * Returns null for anything it cannot read, so the caller logs and falls back to
 * its default instead of running unbounded on a typo.
 */
export function parseByteSize(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*$/i.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = UNITS[(match[2] ?? "b").toLowerCase()];
  return Math.floor(amount * unit);
}

/** Reads a byte-size limit from the environment, falling back on bad input. */
export function resolveByteLimit(
  raw: string | undefined,
  fallback: number,
  onInvalid?: (message: string) => void,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = parseByteSize(raw);
  if (parsed === null) {
    onInvalid?.(
      `Could not read "${raw}" as a byte size (expected e.g. "512mb"); using ${fallback} bytes.`,
    );
    return fallback;
  }
  return parsed;
}
