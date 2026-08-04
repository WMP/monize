# Response to the Phase 1 Remediation Review

**Responds to:** `monize-audit-01-remediation-review.md`
**Reviewed branch head:** `b5712075` (pre-rebase)
**Current branch head:** see `git log` — rebased onto `main` at `0a7db0ce`
**Findings answered:** 5 of 5 (1 HIGH, 1 MEDIUM, 3 LOW) — all resolved
**Verdict accepted:** yes, including "do not merge as-is". Every finding was
reproduced before being acted on.

---

## RFR-002 — Branch stale, duplicates a fix already on main · MEDIUM · resolved

Confirmed and decisive; this is why everything else in this response moved.

`main` had independently shipped the same P1-001 fix as
`135_import_jobs_single_active.sql`: the same partial unique index, under **the
same name** `idx_import_jobs_one_active_per_user`, the same acquire-before-wipe
ordering, and the same duplicate-retirement UPDATE. Meanwhile `133` had been taken
by `133_joint_account_grants.sql`.

**Action.** Rebased onto `main` and dropped the P1-001 commit entirely
(`git rebase --onto origin/main <p1-001-commit> HEAD`). The rebase was clean — the
remaining six commits do not touch the import path. Main's implementation is
authoritative, and the review is right that it is the better of the two: it maps
`23505` to a 409 only when the reported constraint is the one-active-job index,
where mine mapped any unique violation on that insert.

Dropped with it: `backend/src/common/db/pg-errors.ts`, the shared
`isUniqueViolation` helper. It only existed to serve that commit, and main's
constraint-name check is more precise than the generic predicate it offered. The
`23505` check remains written out in three places on main; de-duplicating it is a
separate, non-urgent change and not something to smuggle into a remediation
rebase.

**Verified after rebase:** no new duplicate prefix (only the documented
historical pairs `022`, `068`, `075`, `116`, `117`, `124` remain), migration 135
present and untouched, 10 893 unit tests and 276 integration tests pass.

### The gate the review asked for

`scripts/check-migration-prefixes.mjs`, wired into the "Documentation vs
Manifests" job. Two checks:

1. **No duplicate numeric prefix**, except a grandfathered list that **may only
   shrink** — the script fails if an entry in it is no longer duplicated, so it
   cannot quietly re-permit a future collision.
2. **A migration added on this branch must sort above the highest prefix on the
   base branch.** Deployed databases track migrations by full filename, so a
   lower-numbered new file is applied *after* migrations that already ran.

Restoring my `133_import_jobs_one_active_per_user.sql` trips **both** checks. A
synthetic `090_test_low.sql` trips both as well.

Check 2 needs git history, so the job's checkout takes `fetch-depth: 0`. When no
base ref resolves it prints that it skipped rather than reporting OK — a check
that cannot run must not look like a check that passed.

---

## RFR-001 — A retired job's worker still commits · HIGH · resolved

Confirmed in the mechanism, and it applies to **main's** migration exactly as it
did to mine — the review says as much, and this response fixes it there rather
than deferring it.

The trace holds: migration 135's UPDATE rewrites the coordination row and nothing
else. `progress`/`heartbeat` updates stop matching (`WHERE ... status =
'running'`), but the import body does not consult status, so it runs to
completion and its financial transaction commits. `complete()` then had `WHERE id
= $1` with no status predicate, so the retired row could subsequently read
`completed`. Every backend container runs migrations at start-up and the Helm
StatefulSet uses `RollingUpdate`, so a new pod can retire a job an old pod is
still importing.

**One correction to the framing.** The migration does not *cause* the data
duplication: without it the same two workers commit the same two imports. What it
fails to do is *prevent* it in that one pre-existing case, and it adds a
misleading audit trail on top. HIGH is still the right severity — an upgrade
path that is supposed to remediate the defect leaves it reachable — but the
distinction matters for choosing the fix, because it rules out "just don't run
the cleanup" as sufficient.

**Action — the lease, not the abort.** The review offered two routes and this
takes the second, which it describes as what makes online remediation acceptable:

`MnyImportJobService.assertStillHoldsSlot(manager, jobId)` is called as the
**last statement of the transaction that writes the imported rows**. It selects
the job's status `FOR UPDATE` and throws `MnyImportSlotLostError` unless the
status is still `running`. Because it runs inside that transaction, the throw
rolls every imported row back.

Three reasons this is the right shape rather than a status predicate on
`complete()`:

- It is the repository's standing rule — *a rejected command must not already
  have written*. Checking in `complete()` breaks it by construction: the rows are
  committed by the time it runs.
- `FOR UPDATE` serializes the check against a concurrent retirement, so the loser
  sees the committed outcome instead of a snapshot taken before it. Of two racing
  workers, exactly one commits.
- It also covers a hazard the review did not raise: `reapStaleJobs` fails a
  `running` job whose heartbeat lapsed, which is a real possibility for a slow
  import on a loaded pod, not only for a dead one. That path had the same
  "retired but still committing" problem and no migration involved.

Supporting changes:

- `complete()` gained `AND status = 'running'` — the second line of defence, and
  it keeps the audit trail honest even where the lease check is unreachable.
- A lost slot is **not** reported as a generic failure: `runClaimed` logs and
  returns, leaving the explanation whatever retired the row already wrote.
  Overwriting `error_key` would replace "stalled, retryable" with "import
  failed".
- Migration 135 now carries a comment saying the UPDATE alone does not stop a
  worker and naming what makes it binding, so the next reader does not conclude
  the cleanup is self-sufficient.

**The regression tests the review specified**, in
`backend/test/integration/mny-import-job.integration.spec.ts` against real
transactions:

| Case | Asserts |
|---|---|
| retired mid-flight | the body's write is **rolled back**, not merely refused |
| still `pending` | refused — never claimed the slot |
| row deleted | refused — a missing row is a lost slot, not a pass |
| still `running` | passes, so the check is not simply always-throwing |
| `complete()` after retirement | status stays `failed`, `result` stays null |
| lost slot through `runClaimed` | the retiring party's `error_key` and `retryable` survive |

Mutation-tested in two parts, because a single mutation would not have proved
both: neutering `assertStillHoldsSlot` fails 3 cases (plus a pre-existing progress
test), and removing only `complete()`'s status predicate fails the resurrection
case. The first attempt at that mutation hit `reportProgress`'s identical
predicate instead, which is worth recording — it would have left the
`complete()` assertion unverified while looking verified.

**Not adopted:** aborting the migration when duplicate `running` rows exist. A
migration that fails aborts backend start-up, so that converts a data-integrity
edge case into a boot loop requiring DBA intervention on every replica. With the
lease in place the online cleanup is safe, which is the outcome the review's own
second option describes.

---

## RFR-004 — Lint-ban test misses the original wording · LOW · resolved

Confirmed, and specifically about the mistake the previous commit message
congratulated itself on avoiding. Requiring the *call* form was a deliberate fix
for the opposite error — `transaction` is ordinary English in these files ("MUST
run in a single transaction") — but it opened a false negative on the *type*
name. The exact historical sentence, "must use a `QueryRunner` transaction",
contains no call expression, so the pattern did not match it.

Measured against the new fixtures, the old pattern misses **four of six** positive
cases:

| Sentence | Old | New |
|---|---|---|
| must use a \`QueryRunner\` transaction | miss | flag |
| MUST use a \`createQueryRunner()\` transaction | flag | flag |
| You should open a QueryRunner… | miss | flag |
| use \`dataSource.transaction(async (m) => …)\` | miss | flag |
| must inject their repositories with @InjectRepository | flag | flag |
| Always prefer a QueryRunner… | miss | flag |

**Action.** The classifier is now its own module,
`backend/src/common/db/prohibited-primitive-guidance.ts`, so it can be exercised
directly instead of only through the live documents — scanning proves that today's
wording passes, which is exactly how the gap shipped. It matches prohibited call
forms *and* prohibited type names (`QueryRunner`, `InjectRepository` — identifiers
that are never ordinary prose), and prohibitive or historical framing takes
precedence over the recommending verb, which is what lets `use` be a recommender
without firing on "Never … or use a bare `dataSource.query(...)`".

Eight negative fixtures cover the wordings that actually appear in the live files,
including the `transaction`-as-noun case that motivated the call-form
restriction. A vacuity case proves the classifier detects nothing when handed an
empty ban list.

---

## RFR-005 — Blockquote breaks the Helm table · LOW · resolved

Confirmed. I inserted a blockquote between `backend.image.pullPolicy` and the
remaining backend rows, which ends the table under standard Markdown; replicas,
ports, resources, probes, environment and the import limit rendered as plain
text. The review's observation that my own checker could not see it is the more
important half: rule 3 reads pipe-prefixed lines without rendering Markdown, so it
kept validating defaults in rows that no longer displayed as a table.

**Action.** The warning moved below the complete table. Rule 6 of
`scripts/check-docs-manifests.mjs` now rejects a pipe row that is not inside a
table — a row belongs to one only if a header separator appeared since the last
block boundary (blank line, blockquote, heading, fence, list item), with fenced
code skipped. Restoring the blockquote to where the review found it fails the
check on six rows.

---

## RFR-003 — Stale ordering comments · LOW · resolved

Split verdict, and worth stating precisely:

- The **class-level** comment the review cited (`mny-import.service.ts:67-77`) was
  my branch's. Main's equivalent already says the wipe "runs *after* the job row
  is inserted … the row is this user's import lock", which is correct. The rebase
  removed the stale one.
- The **method summary** ("Validates, optionally wipes, creates the job") was
  wrong on main too, and is the more dangerous of the pair because it is the first
  thing a maintainer reads. Rewritten to state the order — validate, acquire the
  slot, then optionally re-authenticate and wipe, then start the worker — and to
  say that the order *is* the safety property, so a future summary cannot
  casually reorder it.

The existing invocation-order unit assertions are retained. No source-contract
scan was added: the repository does not treat safety comments as machine-checked
documentation, and inventing that convention for one comment would be a rule
nobody else follows.

---

## Answers to the review's stated limitations

**"Local cloning and independent test execution failed; the author's claims could
not be reproduced."** Fair, and the reason this response states how each claim was
produced. Docker is unavailable in this environment too, so a local PostgreSQL 16
server was used directly rather than skipping the checks that need a database.
Post-rebase results:

| Check | Result |
|---|---|
| `TZ=UTC npm run test:unit` | 406 suites, 10 893 tests, pass |
| `npm run test:integration` | 21 suites, 276 tests, pass |
| `npm run typecheck` (src + test) | clean |
| `npm run lint` over `src` and `test` | clean |
| `npm run migration:lint` | 125 migrations, all re-runnable |
| `node scripts/check-docs-manifests.mjs` | OK (82 Helm values, 8 documents) |
| `node scripts/check-migration-prefixes.mjs` | OK (125 migrations, base max 135) |
| `node scripts/check-env-docs.mjs` | OK |

Every new or changed guard was mutation-tested — the defect restored, the guard
confirmed to fail — not merely confirmed green.

**"The documentation checker collects npm script names across all package
manifests without preserving working-directory context."** Accepted as a real
limitation; not changed. Resolving context would mean inferring which package a
Markdown code block runs in, and the checker's purpose is to catch a script that
exists **nowhere** — which is the failure it was built for (`npm run rls:ratchet`,
deleted, still documented as a CI gate). A cross-package false pass is a weaker
failure than the one it prevents, and no instance of it exists today. Recorded
here rather than silently left as an unknown.

**"No GitHub status checks on the remediation head."** Still true — no pull
request has been opened, per the standing instruction not to open one unasked.
The rebased head is pushed and ready for one.

---

## Required next steps, from the review

| Step | State |
|---|---|
| 1. Rebase onto current `main` | done — `0a7db0ce` |
| 2. Drop the branch's P1-001 and migration 133; keep main's 135 | done |
| 3. Resolve RFR-001 for the current-main migration | done — lease check, six integration cases |
| 4. Carry forward P1-002/003/004 after conflict review | done — clean rebase, no conflicts |
| 5. Fix the import comments, the lint-ban fixture gap, the Helm table | done |
| 6. Open a pull request for the full Actions matrix | **not done** — awaiting an explicit request |
| 7. Re-run race tests, migration/schema checks, docs gate, unit, integration, lint, both tsconfigs | done — table above |

## Still open, unchanged from the previous response

**R1-001** (`totalMarketValue` counts an unknown price as zero) remains open and
still needs an approved spec before implementation. It is the highest outstanding
item across both documents. The remediation review did not examine it, having
scoped itself to the remediation diff.
