# Techniques by risk

Choose a technique for the failure mode it can catch, not to raise a count. Each section says when to use it, how it is done in this repository, and where it misleads. The contract documents remain the source of every rule; this file only says how to test against them.

## Boundaries and invalid input

- Test each boundary from both sides: the last valid value, the first invalid one, and the boundary itself. `docs/testing-contract.md` has the canonical values for dates, money precision, collections, currency conversion, identifiers, strings and optional fields; take only the classes the code can receive.
- Keep `null`, `undefined`, an omitted property and an empty string apart: a form sends `""` for a field the user left alone.
- Send a value the API forbids through the real validation path (the DTO under the global `ValidationPipe`), not as a hand-built object past it.
- Text that is stored, compared, searched or truncated gets whitespace-only input, combining characters, the maximum length and one character over it.

## Identity, authorization and tenancy

A cross-user test is evidence only when all of these hold:

1. The other user's resource exists for real, created by its owner.
2. The request is valid and reaches the path under test: the same route or service method, a well-formed id, a body that passes validation. Otherwise a 400 or a 404 from a typo looks like a refusal.
3. Positive control: the owner's identical request succeeds.
4. The other user's request is refused with the kind of refusal the contract and the neighbouring endpoints use (for a row the caller does not own this is usually `NotFoundException`; check the endpoint, do not assume), and the response carries nothing of the row.
5. A reload through the owner shows that nothing changed: fields, revision, balances, child rows. No notification, job, email or push was produced.
6. The same holds at every door to the same data: list and search, detail, export, bulk update, import, the AI assistant tools and the MCP tools (one domain service behind both: `docs/backend/ai-and-payees.md`, "Shared AI tools"), and ids inside the body that name another user's account, category or payee.

Identities to consider: unauthenticated, another user, a delegate with a partial grant (READ versus WRITE, per account), a joint-account grantee, an administrator. `docs/backend/database-access-and-tenancy.md` says whose identity each read runs under.

Where it runs: the application predicate with `createIntegrationModule`, the RLS policy with `createEnforcedIntegrationModule`, the identity sequence with the `rls-context-smoke.spec.ts` pattern (`references/project-test-map.md`, "Choosing the level"). A refusal produced by a mock that returns `null` proves nothing about ownership.

## Illegal states and sequences

- Try the skipped step (confirm with nothing pending), the repeated step (double submit, a consumed token replayed), the late step (cancel after completion), the stale step (an old revision), and the duplicate (the same natural key twice).
- Model-based test: write a small model of the states and transitions the contract allows, run a sequence of operations against the real service, and compare the system with the model after every step, not only at the end. Example: create, edit, void and delete transactions and, after each step, check INV-BALANCE-001 (the stored balance equals the opening balance plus the included ledger rows) in the real database.

## Concurrency, retries, idempotency, atomicity

- `docs/concurrency-and-idempotency.md` decides the mechanism (sections 2 to 4) and the test obligation (section 9). Starting two calls "in parallel" does not reliably reproduce a race; force the interleaving with two real connections, a `FOR UPDATE` barrier with a wait for the blocked backend, or a deferred promise.
- Retry after an unknown outcome (CONC-006): let the effect commit, fail before the job is finalized (a failpoint), retry, and assert exactly one effect. `docs/verification-contract.md` section 3 explains why a failure inside the transaction does not test this.
- Idempotency: assert that the repeated request adds no effect AND that the first request had its effect; an implementation that does nothing passes the first half alone. This codebase has no generic idempotency-key mechanism: test the specific one the contract names (a claim row, a unique index, an upsert on a natural key).
- Atomicity and rollback: throw at the boundary, assert that nothing partial is left, and keep a control case without the failpoint that shows the operation does write.
- Effects outside PostgreSQL (EXT-001 to EXT-004 in `docs/external-side-effects.md`): bytes before the commit, deletes after it. A failure between them may leave unreferenced bytes, never a row that points at missing bytes. Test with a real temporary directory or a local fake endpoint.

## Dependency failures

- Provider or HTTP call: timeout, connection refused, a 5xx, a malformed body, an empty list, a quote in the wrong currency. The surface reports unknown and names the cause (`docs/financial-calculation-contract.md` section 1.3); it never shows zero, or a stale value as current.
- Database: a unique violation mapped to the documented refusal, a lock timeout, a lost connection in the middle of the operation.
- Partial work: N of M items done, then a failure. Which items committed, what the job state says, and whether a retry repeats the finished items.
- Fake the boundary (a local HTTP server, a typed double that returns what the real client returns, error shapes included). The base suite never needs the public internet.

## Generated inputs (property-based tests)

- No property-testing library is installed, and adding one is a dependency decision (`AGENTS.md`, "Ask first"). The repository's pattern is a seeded generator inside the test: the LCG in `backend/src/common/time-series/fx-rate-resolver.spec.ts`, `seeded()` in `frontend/src/test/rule-cel-support.ts`.
- A property must come from a source, never from a guess. Examples with sources: split children sum exactly to the parent at 4 decimal places (`docs/financial-semantics.md` section 5); converting between equal currency codes uses rate 1 without a lookup (INV-FX-001); printing and parsing a rule tree returns the same tree (`frontend/src/lib/rule-cel/roundtrip.test.ts`). Do not assume commutativity, invertibility or idempotency.
- Put the seed into the compared object, as `fx-rate-resolver.spec.ts` does, so that a failure names it. Reduce a failing input by hand to the smallest case that still fails, and commit that case as an example-based test.
- Fixed seeds keep CI deterministic, but they explore one corpus forever. While you work on the code, widen the seed range in your working copy (do not commit it) and run again.
- A property alone is weak: keep example-based tests with concrete expected values beside it. A generated-input run that does not crash proves no business rule.

## Metamorphic relations

Change the input in a controlled way whose effect on the output a contract states:

- adding a VOID transaction moves no balance (`docs/financial-semantics.md`, "VOID means no balance moved"; INV-TRANSFER-001);
- a presentation-only edit does not re-resolve a rate (`docs/financial-semantics.md` section 11);
- a repeat of an operation the contract makes idempotent adds no second effect;
- a number formatted in a locale and parsed back in the same locale is the same number at the displayed precision (`frontend/src/lib/number-parse.test.ts`, "round trip").

A relation without a source is a guess. Keep one example with an exact expected value beside each relation, because an implementation that ignores its input satisfies many relations.

## Differential tests and reference models

- Compare the implementation with an independent model written the slow, obvious way inside the test: `scanForBest` in `fx-rate-resolver.spec.ts` ("the same rules, written the slow way").
- Comparing two production implementations (`backend/src/transaction-rules/rule-glob-capture.spec.ts`) or the backend with the frontend through a shared case table catches drift, not a misunderstanding they share. Keep hand-checked examples beside the comparison.
- An old implementation used as the reference carries its known defects: list them and exclude those inputs explicitly.
- State the allowed difference (4 decimal places for money, 10 for rates) in the comparison. Do not absorb it in a loose tolerance.

## Migrations and compatibility

- `npm run migration:lint` and `scripts/verify-schema.sh` prove idempotency and agreement with `database/schema.sql`. They do not prove that existing rows are transformed correctly; the script's own comment says so.
- A data migration gets an integration test over legacy rows: recreate the old shape, seed every legacy state, apply the file from disk, assert the new state, then apply it again and assert that nothing changes (`backend/test/integration/migration-149-backfill.integration.spec.ts`).
- During a rolling deployment the previous release runs against the new schema (`database/CLAUDE.md`, "Expand now, contract in a later release"). A change that drops, renames or tightens needs evidence that the old code still works, which usually means a later release.
- An API shape change is checked against its consumers: `frontend/src/types/`, the MCP tools, the E2E specs (grep `e2e/` for a renamed control).

## Performance

- Only for a stated requirement or a known regression. Measure something stable: rows read, queries issued, calls made, growth with the input, a recorded memory peak. Never a tight millisecond budget on a shared runner.
- Patterns: a budget two orders of magnitude above the measured cost, so that it fails a return to work that grows with the input and not a slow machine ("keeps a day-by-day walk over a 26-year history off the event loop" in `fx-rate-resolver.spec.ts`); or an on-demand measurement with a committed record and a cheap guard beside it (`.github/workflows/restore-peak-rss.yml`, `backend/src/backup/restore-peak-rss.record.spec.ts`).

## Architecture and static rules

When the rule is "this must appear nowhere" or "every X goes through Y", write a source-scanning guard (`docs/guard-tests.md`): strip comments, test the scanner on known good and bad lines, and assert a minimum number of scanned files so that an empty scan cannot pass. Module edges are held by `backend/src/module-graph.spec.ts`, the banned database calls by `backend/eslint.config.mjs`.

## UI

- Assert what the user perceives: roles, labels, text, enabled or disabled state, and the request an action sends. Not implementation details.
- A component test with a mocked API module proves rendering and wiring. Persistence after a reload, and a server refusal shown to the user, are E2E questions.
- An unknown value renders as unknown and a known zero as a number (`frontend/CLAUDE.md`): test both.
- A response that arrives for an old selection must not overwrite the new one (`frontend/src/hooks/useReportData.test.ts`, "ignores a stale response when deps change mid-flight").
- The repository has no snapshot tests. A new snapshot is a deliberate comparison whose diff someone reads, never a replacement for domain assertions.

## Determinism

- Clock: pin it, and derive the pinned values from the constants the behaviour branches on (`docs/backend/testing.md`, "A test that reads the wall clock is a test about today's date"). Under Vitest fake timers, drain inside `act` (`docs/frontend/testing.md`).
- Time zone: `TZ=UTC`. DST cases apply only to timestamp logic.
- Randomness: seeded generators; E2E names use `crypto.randomInt` (`e2e/CLAUDE.md`).
- Network: mock every client a code path touches. jsdom's origin is the port the dev backend listens on, so an unmocked call can reach a real server (`docs/frontend/testing.md`, last section).
- Isolation: backend integration specs clean their tables (`cleanTables`), the frontend setup clears both storages, E2E uses one fresh user per test. A test passes alone and in any order.
- Waiting: wait for an observable condition with a time limit (`waitFor`, `findBy...`, Playwright's auto-waiting assertions, a poll of `pg_stat_activity`), never a fixed sleep. Wait for the thing you assert, not for static page chrome.
