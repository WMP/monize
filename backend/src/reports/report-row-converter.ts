import type { EntityManager } from "typeorm";
import { ConversionGaps } from "../built-in-reports/report-currency.service";
import {
  reportingRates,
  tryReportingConversion,
  type ReportingMoneySource,
} from "../accruals/reporting-money";
import type { ReportingProvenance } from "../accruals/reporting-provenance";

export interface ReportFxGap {
  from: string;
  to: string;
  date: string;
  reason: string | null;
}
export interface RowConverter {
  readonly currency: string;
  readonly gaps: ConversionGaps;
  readonly missingRatePairs?: ReportFxGap[];
  convert(
    amount: number,
    currencyCode: string,
    source?: ReportingMoneySource,
  ): number | null;
  conversion?(
    amount: number,
    source: ReportingMoneySource,
  ): ReportingProvenance["conversion"];
}

/** Convert each component before aggregation; keep dated gaps alongside the known subtotal. */
export async function createDatedReportConverter(
  m: EntityManager,
  currency: string,
  sources: ReportingMoneySource[],
): Promise<RowConverter> {
  const rates = await reportingRates(m, sources, currency);
  const gaps = new ConversionGaps();
  const missingRatePairs: ReportFxGap[] = [];
  const missing = new Set<string>();
  return {
    currency,
    gaps,
    missingRatePairs,
    convert(amount, currencyCode, source) {
      if (!source)
        throw new Error("Dated report conversion requires its source");
      const result = tryReportingConversion(
        amount,
        { ...source, currencyCode },
        currency,
        rates,
      );
      if (result.amount === null) {
        gaps.record(currencyCode);
        const key = JSON.stringify(result.missingRatePair);
        if (!missing.has(key)) {
          missing.add(key);
          missingRatePairs.push(result.missingRatePair);
        }
      }
      return result.amount;
    },
    conversion(amount, source) {
      const result = tryReportingConversion(amount, source, currency, rates);
      return {
        source: result.source,
        rate: result.rate,
        observedOn: result.observedOn,
      };
    },
  };
}
