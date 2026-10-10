import { BenchmarkData } from "../../domain/benchmark";
import { BondTerms, parseBondTerms } from "../../domain/bond-terms";
import { EMPTY_CALENDAR_REGISTRY } from "../../domain/calendar-registry";
import { BondEngineInput } from "../../engine/bond-engine-types";
import { registerPolishCalendars } from ".";
import coi from "./manifests/coi1030.terms.json";
import edo from "./manifests/edo1036.terms.json";
import ror from "./manifests/ror1027.terms.json";
import tos from "./manifests/tos1029.terms.json";

export type ManifestName = "tos1029" | "ror1027" | "coi1030" | "edo1036";

const DOCUMENTS: Record<ManifestName, unknown> = {
  tos1029: tos,
  ror1027: ror,
  coi1030: coi,
  edo1036: edo,
};

export function manifest(name: ManifestName): BondTerms {
  return parseBondTerms(DOCUMENTS[name]);
}

export function manifestDocument(name: ManifestName): Record<string, any> {
  return JSON.parse(JSON.stringify(DOCUMENTS[name]));
}

export const polishCalendars = registerPolishCalendars(EMPTY_CALENDAR_REGISTRY);

/** A lot of one bond bought on `purchaseDate`, with no announced rate and no reference data. */
export function lotInput(
  name: ManifestName,
  purchaseDate: string,
  asOf: string,
  overrides: Partial<BondEngineInput> = {},
): BondEngineInput {
  return {
    terms: manifest(name),
    termsVersion: 1,
    announcedRates: new Map(),
    benchmarks: new Map<string, BenchmarkData>(),
    calendars: polishCalendars,
    lot: { purchaseDate, quantity: 1 },
    asOf,
    ...overrides,
  };
}
