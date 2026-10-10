import { TrackedProviderId } from "../provider-health/providers";
import { CalendarRegistry } from "./domain/calendar-registry";

/** A benchmark series an adapter knows how to fetch and keep up to date. */
export interface BenchmarkSeriesDefinition {
  readonly code: string;
  readonly kind: "STEP" | "MONTHLY";
  readonly publisher: string;
  readonly sourceUrl: string;
  /** Values are stored as fractions: 0.0575 for 5.75 percent. */
  readonly unit: "RATE_FRACTION";
  /** The outbound provider the fetch is gated and reported under. */
  readonly providerId: TrackedProviderId;
}

/**
 * One curated terms document. A correction is a new `termsVersion`, never an
 * edit of an existing entry (INV-BOND-001).
 */
export interface CatalogEntry {
  readonly termsVersion: number;
  readonly publishedAt: string | null;
  /** The raw manifest JSON; the catalog service parses and validates it. */
  readonly terms: unknown;
}

export interface BenchmarkObservation {
  readonly observationDate: string;
  /** A fraction as an exact decimal string. */
  readonly value: string;
  readonly publishedOn: string | null;
}

export interface BenchmarkFetchResult {
  readonly observations: readonly BenchmarkObservation[];
  /** The source is authoritative for every day up to and including this date. */
  readonly coveredThrough: string;
  readonly sourceUrl: string;
}

/**
 * The only door the adapters have to the network. The caller gates it behind the
 * provider's circuit breaker and reads the whole body, so an adapter is a pure
 * function of what comes back and a test needs no socket.
 */
export type BondFetch = (
  url: string,
) => Promise<{ status: number; body: Uint8Array }>;

export class BenchmarkFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkFetchError";
  }
}

/** Everything one country contributes: calendars, benchmarks, curated terms. */
export interface BondAdapter {
  readonly countryCode: string;
  registerCalendars(registry: CalendarRegistry): CalendarRegistry;
  readonly benchmarks: readonly BenchmarkSeriesDefinition[];
  readonly catalog: readonly CatalogEntry[];
  fetchBenchmark(code: string, fetch: BondFetch): Promise<BenchmarkFetchResult>;
}
