import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The frontend's GEM types are a hand-written copy of the backend's read model,
 * and nothing compiles the two against each other. Drift is therefore silent
 * until a component reads a field the server never sends -- and it stays silent
 * for as long as no component happens to read it, which is how `GemPerformance`
 * came to declare a required `currencyCode` the API does not return, described
 * as "the strategy account's base currency" over lines that are unitless
 * returns in each instrument's own listing currency.
 *
 * This guard is deliberately one-directional and about *required* properties
 * only. A frontend interface may legitimately omit fields it does not use; it
 * may not require one the backend does not declare, because that is a promise
 * the payload cannot keep.
 */

const BACKEND_TYPES = resolve(
  __dirname,
  "../../../backend/src/strategies/gem-report.types.ts",
);
const FRONTEND_TYPES = resolve(__dirname, "./gem-strategy.ts");

/**
 * The same read model on both sides, `[frontend, backend]`. The backend suffixes
 * several of these `View`; where the names already agree both entries match.
 */
const SHARED_INTERFACES: Array<[string, string]> = [
  ["GemStrategyReport", "GemStrategyReportView"],
  ["GemStrategyMeta", "GemStrategyMetaView"],
  ["GemStrategyRef", "GemStrategyRef"],
  ["GemPerformance", "GemPerformanceView"],
  ["GemPerformancePoint", "GemPerformancePoint"],
  ["GemCurrentPortfolioSimulation", "GemCurrentPortfolioSimulation"],
  ["GemBacktestSummary", "GemBacktestSummaryView"],
  ["GemPosition", "GemPositionView"],
  ["GemAction", "GemActionView"],
  ["GemSignal", "GemSignalView"],
  ["GemAssetMomentum", "GemAssetMomentum"],
  ["GemAbsoluteStep", "GemAbsoluteStep"],
  ["GemRelativeStep", "GemRelativeStep"],
  ["GemHistoryEntry", "GemHistoryEntryView"],
  ["GemAccountRef", "GemAccountRef"],
  ["GemAssetRef", "GemAssetRef"],
  ["GemHeldAsset", "GemHeldAsset"],
  ["GemWarning", "GemWarning"],
];

/**
 * Interfaces the frontend declares that the backend read model has no
 * counterpart for, with the reason. Anything not here and not above is a type
 * the guard is silently ignoring, which is what let `GemStrategyMeta` and the
 * report root sit outside it: they agree field by field today, and a settings
 * field added to one side only would have been invisible.
 */
const CLIENT_ONLY = new Set([
  // Request bodies, not the read model. Their server counterparts are DTOs with
  // class-validator decorators, which this parser is not built to read.
  "GemAssetAssignmentInput",
  "GemStrategyConfigInput",
]);

/**
 * Property names declared in `interface Name { ... }`, split by whether the
 * declaration marks them optional.
 *
 * A brace-depth walk rather than a single regex: several of these bodies carry
 * inline object types (`Partial<Record<...>>`, `{ id: string }`), and a flat
 * match would read their members as members of the interface.
 */
function propertiesOf(
  source: string,
  name: string,
): { required: Set<string>; all: Set<string> } | null {
  const header = new RegExp(`\\binterface\\s+${name}\\b[^{]*\\{`).exec(source);
  if (!header) return null;
  const required = new Set<string>();
  const all = new Set<string>();
  let depth = 1;
  let index = header.index + header[0].length;
  let lineStart = index;
  for (; index < source.length && depth > 0; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === "\n") {
      if (depth === 1) {
        const line = source.slice(lineStart, index).trim();
        const property = /^([A-Za-z_$][\w$]*)(\?)?\s*:/.exec(line);
        if (property) {
          all.add(property[1]);
          if (!property[2]) required.add(property[1]);
        }
      }
      lineStart = index + 1;
    }
  }
  return { required, all };
}

describe("GEM report contract parity", () => {
  const backend = readFileSync(BACKEND_TYPES, "utf8");
  const frontend = readFileSync(FRONTEND_TYPES, "utf8");

  it.each(SHARED_INTERFACES)(
    "%s requires nothing the backend does not send",
    (clientName, serverName) => {
      const server = propertiesOf(backend, serverName);
      const client = propertiesOf(frontend, clientName);
      // Both sides must actually declare it, or the guard is passing on a
      // typo rather than on agreement.
      expect(
        server,
        `${serverName} missing from the backend types`,
      ).not.toBeNull();
      expect(
        client,
        `${clientName} missing from the frontend types`,
      ).not.toBeNull();

      const invented = [...(client as { required: Set<string> }).required]
        .filter(
          (property) => !(server as { all: Set<string> }).all.has(property),
        )
        .sort();
      expect(invented).toEqual([]);
    },
  );

  it("compares every interface the frontend declares", () => {
    // The list above is only as good as its completeness: an interface added to
    // `gem-strategy.ts` and not to it is unguarded, and nothing else would say
    // so. Either pair it with its backend counterpart or record why it has none.
    const declared = [...frontend.matchAll(/^export interface (\w+)/gm)].map(
      (match) => match[1],
    );
    const covered = new Set([
      ...SHARED_INTERFACES.map(([clientName]) => clientName),
      ...CLIENT_ONLY,
    ]);
    expect(declared.filter((name) => !covered.has(name))).toEqual([]);
    // And the reverse: a name left in the list after the interface it names is
    // gone or renamed would make its case vacuous.
    expect(
      [...covered].filter((name) => !declared.includes(name)).sort(),
    ).toEqual([]);
  });

  it("parses the interfaces it claims to compare", () => {
    // A silent parse failure would make every case above vacuous.
    const parsed = propertiesOf(frontend, "GemPerformance");
    expect(parsed?.required.has("points")).toBe(true);
    expect(parsed?.required.has("totals")).toBe(true);
    expect(parsed?.all.has("currencyCode")).toBe(false);
  });
});
