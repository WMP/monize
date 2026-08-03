# Monize Phase 7 Remediation - Tests, CI and the Implementation Defects Behind Them

## Report metadata

| Field | Value |
|---|---|
| Repository | `kenlasko/monize` |
| Source report | `monize-audit-07-tests-ci.md` (Phase 7 - Tests, CI, Required Checks, and Verification Coverage) |
| Audit baseline | `d5cea9bfa995885ba5198f9843359362927c0fd4` |
| Remediation base | `4e48a767` (88 commits after the audit baseline) |
| Branch | `claude/detailed-error-review-fixes-p8bwgy` |
| Commits | 6 |
| Files changed | 197 (+3605 / -751) |
| Mode | Read-write: every finding re-verified against the current tree before being acted on |
| Suites executed | Backend unit (10,735 passing), frontend Vitest (12,328 passing), both lints, both type-checks |
| Suites **not** executed | Backend integration and Playwright E2E - no PostgreSQL and no browser stack in this environment |

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
the report's only HIGH) - was **not attempted**; section 6 explains why and what
it would take.

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
| P7-008 | **HIGH** | Yes | **Not done.** See section 6 |
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

## 6. Not done, and why

### P7-008 - production-boundary concurrency harness (the audit's only HIGH)

**Not attempted.** The audit asks for a reusable harness with two or more
independently acquired PostgreSQL connections, explicit isolation and lock
timeouts, named barriers, and the ability to start two Nest scheduler instances -
then seven regression tests on top of it (P4-001 through P4-007), with P4-008
through P4-018 as backlog.

It is a substantial piece of test infrastructure, and there is no PostgreSQL in
this environment, so nothing built here could be run even once. A concurrency
harness that has never executed is worse than none: it would look like coverage.
This is the largest remaining item and should be its own change.

### The `useExchangeRates.convert` migration

`convertOrNull`, `convertToDefaultOrNull` and `canConvert` are the honest API and
the credit-utilization widgets use them. `convert` keeps its unconverted
fallback, because roughly fifty display call sites across the reports, dashboard
widgets and account pages consume it as a plain `number` and each needs its own
decision about how to show an unknown figure. Making it nullable produced 66
type errors across 27 files - tractable, but not something to do hastily
alongside everything else.

It is documented on the hook as a tracked defect with the contract section it
violates, and the test pinning it says it is pinned rather than endorsed. The
backend half - where the money is actually computed - is fixed. Affected files:
`app/accounts`, `app/dashboard`, `app/transactions`, `app/payees/[id]`,
`CashFlowForecastChart`, `ExpensesPieChart`, `IncomeExpensesBarChart`,
`UpcomingBills`, `GeographicAllocationWidget`, `SecurityTypeAllocationWidget`,
`SecuritySummaryCards`, `CategoryInfoWidget`, `PayeeInfoWidget`,
`TagKeyBreakdownChart`, and the currency-exposure, dividend, foreign-fee,
geographic, realized-gains, security-type and transaction-history reports.

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

## 10. Recommended next steps, in order

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
