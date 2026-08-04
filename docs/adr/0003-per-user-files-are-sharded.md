# 0003. Per-user files live in a sharded directory

Status: accepted
Date: 2026-08-04 (recorded retrospectively; the decision was made when the
flat-folder collision was fixed, and is already stated as a rule in the root
`CLAUDE.md`)

## Context

The server writes files on a user's behalf in two places: attachment bytes under
the local filesystem provider, and each user's automatic backups.

Automatic backup filenames carry only a tier and a date --
`monize-backup-daily-2026-08-03.json.gz`. In a flat shared folder that gave every
user the same name for the same day. Whoever's cron ran last overwrote the rest,
and one user's retention pass deleted another user's files. Both effects are
silent: the backup reports success, and the loss is discovered only when a
restore is attempted.

A second force is filesystem behaviour rather than correctness. A single
directory holding one entry per user degrades on filesystems that scan linearly,
and worse over a network mount, so the layout has to keep any one directory
small regardless of user count.

## Decision

Anything the server writes to disk on a user's behalf goes in:

```text
<base>/<ab>/<cd>/<id>/
```

built from `shardedSegments` in `backend/src/common/shard-path.util.ts` -- two
levels of two hex characters taken from the id, then the id itself.

- One sharding scheme, one helper. Do not hand-roll a second.
- Do not write a per-user file flat into a shared folder, even when the filename
  looks unique. The backup case proves that a name which looks unique per user is
  often only unique per user *per day*.
- A path built from an id must still be validated with `isShardableId` and
  asserted to resolve inside its base before it reaches the filesystem, **even
  when the id is server-generated** (CWE-22).

## Consequences

**Makes easy.** A per-user file's owner is derivable from its path, which makes
retention scoping correct by construction: a user's retention pass sweeps their
own directory and cannot reach anyone else's. Directory sizes stay bounded.

**Makes hard.** Anything that wants to enumerate all users' files must walk two
levels. `enforceRetention` also still sweeps the old flat layout, because files
written before this decision exist and must not be orphaned -- that compatibility
sweep is expected to remain indefinitely.

**Forbids.** A second sharding scheme; a flat per-user write; and an unvalidated
id reaching a path, including a server-generated one. The "even when
server-generated" clause is deliberate: an id that is trusted because of where it
came from stops being trustworthy the moment a caller passes something else, and
the validation is cheap.

**Does not solve.** Sharding fixes *which* file belongs to whom. It does nothing
about whether the file is complete -- a truncated write still lands under the
expected name. See `docs/external-side-effects.md` and INV-BACKUP-001, where
that remains open.

## Alternatives considered

**Include the user id in the filename, keep one flat directory.** Rejected on the
filesystem force alone: the collision problem is solved, but a directory with one
entry per user per tier per retained date is exactly the shape that scans badly.

**A database-backed blob for everything, no filesystem writes.** This is what the
database attachment provider does, and it is genuinely the strongest option --
metadata and bytes commit in one transaction. Rejected as the *only* option
because deployments want backups on a mounted volume and attachments in object
storage, and a backup living solely inside the database it backs up is not a
backup.

**A single level of sharding.** Rejected as insufficient at scale: one level of
two hex characters caps at 256 directories, so directory size still grows linearly
with users. Two levels give 65,536, which keeps each directory small across any
plausible user count for this application.
