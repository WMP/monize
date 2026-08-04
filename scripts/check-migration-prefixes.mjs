#!/usr/bin/env node
// Verify migration filename prefixes are unique, and that a newly added
// migration sorts after everything already on the base branch.
//
// `database/CLAUDE.md` states both rules in prose. Prose did not stop this from
// happening: a remediation branch added `133_import_jobs_one_active_per_user.sql`
// while `main` had meanwhile taken `133` for `133_joint_account_grants.sql` and
// shipped the same fix as `135_import_jobs_single_active.sql`. Migrations are
// applied and tracked **by full filename**, so on a database that had already
// recorded `135`, the newly introduced `133_*` would be seen as pending and
// applied *after* it -- an obsolete body running against a schema the newer
// migration had already corrected, with the apply order between the two `133_*`
// files decided by alphabetical tie-breaking.
//
// Two checks:
//
//   1. no numeric prefix is used twice, except the historical pairs below;
//   2. when a base ref is available, every migration this branch adds has a
//      prefix strictly greater than the highest prefix on that base.
//
// Check 2 needs git history. It reports and skips rather than failing when the
// base ref is absent (shallow clone, detached build), because a check that
// cannot run must not look like a check that passed.
//
// Requires nothing but Node and, for check 2, git.

import { readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const REPO_ROOT = new URL('..', import.meta.url).pathname;
const MIGRATIONS = join(REPO_ROOT, 'database', 'migrations');

/**
 * Prefixes already shared by two files when this check was written. Every one
 * predates the rule and is recorded in `database/CLAUDE.md`. **This list may
 * only shrink** -- adding to it is choosing the ambiguous apply order the check
 * exists to prevent.
 */
const GRANDFATHERED_DUPLICATES = new Set([
  '022',
  '068',
  '075',
  '116',
  '117',
  '124',
]);

/** Base refs tried, in order, for the "must sort last" check. */
const BASE_REFS = ['origin/main', 'main'];

const failures = [];
const notes = [];

function prefixOf(name) {
  const match = /^(\d+)_/.exec(name);
  return match ? match[1] : null;
}

function migrationNames(list) {
  return list.filter((name) => name.endsWith('.sql'));
}

// ---------------------------------------------------------------------------
// Check 1: unique numeric prefixes
// ---------------------------------------------------------------------------

const names = migrationNames(readdirSync(MIGRATIONS)).sort();

if (names.length === 0) {
  failures.push('database/migrations contains no .sql files -- the check would be vacuous');
}

const byPrefix = new Map();
for (const name of names) {
  const prefix = prefixOf(name);
  if (!prefix) {
    failures.push(`${name}: filename does not start with a numeric prefix (NNN_description.sql)`);
    continue;
  }
  byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), name]);
}

const staleGrandfathers = [];
for (const prefix of GRANDFATHERED_DUPLICATES) {
  if ((byPrefix.get(prefix) ?? []).length < 2) staleGrandfathers.push(prefix);
}
if (staleGrandfathers.length) {
  // The list may only shrink, so a prefix that is no longer duplicated must be
  // removed from it -- otherwise it silently re-permits a future collision.
  failures.push(
    `GRANDFATHERED_DUPLICATES lists prefixes that are no longer duplicated: ` +
      `${staleGrandfathers.join(', ')}. Remove them from ${'scripts/check-migration-prefixes.mjs'}.`,
  );
}

for (const [prefix, files] of byPrefix) {
  if (files.length > 1 && !GRANDFATHERED_DUPLICATES.has(prefix)) {
    failures.push(
      `duplicate migration prefix ${prefix}: ${files.join(', ')} -- ` +
        'apply order falls back to alphabetical tie-breaking. Renumber the new file to the next free prefix.',
    );
  }
}

// ---------------------------------------------------------------------------
// Check 2: an added migration sorts after everything on the base branch
// ---------------------------------------------------------------------------

function git(args) {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function resolveBase() {
  for (const ref of BASE_REFS) {
    try {
      git(['rev-parse', '--verify', `${ref}^{commit}`]);
      return ref;
    } catch {
      continue;
    }
  }
  return null;
}

const base = existsSync(join(REPO_ROOT, '.git')) ? resolveBase() : null;

if (!base) {
  notes.push(
    'no base ref (origin/main or main) resolved, so the "new migration sorts last" ' +
      'check did not run. Prefix uniqueness was still verified.',
  );
} else {
  let baseNames = [];
  try {
    baseNames = migrationNames(
      git(['ls-tree', '--name-only', base, 'database/migrations/']).split('\n'),
    ).map((path) => path.replace(/^database\/migrations\//, ''));
  } catch {
    notes.push(`could not list database/migrations at ${base}; skipped the ordering check.`);
  }

  if (baseNames.length > 0) {
    const baseMax = baseNames
      .map(prefixOf)
      .filter(Boolean)
      .reduce((max, prefix) => (prefix > max ? prefix : max), '000');
    const baseSet = new Set(baseNames);
    const added = names.filter((name) => !baseSet.has(name));

    for (const name of added) {
      const prefix = prefixOf(name);
      if (prefix && prefix <= baseMax) {
        failures.push(
          `${name} is new on this branch but its prefix ${prefix} is not above the highest ` +
            `prefix on ${base} (${baseMax}). Deployed databases track migrations by full ` +
            'filename, so a lower-numbered new file is applied after migrations that already ' +
            'ran. Renumber it.',
        );
      }
    }
    notes.push(
      `compared against ${base}: ${added.length} migration(s) added on this branch, ` +
        `base maximum prefix ${baseMax}.`,
    );
  }
}

// ---------------------------------------------------------------------------

for (const note of notes) console.log(`note: ${note}`);

if (failures.length) {
  console.error('\nMigration prefix check failed:\n');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('\nSee database/CLAUDE.md, "Creating a New Migration".');
  process.exit(1);
}

console.log(`Migration prefix check: OK (${names.length} migrations)`);
