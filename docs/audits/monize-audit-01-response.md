# Response to Audit Phase 1 — Baseline, Repository Instructions, and Architecture

**Responds to:** `monize-audit-01-baseline-architecture.md` (audit date 2026-08-01)
**Branch:** `claude/detailed-error-review-9kzs8x`
**Response date:** 2026-08-03
**Findings answered:** 4 of 4 (1 HIGH, 2 MEDIUM, 1 LOW) — all resolved
**Findings added by this review:** 2 (1 HIGH, open; 1 MEDIUM, partly resolved)

---

## 1. Baseline divergence from the audit

The audit pinned `AUDIT_BASELINE_SHA = d5cea9bfa995885ba5198f9843359362927c0fd4` and required later
*audit phases* not to follow a newer `main`. This branch is remediation, not a phase, so it is based
on `4e48a767` — `main` at branch time. Every finding was re-verified against `4e48a767` before being
acted on, because two of the audit's observations had already been fixed in between:

| Audit observation | State at `4e48a767` |
|---|---|
| `.claude/skills/{backend,frontend,infrastructure}.md` are stale (P1-002, P1-003, §9.2, §9.4) | **The whole `.claude/skills/` directory no longer exists.** Nothing to correct. |
| `CONTRIBUTING.md` mandates `QueryRunner` transactions (P1-003, §9.4) | Already rewritten to the `withScopedDb` rule. Only the *enforcement gap* it exposed remained — see P1-003. |

Everything else the audit reported was still present and is addressed below.

---

## 2. Answers to the confirmed findings

### P1-001 — Concurrent `.mny` start requests can create and run separate active jobs

**Audit severity:** HIGH · **Verdict: confirmed, resolved** · Commit `ec54abd7`

The audit's analysis was correct in full, including the detail that `claim(jobId)` is atomic only for
workers racing over one row and does nothing about two rows existing.

**What changed.** The insert *is* the concurrency control now. Migration
`133_import_jobs_one_active_per_user.sql` adds a partial unique index over `user_id` restricted to
`status IN ('pending','running')`; `MnyImportJobService.create()` translates the resulting `23505`
into the same `ConflictException` the pre-flight check raises. `hasActiveJob` stays as a courtesy so
the ordinary case costs a count rather than a failed insert, with a comment stating it is not the
guard.

Three details the audit's recommendation did not cover, and which the fix would have been wrong
without:

1. **The index is declared in three places** — the migration, `database/schema.sql`, and as an
   `@Index` decorator on the `ImportJob` entity. The integration suite builds its schema from the
   entities (`synchronize: true`), so without the decorator the new race tests would have run
   against a database with no constraint to contend over and passed while proving nothing.
2. **Existing deployments may already carry duplicates** — the corruption the index prevents. The
   migration retires the losers first (newest row per user kept, since that is the one the wizard is
   polling), marked `failed` + retryable with the `mnyJobStalled` key so the wizard's existing Retry
   path handles them. Verified against a database seeded with three active rows for one user and one
   for another: two retired, newest kept, other user untouched, and idempotent on replay.
3. **The destructive half of the race is fixed by ordering, not by the index.** The audit noted
   `wipeExistingData` sits between the check and the create. The slot is now acquired *before* the
   wipe, so a request that loses has nothing to undo — previously both requests could delete the
   user's data and only then discover one of them was not allowed to import. Because the job row now
   exists when re-authentication runs, a wrong password retires it instead of holding the slot until
   the reaper's five-minute sweep.

**Regression coverage** (the audit's §8.1 item 1). Six integration cases racing real connections
through `withScopedDb`, in `backend/test/integration/mny-import-job.integration.spec.ts`:

| Case | Asserts |
|---|---|
| two simultaneous creates, same staged file | exactly one created, one 409, one active row |
| two simultaneous creates, *different* staged files | same — the slot belongs to the user, not the file |
| four concurrent creates | one created, three 409 |
| create while a claimed job is `running` | 409 (the index covers `running`, not only `pending`) |
| two different users concurrently | both succeed — the constraint must not over-serialize |
| after `complete` and after `fail` | slot is free — a terminal row must not hold it forever |

**Four of the six fail with the entity index removed** (verified by removing it and re-running). The
two that pass either way are the guard rails against over-constraining, which is what they are for.

Unit cases cover the 409 translation and that an unrelated driver error (`23503`) is *not* disguised
as a conflict. Two pre-existing specs asserted `deleteData` ran *before* `create` — they encoded the
defective ordering and now assert the inverse.

**Also extracted:** `isUniqueViolation` into `backend/src/common/db/pg-errors.ts`. The `23505` check
was written inline in three services and the exception filter, each with its own cast.

**Verification method used.** Ran the spec repeatedly against PostgreSQL 16 (local server; Docker was
unavailable in the review environment). Re-ran the schema-drift check by reproducing
`scripts/verify-schema.sh` without Docker: `schema.sql` matches the state produced by applying every
migration twice, and `npm run migration:lint` passes.

---

### P1-002 — Documented bootstrap and deployment commands do not match the tracked manifests

**Audit severity:** MEDIUM · **Verdict: confirmed, resolved** · Commit `d6a8e458`

Confirmed at `4e48a767`: `README.md` still listed `docker-compose.yml` and ran `docker-compose up -d`;
`helm/README.md` still installed `./helm/monize` in seven places; the Helm default-value tables still
disagreed with `helm/values.yaml` on registry, repository and pull policy for both images, and quoted
a backend memory limit of `150Mi` against an actual `400Mi`.

**What changed.** All of the above corrected, plus the two Compose stacks the README's tree omitted
(`docker-compose.e2e.yml`, `docker-compose.zap.yml`).

**On `latest` + `IfNotPresent` (audit §7.1).** Documented explicitly rather than changed: the pair
keeps whatever image a node already cached, so replicas can end up running different builds of the
same tag, and a rolling restart re-uses the cache. `helm/README.md` now says so and points at pinning
an immutable tag or a digest. Flipping either default silently alters upgrade behaviour for existing
installs, which is the operator's decision, not a remediation branch's.

**The gate** (the audit's §8.1 item 2 and its recommended CI job).
`scripts/check-docs-manifests.mjs`, wired into the CI job now named "Documentation vs Manifests".
Five rules, no dependencies:

1. every repository path a documented command names must exist;
2. no documented `docker compose` invocation may omit `-f` — there is no default Compose file;
3. every Helm parameter documented with a default must have that default in `helm/values.yaml`;
4. every Compose stack on disk must appear in the README's tree;
5. every `npm run <script>` named in an instruction file or anywhere under `docs/` must exist.

Run against the pre-fix documents it reports all four original defects and nothing else — verified by
restoring each one in turn.

The audit's other suggestions for this job (`docker compose config`, `helm lint`, `helm template`)
were deliberately not implemented: they need Docker and Helm binaries in the job, and the failure
mode observed here was drift between text and manifests, which rules 1–5 catch statically. Worth
adding if a rendering bug ever appears.

**Also fixed:** `scripts/check-env-docs.mjs` carried the same phantom `docker-compose.yml` in a
hardcoded list. Its loop skips a missing file silently, so the coverage loss was invisible — and the
list also omitted the demo and zap stacks. It now reads the stacks from disk.

---

### P1-003 — Repository instructions direct contributors to prohibited transaction APIs

**Audit severity:** MEDIUM · **Verdict: confirmed with a narrower scope, resolved** · Commit `7e5433d5`

Two of the audit's three cited documents no longer needed correcting (see §1). What remained was the
part the audit identified as the real hazard and which no amount of rewording addresses:

> "A `DataSource.transaction()` implementation can be merged if it evades the current syntax
> restriction."

Correct, and it did evade it. ESLint banned `createQueryRunner()` and `@InjectRepository` but not
`dataSource.transaction(fn)`, which is not equivalent: it opens a transaction that does not know
about the ambient scoped manager, so under `RLS_MODE=enforce` it carries no identity GUCs and fails
closed, at `off` it loses defence in depth, and nested inside a caller's `withScopedDb` it commits
independently of that caller's rollback.

**What changed.**

- ESLint rejects `.transaction()` in `src/` outside `scoped-db.ts`, specs and test helpers (the
  audit's recommended restricted-syntax rule). No existing call site needed changing —
  `scoped-db.ts` is the only caller, which is also why the rule is safe to add outright rather than
  with a ratchet.
- `docs/future-plans/vat-support.md` no longer proposes a `QueryRunner` for single-default
  enforcement.
- `CLAUDE.md` and `CONTRIBUTING.md` name the new ban. The root file also said "ESLint bans **both**"
  while listing three things.

**The gate** (the audit's §8.1 item 3). `backend/src/common/db/lint-bans.spec.ts` reads the ban list
out of `eslint.config.mjs` and requires every banned call to be named in the root `CLAUDE.md` and
`CONTRIBUTING.md`, and no instruction file to recommend one. Both directions fail: restoring the
original "MUST use a `createQueryRunner()` transaction" sentence, and dropping the new ban from the
documentation.

One implementation note worth recording, because the first attempt was wrong: matching the *call*
form (`createQueryRunner(`) rather than the identifier is essential. "MUST run in a single
transaction" is ordinary English in these files, and a word-boundary match on `transaction` both
false-fired on that sentence and — with the boundary anchored before the identifier — let the exact
original markdown wording through. A guard that cannot tell a recommendation from a noun is not a
guard.

**Not implemented from the audit's recommendation:** the suggested architectural decision record.
The rationale now lives in the ESLint rule's message and the spec's header, which is where a
contributor and an agent actually encounter it; a separate ADR would be a fourth copy of a claim this
branch has just spent effort de-duplicating.

---

### P1-004 — The schema advertises a PAT scope that the API cannot issue

**Audit severity:** LOW · **Verdict: confirmed, resolved** · Commit `08c70e19`

Confirmed: `database/schema.sql` listed `read`, `write`, `reports`; `CreatePatDto` accepted only
`read|write`; `docs/future-plans/vat-support.md` proposed an MCP tool guarded by `reports`.

The audit offered a choice between removing `reports` and building it out. Removed — nothing in the
tree needs it, and the audit's own reasoning that a `reports`-guarded tool would be unreachable to
every PAT client stands.

**What changed.** `backend/src/auth/scopes.ts` holds `API_SCOPES` as the single vocabulary. The DTO's
pattern, its validation message and its Swagger description, and `MCP_RESOURCE_SCOPES` (the
`monize:`-prefixed list the OAuth metadata endpoint advertises) all derive from it. The schema
comment points at the constant instead of restating it. The VAT plan asks for `read`.

**The gate** (the audit's §8.1 item 4, and its recommended table-driven contract test).
`backend/src/auth/scopes.spec.ts` enumerates from `API_SCOPES` rather than restating the list, so
adding a scope there is what makes the checks cover it:

- PAT issuance accepts each scope alone and all of them together; rejects `reports`, `read,reports`,
  an empty list and a trailing separator; names every supported scope in the rejection message.
- `hasScope`/`requireScope` recognise each one; `MCP_RESOURCE_SCOPES` is exactly the prefixed set and
  advertises nothing a PAT could not be issued.
- **Two scanning guards**, because the defect was documents disagreeing with code: `schema.sql`'s
  column comment must enumerate exactly `API_SCOPES`, and no scope named as the second argument of a
  `requireScope` call anywhere under `docs/` may be one that cannot be issued. Both fail when the
  original wording is restored.

  This paragraph originally embedded a literal example of such a call, and the guard flagged its own
  description -- correctly. A document that writes the call form is making the claim, whether or not
  it means to; the fix is to describe the shape in prose rather than to teach the guard to ignore
  documents about itself.
- A third check ties the frontend's `SCOPE_OPTIONS` to the same list — a scope the backend accepts
  but the UI never offers is unreachable for anyone not hand-crafting requests.

Both scanning guards are deliberately narrow, reading one machine-identifiable construct each. A
first attempt scanned prose for quoted scope-shaped tokens near the word "scope" and false-fired on
the sentence explaining that `reports` had been *removed*.

**Also cleared in the same file:** the VAT plan's migration numbers `086`/`087`, written when the
directory ended at `085` and now nearly fifty behind.

---

## 3. Findings this review added

The audit was explicit that Phase 1 "was intentionally not an exhaustive general code review". Two
defects surfaced while reviewing the files it listed in §10.2/§10.3.

### R1-001 — `totalMarketValue` counts an unknown price as zero

**Severity: HIGH · Confidence: high · Status: OPEN, not fixed**

`backend/src/securities/portfolio-calculation.service.ts:1641` and `:1694`:

```ts
accountMarketValue += await this.convertToDefault(h.marketValue ?? 0, ...);
```

`h.marketValue` is `number | null`, where `null` means the price is unknown (no quote, delisted
security, missing price row). `?? 0` defaults it to zero and sums it into `totalMarketValue`; then
`totalGainLoss = accountMarketValue - accountCostBasis` reports the entire cost basis of the unpriced
position as a loss, and `totalGainLossPercent` is derived from that.

This violates the root `CLAUDE.md` rule and `docs/financial-calculation-contract.md` §1 directly, in
the field the contract's own example names:

```typescript
totalMarketValue: number | null;     // null unless every position priced
knownMarketValueSubtotal?: number;   // sum of the priced positions only
unpricedPositionCount?: number;      // why the total is null
```

`totalMarketValue` is typed non-nullable `number` (`portfolio.service.ts:86` and `:166`);
`knownMarketValueSubtotal` does not exist anywhere in the source.

**Reproduction.** One investment account holding:

| Security | Quantity | Avg cost | Cost basis | Current price | Market value |
|---|---:|---:|---:|---:|---:|
| AAPL | 100 | 80 | 8 000 | 100 | 10 000 |
| XYZ (no quote) | 500 | 10 | 5 000 | — | `null` |

| Field | Reported | Contract-correct |
|---|---:|---:|
| `totalMarketValue` | 10 000 | `null` |
| `totalGainLoss` | **−3 000** | `null` |
| `totalGainLossPercent` | **−23.08 %** | `null` |
| `knownMarketValueSubtotal` | absent | 10 000 |
| `unpricedPositionCount` | absent | 1 |

The user is shown a 3 000 loss that does not exist, with no signal that anything is missing — which
the contract calls out specifically: "silence is what turns a subtotal into a lie."

**Two things sharpen it.**

1. The same quantity is computed a second, differently-wrong way in the same file. The
   portfolio-wide `totalHoldingsValue` (line 1546) guards with `if (marketValue !== null)` and
   **skips** unpriced positions. That is a subtotal returned under a `total*` name — the milder
   violation — and it is inconsistent with the per-account figure. Neither carries an incompleteness
   signal.
2. It reaches the AI and MCP surfaces through `LlmAccountHoldings.totalMarketValue`, so the assistant
   states the fabricated loss as fact.

**Scope of the class.** Swept for the same shape (`marketValue ?? 0`, `currentPrice ?? 0`,
`costBasis ?? 0`, `rate ?? 1`). Only these two lines are defects. The third hit,
`gem-position.util.ts:222`, is a sort comparator ordering unpriced positions last — a display choice,
not a total. FX handling in `common/fx-entry.util.ts` is correct throughout and matches the
`roundFxRate`/`FX_RATE_DECIMALS` rules.

**Why it is not fixed here.** Making `totalMarketValue`, `totalGainLoss` and
`totalGainLossPercent` nullable ripples into frontend components, reports, and the AI/MCP adapters,
and a partial fix is worse than none — some surfaces would become null-aware while others silently
kept reading a number. The repository's own rule applies: a financial feature of any substance
"starts from a short approved spec (invariants, truth tables, numerical examples, missing-data
policy, test matrix), committed *before* the implementation it guides." That spec is the next step,
not a drive-by edit.

**Suggested test matrix for whoever takes it.** All positions priced → complete total. One position
unpriced → total `null`, subtotal present, count 1, percent `null`. All positions unpriced → total
`null`, subtotal `0` **or** absent (decide explicitly; an empty-but-known account holds zero, an
unpriced one does not). Empty account → total `0`, not `null` — the "`null` is not the safe answer
either" half of the rule. Multi-currency: an unpriced holding in a third currency must not be masked
by conversion. Plus the per-account and portfolio-wide paths asserted separately, since they are
currently inconsistent.

### R1-002 — Four `test/*.e2e-spec.ts` suites had not compiled since 27 July

**Severity: MEDIUM · Status: compile gap fixed and gated; three suites left broken and documented**
· Commit `19b2069a`

This answers the audit's §11.2 note that no repository test suite was executed, and belongs to its
Phase 7 scope.

`backend/tsconfig.json` pins `rootDir` to `./src` and sets `exclude: [..., "test"]` because it drives
the build — and CI's `npx tsc --noEmit` uses it. ESLint's glob does cover `test/`, but a namespace
import called as a function is a type error, not a lint error. CI runs `test:unit` and
`test:integration` (the latter filtered to `test/integration/`), and nothing runs `test:e2e`.

With no gate of any kind, `main.ts` moving to `import cookieParser from "cookie-parser"` left three
files under `test/` on `import * as cookieParser` and four suites stopped compiling.
`test/payee-detail.e2e-spec.ts` was edited three days later, still broken, without anyone noticing —
and that is the suite `backend/CLAUDE.md` cites as what caught the raw-select transformer class of
bug, "because a unit spec with mocked query builders cannot".

**What changed.** Imports fixed; `npm run typecheck` (`backend/tsconfig.test.json`, `noEmit`, no
`rootDir` restriction) added to the backend lint job. Restoring the namespace import fails it.

**What the compile error was hiding**, once removed:

| Suite | State | Cause |
|---|---|---|
| `test/payee-detail.e2e-spec.ts` | **passes, 9 tests** | nothing wrong with it — the coverage was simply absent |
| `test/payees.e2e-spec.ts` | fails | calls services directly, so no request scope; never converted for RLS (`withScopedDb` throws without ambient context) |
| `test/auth.e2e-spec.ts` | fails | `AuthController` gained a `TokenService` dependency its test module does not provide |
| `test/transactions.e2e-spec.ts` | fails | `DelegateTransferMaskInterceptor` gained a `CrossOwnerAccessService` dependency its test module does not provide |

Each is separate rot that accumulated *behind* the compile error: the RLS conversion, the
token-service split and the cross-owner-transfers work each moved on without these files and nothing
complained. The three are documented in `backend/CLAUDE.md` with their exact causes, along with the
instruction not to add `test:e2e` to CI until they are repaired. Repairing them is not a review
finding; leaving them present, cited and dead is the thing that must not continue.

---

## 4. Hypotheses checked and rejected

Recorded because two of them looked serious enough to act on, and acting would have been wrong.

**`PatController` and `AdminController` derive the actor from `req.user.id`, not `realUserId`.** Under
delegation `req.user.id` is the *owner's* id, so on its face a delegate could list the owner's
personal access tokens and — worse — mint one, obtaining a full-scope credential for the owner's
entire dataset outside the delegation's per-account grants. Not reachable: `AccountDelegateGuard` is
registered globally (`delegation/delegation.module.ts:46`, `APP_GUARD` / `useExisting`) and rejects
any acting token on a route without `@AllowDelegate`. The comment above the
`personal_access_tokens` policy in `112_rls_policies_direct.sql` states this reasoning and is
accurate. It stays latent — adding `@AllowDelegate` to either controller would make it live
immediately — but it is not a defect today, and the migration comment already warns about it.

**`withPreserveTimestamps` with no ambient context.** Spreading `undefined` yields `{}`, so
`withScopedDb` throws exactly as documented. Correct.

**An exchange rate defaulted to 1.** `exchangeRate ?? 1` appears in the transfer and action-history
paths. Those are same-currency legs, where 1 is a *known* value, not a substitute for an unknown one.
No defect.

---

## 5. Audit sections answered without a code change

| Audit section | Response |
|---|---|
| §7.1 RLS rollout coupled to deployment immutability | The `latest`/`IfNotPresent` half is now stated in `helm/README.md` rather than implied. The rollout sequencing itself is unchanged and remains an operator decision. |
| §9.6 RLS document placement | `row-level-security.md` gained the status banner the runbook already had, and says why the `docs/future-plans/` location is historical. Relocating the files would break a large number of cross-references for no functional gain. |
| §9.2 `.claude/skills/infrastructure.md` is materially stale | Moot — the directory is gone. |
| §11.2 no test suite executed | Both CI suites were executed for this branch: 10 720 unit tests and 233 integration tests pass, against a real PostgreSQL 16. See §6. |

**One further stale claim found while answering §9.6:**
`docs/future-plans/row-level-security-tasks.md` documented a counting ratchet — a script, a committed
baseline and two npm entries — as a live CI gate. None of them exist; the ratchet reached zero and
became the outright ESLint bans. A reader was being pointed at a check that could not be run, let
alone fail. Marked superseded, and rule 5 of the new documentation check now fails on any command a
document offers that no `package.json` provides. Historical mentions stay legal but must say so
("superseded", "shipped as", "replaced by"), looked for in a window around the line because the
correction usually sits a paragraph below the command — without that window the rule fired on a task
row correctly recording a command's original name alongside the one that shipped.

---

## 6. Verification performed

Docker was unavailable in the review environment, so a local PostgreSQL 16 server was used directly
rather than skipping the checks that need a database.

| Check | Result |
|---|---|
| `TZ=UTC npm run test:unit` | 402 suites, 10 720 tests, all pass |
| `npm run test:integration` | 19 suites, 233 tests, all pass |
| `npx tsc --noEmit` (build config) | clean |
| `npm run typecheck` (src + test) | clean |
| `npm run lint` over `src` and `test` | clean |
| `npm run migration:lint` | 123 migrations, all re-runnable |
| Schema-vs-migrations drift | reproduced `scripts/verify-schema.sh` without Docker: migrations applied twice on top of `schema.sql`, dumps identical |
| Migration 133 against pre-existing duplicates | three active rows for one user reduced to one, other user untouched, idempotent on replay |
| `node scripts/check-docs-manifests.mjs` | OK (82 Helm values, 8 documents) |
| `node scripts/check-env-docs.mjs` | OK, 49 referenced env vars documented |

**Every new guard was mutation-tested** — the original defect was restored and the guard confirmed to
fail — rather than only confirmed green: the `.mny` race (4 of 6 cases fail without the index), the
last-admin locks (3 cases), the scope vocabulary (both scanning guards), the documented ban list
(both directions), the documentation/manifest rules (all four original defects), the npm-script rule,
and the test-tree typecheck.

---

## 7. Handoff

**Open from this response:** R1-001 needs an approved spec before implementation. It is the highest
outstanding item in this document and belongs to the audit's Phase 5.

**Open from the audit, untouched here:** Phases 2–7 remain as scoped. This branch touched Phase 2
only where P1-003 required it, and Phase 4/5/7 only where the two added findings led. In particular
the audit's §7.4 (application-maintained balances) and §7.7 (support-backup de-identification) were
not examined, and the following files listed in audit §10.2/§10.3 were reviewed only as far as their
interfaces: `backup.service.ts`, `support-backup-rules.ts`, `support-backup-integrity.ts`,
`transactions.service.ts`, `database/schema.sql` line by line, `helm/templates/*`, and the frontend
component tree. Support-backup de-identification is the recommended next target: a single
unclassified JSON field is enough to re-identify a masked record, and the golden test guards column
addition rather than re-identification strength.
