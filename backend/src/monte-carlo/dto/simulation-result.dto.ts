export interface SimulationPercentiles {
  p10: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p90: number[];
}

export interface FinalDistributionStats {
  min: number;
  max: number;
  mean: number;
  median: number;
  stdev: number;
  /** Probability the user fully depletes the portfolio before the horizon ends. */
  depletionRate: number;
}

/** Single scalar metric summarised across all simulations as five percentiles. */
export interface PercentileBand {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

/**
 * Per-simulation performance statistics, summarised across simulations as
 * percentile bands. Each metric is computed independently for every Monte
 * Carlo path; the bands are then sorted percentiles of those per-path values.
 *
 * Returns are decimals (0.05 = 5%); drawdowns and withdrawal rates are
 * decimals too (-0.20 = 20% drawdown, 0.04 = 4% withdrawal). Balances are in
 * the simulation currency.
 */
export interface PerformanceSummary {
  twrNominal: PercentileBand;
  twrReal: PercentileBand;
  endBalanceNominal: PercentileBand;
  endBalanceReal: PercentileBand;
  meanReturnNominal: PercentileBand;
  annualizedVolatility: PercentileBand;
  maxDrawdown: PercentileBand;
  maxDrawdownExcludingCashflows: PercentileBand;
  safeWithdrawalRate: PercentileBand;
  perpetualWithdrawalRate: PercentileBand;
}

export interface SimulationResult {
  yearLabels: string[];
  /** Median trajectory equals percentiles.p50 — duplicated for chart convenience. */
  percentiles: SimulationPercentiles;
  /** Distribution stats of the final-year balance. */
  finalDistribution: FinalDistributionStats;
  /** Per-simulation performance metrics summarised as percentile bands. */
  performanceSummary: PerformanceSummary;
  /** null if no targetValue was supplied; otherwise share of paths where final >= target. */
  successRate: number | null;
  /** Echo of the inputs that produced this result. Lets the UI show "ran with…". */
  inputsSnapshot: Record<string, unknown>;
  /** Whether values are deflated to today's value (real terms). */
  realValues: boolean;
  ranAt: string;
}
