/**
 * The pure decision behind the daily portfolio-movement notification
 * (`docs/specs/portfolio-movement-notifications.md`): given today's portfolio
 * value, the stored baseline, the day's external cash flow and the user's
 * threshold, decide whether to fire and what the new baseline is.
 *
 * Kept free of the database and the cron so the arithmetic and the
 * completeness/withhold policy (INV-PORTMOVE-001..006) are unit-testable in
 * isolation. The producer supplies the inputs and applies the result.
 */
import { roundMoney } from "../common/round.util";

/** A percentage is a ratio, not money -- never round it with `roundMoney` (4dp). */
export const PORTFOLIO_MOVE_PERCENT_DECIMALS = 2;

export interface MovementInputs {
  /** `getPortfolioSummary(...).valuationComplete` for today's run. */
  mvComplete: boolean;
  /** Today's portfolio value (holdings + cash) in the reporting currency. */
  mvToday: number;
  /** The reporting currency today's value is in. */
  currency: string;
  /** The stored baseline, or null when none has been captured. */
  baseline: { value: number; currency: string } | null;
  /** The day's external cash flow into the investment accounts. */
  flow: { complete: boolean; value: number };
  /** The user's threshold in percent; <= 0 or null means the alert is off. */
  movePercent: number | null;
}

export interface FiredMovement {
  /** The movement as a percentage of the baseline, rounded for display. */
  changePercent: number;
  /** `"up"` for a gain, `"down"` for a loss. */
  direction: "up" | "down";
  /** The movement in the reporting currency (mvToday - baseline - flow). */
  movementValue: number;
}

export interface MovementDecision {
  /** The alert to raise, or null (silent, withheld, or nothing to compare). */
  fire: FiredMovement | null;
  /**
   * The value to store as the new baseline, or null to leave the baseline
   * untouched. Null means the run was a no-op (incomplete value or flow): a
   * subtotal must never become a baseline (INV-PORTMOVE-001).
   */
  rebaselineTo: number | null;
}

const roundPercent = (value: number): number => {
  const factor = 10 ** PORTFOLIO_MOVE_PERCENT_DECIMALS;
  return Math.round(value * factor) / factor;
};

/**
 * Decide the movement outcome. The order of the guards is the spec's:
 *
 * 1. Value incomplete -> no-op (no alert, no rebaseline): a subtotal is unknown.
 * 2. Off (no threshold) -> no-op: nothing to maintain a baseline for.
 * 3. No baseline, or a reporting-currency change -> rebaseline, no alert.
 * 4. Flow incomplete -> no-op: an unconvertible contribution makes the movement
 *    unknown; do not rebaseline on an unknown run either.
 * 5. Baseline value 0 -> undefined percentage -> rebaseline, no alert.
 * 6. Otherwise compute movement = mvToday - baseline - flow, compare
 *    |movement / baseline| against the threshold (at full precision), and
 *    rebaseline to today whether or not it fired.
 */
export function decideMovement(input: MovementInputs): MovementDecision {
  if (!input.mvComplete) return { fire: null, rebaselineTo: null };
  if (input.movePercent == null || input.movePercent <= 0) {
    return { fire: null, rebaselineTo: null };
  }
  if (input.baseline == null || input.baseline.currency !== input.currency) {
    return { fire: null, rebaselineTo: input.mvToday };
  }
  if (!input.flow.complete) return { fire: null, rebaselineTo: null };
  if (input.baseline.value === 0) {
    return { fire: null, rebaselineTo: input.mvToday };
  }

  // The threshold compares at full precision, but the STORED movement is the
  // difference of three decimal(20,4) values, and the difference of two 4dp
  // decimals is not a 4dp decimal -- round the delta before it is persisted.
  const movement = input.mvToday - input.baseline.value - input.flow.value;
  const rawPercent = (movement / input.baseline.value) * 100;
  const fires = Math.abs(rawPercent) >= input.movePercent;
  return {
    fire: fires
      ? {
          changePercent: roundPercent(rawPercent),
          direction: rawPercent >= 0 ? "up" : "down",
          movementValue: roundMoney(movement),
        }
      : null,
    rebaselineTo: input.mvToday,
  };
}
