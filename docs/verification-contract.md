# Verification Contract

Which kind of test each invariant requires, and which CI job enforces it. The
repository has many tests, including real PostgreSQL suites; what it has not had
is a normative statement of *what kind* of test a given claim needs. That gap is
why several defects lived behind green suites, and why six tests were found
asserting the wrong outcome.

Related: `docs/testing-contract.md` lists the adversarial inputs to pick from
(dates, money precision, aggregation, currency conversion, ownership,
concurrency) so an author chooses from a list rather than recalling edge cases.
This document is about test *kind* and *placement*, not input selection.
`docs/system-invariants.md` defines the IDs used below.

## 1. The test kinds

| Kind | What it can prove | Where it lives |
| --- | --- | --- |
| Unit | Pure logic, arithmetic, sign and precision rules, validation branches | `backend/src/**/*.spec.ts`, `frontend/src/**/*.test.ts` |
| Source scan | That a mistake appears nowhere, rather than not in the one place tested | any suite; see `frontend/src/test/ui-conventions.test.ts` |
| PostgreSQL integration | Real constraints, cascades, triggers, RLS policies, SQL semantics | `backend/test/integration/*.integration.spec.ts` |
| Two connections | Lock ordering, statement snapshots, one-winner CAS, partial-index arbitration | same, with two `DataSource` connections and `Promise.all` |
| Two instances | Process-local state failing across replicas; cron claim mechanisms | same, two service instances over one database |
| Failpoint | Crash between an external effect and its commit | same, by throwing at the boundary |
| Provider round trip | Bytes actually written and readable; a truncated artifact refused | same, against local filesystem and S3 |
| E2E | The user-visible outcome, and browser/cache state | `e2e/tests/*.spec.ts` |

## 2. What a mock cannot prove

A mocked repository can be made to return whatever a branch needs, which makes
that branch testable, tested, and dead. This is not hypothetical here:

- `mny-import-job.service.ts` carries a helper, `returnedRows`, that exists
  because a data-modifying statement with `RETURNING` comes back from
  `manager.query()` as `[rows, rowCount]` while a bare `SELECT` returns plain
  rows. Reading the tuple as `rows.length > 0` made **every** CAS attempt look
  like a winner. Its comment records that this was found by the concurrency
  spec -- the real-database one. No unit test could have found it, because the
  mock returned whatever shape the test author assumed.
- `gem-price.integration.spec.ts` states the same lesson about its own subject:
  with a mock, "every lost-race branch was dead, tested and unreachable."

So mocks are supporting evidence only for anything claiming a property of
PostgreSQL, of multiple processes, of a provider, or of browser state:

```text
VER-001
A test asserting that a service called `save`, `update` or `transaction` proves
the call, not the property. Where the invariant is a property of PostgreSQL,
multiple processes, a provider or the browser, a mock-based test is supporting
evidence and a production-boundary test is mandatory.

VER-002
A concurrency mechanism with only unit tests is untested. Two-connection means
two real connections interleaved, not two sequential calls on one.

VER-003
An invariant's entry in docs/system-invariants.md names its required tests. A
change that adds enforcement adds the required test in the same commit; a change
that cannot must say so in the pull request.
```

## 3. The matrix

`required` means the invariant is not verified without it. `supporting` means it
adds value but proves nothing on its own. `--` means not applicable.

| Invariant | Unit | Source scan | PG integration | Two connections | Two instances | Failpoint | Provider | E2E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INV-IMPORT-001 one active import | supporting | -- | required | **required** | required | supporting | -- | optional |
| INV-IMPORT-002 retry never doubles | supporting | -- | required | required | -- | **required** | -- | required |
| INV-IMPORT-003 category collision | supporting | -- | required | **required** | -- | -- | -- | -- |
| INV-BALANCE-001 balance equals ledger | supporting | -- | required | **required** | optional | required | -- | required |
| INV-HOLDING-001 holding replay | supporting | -- | required | **required** | optional | required | -- | optional |
| INV-HOLDING-002 one reducer | required | **required** | supporting | -- | -- | -- | -- | required |
| INV-TRANSFER-001 both legs | required | -- | required | optional | -- | -- | -- | required |
| INV-FX-001 no 1:1 fallback | **required** | **required** | required | -- | -- | required | optional | required |
| INV-OCCURRENCE-001 one effect | supporting | -- | required | required | **required** | required | -- | required |
| INV-OCCURRENCE-002 override price | required | -- | -- | -- | -- | -- | -- | required |
| INV-CLAIM-001 single-use claim | supporting | -- | required | **required** | optional | optional | -- | required |
| INV-AUTH-001 refresh rotation | supporting | -- | required | **required** | -- | -- | -- | optional |
| INV-AUTH-002 login counter | supporting | -- | required | **required** | -- | -- | -- | -- |
| INV-AUTH-003 OIDC round trip | required | -- | required | -- | -- | -- | required | required |
| INV-PROFILE-001 allowlist | required | **required** | supporting | -- | -- | -- | -- | -- |
| INV-MCP-001 credential binding | supporting | -- | required | -- | -- | -- | -- | -- |
| INV-CURRENCY-001 currency delete | supporting | **required** | required | required | -- | -- | -- | optional |
| INV-ATTACHMENT-001 bytes present | supporting | -- | required | optional | -- | **required** | **required** | required |
| INV-BACKUP-001 backup complete | supporting | -- | required | -- | optional | **required** | **required** | required |
| INV-CRON-001 one effect per tick | supporting | -- | required | required | **required** | optional | -- | -- |
| INV-RLS-001 role privilege | supporting | -- | **required** | -- | required | -- | -- | -- |
| INV-CACHE-001 cache invalidation | required | **required** | -- | -- | -- | -- | -- | required |
| INV-RELEASE-001 one revision | required | -- | -- | -- | -- | -- | -- | workflow self-test |

Bold marks the kind that is load-bearing -- the one whose absence means the
invariant is unverified no matter how many others pass. `INV-PROFILE-001`'s is a
source scan rather than a unit test because the defect arrives via a change to a
different file: a new entity column. `INV-FX-001` and `INV-HOLDING-002` need
scans for the same reason -- both are scattered across call sites, and every
previous fix corrected one and left the others.

## 4. CI ownership

Every required test must be reachable by a named job. The jobs that exist in
`.github/workflows/ci.yml`:

| Job | Runs | Owns |
| --- | --- | --- |
| `Backend Lint & Type Check` | eslint, tsc | the RLS lint bans, ban lists |
| `Backend Unit Tests` | `npm run test:unit -- --coverage` | unit, source scans in `backend/src` |
| `Backend Integration Tests` | `npm run test:integration` | PG integration, two-connection, two-instance, failpoint, provider round trip |
| `Frontend Unit Tests` | `npm run test:cov` | unit, source scans in `frontend/src` |
| `Frontend Lint & Type Check` | eslint, tsc | frontend conventions |
| `Schema vs Migrations Drift` | `scripts/verify-schema.sh` | migration replay is a no-op on `schema.sql` |
| `E2E Tests (shard N/4)` | Playwright, 4 shards | user-visible outcomes, browser cache state |
| `Lighthouse audit` | Lighthouse CI | accessibility and performance budgets |

Two structural points about this table:

**One job owns six test kinds.** `Backend Integration Tests` is where
two-connection, two-instance, failpoint and provider round-trip tests all live,
because they all need a real database. That makes it the single most important
job in the pipeline and the one whose silent failure is most costly -- which
brings us to the next point.

**That job can currently pass having run nothing.** `test:integration` carries an
unconditional `--passWithNoTests`, so a renamed directory or an edited
`testPathPatterns` regex turns a discovery failure into a green check across all
six kinds at once. `docs/release-integrity.md` REL-001 and REL-002 cover this;
it is repeated here because the consequence is a verification consequence, not
merely a CI hygiene one. There are 21 suites under
`backend/test/integration/` today, and nothing asserts that number does not
shrink.

## 5. Known-wrong tests

A green test is evidence only for the behaviour it asserts. If the assertion
encodes the defect, the test is a regression protector for the wrong outcome --
and it is worse than no test, because it will be cited as coverage.

```text
VER-004
A test that asserts current behaviour without a reason to believe it correct is
not coverage. When an invariant is found violated, search the suites for tests
asserting the violation and correct them in the same change -- they are why the
defect survived.
```

The instances found, and worth checking for when the corresponding invariant is
closed:

| Asserted | Invariant it protects the violation of |
| --- | --- |
| A missing exchange rate resolving to 1:1 | INV-FX-001 |
| An existing scheduled override price being overwritten | INV-OCCURRENCE-002 |
| Additive historical stock-split replay | INV-HOLDING-002 |
| A failed logout presented as successful | INV-AUTH-001 (logout path) |
| Unsafe backup naming expectations | INV-BACKUP-001 |
| `oidcIdToken: 'oidc-session-confirmed'` as a valid proof | INV-AUTH-003 |

The last one is the clearest case: the sentinel string is asserted in both
frontend and backend suites, so the tests do not merely tolerate the defect --
they specify it. Any change that implements a real OIDC round trip must change
these tests, which is exactly the friction that makes the defect look like a
decision.

Per root `CLAUDE.md`, each corrected unit test needs a production-boundary
companion wherever the defect depends on PostgreSQL, multiple processes,
providers or browser state. Correcting the assertion alone leaves the class open.

## 6. A green suite after a behaviour change is a finding

Restating `docs/financial-calculation-contract.md` section 8.1 because it is the
rule most often skipped: if you changed what the code produces and nothing
failed, either the change is a no-op or the suite had no case for it. Say which
in the change description, and if it is the second, add the case in the same
commit.

The corollary for this document: a test you have never seen fail protects
nothing. When adding a required test from section 3, run it against the
unfixed code first and confirm it fails for the right reason.

## 7. Running the suites so a green branch does not read as red

CI runs in UTC with one Playwright worker; a local run does neither, and both
differences produce failures that look like regressions and are not.

- `TZ=UTC npm run test:unit` matches CI. Some tests read `new Date()` and count
  completed periods against fixtures; under another offset they land on the wrong
  side of a boundary. `insights-aggregator.service.spec.ts` and
  `net-worth.service.spec.ts` are the ones that bite.
- `--workers=1` for the whole E2E suite. `playwright.config.ts` sets one worker
  only when `CI` is set, and `e2e/tests/zz-danger-zone.spec.ts` deletes the
  shared account -- the `zz-` prefix orders it last, which only means anything
  serially. A single spec file is safe without the flag.
- `scripts/verify-schema.sh` reproduces the drift job locally and needs only
  Docker.

Believing an unqualified local failure means chasing a bug that does not exist;
root `CLAUDE.md` has the longer form.

## 8. Definition of done

For a change that touches an invariant:

1. the invariant IDs are named in the pull request;
2. each required test from section 3 is added, or an existing one is cited by
   path and test name;
3. the load-bearing kind (bold in the matrix) is present, not substituted with a
   mock;
4. each new test was seen to fail against the unfixed code;
5. any test asserting the old, wrong behaviour is corrected in the same change;
6. the CI job from section 4 that enforces it is named;
7. the invariant's status in `docs/system-invariants.md` is updated, and the
   citation of the violation deleted if it no longer exists.
