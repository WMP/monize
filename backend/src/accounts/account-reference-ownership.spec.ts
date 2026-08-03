import { readFileSync } from "fs";
import { join } from "path";
import { getMetadataStorage } from "class-validator";
import { CreateAccountDto } from "./dto/create-account.dto";
import { UpdateAccountDto } from "./dto/update-account.dto";

/**
 * Guard: an account field naming another user-owned row is checked for tenant
 * ownership before it is stored.
 *
 * Every `*Id` property on the account DTOs points at a row in another table the
 * requester may or may not own -- an institution, a category, a payee, another
 * account. The foreign key behind it only checks *existence*, so assigning one
 * unvalidated lets an authenticated caller wire their account to another
 * tenant's row. `overpaymentPayeeId` shipped that way (REV-20260803-002): the
 * FK is `ON DELETE SET NULL`, so the victim deleting their own payee reached
 * across and mutated the attacker's account.
 *
 * The fix is an `assert<Entity>Owned(userId, dto.<field>)` call beside the
 * assignment, the shape `assertInstitutionOwned` already established in
 * `accounts.service.ts`. This test finds the next unguarded reference field
 * automatically rather than trusting the next author to remember, in the shape
 * of `common/array-bound-dto.spec.ts`.
 *
 * Source-shaped rather than behavioural on purpose. The claim is mechanical --
 * "this field reaches an ownership assertion" -- and a behavioural sweep would
 * have to drive `create`/`update` once per field through the full mock harness,
 * which is both slower and blind to the fields whose assignment sits on a code
 * path the mocks do not reach. The behaviour of the payee check itself is
 * covered in `accounts.service.spec.ts`.
 */

/** `accounts.service.ts` with runs of whitespace collapsed, so the regexes below
 * are indifferent to how Prettier chose to wrap an argument list. */
function serviceSource(): string {
  return readFileSync(join(__dirname, "accounts.service.ts"), "utf8").replace(
    /\s+/g,
    " ",
  );
}

/**
 * Reference properties on the account DTOs: every validated property whose name
 * ends in `Id`. Read from class-validator metadata rather than the source so a
 * property added to either DTO -- including one inherited from a base class or
 * a `PartialType` -- is discovered without touching this file.
 */
function referenceProperties(): string[] {
  const storage = getMetadataStorage();
  const found = new Set<string>();
  for (const cls of [CreateAccountDto, UpdateAccountDto]) {
    for (const meta of storage.getTargetValidationMetadatas(
      cls,
      "",
      false,
      false,
    )) {
      if (/Id$/.test(meta.propertyName)) found.add(meta.propertyName);
    }
  }
  return [...found].sort();
}

/**
 * Whether `field` is passed to an ownership assertion anywhere in the service.
 * Matches on the assertion's *argument*, so a check written for one field
 * cannot be mistaken for a check on its neighbour -- which is the failure this
 * guard exists to catch.
 */
function hasOwnershipAssertion(source: string, field: string): boolean {
  const pattern = new RegExp(
    // assertXOwned(userId, <accountData|createAccountDto|updateAccountDto>.field)
    String.raw`assert\w+Owned\( *\w+, *\w+\.${field}\b`,
  );
  return pattern.test(source);
}

/**
 * Reference fields assigned without an ownership check before this guard
 * existed. Each is a real cross-tenant exposure of the same shape as
 * REV-20260803-002, but closing one changes authorization behaviour for an
 * endpoint this finding did not cover, so they are recorded rather than fixed
 * blind -- the categories in particular need a decision about whether a
 * dangling id should be rejected or silently cleared.
 *
 * The list may only shrink: add the `assert<Entity>Owned` call and remove the
 * entry. New properties never join it.
 */
const PREEXISTING_UNCHECKED: readonly string[] = [
  "assetCategoryId",
  "interestCategoryId",
  "linkedLoanAccountId",
  "principalCategoryId",
  "sourceAccountId",
];

describe("account reference ids are checked for tenant ownership", () => {
  it("finds the reference properties, so the sweep is not vacuous", () => {
    // Were the discovery to break, the sweep below would pass over an empty
    // list and this guard would silently stop guarding.
    expect(referenceProperties()).toContain("overpaymentPayeeId");
    expect(referenceProperties().length).toBeGreaterThan(1);
  });

  it("requires an ownership assertion for every reference id not grandfathered above", () => {
    const source = serviceSource();
    const offenders = referenceProperties().filter(
      (field) =>
        !hasOwnershipAssertion(source, field) &&
        !PREEXISTING_UNCHECKED.includes(field),
    );
    // Add `await this.assert<Entity>Owned(userId, dto.<field>)` beside the
    // assignment. Do not extend the grandfather list -- it exists for fields
    // older than the guard.
    expect(offenders).toEqual([]);
  });

  it("keeps the grandfather list free of fields that are now checked", () => {
    // The teeth: a field that gained its check (or no longer exists) has to
    // leave the list, so the list can only ever get shorter.
    const source = serviceSource();
    const known = new Set(referenceProperties());
    const stale = PREEXISTING_UNCHECKED.filter(
      (field) => !known.has(field) || hasOwnershipAssertion(source, field),
    );
    expect(stale).toEqual([]);
  });

  // The specific regressions: a field has to be asserted on *each* entry point
  // that can store it, not just one. A single-path fix would satisfy the sweep
  // above -- which only asks that the field reach an assertion somewhere --
  // while leaving the other door open.
  it.each([
    ["overpaymentPayeeId", "assertPayeeOwned"], // REV-20260803-002
    ["overpaymentCategoryId", "assertCategoryOwned"], // REV-20260803-021
  ])("checks %s on both create and update", (field, assertion) => {
    const source = serviceSource();
    expect(source).toMatch(
      new RegExp(String.raw`${assertion}\( *userId, *accountData\.${field}\b`),
    );
    expect(source).toMatch(
      new RegExp(
        String.raw`${assertion}\( *userId, *updateAccountDto\.${field}\b`,
      ),
    );
  });
});
