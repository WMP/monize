# Audit-03 Rebase — As-Built Report (for independent verification)

Written for the external reviewer that produced the audit-03 findings. Every claim is
falsifiable against this local clone; reproduction commands included. **Scope: Steps 1–2 only**
(rebase + conflict resolution + verification). The PR split (Step 3), PR opening (Step 4) and
issue filing (Step 5) have NOT started — nothing was pushed, no PR or issue exists yet.

## 1. Target facts

| Field | Value |
| --- | --- |
| Upstream (`origin`) main used as base | `53764ced517fb9447a4c2bce631136e0825011ef` |
| Source branch (fork ref, pre-rebase) | `fork/claude/detailed-error-review-4pbug7` = `c841ad9aebb05b616a2d0077fefc707850541344` |
| Old merge-base | `4e48a76762a07402a5d3bc3f886fcd8e6ff5829b` (52 ahead / 92 behind) |
| Rebased local head | `825eab8c619f03b0739ada4d7c95fbbdd390e3b4` (`ba0de2e37` at review 1, `2587053f3` at review 2; see §2.7, §2.8) |
| Commits over main after rebase | 57 = 52 original + 5 new (migration renumber `2df6e400c`, guard-scope fix `e11bd888e`, prettier `ba0de2e37`, review-1 response `2587053f3`, review-2 response `825eab8c6`) |
| Net diff vs main | 92 files, +14819 −1700 |
| Worktree | clean (`git status --porcelain` empty apart from untracked local `.claude/` scratch) |
| Patch-id overlap check | `git cherry origin/main <branch> 4e48a767` → zero `-` lines; no audit-03 commit was already upstream |

Reproduce ancestry: `git merge-base --is-ancestor origin/main 825eab8c6` holds;
`git log --oneline origin/main..825eab8c6` lists the 57.

Related in-flight work the reviewer should know about: the **audit-02 series** (upstream PRs
#1056–#1063 + local stacked pr/05, pr/06, pr/09) is open but unmerged. Audit-03 was rebased onto
main WITHOUT it. Cross-series collisions exist by construction — both series touch
`backend/src/backup/` — and will surface as ordinary rebase work for whichever series merges
second. Notably: audit-02's #1061 (atomic backup write, `randomUUID` temp name) is **subsumed
and exceeded** by audit-03's `atomic-file.ts` machinery (fsync-before-rename F3R-007, stale-temp
cleanup, real-fs tests); if audit-03's backup PR is accepted, #1061 should be closed in its
favor. Audit-02's #1063 (runtime-role) and audit-03's `3f0cd8379`/`4612b039b` (SET-ROLE-to-power
refusal, startup serialisation) overlap partially — #1063 is the more complete runtime-role
verifier; audit-03's startup-lifecycle half is disjoint. Not resolved here; flagged for the
maintainer.

## 2. Conflict-resolution decisions (rule: the more complete solution wins)

### 2.1 `d5613978` "Isolate automatic backups per user…" vs upstream #1032 — the big one

Upstream #1032 had independently shipped: sharded per-user folders (`<root>/<ab>/<cd>/<id>`, the
repo-canonical `shardedSegments` layout shared with attachments), admin-only settings
(`AutoBackupController` behind `@Roles("admin")`), hourly enrolment, automatic encryption tied to
the login password, and a legacy flat-base retention sweep. The branch commit brought: allowed-
roots confinement (`backup-paths.ts`, `BACKUP_ALLOWED_ROOTS`), crash-atomic writes
(`atomic-file.ts`: temp+rename, stale-temp cleanup), a FLAT `<root>/<uuid>` per-user layout, and
a rewritten real-filesystem spec.

Kept from upstream: sharded layout (root `CLAUDE.md` forbids a second sharding scheme), admin
gating, encryption, enrolment, the 3-arg `enforceRetention` with the legacy flat-base sweep.
Kept from the branch: confinement (`assertAllowedRoot` threaded into `resolveUserFolder`),
`atomic-file.ts` + all writes through it, the real-fs spec approach (a mocked `rename` cannot
demonstrate atomicity — the branch's own rationale, kept as the suite's header comment), the
folder-picker exclusion of per-user dirs (extended to also exclude the 2-hex-char shard levels).
`userBackupDirectory` (flat layout helper) is no longer called by the service; the spec's
`folderFor` computes the sharded path.

Test coverage reconciliation: the merged spec is the branch's real-fs suite ported to sharded
paths, PLUS upstream's tests re-ported (sharding regression, per-user-folder-on-demand,
missing-base refusal, two-users-apart, traversal rejection, encryption `.mzbe` +
unrecoverable-password refusal, enrolment trio, legacy flat-base retention pair). One branch test
was **removed as contradictory** rather than ported: "leaves legacy files sitting directly in the
root alone" asserted the flat-base sweep must NOT happen, while the kept (upstream) retention
deliberately sweeps it. Final: 92 tests, green.

### 2.2 `dd8e466e` stale-snapshot fix vs upstream's newer `BackupEncryptionService`

Upstream's API (automatic encryption; `setBackupPasswordForOidcUser` / `disableForOidcUser` /
`rememberLoginPassword`; `requireManageableUser`; three-state `resolveBackupPassword`;
constant-time stored-password comparison) was kept wholesale — the branch's incoming method
bodies (`enableForLocalUser`/`disable`/opt-in flag flow) are the OLDER surface and did not win.
The branch commit's actual defect — every mutating method loaded the `users` row in one
transaction and `save()`d the full stale entity in another, silently reverting concurrent
changes (lockout counters, disabled flags, even `password_hash` during a password change) — was
**ported onto upstream's methods**: one `withScopedDb` per operation, re-read inside, targeted
`update()` of only the service-owned columns, expensive checks (bcrypt, `isBreached` HTTPS)
before the transaction. Spec: upstream's tests kept; the branch's new update-not-save /
single-transaction / refusal-path assertions ported onto upstream's method names; old-API-only
tests dropped (list available on request — includes the one test contradicting upstream's
unconditional `rememberLoginPassword` capture). 29 tests, green.

### 2.3 `8863f104` / `a9ac6f1d` capability endpoint and banner

The branch added `GET backup/auto-backup-capability` to the everyone-visible `BackupController`
(its baseline predates admin-only settings). Upstream moved all schedule configuration behind
`@Roles("admin")`, so the endpoint was placed on `AutoBackupController` instead — the banner
gates a configuration surface only admins see. The frontend capability wiring
(`getAutoBackupCapability`, `AutoBackupCapability`, the no-storage notice) auto-merged and was
kept; three stale-baseline frontend hunks (old `enableLocalEncryption` API, quote-style noise)
resolved to upstream.

### 2.4 `83ab4f6f` (F3R7-001 partial-backup) identifier reconciliation

Applied on top of the merged shape: `exportToFile` now returns `{ filename, report }`;
promotion/retention gated on `report.complete`; `applyBackupOutcome` calls
`enforceRetention(folder, settings.folderPath, settings)` (upstream's 3-arg legacy-sweep form,
not the branch's 2-arg). Four `exportToBuffer` call sites in upstream-era
`backup-restore.integration.spec.ts` destructured to the new `{ buffer }` contract.

### 2.5 Smaller ones

- `backup.module.ts`: union (`AttachmentsModule` import + `AutoBackupController`).
- Root `CLAUDE.md` ×2: union of upstream's dockerignore rule with the branch's three new rules;
  second conflict took the branch's own updated wording ("wrong in all four") over its earlier draft.
- `docs/cron-jobs.md`: merged row for `auto-backup.service` (upstream's enrolment + branch's
  promote/retention wording) + the branch's six new rows.
- `helm/README.md`: branch side (env-var name instead of a stale literal).
- `local-storage.provider.ts` / S3: branch side — shared `assertSafeStorageKey`
  (`storage-key.util.ts`) verified to reproduce upstream's `basename` + `isShardableId` +
  `NotFoundException` semantics before adoption.
- `backup.controller.ts` import hunk: upstream side; re-added `releaseRestoreReservation` (used
  at the restore handler's `finally`) and dropped the now-unused `AutoBackupService` import.

### 2.6 New commits beyond the original 52

1. `2df6e400c` — migrations `133_currency_global_liveness.sql` → `136_…`,
   `134_currency_codes_referenced_by_user.sql` → `137_…` (upstream took 133–135 meanwhile; the
   prefix-uniqueness CI gate would fail); `database/CLAUDE.md`'s reference follows the file.
   Content unchanged (`git show 2df6e400c` = pure renames + one doc line).
2. `e11bd888e` — the branch's two new repository-tree guards (`doc-paths.spec.ts`,
   `source-bytes.spec.ts`) now skip `.claude/` (untracked local agent scratch made them red on a
   contributor's clone while CI stayed green — exactly when a guard must be trustworthy). Plus
   one unused import dropped after the storage-key extraction.
3. `ba0de2e37` — prettier normalization of the resolution edits (cosmetic).

### 2.7 Response to the independent verification of `ba0de2e37` (commit `2587053f3`)

The reviewer confirmed the ancestry facts and most resolution choices, and found **two defects
that are mine** — integration failures at the seam, where each side was right alone and the merged
invariant was not the union. Both are fixed in `2587053f3`; each claim was re-verified in the code
before acting.

**F3RB-002 (MEDIUM, security) — the final sharded directory was not re-canonicalised.**
Confirmed: `resolveUserFolder` canonicalised the *root* via `assertWithinAllowedRoots`, then
appended `<ab>/<cd>/<userId>` lexically, and `assertFolderWritable` uses `fs.stat`/`writeFile`,
which follow symlinks. A pre-existing symlink at either shard level or at the user directory
redirected the write outside `BACKUP_ALLOWED_ROOTS` with the base still clean. Fixed by
canonicalising the final path — and, on the first attempt, the new test caught something the
reviewer had not: checking *after* `mkdir` still created a directory inside the symlink's target,
so the check now runs **before** anything is created. Three regression cases (user directory,
first shard segment, second shard segment) each assert the outside target stays empty.

**F3RB-003 (MEDIUM, contract) — capability probed only the default root.** Confirmed:
`describeCapability()` probed `this.defaultFolderPath` unconditionally, while
`BACKUP_ALLOWED_ROOTS` exists precisely so an operator can mount elsewhere; the frontend treats
`available: false` as deployment-wide and disables the enable toggle and Run Backup Now. Fixed by
probing the root the schedule would actually write under (stored folder when set, default
otherwise); the endpoint now passes `req.user.id`. Regression test: default root absent, configured
secondary root writable → `available: true` naming that root.

**Documentation findings, all confirmed and fixed.** DOC-F3RB-001: six stale
"migration 133/134" references (in `backup.service.ts`, `currencies.service.ts`, `app-role.ts`,
`currency-references.spec.ts`, `137_*.sql`, `schema.sql`) now follow the renumber to 136/137 — the
remaining `133`/`134` hits in the tree are upstream's joint-account migrations, correctly
unchanged. DOC-F3RB-002: `userBackupDirectory` **deleted** rather than re-worded — it was the
flat-layout helper, unreferenced since the merge kept upstream's sharding, and its comment claimed
retention never touches flat legacy files while the merged retention deliberately sweeps them.

**Deliberately not addressed in this commit**, with reasons:

- **F3RB-001 (HIGH)** — partial artifacts publish onto the complete artifact's date-only filename
  and match `DAILY_FILE_PATTERN`, so a partial run can replace a complete same-day artifact and
  later count toward complete retention. I re-read `exportToFile`/`applyBackupOutcome` and agree:
  the fix as merged skips promotion/retention *for the partial run* but gives the artifact no
  durable identity. This is a defect in the audited work (F3R7-001's own half-fix), not a rebase
  seam, and it needs a design decision (distinct partial filename + completeness in the envelope
  or a catalog + retention enumerating only proven-complete files) — a compatibility decision about
  the on-disk format. **Maintainer decision taken: file it as an issue rather than fix it in this
  series.** Draft ready at
  `.claude/pending-issues/2026-08-05-f3rb-001-partial-backup-identity.md`, titled
  `03: A partial automatic backup can replace a complete one and consume its retention slot
  (F3RB-001)`, with both reproduction scenarios, the durable-identity problem, and the regression
  matrix.
- **F3RB-004..007 and DR-F3RB-001..004** — likewise pre-existing branch/upstream behaviour
  (incomplete manual export reported as success; zero-fit restore forced to one slot; plain export
  materialising tables and attachment sets; the OIDC truthy sentinel; legacy-flat retention policy;
  unbounded restore queue; unmeasured memory constants). §7 of `docs/audit-phase-3-response.md`
  already carries most of them as open items, and Step 5 files them as issues.

One reviewer statement I could not reproduce and did not act on: DOC-F3RB-002 also cites
`backup-paths.ts:146-174` as claiming retention enumerates only a per-user directory — that text
lived in the `userBackupDirectory` docblock, which is now gone, so the claim is resolved by
deletion rather than by rewording. If the reviewer meant a second location, I did not find one
(`grep -n "left where they are\|only ever enumerates" backend/src/backup/backup-paths.ts` is now
empty).

### 2.8 Response to the second review, of `2587053f3` (commit `825eab8c6`)

The re-verification confirmed F3RB-002 **closed** (correct ordering, real-fs coverage of all three
symlink levels) and the original F3RB-003 scenario fixed, then found that my own capability fix had
introduced a narrower defect in the other direction. Both new items were reproduced in the code
before acting.

**F3RB-R1-001 (MEDIUM) — capability probed outside the allowed roots. Confirmed and fixed.** My
previous commit made `describeCapability` read the *stored* folder rather than only
`BACKUP_CONTAINER_DIR`, but kept the direct `assertFolderWritable` call — and a stored folder is
not necessarily inside the policy: `updateSettings` validates only syntax
(`validateFolderPath`) unless the same call sets `enabled: true` (verified at
`updateSettings`, the `assertAllowedRoot` branch is under `if (dto.enabled)`), and an upgraded
deployment can already hold an arbitrary absolute path. So reading capability created and deleted a
`.monize-write-test-*` file outside the approved volume and answered `available: true` for a
configuration `resolveUserFolder` refuses. Fixed by running `assertAllowedRoot` first and probing
only a path that passed it; an out-of-policy row still answers `available: false` with a reason
rather than throwing, so an admin can load the page and switch such a schedule off. Three
regression tests, the first asserting the outside directory stays **empty** so the probe provably
does not run: stored root outside the roots, stored root symlinked out of them, enabled-but-
out-of-policy row answering rather than throwing.

This is worth stating plainly rather than burying: the first fix traded one wrong answer for
another, and only the second review caught it. The lesson is the reviewer's own framing — a
capability endpoint has to model the *same* acceptance rule as the operation it describes, or it is
a second, divergent implementation of that rule.

**DOC-F3RB-R1-001 — the last stale migration number. Confirmed and fixed.** One `(134)` remained in
`currency-references.spec.ts:23`; my earlier sweep matched only the phrase "migration 134". Now
`(migration 137)`. `grep -rn "migration 13[34]" backend/src database/schema.sql` returns only
upstream's joint-account migrations, correctly untouched.

**DOC-F3RB-R1-002..005 — acknowledged, deliberately not fixed here.** The two attachment providers
still say external bytes are not embedded and the bucket/directory must be backed up separately;
`auto-backup.service.ts` says partial artifacts cannot displace complete copies; `backup.service.ts`
says the plain export streams to avoid OOM. All four are true statements about the code *before*
this branch's own later commits and false after them — but each belongs with the finding it
describes: the first two with the self-contained-artifact concern (PR 3), the third with F3RB-001
(now an issue, which the PR body must reference rather than repeating the false claim), the fourth
with F3RB-006. Fixing them in a rebase commit would scatter them away from the changes that make
them wrong.

**Residual, explicitly not claimed as closed:** the final-path fix is still pathname-based
check-then-use. A process with concurrent write access to the same volume could in principle
substitute a component between `assertAllowedRoot` and `writeFileAtomic`. The reviewer classes this
as a design note rather than a defect in this deployment model; closing it properly needs
`openat`-style no-follow directory handles, which is a larger change than a rebase should carry.

## 3. Verification (all on `825eab8c6`)

| Check | Result |
| --- | --- |
| backend `tsc --noEmit -p tsconfig.test.json` | clean |
| backend `npm run lint` | clean |
| backend `npm run migration:lint` | 127 files, clean |
| backend `npm run i18n:check` | pseudo-locale fresh |
| backend `TZ=UTC npm run test:unit` | **11157/11193; the only red suite is `locales.parity.spec.ts` (36)** |
| frontend `npx tsc --noEmit` | clean |
| frontend `npm run lint` | clean (1 pre-existing `exhaustive-deps` warning, `Combobox.tsx` — same as recorded in audit-phase-3-response §8) |
| frontend `npm run i18n:check` | clean |
| frontend `npx vitest run` | **12428/12446; the only red file is `messages.parity.test.ts` (18)** |
| `node scripts/check-env-docs.mjs` | 61 env vars documented |

The parity failures are the branch's declared state (response doc §7 item 5): English catalogs
complete, the 18 other locales pending the acceptance-time localization pass. **Not run** (no
Docker/PostgreSQL/cgroup/browser in this environment): `backend/test/integration/*`,
`scripts/verify-schema.sh`, Helm rendering, cgroup peak-RSS. First execution happens in CI.

## 4. Points most worth adversarial review

Items 1–4 below were checked by the first independent review; §2.7 records the outcome. The
remaining open questions for a second pass:

- [x] F3RB-002's fix — reviewed and **closed** by review 2 (ordering correct, all three symlink
      levels covered). The pathname-based check-then-use window remains open by design; see §2.8.
- [x] F3RB-003's fix — review 2 found it half-right and half-wrong (F3RB-R1-001); fixed in
      `825eab8c6`, see §2.8. Still open as a *contract* question: capability is now per-admin
      (reads that admin's settings row) rather than enumerating every approved root. Is that the
      contract the frontend banner wants?
- [x] Self-caught while writing this list: the new capability tests asserted only that the outside
      directory was empty, which is also what a probe that cleaned up after itself would leave. Fixed
      by spying on the real `fs.writeFile` and asserting no call targeted that directory, so
      "never wrote" is now distinguishable from "wrote and unlinked". Both F3RB-R1-001 tests were
      then confirmed to **fail** with the containment line reverted (`2 failed, 97 skipped`) and pass
      with it restored — the check every new invariant on this branch is supposed to get.
- [x] Whether F3RB-001 belongs in the backup PR as a fix or as an issue — **decided: issue**
      (draft in `.claude/pending-issues/`). The audit-03 backup PR therefore ships F3R7-001's
      "skip promotion and retention for a partial run" half and no artifact-naming change; the PR
      body must say so rather than implying partial artifacts are fully contained.

- [ ] §2.1: does the merged `resolveUserFolder` + sharded layout still satisfy every property the
      branch's flat-layout confinement proved (symlink escape, root containment, traversal)?
      The real-fs suite ports those cases — check none lost its teeth in the port.
- [ ] §2.1: the removed "leaves legacy files alone" test — confirm the kept legacy-sweep
      semantics are the intended ones for artifacts written by pre-#1032 versions.
- [ ] §2.2: confirm no mutating path in `backup-encryption.service.ts` still does a full-entity
      `save`, and that `requireManageableUser` now reads through the transaction's repository.
- [ ] §2.3: confirm placing the capability endpoint admin-side matches F3RR-RISK-001's intent
      (the banner warns whoever can configure a schedule; on upstream that is only admins).
- [ ] §2.4: `applyBackupOutcome`'s partial path — settings row ends `partial`, artifact written,
      promotion/retention skipped; the 3-arg retention on the complete path.
- [ ] Migration renumber: `136_`/`137_` idempotent, `schema.sql` consistent, no doc still says `133_currency…`.
- [ ] Cross-series: #1061 vs `atomic-file.ts`; #1063 vs `3f0cd8379`+`4612b039b` (see §1).

## 5. Next steps (not started)

Split into 8 single-concern PRs per response-doc §9, titles `03: … (v1.15.0)`, stacked where
they share `backend/src/backup/`; open as drafts (owner runs push/`gh pr create` — sandbox policy
blocks both for the agent); file the 6 open-item issues from §7 + an i18n tracking issue. The
owner must first push this rebased branch:
`git push fork claude/detailed-error-review-4pbug7 --force-with-lease`.

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)
