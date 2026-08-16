import { AccountType } from "./entities/account.entity";

export interface AccountTypeCapabilities {
  /** Participates in loan amortization, payment recalculation and scenarios. */
  loanLike: boolean;
  /** May own persisted loan-scenario rows. */
  supportsLoanScenarios: boolean;
  /** A payment schedule can allocate principal/interest against this account. */
  supportsLoanPaymentSchedule: boolean;
}

/**
 * Exhaustive financial capabilities for AccountType.
 *
 * The `satisfies Record<...>` check makes a new enum member a compile error;
 * the runtime contract spec catches frontend/generated or transpilation drift.
 */
export const ACCOUNT_TYPE_CAPABILITIES = {
  [AccountType.CHEQUING]: {
    loanLike: false,
    supportsLoanScenarios: false,
    supportsLoanPaymentSchedule: false,
  },
  [AccountType.SAVINGS]: {
    loanLike: false,
    supportsLoanScenarios: false,
    supportsLoanPaymentSchedule: false,
  },
  [AccountType.CREDIT_CARD]: {
    loanLike: false,
    supportsLoanScenarios: false,
    supportsLoanPaymentSchedule: false,
  },
  [AccountType.LOAN]: {
    loanLike: true,
    supportsLoanScenarios: true,
    supportsLoanPaymentSchedule: true,
  },
  [AccountType.MORTGAGE]: {
    loanLike: true,
    supportsLoanScenarios: true,
    supportsLoanPaymentSchedule: true,
  },
  [AccountType.INVESTMENT]: {
    loanLike: false,
    supportsLoanScenarios: false,
    supportsLoanPaymentSchedule: false,
  },
  [AccountType.CASH]: {
    loanLike: false,
    supportsLoanScenarios: false,
    supportsLoanPaymentSchedule: false,
  },
  [AccountType.LINE_OF_CREDIT]: {
    loanLike: true,
    supportsLoanScenarios: true,
    supportsLoanPaymentSchedule: true,
  },
  [AccountType.ASSET]: {
    loanLike: false,
    supportsLoanScenarios: false,
    supportsLoanPaymentSchedule: false,
  },
  [AccountType.OTHER]: {
    loanLike: false,
    supportsLoanScenarios: false,
    supportsLoanPaymentSchedule: false,
  },
} satisfies Record<AccountType, AccountTypeCapabilities>;

export function accountTypeHasCapability(
  accountType: AccountType,
  capability: keyof AccountTypeCapabilities,
): boolean {
  return ACCOUNT_TYPE_CAPABILITIES[accountType][capability];
}

export function supportsLoanScenarios(accountType: AccountType): boolean {
  return accountTypeHasCapability(accountType, "supportsLoanScenarios");
}

export function accountTypesWithCapability(
  capability: keyof AccountTypeCapabilities,
): AccountType[] {
  return Object.values(AccountType).filter((accountType) =>
    accountTypeHasCapability(accountType, capability),
  );
}
