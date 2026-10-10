import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DataSource } from "typeorm";
import { addDaysYMD, todayInTimezone } from "../common/date-utils";
import { withScopedDb } from "../common/db/scoped-db";
import { withSystemContext } from "../common/db/with-context";
import {
  describeFetchFailure,
  isTransportFailure,
} from "../common/http/fetch-failure.util";
import {
  FetchSyncJob,
  FetchSyncService,
} from "../common/jobs/fetch-sync.service";
import { ProviderHealthService } from "../provider-health/provider-health.service";
import { isProviderUnavailable } from "../provider-health/provider-unavailable.error";
import { TrackedProviderId } from "../provider-health/providers";
import {
  BenchmarkFetchResult,
  BenchmarkSeriesDefinition,
  BondAdapter,
  BondFetch,
} from "./bond-adapter";
import { INSTALLED_BOND_ADAPTERS } from "./bond-adapters";
import { BondCatalogService } from "./bond-catalog.service";

export type HttpFetch = typeof globalThis.fetch;

export interface RefreshOptions {
  /** Skip a series whose `covered_through` is today or yesterday (the boot warm-up). */
  readonly onlyStale?: boolean;
  /** The network, injectable so a test never leaves the process. */
  readonly fetch?: HttpFetch;
  readonly adapters?: readonly BondAdapter[];
}

const FETCH_TIMEOUT_MS = 30_000;
const WARSAW = "Europe/Warsaw";

/**
 * Keeps the benchmark series (NBP reference rate, GUS CPI, whatever an adapter
 * declares) current. Global reference data, so one fetch serves every user.
 *
 * Cost control, not correctness: the upserts converge however many replicas run,
 * so the lease (`bond-benchmarks`) only stops N replicas asking the same
 * publisher at the same instant.
 */
@Injectable()
export class BenchmarkRefreshService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BenchmarkRefreshService.name);

  /** Longer than a refresh of two small files, far shorter than a day. */
  private readonly FETCH_LEASE_MS = 10 * 60 * 1000;

  constructor(
    private readonly dataSource: DataSource,
    private readonly health: ProviderHealthService,
    private readonly fetchSync: FetchSyncService,
    private readonly catalog: BondCatalogService,
  ) {}

  /**
   * Warm up a deployment whose series are empty or stale, under the same lease
   * as the cron so a rollout of N pods fetches once. A failure is a warning, not
   * a reason to stop the application.
   */
  onApplicationBootstrap(): void {
    void withSystemContext(() =>
      this.fetchSync.withLease(
        FetchSyncJob.BondBenchmarks,
        this.FETCH_LEASE_MS,
        () => this.refreshAll({ onlyStale: true }),
      ),
    ).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Initial bond benchmark refresh failed: ${message}`);
    });
  }

  /**
   * Weekday morning in Warsaw: GUS publishes mid-month and NBP announces after
   * its policy meetings, both during the working day before.
   *
   * Cross-user work with no request behind it, so it seeds its own system
   * context (`docs/backend/cron-and-background-work.md`); the wrapper goes
   * around the whole lease call.
   */
  @Cron("25 6 * * 1-5", { timeZone: WARSAW })
  async scheduledRefresh(): Promise<void> {
    await withSystemContext(() =>
      this.fetchSync.withLease(
        FetchSyncJob.BondBenchmarks,
        this.FETCH_LEASE_MS,
        () => this.refreshAll(),
      ),
    );
  }

  /**
   * Refresh every declared series. One series failing is logged and does not
   * stop the next. Needs an ambient identity (`withSystemContext`).
   */
  async refreshAll(options: RefreshOptions = {}): Promise<void> {
    const adapters = options.adapters ?? INSTALLED_BOND_ADAPTERS;
    const http: HttpFetch | undefined = options.fetch;
    // The series rows must exist before a value can reference one, whichever
    // service booted first.
    await this.catalog.seedBenchmarkSeries(adapters);
    const today = todayInTimezone(WARSAW) as string;

    for (const adapter of adapters) {
      for (const series of adapter.benchmarks) {
        await this.refreshSeries(
          adapter,
          series,
          http,
          today,
          options.onlyStale === true,
        );
      }
    }
  }

  private async refreshSeries(
    adapter: BondAdapter,
    series: BenchmarkSeriesDefinition,
    http: HttpFetch | undefined,
    today: string,
    onlyStale: boolean,
  ): Promise<void> {
    try {
      if (onlyStale && !(await this.isStale(series.code, today))) return;
      const result = await adapter.fetchBenchmark(
        series.code,
        this.gated(series.providerId, http),
      );
      await this.store(series.code, result);
      this.logger.log(
        `Stored ${result.observations.length} observation(s) for ${series.code}, covered through ${result.coveredThrough}`,
      );
    } catch (error) {
      if (isProviderUnavailable(error) || isTransportFailure(error)) {
        // Rate-limited and counted by the breaker; a refused call prints nothing.
        this.health.logFailure(
          this.logger,
          series.providerId,
          `bond benchmark refresh for ${series.code}`,
          error,
        );
        return;
      }
      this.logger.error(
        `Bond benchmark refresh for ${series.code} failed: ${describeFetchFailure(error)}`,
      );
    }
  }

  private async isStale(code: string, today: string): Promise<boolean> {
    const rows: Array<{ covered_through: string | null }> = await withScopedDb(
      this.dataSource,
      (m) =>
        m.query(
          `SELECT TO_CHAR(covered_through, 'YYYY-MM-DD') AS covered_through
             FROM benchmark_series WHERE code = $1`,
          [code],
        ),
    );
    const covered = rows[0]?.covered_through ?? null;
    return covered === null || covered < addDaysYMD(today, -1);
  }

  /**
   * The network, behind the provider's circuit breaker: a refusal throws before
   * any socket is opened, a transport failure is counted, and success is
   * recorded only once the whole body has arrived.
   */
  private gated(
    providerId: TrackedProviderId,
    http: HttpFetch | undefined,
  ): BondFetch {
    return async (url) => {
      const admission = this.health.assertAvailable(providerId);
      let status: number;
      let body: Uint8Array;
      try {
        const init = { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) };
        // A test injects `http`; production calls the global fetch here, in the
        // one place provider-call.guard.spec.ts scans for its breaker.
        const response = http ? await http(url, init) : await fetch(url, init);
        status = response.status;
        body = new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        const counted = this.health.recordFailure(providerId, error);
        if (!counted && admission === "probe")
          this.health.releaseProbe(providerId);
        throw error;
      }
      this.health.recordSuccess(providerId);
      return { status, body };
    };
  }

  /**
   * One transaction: the observations, then the coverage. A value is rewritten
   * only when it differs (a publisher's revision corrects a row), and
   * `covered_through` only moves forward.
   */
  private async store(
    code: string,
    result: BenchmarkFetchResult,
  ): Promise<void> {
    const { observations } = result;
    await withScopedDb(this.dataSource, async (m) => {
      if (observations.length > 0) {
        await m.query(
          `INSERT INTO benchmark_values
             (benchmark_code, observation_date, value, published_on, source_url, retrieved_at)
           SELECT $1::varchar, t.d, t.v, t.p, $5::text, NOW()
             FROM unnest($2::date[], $3::numeric[], $4::date[]) AS t(d, v, p)
           ON CONFLICT (benchmark_code, observation_date) DO UPDATE
              SET value = EXCLUDED.value,
                  published_on = EXCLUDED.published_on,
                  source_url = EXCLUDED.source_url,
                  retrieved_at = EXCLUDED.retrieved_at
            WHERE benchmark_values.value IS DISTINCT FROM EXCLUDED.value`,
          [
            code,
            observations.map((o) => o.observationDate),
            observations.map((o) => o.value),
            observations.map((o) => o.publishedOn),
            result.sourceUrl,
          ],
        );
      }
      await m.query(
        `UPDATE benchmark_series
            SET covered_through = GREATEST(COALESCE(covered_through, $2::date), $2::date),
                updated_at = NOW()
          WHERE code = $1`,
        [code, result.coveredThrough],
      );
    });
  }
}
