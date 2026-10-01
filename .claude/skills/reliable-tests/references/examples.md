# Worked examples

Each example is adapted to this repository and states the rule's source, the wrong test, the right test, and the defect the right test catches. The values were worked out by hand from the cited source; they are not copied from the code's output.

## 1. A boundary: the age limit of an exchange rate

Rule and source: a rate for a date is the newest observation on or before that date within `FX_MAX_RATE_AGE_DAYS` (45) days, otherwise unknown (INV-FX-001; the window is `[d - FX_MAX_RATE_AGE_DAYS, d]` in `backend/src/common/time-series/rate-index.util.ts`).

Wrong: one observation ten days old, `expect(result.rate).toBe(1.25)`. Every plausible boundary defect passes it.

Right: put a value on each side of each boundary, and work the day counts out in the test.

```ts
// For 2026-03-01: 2026-01-15 is 16 (rest of January) + 28 (February 2026) + 1 = 45 days old, inside.
// 2026-01-14 is 46 days old, outside. 2026-03-02 is after the date and is never used.
it.each([
  ["2026-01-15", { status: "resolved", rate: 1.25, ageDays: 45 }],
  ["2026-01-14", { status: "unknown", rate: null, reason: "stale_observation" }],
  ["2026-03-02", { status: "unknown", rate: null, reason: "only_after_date" }],
])("an observation dated %s, valued on 2026-03-01", (observedOn, expected) => {
  const result = resolveFxRate("EUR", "USD", "2026-03-01",
    lookupFrom({ "EUR->USD": [{ date: observedOn, rate: 1.25 }] }), { today: "2026-06-01" });
  expect(result).toMatchObject(expected);
});
```

Defects it catches: `>=` for `>` in the age test (day 45 becomes unknown), an off-by-one in the window start (day 46 becomes known), a look-ahead (the 2026-03-02 rate is used), and a fallback to rate 1 (status `resolved` with rate 1).

## 2. An expected value computed by the code under test

Rule and source: split amounts sum to the parent exactly at 4 decimal places (`docs/financial-semantics.md` section 5; `validateSplitAmountSum` in `backend/src/common/split-amount.util.ts`).

Wrong: the oracle repeats the implementation, so the test agrees with whatever the implementation does.

```ts
const accepted = sumMoney(splits.map((s) => s.amount)) === roundMoney(parent);
expect(attempt(splits, parent)).toBe(accepted);
```

Right: literals from the rule, including the case a plausible wrong rounding gets wrong.

```ts
// -3.3333 - 3.3333 - 3.3334 = -10.0000: equal at 4 dp, accepted.
expect(() => validateSplitAmountSum(amounts(-3.3333, -3.3333, -3.3334), -10)).not.toThrow();
// -3.3333 x 3 = -9.9999: not equal at 4 dp, refused.
// Rounding both sides to cents first would make it -10.00 = -10.00 and accept it.
expect(() => validateSplitAmountSum(amounts(-3.3333, -3.3333, -3.3333), -10)).toThrow(BadRequestException);
```

The same mistake in the frontend: `frontend/src/components/securities/SecurityList.test.tsx` builds the expected money text from `Intl.NumberFormat` with the locale the test sets, and the comment above its `money` helper says why it does not use `formatCurrency` from `@/lib/format`: the component used to call that helper, so a test using it as the oracle could only agree with it.

## 3. A user acting on another user's row

Rule and source: a service reads and writes only the caller's rows (`AGENTS.md`, security rules; `docs/backend/database-access-and-tenancy.md`). The neighbouring endpoints refuse a row the caller does not own with `NotFoundException`.

Wrong: a unit test whose mock returns `null` whatever it is asked.

```ts
accountsRepository.findOne.mockResolvedValue(null);
await expect(service.findOne("user-1", "account-1")).rejects.toThrow(NotFoundException);
```

It is the "not found" test under another name. Remove `userId` from the service's `where` and it still passes.

Right: an integration test in the shape of `backend/test/integration/security-cross-user-isolation.integration.spec.ts`, with a positive control added.

```ts
it("lets the owner rename the account, refuses user B, and leaves the row unchanged", async () => {
  // Positive control: the same call reaches the same path and succeeds for the owner.
  await withUserContext(userAId, () =>
    accountsService.update(userAId, accountA.id, { name: "Renamed by owner" }));

  await expect(withUserContext(userBId, () =>
    accountsService.update(userBId, accountA.id, { name: "PWNED" }))).rejects.toThrow(NotFoundException);

  const reloaded = await dataSource.manager.findOneOrFail(Account, { where: { id: accountA.id } });
  expect(reloaded.name).toBe("Renamed by owner");
  expect(reloaded.userId).toBe(userAId);
});
```

`createIntegrationModule` connects as the table owner, so RLS does not hide the defect: this tests the service's own predicate, which is what production runs with at the default `RLS_MODE=off`. Then ask the questions in `references/techniques.md`, "Identity, authorization and tenancy": the list, export, bulk and AI or MCP doors, ids in the body, delegates and joint accounts.

## 4. A proposal to weaken a test

Situation: after a change to the rate resolver, case 1 fails with `expected "resolved", received "unknown"` for the 45-day observation. The tempting fixes are to change the expectation to `unknown`, to replace `toMatchObject` with `toBeDefined()`, or to add `.skip`.

Right response: stop and classify before editing the test.

- The code regressed: the window is closed at 45 days in the source the test cites. Fix the code.
- The requirement changed: only the user can decide that. The contract text and INV-FX-001 change in the same PR, and the report names the approval.
- The test was wrong: show the source that defines the correct behaviour, and correct the test with that citation (VER-004).

Report what the test asserts, which source supports it, and what you propose. Do not edit the assertion first and explain afterwards.

## 5. A documentation-only change

Situation: fix a sentence and a path in `docs/backend/testing.md`.

Run only what reads the file: `cd backend && npm run test:unit -- src/common/doc-paths.spec.ts`, and `node scripts/check-docs-manifests.mjs` if a command or a compose file is named (`references/project-test-map.md`, "Documentation-only changes"). No oracle map, no mutation, no layer gate. The report:

```text
Scope and risk:  docs/backend/testing.md; documentation only
Commands:        cd backend && npm run test:unit -- src/common/doc-paths.spec.ts -> PASS
                 backend, frontend and E2E suites -> NOT RUN (documentation only)
```

## 6. A mutation run and how to read it

Ask which tests depend on the ownership predicate of `AccountsService.findOne`:

```bash
node .claude/skills/reliable-tests/scripts/mutation-probe.mjs \
  --file backend/src/accounts/accounts.service.ts \
  --find $'getRepository(Account).findOne({\n        where: { id, userId },' \
  --replace $'getRepository(Account).findOne({\n        where: { id },' \
  --cwd backend --runner jest -- npm run test:unit -- src/accounts/accounts.service.spec.ts
```

`--find` must match exactly once: `where: { id, userId },` alone occurs four times in that file, so the line before it is part of the text. Read the result line:

- KILLED: a test failed on an assertion. Check that the failing test is the one meant to catch this defect, and that its message is about the behaviour.
- SURVIVED: no test noticed. Decide: a real gap (write the test, here at the integration level), an equivalent mutation, behaviour outside the contract, or a tool problem. Write the decision in the report.
- INVALID: the run did not test behaviour (a compile error, a suite that did not load, fewer tests than the baseline). Change the mutation; it is not a result.
- BASELINE-RED: the unmutated tests already fail. Fix that first.

To ask the same question of the integration test, end the command with `npx jest --config ./test/jest-e2e.json --testPathPatterns=test/integration/security-cross-user-isolation` instead; that run needs PostgreSQL (`references/project-test-map.md`, "Environment"). Do not use `npm run test:integration -- <regex>` here: it runs every integration suite.

Observed on 2026-10-01 (base `3cac8b8`): the unit spec let this mutation survive (224 tests, none failed), because its mocks ignore the `where`; the integration suite killed it (4 of 43 tests failed, among them "findOne(userB, userA.account.id) throws NotFoundException"). That is example 3 measured: the mocked refusal proved nothing, the real-database refusal did.
