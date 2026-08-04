# Monize Phase 7 Remediation - Tests, CI and the Implementation Defects Behind Them

## Report metadata

| Field | Value |
|---|---|
| Repository | `kenlasko/monize` |
| Source report | `monize-audit-07-tests-ci.md` (Phase 7 - Tests, CI, Required Checks, and Verification Coverage) |
| Audit baseline | `d5cea9bfa995885ba5198f9843359362927c0fd4` |
| Remediation base | `4e48a767` (88 commits after the audit baseline) |
| Branch | `claude/detailed-error-review-fixes-p8bwgy` |
| Second source report | `monize-audit-07-remediation-review.md` (independent review of this branch at `79bfc257`) |
| Third source report | `monize-audit-07-remediation-review.md` re-review (of this branch at `e75acd20`) |
| Fourth source report | `monize-audit-07-remediation-review_1.md` re-review (of this branch at `ebda4609`) |
| Commits | 15, plus a merge of `origin/main` |
| Files changed | 335+ against the original merge base, including the merge |
| Mode | Read-write: every finding re-verified against the current tree before being acted on |
| Suites executed | Backend unit (10,902 passing), backend integration (314 passing, real PostgreSQL 16), frontend Vitest (12,413 passing), migration lint (125), schema-drift replay, both lints, both type-checks, i18n freshness and parity - all on the post-merge tree |
| Suites **not** executed | Playwright E2E (no browser stack), the Helm CI job (no `helm` binary) |

This document covers four rounds, each answering an independent review of the
one before, and each superseding it where they disagree:

- **Sections 1-10** - the first pass against the Phase 7 audit.
- **Section 11** - the second pass. Closes P7-008, which the first pass did not
  attempt because it wrongly assumed no PostgreSQL was available here.
- **Section 12** - the third pass, against a re-review that found three further
  HIGH defects in code the second pass had declared done. **Read 12.8 first if you
  are about to fix something in this codebase**: all three were the same mistake,
  and it is not the one it looks like.
- **Section 13** - the fourth pass, against a re-review that found one more HIGH
  (the scheduled-post fix left optional at the public boundary) and one MEDIUM (a
  deadlock the round-three locking introduced). 13.6 has the two rules it added.

The branch has also been merged with `origin/main`, which had independently landed
one of the same fixes. Section 12.5 has what that changed, including two round-two
artefacts deleted in favour of main's versions.

## Executive summary

Every one of the audit's 11 findings was re-verified at the current head rather
than taken on trust. Nine reproduced. Two did not, and one of those two was a
misreading of a deliberate design decision rather than a defect.

The more useful result is that **for four of the findings the audit understated
the problem**. It classified them as tests asserting known-bad behaviour, and
they were that, but the implementations were also wrong, and in two cases more
wrongly than the report described:

- the split-replay defect existed in **eight** copies of one fold, not the one
  the report cited, and one copy carried a bug none of the others had;
- the missing-FX defect had an identical twin with no FX involved - unpriced
  holdings were being dropped from totals, which is the same rule broken the
  same way (the report tracked this separately as P6-007 and called it
  "partial");
- the automatic-backup namespace collision was reachable on **default**
  settings, because the default folder is one deployment-wide directory;
- the same flattening habit reached the AI Assistant and the MCP server, where
  an unknown portfolio total was reported to a model as `0.00`.

Sweeping for those classes rather than those instances found nine further
defects the audit did not name, listed in section 4.

Seven of the audit's items are fixed with regression tests that fail on the old
code. Two are partly fixed with the remainder stated precisely. Two needed no
change. One large item - the production-boundary concurrency harness (P7-008,
the report's only HIGH) - was **not attempted** in the first round; section 6
records why, and **section 11 closes it**: PostgreSQL turned out to be runnable
in this environment after all, the harness exists, and all seven races the audit
named are covered. Five of the seven were live defects, including a scheduled
bill that could be paid twice and a logout that could leave a usable session.

### Disposition of the audit's findings

| ID | Audit severity | Reproduced? | Outcome |
|---|---|---|---|
| P7-001 | MEDIUM | Yes, and worse | **Fixed.** Implementation, both wrong tests, and the whole consumer chain |
| P7-002 | MEDIUM | Yes | **Fixed.** Plus two defects found while writing its tests |
| P7-003 | MEDIUM | Yes, and worse | **Fixed.** Eight copies folded into one, guarded by a scan |
| P7-004 | MEDIUM | Yes | **Fixed** |
| P7-005 | MEDIUM | Yes, on defaults | **Fixed.** Plus a test-isolation bug it exposed |
| P7-006 | MEDIUM | Yes | **Fixed.** Flag removed, inventory guard added with its own self-test |
| P7-007 | MEDIUM | Yes | **Partly fixed.** Provenance gate added; the release is not redesigned |
| P7-008 | **HIGH** | Yes | **Fixed over rounds 2-4.** Harness plus every race; five defects in round 2, three in round 3, one deadlock in round 4. See sections 11-13 |
| P7-009 | MEDIUM | Partly - premise was wrong | **Narrowed and fixed.** The real gap was silence, not lost bytes |
| P7-010 | MEDIUM | Yes | **Partly fixed.** Lint and render in CI; no cluster install |
| P7-011 | LOW | 2 of 7 items | **Fixed**, and made machine-checked |

## 1. Method

1. Re-read the audit in full, then located each cited evidence file at the
   current head. The baseline is 88 commits old, so nothing was assumed still
   present.
2. For each finding, read the *implementation* before the test. This is what
   turned four "wrong test" findings into implementation defects: a test
   asserting bad behaviour usually means the behaviour is there.
3. Fixed the implementation first, then corrected the test to assert the real
   contract, then confirmed the corrected test **fails against the old code**.
   Where that check was skipped by circumstance it is called out below.
4. Treated a green suite after a behaviour change as a finding in its own right
   (root `CLAUDE.md`), which is how the P7-002 and AI-layer coverage holes were
   found.
5. After the listed findings, swept for each defect *class* rather than each
   instance. Four passes: fabricated fallback values, duplicated
   predicates/replays, failure presented as success or emptiness, and shared
   namespaces.
6. Preferred the rule a machine can check over a paragraph. Three new guards
   came out of this (sections 3.3, 3.6, 3.11).
7. Ran both unit suites, both lints and both type-checks after each change.
   Integration and E2E could not run here; section 7 states exactly what that
   leaves unverified.

## 2. Findings that did not reproduce

Recorded so they are not re-opened without new evidence.

| ID | Audit claim | What the current tree shows |
|---|---|---|
| DOC-02 | `CONTRIBUTING.md` retains QueryRunner / direct-repository guidance | Already correct. Line 65 states the `withScopedDb` rule and bans `@InjectRepository`, `createQueryRunner()` and bare `dataSource.query(...)` outright |
| DOC-03 | Contributor guidance uses integer-cent framing inconsistent with `decimal(20,4)` | Not a contradiction. It matches the root `CLAUDE.md`'s own worked example, which uses integer arithmetic scaled by 10,000 precisely to avoid float drift on 4dp values |
| DOC-04 | `.claude/skills/infrastructure.md` describes an outdated stack | The directory does not exist in this repository; `.claude/` holds only `settings.json` |
| DOC-07 | Workflow comments describe a required check and an admin bypass | Correct but unverifiable from inside the repository, as the audit itself noted. Not actionable here |
| P7-009 (as stated) | Restore remaps attachment metadata but never copies the bytes | The premise is wrong. For the `local` and `s3` providers the bytes deliberately live outside the backup and the volume or bucket must be backed up alongside it; both providers document this. The `database` provider *does* embed them, base64-encoded. The real gap was different - see 3.9 |

Also checked and clear:

- **`?? 1` on a transaction's stored `exchangeRate`** (12 sites) is not the
  fabricated-rate defect. That column is `NOT NULL DEFAULT 1` and the entity
  documents `1` as the same-currency value, so the fallback restates a
  documented default rather than inventing a rate.
- **Attachment storage keys** do not have the backup namespace problem. They are
  random attachment UUIDs, so they cannot collide across owners. The backup case
  was uniquely broken because its key was a *date*.
- **`roundMoney` on rates.** No site rounds an exchange rate to 4dp. Every
  `roundMoney(x * rate)` hit rounds the resulting money amount, which is correct.

## 3. What was fixed

### 3.1 P7-001 - a missing exchange rate was reported as a rate of 1

**Reproduced, and the implementation was the defect.**
`PortfolioCalculationService.convertToDefault` ended with
`rate = reverseRate !== null ? 1 / reverseRate : 1`, so `100.00 USD` with no
USD/CAD pair on file was reported as `100.00 CAD`.
`docs/financial-calculation-contract.md` section 3 already forbids this in as
many words: "a missing exchange rate is missing data (rule 1), not a rate of
`1`."

It now returns `null`, which made the compiler produce the list of all 14
callers. Each got an explicit decision. The failure is deliberately not cached,
so the rate cron filling the pair in takes effect on the next request.

`PortfolioSummary` gained `unavailableFxPairs`, so a consumer can say *which*
currency is holding up a total instead of showing an unexplained blank, and
`knownHoldingsValueSubtotal`, so the partial figure is reachable only under a
name that admits what it is.

**Both wrong tests corrected.** `portfolio.service.spec.ts` asserted the rate of
1; it now asserts `null`, the named pair, and - as the counterpart the old suite
could not express - that a same-currency conversion still yields a *number*,
because that is a real conversion at exactly `1.0000`.
`useExchangeRates.test.ts` gained the honest-API cases.

### 3.2 The same defect without any FX: unpriced holdings vanishing from totals

Following the `null` through found the identical violation with no currency
involved:

```typescript
if (marketValue !== null) { totalHoldingsValue += ...; }   // a subtotal
```

plus `h.marketValue ?? 0` in both per-account loops, an unconvertible holding
counted in sector weightings, and `?? 1` in the intraday FX resolver. The audit
tracked this as P6-007/P5-010 and rated it "partial"; it is the same rule broken
the same way, so it is fixed here as one change.

`PartialSum` (backend) and `sumKnown`/`addKnown`/`percentOf` (frontend) encode
the contract rule once: feeding a `null` in is the only way to mark a total
unknown, and the partial sum is reachable only through `knownSubtotal`.
`gainAgainstBasis` does the same for gain and its percentage, including the
decision a zero basis forces - `0%` only when the gain is also zero, otherwise
unknown, because a position acquired at no cost and now worth something has no
meaningful percentage and `0%` says the opposite.

**Consumers followed to the end.** 27 frontend display sites, the intraday
series (a bar it cannot value is now a gap, not a smaller number), Monte Carlo
(which turned an unknown starting value into `0` and returned a full set of
percentiles - it now refuses), and the AI/MCP layer (3.10).

### 3.3 P7-003 - a stock split's ratio was being added

**Reproduced, and eight times over.** `holdings.service` multiplied by the
ratio. `net-worth.service` spelled the same switch out three times and *added*
it, so a 2-for-1 on 90 shares gave 92 instead of 180 - the holdings page and the
historical chart disagreed about one history. All three also ignored
`ADD_SHARES`/`REMOVE_SHARES` entirely, making those holdings invisible in every
historical series. A fourth copy in the TWR replay treated a split as no change
at all, leaving the share count pre-split while prices went post-split, which
reads as a ~50% loss for that sub-period.

Sweeping for the class found four more copies (`portfolio-calculation` ×4,
`investment-report-data` ×2, the MNY holdings cross-check) - all correct, which
is the point: the mistake was that the decision existed in eight places. Two
carried comments claiming they "mirrored" the holdings fold.

The eighth was a real bug: `action-history`'s undo/redo rebuild multiplied
without guarding a non-positive ratio, alone among the copies, so a split stored
with quantity `0` would have zeroed the position.

All now call `applyShareAction`. **`share-quantity.guard.spec.ts` scans `src/`
and fails on any arithmetic under a `SPLIT` label outside the helper** - verified
by reintroducing the original `net-worth` line and watching it fail.

**Two fixtures could not have caught this.** They used `90 + 90 -> 180` and
`50 + 50 -> 100`: the numbers where additive and ratio semantics agree. They now
use real ratios, and the second of them was not in the audit's evidence list.

A third guard check - flagging hand-rolled sets of share-moving actions - was
written and deleted. It fired on AI tool schemas, DTO validation allowlists and
UI label maps, and a guard with false positives is one someone removes.

### 3.4 P7-004 - a failed logout looked like a successful one

**Reproduced.** The `catch` cleared local state and redirected in silence, so a
failed refresh-family revocation was indistinguishable from a completed logout -
the session could still be accepted in another tab or on another device.

It now warns that the server did not confirm it. Local state is still cleared:
leaving someone apparently signed in on a machine they asked to leave is worse.
Four cases replace the one named "still logs out and redirects when
authApi.logout fails", including the positive control that the success path still
shows success.

### 3.5 P7-002 - opening the override editor overwrote the stored price

**Reproduced.** The code comment said so outright: "When the market price
arrives, overwrite the Price with the latest value." A stored `250.00` became
`123.45` on open, so saving a date-only edit moved the transaction by `-126.55`
per share with no user action.

The quote is now an explicit **Apply latest price** action. Auto-fill survives
only where there is no stored price to protect, which is what makes it match the
new-scheduled-transaction form.

**The suite had a hole exactly where the defect lived.** The only latest-price
test rendered without an `existingOverride`, so it never touched the harmful
path - which is why this change did not break it. Four cases now cover it and
three fail on the old code.

Found while writing them: the override description field had a hand-rolled
`<label>` associated with no input, so it had no accessible name, and its
placeholder plus the "Latest:" hint were hardcoded English.

### 3.6 P7-005 - automatic backups shared one namespace across owners

**Reproduced, and reachable on defaults.** The default `folderPath` is
`BACKUP_CONTAINER_DIR` - one deployment-wide directory - and the filename was
only `monize-backup-daily-<date>.<ext>`. Two users whose backups ran on the same
day chose the same key: the second overwrote the first, retention counted both
owners' files against one limit and deleted across the boundary, and a restore
could hand one user another user's data.

Each owner now writes into its own sub-directory, with listing, retention and
deletion scoped to it. Legacy files in the shared parent are **never deleted** -
they carry no owner, so nothing can attribute them, and deleting them in a
multi-user deployment would destroy someone's recovery points. Retention reports
them once so an operator can act.

The unit suite asserted the generic names against a shared listing with one
mocked owner. It now covers two owners on the same date, per-owner retention
scoping, and the legacy files being left alone.

**A test-isolation bug surfaced here.** `afterEach` called `clearAllMocks`, which
resets call history but not implementations, so the folder-permission test's
`mockRejectedValue` on `fs.mkdir` leaked into every later test and failed
fourteen of them as soon as the service began creating a directory.

### 3.7 P7-006 - the integration job could pass having run nothing

**Reproduced.** `--passWithNoTests` was still in `test:integration`.

Removed. `scripts/integration-inventory.mjs` runs first, fails when a mandatory
suite is missing or the count drops below a floor, and prints the discovered list
so a job log shows what was covered. Its eight-case self-test runs in the lint
job, because a guard that cannot fail is not a guard.

The mandatory list is deliberately not "every file": pinning the whole inventory
would fail on every legitimate addition and get deleted.

### 3.8 P7-007 - the release pushed a commit no check had seen (partly fixed)

**Reproduced.** The version bump is created after the gates, carries `[skip ci]`,
and is pushed to protected `main` with an admin PAT.

Redesigning this into a release PR is a larger change and was not done. What is
here makes the divergence impossible to ignore: before the push the job proves
the new commit sits directly on the tested SHA, that the diff touches nothing but
the four version manifests, and that both manifests and lockfiles carry the
released version - then re-checks the parent after `git pull --rebase`, because a
rebase onto commits that landed mid-release would advance `main` to code no check
has seen while the signed images describe a different tree. Tested, image and
pushed SHAs go into the job summary.

Verified against a scratch repository: a clean bump passes, one carrying a stray
source file is refused, and one replayed onto a newer `main` is refused.

**Still open:** the pushed commit is still not itself verified by the required
checks. Only a release-PR flow or a post-commit gate run fixes that.

### 3.9 P7-009 - narrowed, then fixed

The audit's premise was wrong (section 2). The real gap: a restore of a backup
taken under `local` or `s3` returns attachment metadata with no bytes, and said
nothing about it, so the user discovered weeks later that every download 404s.
The restore now counts attachments with no bytes and reports the count in its
message and the log.

### 3.10 The flattening reached the AI Assistant and the MCP server

Not in the audit. `getLlmSummary` passed the totals through a `roundMoneyValue`
helper mapping `null` to `0`, so an unknown portfolio was reported to a model as
being worth `0.00` - which a model then states as fact, to a user with no way to
check it.

The LLM shape is nullable, the summary says "unknown" with the reason, and it
tells the model explicitly not to read an unknown figure as zero. That change
broke no test, which was the finding; two now cover it, including the control
that a genuinely empty portfolio still reports `0.00`.

### 3.11 P7-011 and P7-010 - documentation and the chart

Two of the seven documentation items reproduced. The threshold claim (85%
branches against a config enforcing 84%) is the cheap one. The Helm README is
not: all seven documented commands said `./helm/monize`, but `Chart.yaml` lives
at `helm/Chart.yaml`, so every command a copying operator ran failed outright.

Both corrected, and `frontend/src/test/docs-consistency.test.ts` now parses
`vitest.config.ts`, `backend/package.json`, `playwright.config.ts` and
`Chart.yaml` and fails when a document disagrees. All three real drifts fail it
before the fix.

For P7-010, `helm lint` plus a render of the default, Ingress and
HTTPRoute-disabled variants runs in CI, every rendered document is parsed as
Kubernetes YAML, and `prepare-release` depends on the job. Helm is installed from
the official release with a checksum check rather than through another action, so
there is no extra SHA to keep current.

## 4. Defects found by sweeping, not listed in the audit

| # | Defect | Where | Status |
|---|---|---|---|
| 1 | `ADD_SHARES`/`REMOVE_SHARES` ignored by every historical replay, so those holdings were invisible in net-worth series | `net-worth.service.ts` ×3 | Fixed |
| 2 | TWR replay treated a split as no quantity change, reading as a ~50% loss for that sub-period | `portfolio-calculation.service.ts` | Fixed |
| 3 | Undo/redo rebuild multiplied by a split ratio with no `> 0` guard, so a `0` ratio would zero the position | `action-history.service.ts` | Fixed |
| 4 | Unpriced holdings silently dropped from `totalHoldingsValue`; `?? 0` in both per-account loops | `portfolio-calculation.service.ts` | Fixed |
| 5 | Intraday FX resolver fell back to `?? 1`, drawing a chart line on a fabricated parity | `portfolio.service.ts` | Fixed |
| 6 | Monte Carlo turned an unknown starting value into `0` and returned a full set of percentiles | `monte-carlo.service.ts` | Fixed - now refuses |
| 7 | AI Assistant and MCP reported an unknown portfolio total as `0.00` | `tool-executor.service.ts`, `portfolio.service.ts` | Fixed |
| 8 | Second additive-split fixture, outside the audit's evidence list | `net-worth.service.spec.ts` | Fixed |
| 9 | `clearAllMocks` leaking a `mockRejectedValue` across tests | `auto-backup.service.spec.ts` | Fixed |
| 10 | Override description field had no accessible name; placeholder and price hint hardcoded English | `OverrideEditorDialog.tsx` | Fixed |
| 11 | Failed lookup rendered as an empty dataset with no distinction | `PaymentSetupDialog.tsx` | Fixed |
| 12 | Hardcoded English error string | `RecentTransactionsPopover.tsx` | Fixed |

## 5. New durable guards

| Guard | Catches |
|---|---|
| `backend/src/securities/share-quantity.guard.spec.ts` | Any share arithmetic under a `SPLIT` label outside the one helper. Verified against the real defect |
| `backend/scripts/integration-inventory.mjs` + self-test | A discovery regression producing a green integration job that ran nothing |
| `frontend/src/test/docs-consistency.test.ts` | Documented thresholds, browser matrix or chart path disagreeing with the executable configuration |
| `PartialSum`, `gainAgainstBasis`, `sumKnown`/`addKnown`/`percentOf` | Make the forbidden `if (x !== null) total += x` shape awkward to write |
| Release provenance gate | A version-bump commit differing from the tested SHA by more than the four manifests, or rebased onto unverified code |

Two rules were added to the root `CLAUDE.md`, phrased around what went wrong
rather than as advice: reach for the accumulators instead of re-deriving the
rule, and follow a newly nullable field to the pixels *and to the model*; share
arithmetic is one function, enforced by a scan.

## 6. Not done, and why *(as of round 1 - see section 11 for what changed)*

### P7-008 - production-boundary concurrency harness (the audit's only HIGH)

**Not attempted in round 1.** The audit asks for a reusable harness with two or
more independently acquired PostgreSQL connections, explicit isolation and lock
timeouts, named barriers, and the ability to start two Nest scheduler instances -
then seven regression tests on top of it (P4-001 through P4-007), with P4-008
through P4-018 as backlog.

It is a substantial piece of test infrastructure, and the working assumption was
that there is no PostgreSQL in this environment, so nothing built here could be
run even once. A concurrency harness that has never executed is worse than none:
it would look like coverage.

**That assumption was wrong, and it was the single most consequential error in
round 1.** PostgreSQL 16 initialises and runs here perfectly well. Section 11.1
has the harness, section 11.2 the seven races, and five of them were live
defects - which is a direct cost of having accepted an environment limitation
without testing it.

### The `useExchangeRates.convert` migration - **completed in round 2**

Round 1 kept `convert` with its unconverted fallback and migrated only the
credit-utilization widgets, on the grounds that roughly fifty display call sites
each needed their own decision about how to show an unknown figure. The review
called that out as the branch's most serious remaining problem, and it was right:
a fallback that still compiles is a fallback something still calls, and
documenting a defect on the hook is not the same as not shipping it. `convert`
and `convertWithRateMap` are now **deleted**. Section 11.5 has the detail.

### Account-balance displays still using `?? 0`

`brokerageMarketValues` now omits accounts whose value is unknown, matching the
backend's "missing key means no information" convention. The consumers still read
`map.get(id) ?? 0`, so an unknown account value renders as a zero balance. This
pre-dates the change and is unchanged by it (a null `portfolioSummary` already
produced an empty map), but it is the same class and remains open in
`AccountBalancesReport`, `app/accounts` and `app/dashboard`.

### Other audit items left open

| Item | Why |
|---|---|
| P7-010 cluster install | `helm lint`/`template` are in CI. A kind/k3d install verifying backup-volume persistence through a pod replacement is a separate change |
| P7-009 provider byte round-trip | The reframed defect is fixed. A local/S3 provider-parameterized round trip with byte hashes still does not exist |
| Section 7.2 "test not located" register (40+ items) | Out of scope here. Each needs its own verification |
| DR-01 through DR-07 design risks | Mostly need branch-protection or merge-queue facts unavailable from inside the repository. DR-04 (`TZ=UTC` in CI) is a one-line change and would be worth doing |
| `CreditUtilizationReport` duplicating `lib/credit-utilization.ts` | Noticed while fixing it. Both were made null-aware; the duplication itself remains |

## 7. Verification status

| Check | Result |
|---|---|
| Backend unit (`TZ=UTC npm run test:unit`) | **403 suites, 10,735 tests, all passing** |
| Frontend Vitest | **629 files, 12,328 tests, all passing** |
| Backend lint + `tsc --noEmit` | Clean |
| Frontend lint + `tsc --noEmit` | Clean (one pre-existing `Combobox` warning, untouched) |
| i18n parity, both layers | Passing - all 12 new strings translated into all 18 locales, both pseudo-locales regenerated |
| `ci.yml` | Parses as YAML; the new release step's shell passes `bash -n`; the provenance logic was exercised against a scratch git repository |
| Backend integration | **Not run** - no PostgreSQL. 3 suites fail here with `ECONNREFUSED`, unrelated to these changes |
| Playwright E2E | **Not run** - no browser stack |
| `scripts/verify-schema.sh` | **Not run** - no migrations were touched, so no drift is possible |
| Helm job | **Not executed** - no `helm` binary here. Lint/template/parse steps are unverified in practice |

Two new strings initially tripped the double-hyphen rule in
`messages.punctuation.test.ts` and were recast.

## 8. Numerical examples carried forward

- Missing FX: `100.00 USD` with no USD/CAD pair now yields `null` and
  `unavailableFxPairs: ["USD->CAD"]`, not `100.00`. At a real `1.3500` the old
  answer understated by `612.50` on the audit's 10-share fixture.
- Stock split: `90 × 2.0 = 180`. The additive implementation gave `92`, an error
  of `-88` shares. Reverse: `90 × 0.5 = 45`. A literal ratio of `90.0` gives
  `8,100`, which is what proves a fixture cannot be read additively.
- Override preservation: stored `4 @ 250.00`, commission `0.00`, total
  `1005.00`; latest quote `123.45`. A description-only edit now submits the
  stored figures unchanged. Applying the quote explicitly gives `493.80`.
- Backup keys: two users, same date, same destination now produce
  `<folder>/<userIdA>/monize-backup-daily-<date>` and
  `<folder>/<userIdB>/...`; previously one key.

## 9. Commits

| SHA | Subject |
|---|---|
| `863bbfd7` | Stop fabricating exchange rates, split ratios and unknown totals |
| `da5b79c6` | Stop the UI presenting unknown figures as measured ones |
| `4215f4cb` | Close the integration false-green, bind the release to its tested SHA, and isolate automatic backups per owner |
| `78e0d8a2` | Make documentation drift a failing test, verify the Helm chart, and report restored attachments that carry no bytes |
| `ec71b455` | Fold the remaining share-replay copies into one function, guard it with a scan, and complete the localization pass |
| `e622a499` | Keep unknown totals unknown all the way to the model, and write the rules down |

## 10. Recommended next steps, in order *(round 1 - superseded by section 11.9)*

1. **Run the integration and E2E suites** against a real stack. They are the one
   category of verification this work could not perform, and the backup,
   portfolio and net-worth changes all touch code those suites exercise.
2. **Build the concurrency harness (P7-008)** and the seven races on it. Largest
   remaining item, and the audit's only HIGH.
3. **Finish the `convert` migration** across the 27 frontend files in section 6.
   The compiler produces the worklist.
4. **Fix the `?? 0` account-balance displays**, the last known instance of the
   unknown-as-zero class.
5. **Add the local/S3 restore round trip** with byte hashes and failure
   compensation.
6. **Set `TZ=UTC` explicitly in CI** (DR-04). One line, and it removes a real
   source of confusing failures.
7. **Move the release to a version-bump PR** so the pushed commit is verified at
   its own SHA, retiring the provenance gate's reason to exist.

---

## 11. Second round - remediation review (`monize-audit-07-remediation-review.md`)

An independent read-only review of this branch at `79bfc257` reported 2 HIGH and
5 MEDIUM findings and concluded the branch "should not be represented as closing
Phase 7". That was a fair reading, and both HIGHs are now closed.

The review's central complaint was not that individual fixes were wrong but that
two of them stopped at the point where they were hardest to finish: the FX
migration kept its own defect alive behind a deprecation note, and the concurrency
gap was declared unreachable on the basis of an environment limitation that was
never tested. Both of those were judgement calls made in round 1, and both were
wrong in the same direction - accepting a description of the work instead of the
work.

### Disposition of the review's findings

| ID | Severity | Reproduced? | Outcome |
|---|---|---|---|
| FR7-001 | **HIGH** | Yes | **Fixed.** `convert`/`convertWithRateMap` deleted; 67 type errors across 31 files each resolved with a stated policy |
| FR7-002 | MEDIUM | Yes | **Fixed** in `7e23487c`. An override editor opened on an occurrence with no stored override still overwrote the schedule's saved price |
| FR7-003 | MEDIUM | Yes | **Fixed** in `7e23487c`. Sub-daily frequencies produced one filename per day, so three of four backups were lost |
| FR7-004 | **HIGH** | Yes | **Fixed.** Harness plus all seven races; five were live defects |
| FR7-005 | MEDIUM | Yes | **Still partly fixed.** Unchanged from round 1; see 11.8 |
| FR7-006 | MEDIUM | Yes | **Still open.** The reclassification in round 1 was wrong and is withdrawn; see 11.8 |
| FR7-007 | MEDIUM | Yes | **Still partly fixed.** PyYAML is now declared; no cluster install; see 11.8 |

### 11.1 The concurrency harness (FR7-004 / P7-008)

`backend/test/helpers/race-harness.ts`. Three properties, each of which some
existing test lacked:

- **Independent connections.** Each participant runs under its own
  `withUserContext`, so its `withScopedDb` draws a fresh pooled connection and
  opens its own transaction. Two calls sharing one ambient transaction cannot
  conflict with each other at all - they *are* the same transaction, which is why
  the pre-existing `Promise.all`-shaped tests proved nothing.
- **A `RowGate`.** An independent transaction that holds `FOR UPDATE` on the row
  every participant must touch, so each of them stops there *inside its own
  transaction*; releasing the gate frees them into the contended window together
  and lets the application's own locking decide. `RowGate.hold` refuses a
  non-locking SELECT, because a gate that gates nothing turns every race built on
  it back into a `Promise.all` silently.
- **No sleeps.** `waitForBlockedBackends` and `waitForIdleInTransaction` ask
  PostgreSQL a question - is a backend blocked on a lock, is a transaction sitting
  open - so a test proceeds the instant the condition is true and cannot proceed
  while it is false. `waitUntil` takes an arbitrary observable condition for the
  cases where the *presence of the fix* changes which of two outcomes happens.

Plus `raceAll`, which reports what every participant did rather than discarding
the losers with the first rejection; losing a race is a normal outcome here.

**The harness proves itself.** `race-harness.integration.spec.ts` runs an
intentionally unguarded read-modify-write through the same gate and asserts it
*loses* an update, then the same operation with `FOR UPDATE` and asserts it does
not. That case is the positive control for every other race suite: if it ever
starts passing, the gate has stopped gating and the rest have quietly become
`Promise.all` again.

### 11.2 The seven races

Each fix was verified by reintroducing the fault and watching the suite fail. Two
of the seven were sound; five were defects.

| # | Audit root | Verdict | Defect and fix |
|---|---|---|---|
| 1 | P4-001 | **Defect** | `start` counted in-flight jobs, then inserted in a separate transaction. Two simultaneous starts both counted zero and both inserted: one file imported twice, by two workers, into the same accounts. Now a partial unique index (`idx_import_jobs_one_active_per_user`, migration 133); the loser gets a 409 |
| 2 | P4-002 | **Sound, now pinned** | `writeAll` is a single transaction, so a failure commits nothing and a retry cannot replay committed rows. True by where the boundary sits, not by anything in the retry path - so it is now a test |
| 3 | P4-004 | **Defect** | Two posters of one scheduled occurrence both created a transaction and both advanced the due date. The bill was paid twice with nothing inconsistent left to notice. Now one transaction, the schedule row locked, and the intended occurrence checked against it |
| 4 | P4-003 / P4-005 | **Defect** | `recalculateCurrentBalance` read the account in one transaction and summed in another, then wrote back the whole stale entity - reverting any concurrent rename, credit-limit or opening-balance edit, silently. Now one transaction, a locked read, and an update confined to the one column it owns |
| 5 | P4-006 | **Defect** | The holdings rebuild read the history in earlier transactions and then deleted and re-inserted from that replay. Now one transaction with the brokerage accounts locked first |
| 6 | P4-007 (claim) | **Defect** | Two emergency-access claims both passed the single-use check and both rewrote the owner's credentials, each told it had succeeded, while only the last password worked. The code carried a comment claiming the transaction "re-validates under lock"; it did not |
| 7 | P4-007 (tokens) | **Defect** | A confirmed logout could leave a live session. The rotation holds `FOR UPDATE` on the token it replaces, so the revocation's single `UPDATE ... WHERE family_id` necessarily blocks behind it and necessarily commits second, with a snapshot from before the replacement row existed. Revocation now re-reads until nothing is live, and throws rather than reporting a partial revocation |

Six new suites, 26 tests, all passing against PostgreSQL 16.13.

### 11.3 What the races proved, in numbers

- **Scheduled posting.** One `-1200.00` bill, two posters: the account ended at
  `-2400.00` before the fix and `-1200.00` after. The schedule's next due date
  advanced exactly one period either way, which is why nothing downstream noticed.
- **Import start.** Two simultaneous `create` calls produced two `pending` jobs
  before the index and one job plus one `ConflictException` after. At four
  concurrent callers: four jobs, then one.
- **Account recompute.** Opening balance edited from `1000` to `2000` with a
  `+250` transaction on file: the stored row read `currentBalance 1250` against
  `openingBalance 2000` before the fix - a state the account was never in - and
  `2250` after.
- **Emergency claim.** Two claims: two successes and two credential rewrites
  before, one success and one `NotFoundException` after, with exactly one
  `generateTokenPair`.
- **Refresh tokens.** One live descendant survived the revocation before the fix,
  zero after.

### 11.4 Two things the second round is careful *not* to claim

**The holdings race proves serialization, not the original loss.** The old code
deleted the holdings it had *read*, by id, so a row inserted after that read
survived; shares went missing only when the read landed on the far side of the
trade's commit. That window contains no lock, so it is not reachable from outside
the service without adding a seam to production code for a test's benefit. What
the suite asserts instead is the actual invariant - a rebuild and a trade for the
same account cannot overlap - by parking the rebuild mid-transaction and checking
the trade cannot commit there. Without the account lock it commits straight
through the middle, so the assertion does separate the two worlds; it just is not
the assertion the audit's wording implies.

**The refresh-token fix is convergent, not lock-based.** `revokeUntilNoneLive`
loops on a *read*, bounded at eight passes, and throws if it cannot converge. Two
passes settle the ordinary race. It loops on a read rather than on `affected`
because the parent row the rotation already revoked no longer counts as changed,
so an `affected === 0` exit stops one row short of the token that matters. An
advisory-lock scheme would also work and would need a lock-ordering argument
across four call sites; this needs none, and fails loudly instead of quietly.

### 11.5 FR7-001 - the numeric-fallback conversion APIs are gone

`useExchangeRates.convert` returned the source amount when the pair had no rate,
so `100.00 USD` under a CAD label read as `100.00 CAD` - a fabricated 1:1
conversion indistinguishable from a genuine same-currency figure. Round 1 kept it
behind a comment. It is now deleted, along with `convertWithRateMap`, and
`convertToDefault` returns `number | null`.

That produced 67 type errors across 31 files, and each was a decision rather than
a mechanical fix:

- **A single displayed amount** gets the labelled unknown marker, through the new
  `useMoneyDisplay` hook - one catalog string, one place for a translator. It sits
  apart from `useNumberFormat` on purpose: that hook is deliberately free of the
  `next-intl` provider, and adding a lookup there broke thirty of its own tests.
- **An aggregate** cannot be `null` and still be a chart, so unconvertible rows
  are excluded and `UnconvertedNotice` says how many. Excluding silently
  understates just as badly as converting at 1:1.
- **A denominator that cannot be computed** suppresses the shape as well as the
  number: the credit-utilization donut is not drawn at all rather than drawn
  empty, because a gauge at zero width reads as a measured zero.
- **`forecast.ts`** returns no series when the starting balance is unknown, and
  the two `?? 0` sites left inside it are commented as safe only because of that
  guard.

`CreditUtilizationReport` had its own inline copies of the row and total
arithmetic - the duplication round 1 noticed and left. They are deleted in favour
of `computeCreditRows`/`computeCreditTotals`.

### 11.6 New durable guards from round 2

| Guard | What it holds |
|---|---|
| `race-harness.integration.spec.ts` | The gate reaches the conflict window: an unguarded read-modify-write loses an update through it. Positive control for every other race suite |
| `idx_import_jobs_one_active_per_user` | One in-flight import per owner, in the database rather than in a service that a new caller can forget to consult |
| Integration inventory floor | Raised above the length of the mandatory list, which the concurrency suites had quietly overtaken - fifteen mandatory files were enough to clear a floor of fifteen, so the count check had stopped checking anything |
| Six race suites in `MANDATORY_SUITES` | Losing one is a reviewed decision, not a quiet drop |
| Import rollback test | Pins the all-or-nothing write phase. Moving the injected failure to a phase after the commit makes it fail with four surviving accounts, which is the control that says the assertion can see committed data |
| `backend/CLAUDE.md` | "A concurrency test needs two connections, a gate, and a positive control", with the two defect shapes - an `UPDATE` that cannot see a concurrent insert, and `repo.save(entity)` reverting columns it does not own |

### 11.7 Ordering defect found while fixing FR7-004, not in either report

`POST /import/mny/start` ran the destructive **wipe existing data** step *before*
creating the job row. Once the one-active-import invariant became a constraint,
that ordering meant a request which lost the race had already deleted every
account, category and payee the user owned, and then failed with a conflict
claiming nothing had happened. The reservation now comes first, and a wipe that
fails re-authentication releases the slot on its way out. This is the root
`CLAUDE.md` rule "a rejected command must not already have written" - and the
pre-existing order was worse than the race it sat beside.

### 11.8 Still open after round 2, stated plainly

| Item | Status | Why |
|---|---|---|
| **FR7-005 / P7-007** - release pushes an unverified SHA | **Partly fixed, unchanged** | The provenance gate constrains the bump's diff, checks the parent against the tested SHA, and rejects a rebase onto newer code. The pushed commit still is not itself the commit the checks ran on. Fixing that properly means moving the version bump to a release PR and running the full graph on that SHA - a change to the release process, not a patch |
| **FR7-006 / P7-009** - attachment byte round-trip | **Open.** Round 1's reclassification is withdrawn | Round 1 narrowed P7-009 to "restore is silent about attachments carrying no bytes", fixed that, and described the original premise as disproved. The review is right that this does not close a missing-test finding: no test seeds bytes in a local and an S3-compatible provider, exports, restores into remapped ids, downloads through the public path and compares hashes, nor injects a failure after the first object copy |
| **FR7-007 / P7-010** - cluster install | **Partly fixed** | Lint, three renders, YAML parsing and a release dependency are in CI, and PyYAML is now installed explicitly rather than assumed present on the runner image. There is still no kind/k3d install, no backup-volume persistence through a pod replacement, and the Helm job has never executed here (no `helm` binary) |
| Playwright E2E | **Not run** | No browser stack in this environment. Unchanged from round 1 |
| `?? 0` on `brokerageMarketValues` consumers | **Open** | `AccountBalancesReport`, `app/accounts`, `app/dashboard`. Pre-dates this work and is the last known instance of the unknown-as-zero class |
| P4-008 - P4-018 | **Open** | The audit's own concurrency backlog beyond the seven. The harness they need now exists |
| Section 7.2 "test not located" register | **Open** | 40+ items, each needing its own verification |
| DR-01 - DR-07 design risks | **Mostly open** | Need branch-protection or merge-queue facts unavailable from inside the repository. DR-04 (`TZ=UTC` in CI) remains a worthwhile one-line change |

### 11.9 Verification status, round 2

| Check | Result |
|---|---|
| Backend unit (`TZ=UTC npm run test:unit`) | **403 suites, 10,743 tests, all passing** |
| Backend integration (real PostgreSQL 16.13) | **27 suites, 268 tests, all passing** |
| Frontend Vitest | **629 files, 12,326 tests, all passing** |
| Migration idempotency lint | **123 files, passing** |
| Schema-drift replay | **Passing.** `schema.sql` applied to two databases, all migrations replayed **twice** on one of them, dumps normalized as CI does: identical |
| Backend + frontend lint, `tsc --noEmit` | Clean (one pre-existing `Combobox` warning, untouched) |
| i18n parity, both layers | Passing - the new error string translated into all 18 locales, both pseudo-locales regenerated |
| Playwright E2E | **Not run** - no browser stack |
| Helm CI job | **Not executed** - no `helm` binary here |

Every fix in section 11.2 was checked by reintroducing the defect and confirming
the suite fails, which is recorded here because a race test that has only ever
been seen to pass is indistinguishable from one that cannot fail.

### 11.10 Recommended next steps, in order

1. **Run Playwright E2E** against a full stack. It is now the only suite category
   this work has not executed.
2. **Add the local/S3 attachment round trip** (FR7-006). The last open
   missing-test finding from the original audit, and the one with data loss behind
   it.
3. **Add the kind/k3d install job** with backup persistence through a pod
   replacement (FR7-007).
4. **Move the release to a version-bump PR** (FR7-005), retiring the provenance
   gate's reason to exist.
5. **Fix the `?? 0` account-balance displays**, closing the unknown-as-zero class.
6. **Work P4-008 through P4-018** on the harness, which is the cheap part now.
7. **Set `TZ=UTC` explicitly in CI** (DR-04).

### 11.11 Commits, round 2

| SHA | Subject |
|---|---|
| `7e23487c` | Protect a schedule's saved price, make sub-daily backups distinct, and verify both on real infrastructure |
| `b684daea` | Delete the numeric-fallback conversion APIs and carry the unknown to the pixels |
| `7ff68069` | Race four concurrency defects at the real conflict boundary, and fix them |
| `33f1681c` | Stop a scheduled bill being paid twice, and a rebuild erasing a concurrent trade |
| `c19f7bff` | Pin the import's all-or-nothing write, closing the last of the seven races |

---

## 12. Third round - remediation re-review (`monize-audit-07-remediation-review.md`, re-review at `e75acd20`)

The re-review confirmed the second round's two HIGH findings closed and the
concurrency harness credible, then found **three further HIGH defects** and
recorded that section 11's closure claim was overstated. It was: two of the three
sit in code round two had touched and declared done.

That is the pattern worth naming, because it repeated. Each of the three is a fix
that stopped one step short of the invariant it claimed:

- the scheduled-post precondition existed but was *derived from a fresh read*, so
  the command still meant "post whatever is current";
- the backup filename gained a time component but not exclusivity, so
  same-second writers still shared a path;
- the account lock was added to the two mutators the new test happened to
  exercise, and not to the other four.

In all three cases round two had a passing test. None of the three tests could
fail, for the same reason: each exercised the path that had been fixed rather
than the paths that had not.

### Disposition of the re-review's findings

| ID | Severity | Reproduced? | Outcome |
|---|---|---|---|
| RFR7-001 | **HIGH** | Yes | **Fixed.** One command posts one *named* occurrence; the cron and both frontend call sites pass what they discovered |
| RFR7-002 | **HIGH** | Yes | **Fixed.** Unique temporary name with exclusive create, published by `link`; two same-second backups become two files |
| RFR7-003 | **HIGH** | Yes | **Fixed.** Every holdings mutator takes the account lock, and both rebuilds |
| RFR7-004 | MEDIUM | Yes | **Fixed.** `?? 0` removed from every brokerage market-value consumer |
| RFR7-005 | MEDIUM | Yes | **Still partly fixed.** Unchanged; see 12.6 |
| RFR7-006 | MEDIUM | Yes | **Still open.** See 12.6 |
| RFR7-007 | MEDIUM | Yes | **Still partly fixed.** See 12.6 |
| Divergence from `main` | design risk | Yes | **Resolved.** Merged, six conflicts, all verified on the merge result |

### 12.1 RFR7-001 - a delayed replica posted the next occurrence early

The auto-post cron discovers a due list in one transaction and then posts each
row. Round two gave `post` a row lock and an occurrence precondition, but derived
the occurrence from a fresh read inside the same call, so a replica delayed behind
one that had already posted read the *advanced* date and treated that as its
intended occurrence.

A worker asked to post April charged May instead: `-1,200.00` a second time, and
`next_due_date` at `2026-06-15` rather than `2026-05-15`. One extra payment and one
period skipped, from a schedule that looks internally consistent afterwards. The
same shape reached the UI, where a resubmitted Pay dialog paid the following
period.

**The invariant is now one command, one named occurrence.** `expectedNextDueDate`
is a DTO field; the cron passes `ensureYMD(scheduled.nextDueDate)` from the
candidate it discovered, and `ScheduledTransactionList` and
`PostTransactionDialog` pass the `nextDueDate` they are rendering. A superseded
candidate is logged as skipped and counted separately from a failure -- a healthy
multi-replica deployment should not report an error every hour for doing the right
thing.

The fallback for a caller that names nothing is still the fresh read, because
refusing those outright would break every existing client. That caller gets the
old behaviour and the old exposure, documented on the DTO rather than silently
kept.

The races go through `processAutoPostTransactions` itself, discovery included.
That matters: the defect lived in what the cron did with what it found, and the
round-two suite -- which called `post` directly, and in one case a private helper
with a hand-supplied stale date -- could not reach it. On the pre-fix code the new
case fails with two transactions and a June due date.

### 12.2 RFR7-002 - same-second backups collided on both paths

The filename carried local time to the second. Two replicas firing one hourly
occurrence, or a double-submitted manual backup, computed the same temporary
*and* the same final path: both wrote the shared temporary file and both renamed
it. Two accepted backups left one file whose contents belonged to whichever write
landed last, and one of the two runs recorded success for a recovery point that no
longer existed. On a real filesystem that is silent.

Every run now takes its own `randomUUID()` temporary name, created with `wx` so
the open fails rather than truncates, and publishes by **linking** rather than
renaming -- `link` refuses a name that exists, `rename` overwrites it. When the
final name is taken the loser appends a discriminator: **two recovery points,
never one**, because a backup that was accepted and then silently discarded is
exactly the failure this is guarding against. The discriminator is inside
`DAILY_FILE_PATTERN`, so retention still counts and sweeps it; a file matching
neither is a recovery point nothing ever deletes.

The integration test freezes one instant and runs two backups. Before the fix it
finds one file for two accepted attempts.

### 12.3 RFR7-003 - half the holdings mutators skipped the lock

`createOrUpdate` and the whole-user rebuild took the account lock. `applySplit`,
`reverseSplit`, `adjustQuantity` and `rebuildAccountsFromTransactions` did not --
which is every path a `SPLIT`, `ADD_SHARES` or `REMOVE_SHARES` edit or delete
goes through. Round two's race covered a `BUY`, and `BUY` goes through
`createOrUpdate`, the one mutator that already locked. That is why it passed.

Deleting an `ADD_SHARES 10` while a rebuild was parked mid-transaction left the
history with no acquisition and holdings showing **10 phantom shares**; deleting a
`REMOVE_SHARES 4` left 6 where 10 was right. Both reproduce on the pre-fix code
with those exact numbers.

Two of the four new cases -- the `SPLIT` delete and the share *insert* -- pass with
or without the lock, because a split delete is followed by a post-commit repair
rebuild and an insert creates a row the rebuild's by-id delete never sees. The
suite says so rather than implying four proofs where there are two.

### 12.4 RFR7-004 - unknown brokerage value read as a measured zero

`brokerageMarketValues.get(id) ?? 0` turned three different states into one
number. `lib/brokerage-market-value.ts` now keeps them apart:

- **known**, including a genuine `0` for a brokerage that holds nothing -- an
  empty account is worth zero, and reporting that as unknown is the opposite
  error;
- **unknown**, when the server sent `null` for a missing quote or rate;
- **unknown for everything**, when the portfolio request itself failed -- a failed
  lookup is not an empty dataset, and before this a failed load rendered every
  brokerage account as `0.00`.

Applied across the accounts page, the dashboard, `AccountBalancesReport`,
`AccountList`, `AccountRow` and `FavouriteAccounts`. An unknown value also blocks
Close, because it is not a zero balance and the account may still hold securities.

On the reviewer's numbers: `500.00` of cash beside ten shares with no quote now
reports Total Assets as unavailable rather than as `$500.00` complete -- which,
against a later-resolved `100.00` per share, understated by `1,000.00` of `1,500.00`.

A test named "handles brokerage with no portfolio summary (falls back to 0)",
asserting `$0.00`, is rewritten. It pinned the defect as behaviour, which is the
third time in this remediation that a test has been found doing that.

### 12.5 The merge with `main`, and what it changed

The branch was 40 commits behind. Six files conflicted; none of the resolutions
were mechanical, and two went *against* this branch:

- **`main` had independently landed the same one-active-import fix**
  (`135_import_jobs_single_active.sql`). Migration 133 from round two is
  **deleted** -- it created the same index under a number that also collided with
  `133_joint_account_grants.sql`, the duplicate-prefix hazard
  `database/CLAUDE.md` warns about. Main's job service is kept: it matches on
  `QueryFailedError` and takes the index name from the entity instead of a second
  copy of the string. Main's `start` also already reserves before the destructive
  wipe and releases the slot with `discard` rather than failing the row.
- **`race-import-start.integration.spec.ts` is deleted.** Main's
  `mny-import-job` suite covers that invariant as a strict superset. Two suites
  racing the same insert is duplication, not depth, and the inventory guard now
  says why the list looks shorter.

The backup service needed the opposite treatment. Main reworked it into sharded
per-user folders with a separate encryption service -- better than the flat
per-owner directory round two added -- but lost both the sub-daily time component
and the atomic write in the process. Main's structure is kept and all three fixes
re-applied on top.

Everything below was run on the **merge result**, not on either parent.

### 12.6 Still open after round three

| Item | Status | Why |
|---|---|---|
| **RFR7-005 / P7-007** - release pushes an unverified SHA | **Partly fixed, unchanged** | The provenance gate constrains the bump's diff and parent. The pushed commit still is not the commit the checks ran on. Fixing it means moving the version bump to a release PR -- a change to the release process, not a patch, and not something to fold into a branch this size |
| **RFR7-006 / P7-009** - attachment byte round-trip | **Open** | No test seeds bytes in a local and an S3-compatible provider, exports, restores into remapped ids, downloads through the public path and compares hashes, nor injects a failure after the first object copy. The highest-value item left |
| **RFR7-007 / P7-010** - cluster install | **Partly fixed** | Lint, three renders, YAML parsing, explicit PyYAML and a release dependency are in CI. No kind/k3d install, no backup persistence through a pod replacement, and the Helm job has never executed in this environment |
| Playwright E2E | **Not run** | No browser stack here. The only suite category this work has never executed |
| P4-008 - P4-018 | **Open** | The audit's concurrency backlog beyond the seven. The harness they need exists |
| Section 7.2 "test not located" register | **Open** | 40+ items, each needing its own verification |
| DR-01 - DR-07 | **Mostly open** | Need branch-protection and merge-queue facts unavailable from inside the repository. DR-04 (`TZ=UTC` in CI) remains a worthwhile one-line change |

### 12.7 Verification status, round three (on the merge result)

| Check | Result |
|---|---|
| Backend unit (`TZ=UTC npm run test:unit`) | **407 suites, 10,902 tests, all passing** |
| Backend integration (real PostgreSQL 16.13) | **28 suites, 314 tests, all passing** |
| Frontend Vitest | **634 files, 12,413 tests, all passing** |
| Migration idempotency lint | **125 files, passing** |
| Schema-drift replay | **Passing.** `schema.sql` applied to two databases, all migrations replayed **twice**, dumps normalized as CI does: identical |
| Backend + frontend lint, `tsc --noEmit` | Clean (one pre-existing `Combobox` warning, untouched) |
| i18n freshness + parity, both layers | Passing |
| Playwright E2E | **Not run** - no browser stack |
| Helm CI job | **Not executed** - no `helm` binary here |

Each of RFR7-001 through RFR7-004 was checked by reintroducing the defect and
confirming the relevant suite fails, with the numbers recorded in 12.1-12.4. That
is written down because the three HIGH findings of this round all had a passing
test over them, and a test that has only ever been seen to pass is
indistinguishable from one that cannot fail.

### 12.8 The rule this round earned

Round two's failures were not carelessness about the invariants -- the invariants
were written down and the tests were real. They were carelessness about **which
call sites the test reached**. In each case the new test exercised the path the fix
had just changed, which is the one path guaranteed to pass.

So: when a fix adds a guard to a shared entry point, enumerate the *other* entry
points to the same state and either cover them or say plainly that you did not.
`grep` for the state, not for the function you just edited -- the holdings lock
went into two of six mutators and the test went into the one that already had it.

This is now in `backend/CLAUDE.md` beside the harness rule, because it is the
generalisation of what a scanning guard does: a rule that a machine checks over
every call site cannot be satisfied by one.

### 12.9 Recommended next steps, in order

1. **Add the local/S3 attachment round trip** (RFR7-006). The last open
   missing-test finding from the original audit, and the one with data loss behind
   it.
2. **Run Playwright E2E** against a full stack on this exact SHA.
3. **Add the kind/k3d install job** with backup persistence through a pod
   replacement (RFR7-007).
4. **Move the release to a version-bump PR** (RFR7-005).
5. **Work P4-008 through P4-018** on the harness.
6. **Set `TZ=UTC` explicitly in CI** (DR-04).

### 12.10 Commits, round three

| SHA | Subject |
|---|---|
| `fb56a3ea` | Close the three HIGH findings from the re-review |
| `4e02a1e5` | Merge origin/main into the remediation branch |

---

## 13. Fourth round - re-review (`monize-audit-07-remediation-review.md`, re-review at `ebda4609`)

The fourth review confirmed the three round-three HIGHs closed and the harness
credible, then found **one more HIGH and one more MEDIUM** -- one a gap the
previous rounds left in a fix they declared done, the other a defect *introduced*
by the round-three locking. Both are now closed.

The through-line from round three held again: R4-001 is round three's own
scheduled-post fix, migrated at three call sites and left optional at the public
boundary. R4-002 is the cost of adding a lock without checking the order every
holder acquires it in. Neither is a new subsystem; both are the edge of a change
already made.

### Disposition of the fourth review's findings

| ID | Severity | Reproduced? | Outcome |
|---|---|---|---|
| R4-001 | **HIGH** | Yes | **Fixed.** `expectedNextDueDate` required at the DTO and the service; no "post current" fallback |
| R4-002 | MEDIUM | Yes | **Fixed.** Transfer create/edit/delete lock the whole account set up front, in sorted order |
| R4-003 | MEDIUM | Yes | **Still partly fixed.** Release provenance; unchanged; see 13.3 |
| R4-004 | MEDIUM | Yes | **Still open.** Attachment byte round trip; see 13.3 |
| R4-005 | MEDIUM | Yes | **Still partly fixed.** Helm cluster install; see 13.3 |
| DR4-001 | design risk | - | **Acknowledged.** Hard-link support is now a backup storage requirement; see 13.4 |
| DR4-002 | design risk | - | **Narrowed, not eliminated.** Auto-post treats any `ConflictException` as superseded; see 13.4 |

### 13.1 R4-001 - the public post endpoint is idempotent now, not just the first-party callers

Round three's mistake here was the same shape as its other three: the fix reached
the callers the test exercised (cron, list, dialog) and stopped at the public
boundary, which no first-party caller crosses but a retry, a double-submit, or a
third-party integration does. The reviewer's reproduction is exact: `POST
/scheduled-transactions/:id/post` with `{}`, the server posts April and advances
to May, the response is lost, the client retries `{}`, and the fallback reads May
and posts it -- `-2,400.00` for a `-1,200.00` bill, next due `2026-06-15`.

`expectedNextDueDate` is now **required**:

- at the DTO, so the global `ValidationPipe` rejects a body without it with a
  `400` before it reaches the service;
- in the service, which throws rather than falling back -- the cron is an internal
  caller that never touches the DTO, and a future internal caller that omitted the
  field would silently reopen the hole, so the guard lives at both layers;
- in the frontend type and API wrapper, so the compiler forces both call sites to
  pass it and the API cannot be invoked without it.

There is no "post current" path. A caller that does not know which occurrence it
means has no business posting a payment, and the review's suggested compatibility
escape hatch (a versioned "post current" endpoint) is deliberately not built,
because it would be the same foot-gun under a second name.

**Where the proof runs matters, and is a finding in itself.** The obvious place
for this is an HTTP controller test -- and there are four `test/*.e2e-spec.ts`
files that look like the pattern. But **CI runs none of them**: the backend jobs
run `test:unit`, `test:integration` (only `test/integration/`), and `test:cov`,
so a test in `test/` root is dead weight, and indeed `transactions.e2e-spec.ts`
does not even compile in this environment without anyone noticing. So the proof
is placed where CI executes it: a DTO validation spec under `src/` (runs in
`test:unit`) asserts the required-field rejection that the ValidationPipe enforces
on the route, and the integration suite (runs against real PostgreSQL) asserts a
no-occurrence call is refused and writes nothing, and that a named retry is a
`409`.

### 13.2 R4-002 - the round-three lock had no order, so it deadlocked

RFR7-003 gave every holdings mutator an account lock. But a security transfer
runs two mutators -- a `TRANSFER_OUT` locking the source and a `TRANSFER_IN`
locking the destination -- so it acquires the pair source-then-destination. A
simultaneous reverse transfer acquires destination-then-source, and the two form
a lock cycle PostgreSQL breaks by aborting one with `40P01`. A valid transfer
fails for a reason invisible to the user.

The single-account mutators locking themselves is correct and stays; what was
missing is that an operation touching **two** accounts must take both before
either. `lockAccountsForHoldings` is now public, and the transfer create, edit
and delete paths call it with the full affected set (both legs' accounts, plus
any account an edit reroutes to) at the top of their transaction, in the sorted
order the helper already used for rebuilds. The per-leg locks that follow re-take
rows already held -- a no-op -- so the up-front sorted acquisition is the order
every transfer now shares.

The race fires 16 A->B and 16 B->A transfers at once. It is a stress test, not a
gated one, and the file says why: a deterministic deadlock needs each transaction
paused *between* its two lock acquisitions, and `transferSecurity` has no seam
there that a test could reach without deforming production code for the test's
benefit. With the fix it is deterministically deadlock-free; reverting the
up-front lock aborts **31 of 32** legs with `40P01`, which is the positive
control.

### 13.3 Still open after round four

| Item | Status | Why |
|---|---|---|
| **R4-003 / P7-007** - release pushes an unverified SHA | **Partly fixed, unchanged** | The provenance gate constrains the bump's diff and parent; the pushed commit still is not the one the checks ran on. The fix is a release-process change (bump in a PR, full graph on that SHA), not a patch to fold into this branch |
| **R4-004 / P7-009** - attachment byte round trip | **Open** | Still no test that seeds bytes in a local and an S3-compatible provider, exports, restores into remapped ids, downloads through the public path and compares hashes, nor injects a mid-copy failure. The highest-value item left, and the one with data loss behind it |
| **R4-005 / P7-010** - cluster install | **Partly fixed** | Lint, renders, YAML parse, PyYAML and a release dependency are in CI. No kind/k3d install, no backup persistence through a pod replacement; the Helm job has never executed in this environment |
| Playwright E2E | **Not run** | No browser stack here |
| P4-008 - P4-018 | **Open** | The audit's concurrency backlog beyond the named races. The harness exists |
| Section 7.2 "test not located" register | **Open** | 40+ items |

### 13.4 The two design risks the review raised

- **DR4-001 - hard links are now a backup storage requirement.** The same-second
  fix publishes by `link`, which some network or object-backed filesystems do not
  support even within one directory. This is not a defect on the supported
  deployment matrix (a local PVC), but it is a real constraint, and it is recorded
  here rather than left implicit: the automatic-backup directory must support
  same-directory hard links. The kind/k3d persistence test (R4-005), when it
  exists, is where that should be exercised. If a provider-neutral
  exclusive-create is ever needed, `open(O_CREAT|O_EXCL)` on the final name is the
  portable equivalent.
- **DR4-002 - auto-post treats any `ConflictException` as "superseded".** The cron
  swallows a `ConflictException` from the posting path as a benign already-posted,
  which is correct for the occurrence-precondition conflict but would mis-classify
  a different downstream conflict if one were ever introduced. No such conflict
  exists on the path today, so this is narrowed to a design risk rather than a
  finding; a dedicated superseded-occurrence error type would close it and is
  worth doing when the posting path next changes.

### 13.5 Verification status, round four (on the merge result)

| Check | Result |
|---|---|
| Backend unit (`TZ=UTC npm run test:unit`) | **408 suites, 10,907 tests, all passing** |
| Backend integration (real PostgreSQL 16.13) | **29 suites, 317 tests, all passing** |
| Frontend Vitest | **634 files, 12,413 tests, all passing** |
| Migration idempotency lint | **125 files, passing** |
| Backend + frontend lint, `tsc --noEmit` | Clean (one pre-existing `Combobox` warning) |
| i18n freshness + parity, both layers | Passing (the new `errors.scheduled.occurrenceRequired` in all 18 locales) |
| Playwright E2E | **Not run** - no browser stack |
| Helm CI job | **Not executed** - no `helm` binary here |

Both R4-001 and R4-002 were checked by reintroducing the defect: R4-001's
integration test fails (two transactions, a June due date) with the fallback
restored, and R4-002's race aborts 31 of 32 legs with the up-front lock removed.

### 13.6 The rule this round adds

Round three's rule was "a guard on one entry point is a guard on one entry
point." Round four adds two corollaries, both now in `backend/CLAUDE.md`:

- **A fix that migrates the callers is not a fix at the boundary.** R4-001's
  occurrence was threaded through every first-party caller and still left the
  public API unsafe, because the boundary a retry crosses is the DTO, not the
  callers. When an invariant must hold for *every* caller including ones you do
  not control, enforce it at the boundary (a required field, a validated type),
  not by visiting the callers you can see.
- **A lock has an order, and the order is part of the lock.** Adding
  `FOR UPDATE` to a mutator is half a decision; the other half is what order a
  caller that needs two of them acquires them in. Any operation taking more than
  one account lock takes the whole set once, sorted, up front -- and a new
  multi-account holdings path that acquires them incrementally is the R4-002
  deadlock again.

### 13.7 Commits, round four

| SHA | Subject |
|---|---|
| `21ba81ca` | Close the two defects from the fourth review |
