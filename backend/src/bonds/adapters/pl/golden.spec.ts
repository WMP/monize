import { valueBondLot } from "../../engine/bond-engine";
import coiCases from "./coi-cases.json";
import edoCases from "./edo-cases.json";
import { lotInput, ManifestName } from "./pl-test-input";
import rorCases from "./ror-cases.json";
import tosCases from "./tos-cases.json";

interface GoldenCase {
  id: string;
  description: string;
  lot: { purchaseDate: string; quantity: number };
  asOf: string;
  announcedRates?: Record<string, string>;
  expect: Record<string, unknown>;
  knownCashflows?: Record<string, unknown>[];
}

interface GoldenFile {
  manifest: string;
  cases: GoldenCase[];
}

// Values are copied from spec section 5 (E1 to E16), never from the engine's output.
describe.each([tosCases, edoCases, coiCases, rorCases] as GoldenFile[])(
  "golden cases for $manifest",
  (file) => {
    it.each(file.cases)("$id: $description", (c) => {
      const valuation = valueBondLot(
        lotInput(file.manifest as ManifestName, c.lot.purchaseDate, c.asOf, {
          lot: c.lot,
          announcedRates: new Map(
            Object.entries(c.announcedRates ?? {}).map(([k, v]) => [
              Number(k),
              v,
            ]),
          ),
        }),
      );
      expect(valuation).toMatchObject(c.expect);
      for (const flow of c.knownCashflows ?? []) {
        expect(valuation.knownCashflows).toContainEqual(flow);
      }
    });
  },
);
