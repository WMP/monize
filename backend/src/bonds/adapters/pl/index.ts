import { todayInTimezone } from "../../../common/date-utils";
import {
  BenchmarkFetchError,
  BondAdapter,
  BondFetch,
  CatalogEntry,
} from "../../bond-adapter";
import { registerCalendar } from "../../domain/calendar-registry";
import type { CalendarRegistry } from "../../domain/calendar-registry";
import coi from "./manifests/coi1030.terms.json";
import edo from "./manifests/edo1036.terms.json";
import ror from "./manifests/ror1027.terms.json";
import tos from "./manifests/tos1029.terms.json";
import ots from "./manifests/ots0127.terms.json";
import dor from "./manifests/dor1028.terms.json";
import ros from "./manifests/ros1032.terms.json";
import rod from "./manifests/rod1038.terms.json";
import { fetchGusCpi, GUS_CPI_LANDING_URL } from "./pl-gus-cpi";
import { fetchNbpReference, NBP_ARCHIVE_URL } from "./pl-nbp-reference";
import { PL_CPI_GUS_YOY, PL_NBP_REFERENCE } from "./pl-benchmarks";
import { plCalendar } from "./pl-calendar";

export { plBenchmarks } from "./pl-benchmarks";
export { plCalendar } from "./pl-calendar";

/** The registry plus the Polish calendar, for the caller to pass to the engine. */
export function registerPolishCalendars(
  registry: CalendarRegistry,
): CalendarRegistry {
  return registerCalendar(registry, plCalendar);
}

const ISSUE_LETTERS_PUBLISHED = "2026-09-21";

const catalog: readonly CatalogEntry[] = [
  ots,
  tos,
  ror,
  dor,
  coi,
  edo,
  ros,
  rod,
].map((terms) => ({
  termsVersion: 1,
  publishedAt: ISSUE_LETTERS_PUBLISHED,
  terms,
}));

export const POLISH_BOND_ADAPTER: BondAdapter = {
  countryCode: "PL",
  registerCalendars: registerPolishCalendars,
  benchmarks: [
    {
      code: PL_NBP_REFERENCE,
      kind: "STEP",
      publisher: "NBP",
      sourceUrl: NBP_ARCHIVE_URL,
      unit: "RATE_FRACTION",
      providerId: "nbp",
    },
    {
      code: PL_CPI_GUS_YOY,
      kind: "MONTHLY",
      publisher: "GUS",
      sourceUrl: GUS_CPI_LANDING_URL,
      unit: "RATE_FRACTION",
      providerId: "gus",
    },
  ],
  catalog,
  async fetchBenchmark(code: string, fetch: BondFetch) {
    switch (code) {
      case PL_NBP_REFERENCE:
        return fetchNbpReference(
          fetch,
          todayInTimezone("Europe/Warsaw") as string,
        );
      case PL_CPI_GUS_YOY:
        return fetchGusCpi(fetch);
      default:
        throw new BenchmarkFetchError(
          `The Polish adapter has no benchmark ${code}`,
        );
    }
  },
};
