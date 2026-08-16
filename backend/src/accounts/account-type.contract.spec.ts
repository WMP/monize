import { validateExhaustiveRecord } from "../common/financial-invariants/state-flow.contract";
import {
  ACCOUNT_TYPE_CAPABILITIES,
  accountTypesWithCapability,
  supportsLoanScenarios,
} from "./account-type.contract";
import { AccountType } from "./entities/account.entity";

const ACCOUNT_TYPES = Object.values(AccountType);

describe("AccountType financial capability contract", () => {
  it("classifies every enum member exactly once", () => {
    expect(
      validateExhaustiveRecord(
        ACCOUNT_TYPES,
        ACCOUNT_TYPE_CAPABILITIES,
        "account-type-capabilities",
      ),
    ).toEqual([]);
  });

  it("keeps loan, mortgage and line of credit in every loan-like capability", () => {
    const expected = [
      AccountType.LOAN,
      AccountType.MORTGAGE,
      AccountType.LINE_OF_CREDIT,
    ].sort();

    expect(accountTypesWithCapability("loanLike").sort()).toEqual(expected);
    expect(accountTypesWithCapability("supportsLoanScenarios").sort()).toEqual(
      expected,
    );
    expect(
      accountTypesWithCapability("supportsLoanPaymentSchedule").sort(),
    ).toEqual(expected);
  });

  it("does not classify credit cards as amortizing loan scenarios", () => {
    expect(supportsLoanScenarios(AccountType.CREDIT_CARD)).toBe(false);
    expect(supportsLoanScenarios(AccountType.LINE_OF_CREDIT)).toBe(true);
  });

  it("has a negative control: omitting LINE_OF_CREDIT fails exhaustiveness", () => {
    const mutated = { ...ACCOUNT_TYPE_CAPABILITIES } as Partial<
      Record<AccountType, unknown>
    >;
    delete mutated[AccountType.LINE_OF_CREDIT];

    expect(
      validateExhaustiveRecord(
        ACCOUNT_TYPES,
        mutated,
        "account-type-capabilities",
      ),
    ).toContainEqual({
      path: "account-type-capabilities.LINE_OF_CREDIT",
      message: "missing classification",
    });
  });
});
