import { AsyncLocalStorage } from "node:async_hooks";
import { ServiceUnavailableException } from "@nestjs/common";
import type { DataSource } from "typeorm";
import {
  currentReportingRead,
  reportingExecutionBasis,
  withReportingRead,
  type ReportingBasis,
} from "./reporting-basis";

export interface BudgetRateGap {
  from: string;
  to: string;
  date: string;
  reason: string | null;
}
export interface KnownBudgetComponent {
  id: string;
  currency: string;
  date: string;
  knownSubtotal: number;
}
export interface PartialBudgetResult {
  fxComplete: false;
  total: null;
  result: null;
  currency?: string;
  knownComponents: KnownBudgetComponent[];
  missingRatePairs: BudgetRateGap[];
  detailsTruncated?: true;
  repair: "currency_rate_history";
  fetchAttempted: false;
}
export interface BudgetPartialScope {
  known: Map<string, KnownBudgetComponent>;
  gaps: Map<string, BudgetRateGap>;
  truncated: boolean;
}
const partialReads = new AsyncLocalStorage<{
  userId: string;
  scope: BudgetPartialScope;
}>();
/** Independent siblings receive their own accumulator; intentional nested calls join it. */
export function currentBudgetPartialScope(
  userId: string,
): BudgetPartialScope | undefined {
  const value = partialReads.getStore();
  return value?.userId === userId ? value.scope : undefined;
}

class BudgetPartialSignal extends ServiceUnavailableException {
  constructor() {
    super({ code: "REPORTING_FX_INCOMPLETE" });
  }
}
/** Stop optional advice/provider work only after all actuals of this phase have been inspected. */
export function stopIncompleteBudgetRead(userId: string): void {
  if (currentBudgetPartialScope(userId)?.gaps.size)
    throw new BudgetPartialSignal();
}
const DETAIL_LIMIT = 1000;

/** Query subtotals remain separate: overlapping queries must never become a headline. */
export function recordBudgetComponent(
  userId: string,
  id: string,
  currency: string,
  date: string,
  amount: number | null,
  gap?: BudgetRateGap,
): void {
  const scope = currentBudgetPartialScope(userId);
  if (!scope) return;
  if (amount === null && gap) {
    const key = JSON.stringify(gap);
    if (scope.gaps.has(key) || scope.gaps.size < DETAIL_LIMIT)
      scope.gaps.set(key, gap);
    else scope.truncated = true;
  } else if (amount !== null) {
    if (scope.known.has(id) || scope.known.size < DETAIL_LIMIT)
      scope.known.set(id, { id, currency, date, knownSubtotal: amount });
    else scope.truncated = true;
  }
}

/** Only an explicit budget read boundary may return partial arithmetic; its calculated result is withheld on any FX gap. */
export function withPartialBudgetRead<T>(
  source: DataSource,
  userId: string,
  fn: () => Promise<T>,
  requested?: ReportingBasis,
): Promise<T | PartialBudgetResult> {
  return withReportingRead(
    source,
    userId,
    async () => {
      const context = currentReportingRead(userId)!;
      if (
        reportingExecutionBasis(userId) !== "accrual" ||
        currentBudgetPartialScope(userId)
      )
        return fn();
      const scope: BudgetPartialScope = {
        known: new Map(),
        gaps: new Map(),
        truncated: false,
      };
      return partialReads.run({ userId, scope }, async () => {
        let result: T | undefined;
        try {
          result = await fn();
        } catch (error) {
          if (!(error instanceof BudgetPartialSignal) || !scope.gaps.size)
            throw error;
        }
        if (!scope.gaps.size) return result as T;
        const pairs = [...scope.gaps.values()].sort((a, b) =>
          JSON.stringify(a).localeCompare(JSON.stringify(b)),
        );
        const components = [...scope.known.values()].sort(
          (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
        );
        const currencies = new Set([
          ...pairs.map((pair) => pair.to),
          ...components.map((component) => component.currency),
        ]);
        if (currencies.size !== 1) context.resultCurrency = undefined;
        return {
          fxComplete: false as const,
          total: null,
          result: null,
          ...(currencies.size === 1 ? { currency: [...currencies][0] } : {}),
          knownComponents: components,
          missingRatePairs: pairs,
          ...(scope.truncated ? { detailsTruncated: true as const } : {}),
          repair: "currency_rate_history" as const,
          fetchAttempted: false as const,
        };
      });
    },
    requested,
  );
}
