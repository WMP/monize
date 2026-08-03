import {
  BadRequestException,
  ServiceUnavailableException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { tr } from "../i18n/translate";
import { DataSource, In } from "typeorm";
import { withScopedDb } from "../common/db/scoped-db";
import { MonteCarloScenario } from "./entities/monte-carlo-scenario.entity";
import { MonteCarloCashFlow } from "./entities/monte-carlo-cash-flow.entity";
import { CreateScenarioDto } from "./dto/create-scenario.dto";
import { UpdateScenarioDto } from "./dto/update-scenario.dto";
import { RunScenarioDto } from "./dto/run-scenario.dto";
import { CashFlowDto } from "./dto/cash-flow.dto";
import {
  CashFlowSpec,
  MonteCarloSimulationService,
} from "./monte-carlo-simulation.service";
import { SimulationResult } from "./dto/simulation-result.dto";
import { PortfolioService } from "../securities/portfolio.service";
import { SecurityPriceService } from "../securities/security-price.service";
import { Holding } from "../securities/entities/holding.entity";
import { Security } from "../securities/entities/security.entity";
import { Account } from "../accounts/entities/account.entity";
import { roundMoney } from "../common/round.util";

export interface HistoricalStats {
  /** Number of full calendar years of data used to compute the stats. */
  yearsObserved: number;
  /** Annualized arithmetic mean return, decimal (0.07 = 7%). null if not enough data. */
  meanReturn: number | null;
  /** Sample standard deviation of annual returns. null if not enough data. */
  volatility: number | null;
  /** Aggregate current market value of the selected accounts in the user's default currency. */
  /**
   * Today's value of the selected accounts, or `null` when it could not be
   * worked out. Not zero: a failed valuation and an empty selection are
   * different answers and the form has to tell them apart.
   */
  currentBalance: number | null;
}

export interface HoldingStat {
  symbol: string;
  name: string;
  currencyCode: string;
  quantity: number;
  marketValue: number;
  yearsObserved: number;
  meanReturn: number | null;
  volatility: number | null;
}

export interface AccountHoldingStats {
  accountId: string;
  accountName: string;
  currencyCode: string;
  holdings: HoldingStat[];
}

@Injectable()
export class MonteCarloService {
  private readonly logger = new Logger(MonteCarloService.name);

  constructor(
    private simulationService: MonteCarloSimulationService,
    private portfolioService: PortfolioService,
    private securityPriceService: SecurityPriceService,
    private dataSource: DataSource,
  ) {}

  async create(
    userId: string,
    dto: CreateScenarioDto,
  ): Promise<MonteCarloScenario> {
    const saved = await withScopedDb(this.dataSource, (m) => {
      const repo = m.getRepository(MonteCarloScenario);
      const scenario = repo.create({
        userId,
        name: dto.name,
        description: dto.description ?? null,
        accountIds: dto.accountIds,
        startingValue: dto.startingValue,
        useCurrentBalance: dto.useCurrentBalance,
        yearsToRetirement: dto.yearsToRetirement,
        annualContribution: dto.annualContribution,
        contributionGrowthRate: dto.contributionGrowthRate,
        yearsInRetirement: dto.yearsInRetirement,
        annualWithdrawal: dto.annualWithdrawal,
        expectedReturn: dto.expectedReturn,
        volatility: dto.volatility,
        inflationRate: dto.inflationRate,
        showRealValues: dto.showRealValues,
        useHistoricalReturns: dto.useHistoricalReturns,
        simulationCount: dto.simulationCount,
        targetValue: dto.targetValue ?? null,
        randomSeed: dto.randomSeed ?? null,
      });
      return repo.save(scenario);
    });
    await this.replaceCashFlows(saved.id, dto.cashFlows);
    return this.findOne(userId, saved.id);
  }

  async findAll(userId: string): Promise<MonteCarloScenario[]> {
    const scenarios = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(MonteCarloScenario).find({
        where: { userId },
        relations: ["cashFlows"],
        order: { isFavourite: "DESC", sortOrder: "ASC", updatedAt: "DESC" },
      }),
    );
    for (const s of scenarios) {
      if (s.cashFlows) {
        s.cashFlows.sort((a, b) => a.sortOrder - b.sortOrder);
      }
    }
    return scenarios;
  }

  async findOne(userId: string, id: string): Promise<MonteCarloScenario> {
    const scenario = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(MonteCarloScenario).findOne({
        where: { id, userId },
        relations: ["cashFlows"],
      }),
    );
    if (!scenario) {
      throw new NotFoundException(
        tr("errors.monteCarlo.scenarioNotFound", `Scenario ${id} not found`, {
          id,
        }),
      );
    }
    if (scenario.cashFlows) {
      scenario.cashFlows.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return scenario;
  }

  /**
   * Replace the cash-flow list on a scenario (delete-all + insert pattern,
   * since clients send the full list each time). Skipped when `flows` is
   * undefined so partial PATCH calls don't wipe the list accidentally.
   */
  private async replaceCashFlows(
    scenarioId: string,
    flows: CashFlowDto[] | undefined,
  ): Promise<void> {
    if (flows === undefined) return;
    await withScopedDb(this.dataSource, async (m) => {
      const repo = m.getRepository(MonteCarloCashFlow);
      await repo.delete({ scenarioId });
      if (flows.length === 0) return;
      const rows = flows.map((cf, idx) =>
        repo.create({
          scenarioId,
          name: cf.name,
          amount: cf.amount,
          flowType: cf.flowType,
          startYear: cf.startYear,
          endYear: cf.endYear ?? null,
          inflationAdjust: cf.inflationAdjust,
          sortOrder: idx,
        }),
      );
      await repo.save(rows);
    });
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateScenarioDto,
  ): Promise<MonteCarloScenario> {
    const scenario = await this.findOne(userId, id);

    // Explicit property mapping (no Object.assign — prevents mass assignment).
    if (dto.name !== undefined) scenario.name = dto.name;
    if (dto.description !== undefined)
      scenario.description = dto.description ?? null;
    if (dto.accountIds !== undefined) scenario.accountIds = dto.accountIds;
    if (dto.startingValue !== undefined)
      scenario.startingValue = dto.startingValue;
    if (dto.useCurrentBalance !== undefined)
      scenario.useCurrentBalance = dto.useCurrentBalance;
    if (dto.yearsToRetirement !== undefined)
      scenario.yearsToRetirement = dto.yearsToRetirement;
    if (dto.annualContribution !== undefined)
      scenario.annualContribution = dto.annualContribution;
    if (dto.contributionGrowthRate !== undefined)
      scenario.contributionGrowthRate = dto.contributionGrowthRate;
    if (dto.yearsInRetirement !== undefined)
      scenario.yearsInRetirement = dto.yearsInRetirement;
    if (dto.annualWithdrawal !== undefined)
      scenario.annualWithdrawal = dto.annualWithdrawal;
    if (dto.expectedReturn !== undefined)
      scenario.expectedReturn = dto.expectedReturn;
    if (dto.volatility !== undefined) scenario.volatility = dto.volatility;
    if (dto.inflationRate !== undefined)
      scenario.inflationRate = dto.inflationRate;
    if (dto.showRealValues !== undefined)
      scenario.showRealValues = dto.showRealValues;
    if (dto.useHistoricalReturns !== undefined)
      scenario.useHistoricalReturns = dto.useHistoricalReturns;
    if (dto.simulationCount !== undefined)
      scenario.simulationCount = dto.simulationCount;
    if (dto.targetValue !== undefined)
      scenario.targetValue = dto.targetValue ?? null;
    if (dto.randomSeed !== undefined)
      scenario.randomSeed = dto.randomSeed ?? null;
    if (dto.isFavourite !== undefined) scenario.isFavourite = dto.isFavourite;

    const saved = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(MonteCarloScenario).save(scenario),
    );
    await this.replaceCashFlows(saved.id, dto.cashFlows);
    return this.findOne(userId, saved.id);
  }

  async remove(userId: string, id: string): Promise<void> {
    const scenario = await this.findOne(userId, id);
    await withScopedDb(this.dataSource, (m) =>
      m.getRepository(MonteCarloScenario).remove(scenario),
    );
  }

  async reorder(userId: string, scenarioIds: string[]): Promise<void> {
    // Defensive: reject anything that isn't a proper array. The DTO validates
    // this via @IsArray + @ArrayMaxSize, but we re-check here so the invariant
    // holds for any caller (mirrors AccountsService.reorderFavourites).
    if (!Array.isArray(scenarioIds)) {
      throw new BadRequestException(
        tr(
          "errors.monteCarlo.scenarioIdsMustBeArray",
          "scenarioIds must be an array",
        ),
      );
    }
    await withScopedDb(this.dataSource, async (m) => {
      // for...of over .entries(), never `i < scenarioIds.length`: a request
      // value's .length must not bound a loop inside this closure (CWE-834,
      // CodeQL js/loop-bound-injection cannot see the isArray guard above
      // through the withScopedDb callback).
      for (const [i, scenarioId] of scenarioIds.entries()) {
        await m.update(
          MonteCarloScenario,
          { id: scenarioId, userId },
          { sortOrder: i },
        );
      }
    });
  }

  async runSaved(userId: string, id: string): Promise<SimulationResult> {
    const scenario = await this.findOne(userId, id);

    const startingValue = await this.resolveStartingValue(
      userId,
      scenario.accountIds,
      scenario.useCurrentBalance,
      scenario.startingValue,
    );

    const { expectedReturn, volatility } = await this.resolveReturns(
      userId,
      scenario.accountIds,
      scenario.useHistoricalReturns,
      scenario.expectedReturn,
      scenario.volatility,
    );

    const result = this.simulationService.run({
      startingValue,
      yearsToRetirement: scenario.yearsToRetirement,
      annualContribution: scenario.annualContribution,
      contributionGrowthRate: scenario.contributionGrowthRate,
      yearsInRetirement: scenario.yearsInRetirement,
      annualWithdrawal: scenario.annualWithdrawal,
      expectedReturn,
      volatility,
      inflationRate: scenario.inflationRate,
      showRealValues: scenario.showRealValues,
      simulationCount: scenario.simulationCount,
      targetValue: scenario.targetValue,
      randomSeed: scenario.randomSeed,
      cashFlows: (scenario.cashFlows ?? []).map(toCashFlowSpec),
    });

    scenario.lastRunAt = new Date();
    await withScopedDb(this.dataSource, (m) =>
      m.getRepository(MonteCarloScenario).save(scenario),
    );

    return result;
  }

  async runAdHoc(
    userId: string,
    dto: RunScenarioDto,
  ): Promise<SimulationResult> {
    const startingValue = await this.resolveStartingValue(
      userId,
      dto.accountIds,
      dto.useCurrentBalance,
      dto.startingValue,
    );

    const { expectedReturn, volatility } = await this.resolveReturns(
      userId,
      dto.accountIds,
      dto.useHistoricalReturns,
      dto.expectedReturn,
      dto.volatility,
    );

    return this.simulationService.run({
      startingValue,
      yearsToRetirement: dto.yearsToRetirement,
      annualContribution: dto.annualContribution,
      contributionGrowthRate: dto.contributionGrowthRate,
      yearsInRetirement: dto.yearsInRetirement,
      annualWithdrawal: dto.annualWithdrawal,
      expectedReturn,
      volatility,
      inflationRate: dto.inflationRate,
      showRealValues: dto.showRealValues,
      simulationCount: dto.simulationCount,
      targetValue: dto.targetValue,
      randomSeed: dto.randomSeed,
      cashFlows: (dto.cashFlows ?? []).map(toCashFlowSpec),
    });
  }

  /**
   * If `useHistorical` is true and the selected accounts have enough history,
   * substitute computed mean/volatility for the supplied values. Falls back
   * silently to the supplied values when historical data is insufficient.
   */
  private async resolveReturns(
    userId: string,
    accountIds: string[],
    useHistorical: boolean,
    fallbackReturn: number,
    fallbackVolatility: number,
  ): Promise<{ expectedReturn: number; volatility: number }> {
    if (!useHistorical || accountIds.length === 0) {
      return { expectedReturn: fallbackReturn, volatility: fallbackVolatility };
    }
    const stats = await this.getHistoricalStats(userId, accountIds);
    return {
      expectedReturn: stats.meanReturn ?? fallbackReturn,
      volatility: stats.volatility ?? fallbackVolatility,
    };
  }

  /** Brokerage and standalone investment accounts only — what UIs that drive
   * holdings-based simulations should show in their account picker. */
  async getBrokerageAccounts(userId: string) {
    return this.portfolioService.getBrokerageAccounts(userId);
  }

  /**
   * Computes annualized mean return and stdev from the user's investment
   * transaction history for the selected accounts. The user's "Use historical"
   * button calls this to prefill the form.
   *
   * Methodology: build a per-year value series from the running portfolio
   * value at each year-end, factoring out external cash flows (contributions
   * and withdrawals) so the return reflects asset performance, not deposits.
   * Money-weighted return per year:
   *
   *   r_t = (V_t - V_{t-1} - netFlow_t) / max(V_{t-1} + netFlow_t, eps)
   *
   * Returns null mean/volatility when there are fewer than 2 full years.
   */
  async getHistoricalStats(
    userId: string,
    accountIds: string[],
  ): Promise<HistoricalStats> {
    if (accountIds.length === 0) {
      throw new BadRequestException(
        tr(
          "errors.monteCarlo.atLeastOneAccountRequired",
          "At least one accountId is required",
        ),
      );
    }

    const currentBalance = await this.computeCurrentValue(userId, accountIds);

    // Build a value-weighted series of yearly returns from the price history
    // of currently held securities. This answers "what would my current mix
    // have returned year-over-year", which is what users expect when they
    // pick 'Use historical' on this report.
    const holdings = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(Holding).find({
        where: { accountId: In(accountIds) },
        relations: ["security"],
      }),
    );
    const active = holdings.filter(
      (h) => Math.abs(Number(h.quantity)) > 0.0001,
    );
    if (active.length === 0) {
      return {
        yearsObserved: 0,
        meanReturn: null,
        volatility: null,
        currentBalance,
      };
    }

    const securityIds = [...new Set(active.map((h) => h.securityId))];
    const yearlyReturns = await this.fetchYearlyReturnsBySecurity(securityIds);

    // Weight each security by its current market value (sum across accounts).
    const currentPrices =
      await this.portfolioService.getLatestPrices(securityIds);
    const weightBySec = new Map<string, number>();
    for (const h of active) {
      const price = currentPrices.get(h.securityId);
      if (price == null) continue;
      const value = Number(h.quantity) * price;
      weightBySec.set(
        h.securityId,
        (weightBySec.get(h.securityId) ?? 0) + value,
      );
    }

    // Compute portfolio yearly returns by combining per-security returns
    // weighted by current value. Years where no securities have data are
    // skipped.
    const allYears = new Set<number>();
    for (const r of yearlyReturns.values())
      for (const y of r.keys()) allYears.add(y);

    const portfolioReturns: number[] = [];
    for (const year of [...allYears].sort()) {
      let weightedReturn = 0;
      let totalWeight = 0;
      for (const [secId, returns] of yearlyReturns) {
        const r = returns.get(year);
        const w = weightBySec.get(secId);
        if (r === undefined || w === undefined || w <= 0) continue;
        weightedReturn += r * w;
        totalWeight += w;
      }
      if (totalWeight > 0) portfolioReturns.push(weightedReturn / totalWeight);
    }

    if (portfolioReturns.length < 2) {
      return {
        yearsObserved: portfolioReturns.length,
        meanReturn: null,
        volatility: null,
        currentBalance,
      };
    }

    const mean =
      portfolioReturns.reduce((a, b) => a + b, 0) / portfolioReturns.length;
    const variance =
      portfolioReturns.reduce((a, r) => a + (r - mean) ** 2, 0) /
      (portfolioReturns.length - 1);
    const stdev = Math.sqrt(variance);

    return {
      yearsObserved: portfolioReturns.length,
      meanReturn: Math.round(mean * 1_000_000) / 1_000_000,
      volatility: Math.round(stdev * 1_000_000) / 1_000_000,
      currentBalance,
    };
  }

  /**
   * Per-holding stats grouped by account. Used to show users what historical
   * returns/volatility they're picking up when "Use historical returns" is on.
   */
  async getHoldingStats(
    userId: string,
    accountIds: string[],
  ): Promise<AccountHoldingStats[]> {
    if (accountIds.length === 0) {
      throw new BadRequestException(
        tr(
          "errors.monteCarlo.atLeastOneAccountRequired",
          "At least one accountId is required",
        ),
      );
    }

    // Verify the requested accounts belong to the user before running queries
    // that don't carry their own userId clause.
    const accounts = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(Account).find({
        where: { id: In(accountIds), userId },
      }),
    );
    if (accounts.length === 0) return [];

    const holdings = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(Holding).find({
        where: { accountId: In(accounts.map((a) => a.id)) },
        relations: ["security"],
      }),
    );
    const active = holdings.filter(
      (h) => Math.abs(Number(h.quantity)) > 0.0001,
    );
    if (active.length === 0) {
      return accounts.map((a) => ({
        accountId: a.id,
        accountName: a.name,
        currencyCode: a.currencyCode,
        holdings: [],
      }));
    }

    const securityIds = [...new Set(active.map((h) => h.securityId))];
    const yearlyReturns = await this.fetchYearlyReturnsBySecurity(securityIds);
    const currentPrices =
      await this.portfolioService.getLatestPrices(securityIds);

    const grouped = new Map<string, HoldingStat[]>();
    for (const a of accounts) grouped.set(a.id, []);

    for (const h of active) {
      if (!grouped.has(h.accountId)) continue;
      const returns = yearlyReturns.get(h.securityId);
      const series = returns ? [...returns.values()] : [];
      const stats = computeMeanStdev(series);
      const price = currentPrices.get(h.securityId);
      grouped.get(h.accountId)!.push({
        symbol: h.security?.symbol ?? "?",
        name: h.security?.name ?? "Unknown",
        currencyCode: h.security?.currencyCode ?? "USD",
        quantity: Number(h.quantity),
        marketValue: price == null ? 0 : roundMoney(Number(h.quantity) * price),
        yearsObserved: series.length,
        meanReturn: stats.mean,
        volatility: stats.stdev,
      });
    }

    return accounts.map((a) => ({
      accountId: a.id,
      accountName: a.name,
      currencyCode: a.currencyCode,
      holdings: (grouped.get(a.id) ?? []).sort(
        (x, y) => y.marketValue - x.marketValue,
      ),
    }));
  }

  /**
   * Fetch year-end closing prices for the given securities and convert to
   * per-year returns. Returned map: securityId → Map<year, return>.
   */
  /** Skip provider backfill for any security we've asked about within this
   * window. Prevents the Monte Carlo report from re-hitting Yahoo / MSN on
   * every account-selection change for holdings whose history simply doesn't
   * span the full 10-year window. */
  private static BACKFILL_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

  private async fetchYearlyReturnsBySecurity(
    securityIds: string[],
  ): Promise<Map<string, Map<number, number>>> {
    if (securityIds.length === 0) return new Map();

    let yearlyReturns = await this.queryYearlyReturns(securityIds);

    // For securities with fewer than 10 yearly returns we backfill from the
    // provider — typically newer holdings whose local price history doesn't
    // yet span the full window we want for stable mean/volatility estimates.
    const sparseIds = securityIds.filter(
      (id) => (yearlyReturns.get(id)?.size ?? 0) < 10,
    );
    if (sparseIds.length === 0) return yearlyReturns;

    const securities = await withScopedDb(this.dataSource, (m) =>
      m.getRepository(Security).find({
        where: { id: In(sparseIds) },
      }),
    );
    const now = Date.now();
    const dueForBackfill = securities.filter((s) => {
      const last = s.historicalBackfillAttemptedAt;
      if (!last) return true;
      const lastMs =
        last instanceof Date ? last.getTime() : Date.parse(String(last));
      return (
        !Number.isFinite(lastMs) ||
        now - lastMs > MonteCarloService.BACKFILL_COOLDOWN_MS
      );
    });

    if (dueForBackfill.length === 0) return yearlyReturns;

    await Promise.all(
      dueForBackfill.map((s) =>
        this.securityPriceService
          .backfillSecurityRange(s, "10y")
          .catch((err) => {
            this.logger.warn(
              `Provider backfill failed for ${s.symbol}: ${err instanceof Error ? err.message : String(err)}`,
            );
            return 0;
          }),
      ),
    );

    // Stamp every security we attempted, regardless of whether the provider
    // actually returned new rows. The cooldown is about not hammering the
    // API, not about whether the data improved.
    await withScopedDb(this.dataSource, (m) =>
      m
        .getRepository(Security)
        .update(
          { id: In(dueForBackfill.map((s) => s.id)) },
          { historicalBackfillAttemptedAt: new Date() },
        ),
    );

    yearlyReturns = await this.queryYearlyReturns(securityIds);
    return yearlyReturns;
  }

  private async queryYearlyReturns(
    securityIds: string[],
  ): Promise<Map<string, Map<number, number>>> {
    // Prefer adjusted_close so dividends are reflected in the return; fall
    // back to raw close_price for providers / older rows that don't have it
    // populated. Net effect: total return when we have it, price-only when
    // we don't.
    const yearEndRows: Array<{
      security_id: string;
      year: string;
      close_price: string;
    }> = await withScopedDb(this.dataSource, (m) =>
      m.query(
        `SELECT DISTINCT ON (security_id, EXTRACT(YEAR FROM price_date))
         security_id,
         EXTRACT(YEAR FROM price_date)::text AS year,
         COALESCE(adjusted_close, close_price)::text AS close_price
       FROM security_prices
       WHERE security_id = ANY($1)
       ORDER BY security_id, EXTRACT(YEAR FROM price_date), price_date DESC`,
        [securityIds],
      ),
    );

    const pricesBySecurity = new Map<
      string,
      Array<{ year: number; price: number }>
    >();
    for (const row of yearEndRows) {
      const arr = pricesBySecurity.get(row.security_id) ?? [];
      arr.push({ year: Number(row.year), price: Number(row.close_price) });
      pricesBySecurity.set(row.security_id, arr);
    }

    const yearlyReturns = new Map<string, Map<number, number>>();
    for (const [secId, prices] of pricesBySecurity) {
      prices.sort((a, b) => a.year - b.year);
      const returns = new Map<number, number>();
      for (let i = 1; i < prices.length; i++) {
        const prev = prices[i - 1].price;
        const curr = prices[i].price;
        if (prev > 0) returns.set(prices[i].year, (curr - prev) / prev);
      }
      yearlyReturns.set(secId, returns);
    }
    return yearlyReturns;
  }

  /**
   * Today's value of the selected accounts, or `null` when it could not be
   * worked out.
   *
   * `null`, never 0. A valuation failure used to return zero, and a caller
   * cannot tell that from an account genuinely holding nothing: a 100,000
   * portfolio whose price lookup failed produced a retirement projection that
   * ran out of money in year one and presented it as a result. An empty
   * selection really is zero and stays zero -- that is a known state, and the
   * two must not share a value.
   */
  private async computeCurrentValue(
    userId: string,
    accountIds: string[],
  ): Promise<number | null> {
    try {
      const summary = await this.portfolioService.getPortfolioSummary(
        userId,
        accountIds,
      );
      const value = summary.totalPortfolioValue;
      // A non-finite total is an arithmetic failure upstream, not a balance.
      if (!Number.isFinite(value)) {
        this.logger.warn(
          `Portfolio value for accounts ${accountIds.join(",")} was not finite`,
        );
        return null;
      }
      return roundMoney(value);
    } catch (err) {
      this.logger.warn(
        `Failed to compute current portfolio value for accounts ${accountIds.join(",")}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * The starting value a run should use, refusing rather than guessing.
   *
   * A scenario set to start from the current balance cannot be simulated when
   * that balance is unknown: every percentile, every success rate and the
   * headline "money runs out in year N" would be an answer about a portfolio
   * that does not exist.
   */
  private async resolveStartingValue(
    userId: string,
    accountIds: string[],
    useCurrentBalance: boolean,
    storedStartingValue: number,
  ): Promise<number> {
    if (!useCurrentBalance || accountIds.length === 0) {
      return storedStartingValue;
    }
    const currentValue = await this.computeCurrentValue(userId, accountIds);
    if (currentValue === null) {
      throw new ServiceUnavailableException(
        tr(
          "errors.monteCarlo.currentBalanceUnavailable",
          "Your accounts could not be valued right now, so a simulation starting from the current balance cannot be run. Try again, or enter a starting value.",
        ),
      );
    }
    return currentValue;
  }
}

function computeMeanStdev(series: number[]): {
  mean: number | null;
  stdev: number | null;
} {
  if (series.length < 2) return { mean: null, stdev: null };
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  const variance =
    series.reduce((a, r) => a + (r - mean) ** 2, 0) / (series.length - 1);
  return {
    mean: Math.round(mean * 1_000_000) / 1_000_000,
    stdev: Math.round(Math.sqrt(variance) * 1_000_000) / 1_000_000,
  };
}

function toCashFlowSpec(cf: {
  amount: number;
  flowType: string;
  startYear: number;
  endYear?: number | null;
  inflationAdjust: boolean;
}): CashFlowSpec {
  return {
    amount: Number(cf.amount),
    flowType: cf.flowType === "ONE_TIME" ? "ONE_TIME" : "RECURRING",
    startYear: cf.startYear,
    endYear: cf.endYear ?? null,
    inflationAdjust: cf.inflationAdjust,
  };
}
