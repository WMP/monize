import { Account } from './account';
import { Payee } from './payee';
import { Category } from './category';
import { Tag } from './tag';
import { InvestmentAction, Security } from './investment';
import { SplitKind, InvestmentSplitDetails } from './transaction';

/**
 * Every frequency a scheduled transaction can have, ordered shortest period
 * first -- the order the selector renders them in. Mirrors the backend's
 * `FrequencyType` enum (`create-scheduled-transaction.dto.ts`); the stepping
 * maths lives in `@/lib/frequency`.
 *
 * Declared as a const tuple so `z.enum(FREQUENCY_VALUES)` in the form derives
 * from it instead of repeating the list.
 */
export const FREQUENCY_VALUES = [
  'ONCE',
  'DAILY',
  'WEEKLY',
  'BIWEEKLY',
  'EVERY4WEEKS',
  'SEMIMONTHLY',
  'MONTHLY',
  'EVERY2MONTHS',
  'QUARTERLY',
  'SEMIANNUAL',
  'YEARLY',
] as const;

export type FrequencyType = (typeof FREQUENCY_VALUES)[number];

export interface ScheduledTransactionSplit {
  id: string;
  scheduledTransactionId: string;
  kind?: SplitKind;
  categoryId: string | null;
  category: Category | null;
  transferAccountId: string | null;
  transferAccount: Account | null;
  amount: number;
  memo: string | null;
  tags?: Tag[];
  // Investment-split fields
  investmentAction?: InvestmentAction | null;
  investmentSecurityId?: string | null;
  investmentSecurity?: Security | null;
  investmentQuantity?: number | null;
  investmentPrice?: number | null;
  investmentCommission?: number | null;
  investmentExchangeRate?: number | null;
  createdAt: string;
}

export interface ScheduledTransaction {
  id: string;
  userId: string;
  accountId: string;
  account: Account | null;
  name: string;
  payeeId: string | null;
  payee: Payee | null;
  payeeName: string | null;
  categoryId: string | null;
  category: Category | null;
  amount: number;
  currencyCode: string;
  // Foreign-currency entry. When originalCurrencyCode is set, originalAmount is
  // the fixed amount the biller charges in that currency and `amount` is the
  // account-currency estimate derived from it at exchangeRate -- refreshed
  // daily from the latest rate, and re-derived for the posting date on posting.
  originalAmount: number | null;
  originalCurrencyCode: string | null;
  exchangeRate: number;
  description: string | null;
  frequency: FrequencyType;
  nextDueDate: string;
  startDate: string;
  endDate: string | null;
  occurrencesRemaining: number | null;
  totalOccurrences: number | null;
  isActive: boolean;
  autoPost: boolean;
  reminderDaysBefore: number;
  lastPostedDate: string | null;
  isSplit: boolean;
  isTransfer: boolean;
  transferAccountId: string | null;
  transferAccount: Account | null;
  isInvestment: boolean;
  investmentAction: InvestmentAction | null;
  investmentSecurityId: string | null;
  investmentSecurity: Security | null;
  investmentFundingAccountId: string | null;
  investmentFundingAccount: Account | null;
  investmentQuantity: number | null;
  investmentPrice: number | null;
  investmentCommission: number | null;
  investmentTotalAmount: number | null;
  investmentExchangeRate: number | null;
  tagIds?: string[];
  splits?: ScheduledTransactionSplit[];
  overrideCount?: number;
  nextOverride?: ScheduledTransactionOverride | null;
  futureOverrides?: ScheduledTransactionOverride[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduledTransactionSplitData {
  splitKind?: SplitKind;
  categoryId?: string;
  transferAccountId?: string;
  investment?: InvestmentSplitDetails;
  amount: number;
  memo?: string;
  tagIds?: string[];
}

export interface CreateScheduledTransactionData {
  accountId: string;
  name: string;
  payeeId?: string;
  payeeName?: string;
  categoryId?: string;
  amount: number;
  currencyCode: string;
  originalAmount?: number | null;
  originalCurrencyCode?: string | null;
  exchangeRate?: number;
  description?: string;
  frequency: FrequencyType;
  nextDueDate: string;
  startDate?: string;
  endDate?: string;
  occurrencesRemaining?: number;
  isActive?: boolean;
  autoPost?: boolean;
  reminderDaysBefore?: number;
  isTransfer?: boolean;
  transferAccountId?: string;
  isInvestment?: boolean;
  investmentAction?: InvestmentAction;
  investmentSecurityId?: string;
  investmentFundingAccountId?: string;
  investmentQuantity?: number;
  investmentPrice?: number;
  investmentCommission?: number;
  investmentTotalAmount?: number;
  investmentExchangeRate?: number;
  splits?: CreateScheduledTransactionSplitData[];
  tagIds?: string[];
}

export interface UpdateScheduledTransactionData extends Partial<CreateScheduledTransactionData> {}

// ==================== Override Types ====================

export interface OverrideSplit {
  splitKind?: SplitKind;
  categoryId: string | null;
  transferAccountId?: string | null;
  investment?: InvestmentSplitDetails;
  amount: number;
  memo?: string | null;
}

export interface ScheduledTransactionOverride {
  id: string;
  scheduledTransactionId: string;
  originalDate: string; // The original calculated occurrence date this override replaces
  overrideDate: string; // The actual date for this occurrence (may differ if date was changed)
  amount: number | null;
  categoryId: string | null;
  category?: Category | null;
  description: string | null;
  isSplit: boolean | null;
  splits: OverrideSplit[] | null;
  investmentQuantity: number | null;
  investmentPrice: number | null;
  investmentTotalAmount: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduledTransactionOverrideData {
  originalDate: string; // The original calculated occurrence date being overridden
  overrideDate: string; // The actual date for this occurrence
  amount?: number | null;
  categoryId?: string | null;
  description?: string | null;
  isSplit?: boolean | null;
  splits?: OverrideSplit[] | null;
  investmentQuantity?: number | null;
  investmentPrice?: number | null;
  investmentTotalAmount?: number | null;
}

export interface UpdateScheduledTransactionOverrideData {
  amount?: number | null;
  categoryId?: string | null;
  description?: string | null;
  isSplit?: boolean | null;
  splits?: OverrideSplit[] | null;
  investmentQuantity?: number | null;
  investmentPrice?: number | null;
  investmentTotalAmount?: number | null;
}

export interface OverrideCheckResult {
  hasOverrides: boolean;
  count: number;
}

export interface PostScheduledTransactionData {
  /**
   * The occurrence being posted, as the `nextDueDate` the caller is rendering.
   *
   * Required, and a precondition: the server returns 409 if the schedule has
   * moved past it. That is what makes a double-clicked Pay button or a retried
   * request post one payment instead of two consecutive periods -- there is no
   * "post current" fallback, so the type requires it and the API cannot be
   * called without it.
   */
  expectedNextDueDate: string;
  transactionDate?: string;
  amount?: number | null;
  // Foreign-currency schedules only: the amount in the entry currency for this
  // posting, and the rate to convert it at (defaults to the rate stored for the
  // posting date).
  originalAmount?: number | null;
  exchangeRate?: number | null;
  categoryId?: string | null;
  description?: string | null;
  referenceNumber?: string;
  isSplit?: boolean;
  splits?: OverrideSplit[];
  investmentQuantity?: number;
  investmentPrice?: number;
  investmentTotalAmount?: number;
}
