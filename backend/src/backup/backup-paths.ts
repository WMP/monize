import { promises as fs } from "fs";
import { dirname, resolve, sep } from "path";

/**
 * Where a user's automatic backups may be written, and where they may not.
 *
 * Two problems lived in this area, and they compound.
 *
 * **The namespace was shared.** The default folder is deployment-wide and the
 * filenames carried frequency and date and nothing else. Two users keeping the
 * default therefore wrote `monize-backup-daily-2026-08-01.json.gz` to the same
 * path on the same day -- the second replaced the first -- and retention
 * enumerated the whole folder with global patterns and applied whichever user's
 * counts it was running for. A user with a 2-day window deleted a user with a
 * 30-day window's history. One replica and two users is enough; the encryption
 * extension avoided one same-day collision and no part of the retention problem,
 * because both `.json.gz` and `.mzbe` are enumerated.
 *
 * **The destination was unrestricted.** The folder endpoints require
 * authentication and nothing else -- no admin role -- and validation asked only
 * for an absolute, normalised, writable directory. So any user could enumerate
 * the container filesystem through `browse-folders` and point their backups at
 * any writable path in it: `/tmp`, a mounted secret, another tenant's directory.
 * The lexical `safePath` guard protected the generated *filename* against
 * traversal, never the chosen directory. And because nothing canonicalised the
 * path, a symlink inside an otherwise-acceptable directory redirected the write
 * outside it.
 *
 * So a destination now has to satisfy both: it is contained in an
 * operator-approved root, canonically and not just lexically, and the file goes
 * in a server-computed per-user subdirectory of it that the user cannot name.
 */

/**
 * Roots a backup may be written under, from `BACKUP_ALLOWED_ROOTS`
 * (colon-separated, in the style of `PATH`).
 *
 * Defaults to the deployment's backup folder alone. That is a deliberate
 * tightening: a deployment where users had chosen folders elsewhere must list
 * them here, and until it does those backups are refused with an error naming
 * the variable. Refusing loudly is the right failure -- the alternative is
 * keeping a hole open because closing it is inconvenient, and the hole is
 * "any authenticated user can write anywhere the process can".
 */
export function resolveAllowedRoots(
  configured: string | undefined,
  defaultRoot: string,
): string[] {
  const extra = (configured ?? "")
    .split(":")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("/"))
    .map((entry) => resolve(entry));
  // The default root is always allowed: it is the operator's own choice of
  // where backups go, and excluding it would break the out-of-the-box setup.
  return [...new Set([resolve(defaultRoot), ...extra])];
}

/** True when `candidate` is `root` or sits beneath it. */
function isWithin(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(root + sep);
}

/**
 * The deepest existing ancestor of `path`, resolved through symlinks, paired
 * with the segments that do not exist yet.
 *
 * A plain `realpath` of the whole path fails for a directory that has not been
 * created, and skipping canonicalisation entirely is what let a symlink escape:
 * `/data/backups/mine -> /etc` passes every lexical check there is.
 */
async function realpathOfExistingAncestor(
  path: string,
): Promise<{ real: string; missing: string[] }> {
  const missing: string[] = [];
  let current = path;
  for (;;) {
    try {
      return { real: await fs.realpath(current), missing: missing.reverse() };
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) {
        // Reached `/` without finding anything that exists, which cannot happen
        // on a running system but must not loop if it does.
        return { real: current, missing: missing.reverse() };
      }
      missing.push(current.slice(parent === sep ? 1 : parent.length + 1));
      current = parent;
    }
  }
}

export class BackupPathNotAllowedError extends Error {
  constructor(path: string, allowedRoots: string[]) {
    super(
      `Backup folder "${path}" is outside the permitted roots ` +
        `(${allowedRoots.join(", ")}). Set BACKUP_ALLOWED_ROOTS to permit it.`,
    );
    this.name = "BackupPathNotAllowedError";
  }
}

/**
 * Canonicalise `path` and confirm it resolves inside one of `allowedRoots`.
 *
 * Returns the canonical form, which is what callers must use for every
 * filesystem operation afterwards: validating one path and then operating on
 * another is how a check becomes decorative.
 */
export async function assertWithinAllowedRoots(
  path: string,
  allowedRoots: string[],
): Promise<string> {
  const { real, missing } = await realpathOfExistingAncestor(resolve(path));
  const canonical = missing.length > 0 ? resolve(real, ...missing) : real;

  const realRoots = await Promise.all(
    allowedRoots.map(async (root) => {
      try {
        return await fs.realpath(root);
      } catch {
        // A root that does not exist yet still constrains: compare lexically.
        return root;
      }
    }),
  );

  if (!realRoots.some((root) => isWithin(canonical, root))) {
    throw new BackupPathNotAllowedError(path, allowedRoots);
  }
  return canonical;
}

/**
 * The directory one user's backups live in.
 *
 * Server-computed from the user id, never from anything the client sends, so two
 * users on the same root cannot name the same file and retention over this
 * directory can only ever see one user's artifacts. The user id is already an
 * opaque, unguessable UUID, so it needs no further mangling -- and keeping it
 * legible is what lets an operator answer "whose backup is this?" from a volume
 * listing.
 *
 * Files already sitting directly in the root predate this and cannot be
 * attributed to anybody: their names carry no owner. They are deliberately left
 * exactly where they are. Retention only ever enumerates a per-user directory,
 * so nothing deletes them, and nothing pretends to know who they belong to.
 */
export function userBackupDirectory(root: string, userId: string): string {
  return resolve(root, userId);
}
