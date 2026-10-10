/** What a benchmark series is and who publishes it; the data comes from an adapter. */
export interface BenchmarkDefinition {
  readonly id: string;
  readonly kind: "STEP" | "MONTHLY";
  readonly publisher: string;
}

/**
 * Stored observations of one series. STEP: a value in force from a date until
 * the next change. MONTHLY: one value per `YYYY-MM`.
 */
export type BenchmarkData =
  | {
      readonly kind: "STEP";
      readonly publisher: string;
      readonly changes: readonly {
        readonly effectiveFrom: string;
        readonly value: string;
      }[];
      /** Days after this date are unknown even if an older value exists. */
      readonly coveredThrough: string | null;
    }
  | {
      readonly kind: "MONTHLY";
      readonly publisher: string;
      readonly values: ReadonlyMap<string, string>;
    };
