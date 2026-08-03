import { promises as fs } from "fs";
import { basename, dirname, join } from "path";

/**
 * Crash-atomic file writes for automatic backups.
 *
 * The automatic backup wrote its payload with `fs.writeFile` straight onto the
 * final, predictable filename, and promoted daily to weekly/monthly with
 * `copyFileSync` onto another final filename. Both truncate first and fill
 * afterwards, so a process kill, an ENOSPC or a container eviction between the
 * two leaves a partial file under a name that looks finished. It has a valid
 * `.json.gz`/`.mzbe` extension, it sorts newest, retention counts it, and an
 * operator reaching for the most recent recovery point picks it. Nothing in the
 * artifact says it is truncated -- gzip only complains at the end, which is
 * exactly where the bytes stop.
 *
 * So: write to a temporary name in the same directory, flush it to disk, rename
 * it over the final name, and flush the directory entry too. `rename(2)` within
 * a filesystem is atomic, so the final name never names a partial file -- a
 * reader sees either the previous artifact or the complete new one.
 *
 * Temporary names start with a dot and carry the pid, so they are invisible to
 * the retention patterns (which anchor on `monize-backup-`) and attributable
 * when one is left behind. `cleanStaleTempFiles` removes leftovers separately
 * from retention, because a crashed write is not a backup and must not count
 * against the number of backups kept.
 */

/** Prefix marking a partial write. Deliberately not `monize-backup-`. */
const TEMP_PREFIX = ".monize-backup-tmp-";

/** How long a temporary file must be untouched before it is considered stale. */
const STALE_TEMP_AGE_MS = 60 * 60 * 1000;

let tempCounter = 0;

function tempPathFor(finalPath: string): string {
  tempCounter += 1;
  const unique = `${process.pid}-${tempCounter}`;
  return join(
    dirname(finalPath),
    `${TEMP_PREFIX}${unique}-${basename(finalPath)}`,
  );
}

/**
 * `fsync` a directory so a rename survives a power loss. Best-effort: some
 * filesystems refuse to open a directory for this, and failing the whole backup
 * over a durability hint we cannot give would trade a real artifact for none.
 */
async function syncDirectory(path: string): Promise<void> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(path, "r");
    await handle.sync();
  } catch {
    // Not fatal -- see above.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Write `data` to `finalPath` so that name only ever refers to a complete file.
 *
 * The temporary file is created with `wx` (exclusive), so two writers cannot
 * share one, and is removed if anything after that fails -- including the
 * rename. A caller that gets an error has not replaced the previous artifact.
 */
export async function writeFileAtomic(
  finalPath: string,
  data: Buffer,
): Promise<void> {
  const tempPath = tempPathFor(finalPath);
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(tempPath, "wx");
    await handle.write(data);
    // Before the rename, not after: a rename that lands while the data is still
    // in the page cache can survive a crash the data does not.
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(tempPath, finalPath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
  await syncDirectory(dirname(finalPath));
}

/**
 * Copy `sourcePath` to `finalPath` through a temporary name, for the weekly and
 * monthly promotions. `copyFileSync` onto the final name had the same hazard as
 * the daily write: it truncates the destination first, so an interrupted
 * promotion destroyed last month's artifact and left a partial one named as
 * though it had replaced it.
 */
export async function copyFileAtomic(
  sourcePath: string,
  finalPath: string,
): Promise<void> {
  const data = await fs.readFile(sourcePath);
  await writeFileAtomic(finalPath, data);
}

/** True for a name this module would have created. */
export function isTempBackupName(name: string): boolean {
  return name.startsWith(TEMP_PREFIX);
}

/**
 * Remove temporary files left by an interrupted write.
 *
 * Deliberately separate from retention: a partial write is not a backup, so
 * counting it towards "keep 7 daily" would silently shorten the retention
 * window. Only files older than an hour are removed, so a concurrent write in
 * another replica is never pulled out from under itself.
 *
 * Best-effort and never throws -- this runs at the start of a backup, and
 * failing to tidy up must not stop one being taken.
 */
export async function cleanStaleTempFiles(
  directory: string,
  now: number,
): Promise<number> {
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch {
    return 0;
  }

  let removed = 0;
  for (const name of names) {
    if (!isTempBackupName(name)) continue;
    const path = join(directory, name);
    try {
      const stat = await fs.stat(path);
      if (now - stat.mtimeMs < STALE_TEMP_AGE_MS) continue;
      await fs.unlink(path);
      removed += 1;
    } catch {
      // Gone already, or not ours to remove.
    }
  }
  return removed;
}
