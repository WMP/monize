/**
 * Payroll deduction rules, mirrored from
 * `backend/src/payroll-deductions/` (docs/specs/payroll-deductions.md).
 *
 * Every amount is a magnitude in the bill's account currency. `paidToDate`
 * is the server's reading of the ledger for the period containing today and
 * is never recomputed here; `remaining` is the room left under the maximum.
 */

export const PAYROLL_RESET_PERIODS = ['YEARLY'] as const;
export type PayrollResetPeriod = (typeof PAYROLL_RESET_PERIODS)[number];

/** Where the expected amount came from: the bill's own line, the user, or nowhere. */
export type ExpectedSource = 'line' | 'entered' | null;

/** The figures a rule carries on every surface (spec section 5.3). */
export interface PayrollDeductionFigures {
  periodStart: string;
  periodEnd: string;
  nextResetOn: string;
  paidToDate: number;
  remaining: number;
  /** Rows of the category in the period in another currency, not converted. */
  foreignCurrencyRows: number;
  currencyCode: string;
  /** `null` when neither a line nor an entered value gives one. */
  expectedPerPaycheque: number | null;
  expectedSource: ExpectedSource;
}

/** One rule as `GET /payroll-deductions` answers it. */
export interface PayrollDeductionRule extends PayrollDeductionFigures {
  id: string;
  userId: string;
  scheduledTransactionId: string;
  scheduledTransactionName: string;
  categoryId: string;
  categoryName: string;
  yearlyMaximum: number;
  resetPeriod: PayrollResetPeriod;
  resetDate: string;
  createdAt: string;
  updatedAt: string;
}

/** The field every scheduled bill carries (`ScheduledTransaction.payrollDeductions`). */
export interface ScheduledPayrollDeduction extends PayrollDeductionFigures {
  ruleId: string;
  categoryId: string;
  categoryName: string;
  yearlyMaximum: number;
}

export interface CreatePayrollDeductionRuleData {
  scheduledTransactionId: string;
  categoryId: string;
  yearlyMaximum: number;
  resetPeriod?: PayrollResetPeriod;
  resetDate: string;
  expectedPerPaycheque?: number | null;
}

export type UpdatePayrollDeductionRuleData = Partial<CreatePayrollDeductionRuleData>;

/** One category of a batch: what differs per deduction line of the bill. */
export interface PayrollDeductionLineData {
  categoryId: string;
  yearlyMaximum: number;
  expectedPerPaycheque?: number | null;
}

/** The most categories one batch names (`PAYROLL_BATCH_MAX_LINES` on the server). */
export const PAYROLL_BATCH_MAX_LINES = 50;

/**
 * `POST /payroll-deductions/batch`: several categories of one bill sharing a
 * reset, written in one transaction so a refused line leaves nothing behind.
 */
export interface CreatePayrollDeductionRulesData {
  scheduledTransactionId: string;
  resetPeriod?: PayrollResetPeriod;
  resetDate: string;
  lines: PayrollDeductionLineData[];
}

/**
 * `GET /payroll-deductions/suggest`: the bill's own line, else the magnitude
 * the category's deduction rows most often carry over the last year.
 */
export interface ExpectedAmountSuggestion {
  expectedPerPaycheque: number | null;
  expectedSource: 'line' | 'ledger' | null;
  /**
   * The maximum the ledger suggests: the last full period's total, or the
   * current period's when that is already higher; `null` when nothing was
   * collected or no reset date was sent.
   */
  yearlyMaximum: number | null;
  yearlyMaximumSource: 'previousPeriod' | 'currentPeriod' | 'currentPeriodCapped' | null;
}
