# Sovereign Bonds: Plan

> Spec: [`docs/specs/polish-retail-bonds.md`](../specs/polish-retail-bonds.md). Task list: [`sovereign-bonds-tasks.md`](./sovereign-bonds-tasks.md). Origin: discussion kenlasko/monize#1650.

## Goal

One country-agnostic bond engine for every jurisdiction Monize users hold
bonds in, with Polish retail treasury bonds (TOS, ROR, COI, EDO) as the first
adapter. Value them from their issue terms and official reference data, not
from a market quote. Implement only the primitives the Polish products need,
in a shape where each later country is an adapter plus, rarely, a new
primitive (spec section 2.0).

## Assumptions (restated for a fresh session)

- Retail bonds have no market price. Their value comes from the issue letter,
  the purchase date of each lot, and the NBP reference rate or the GUS CPI.
- Periods are anchored on the purchase date of the lot, so two lots of one
  series have different schedules.
- The backend has no decimal library. The engine uses its own exact rational
  type over `BigInt`; no new dependency.
- The bond tables are global reference data (RLS exempt), like
  `exchange_rates`.
- `securities` stays generic: no bond columns on it (discussion section 23).
- The UI language never selects bond logic: a Polish-language user may hold US
  TIPS. The instrument's issuer country, program and series decide it.
- The global research note (attached to the discussion) lists the 21
  jurisdictions of the Monize locales and the primitives they need; this plan
  does not freeze that list.

## Architecture

```text
backend/src/bonds/
  domain/          exact-decimal, calendar dates, period schedule,
                   business-day calendar interface and registry,
                   bond-terms (primitive unions + strict parser), benchmarks
  engine/          bond-engine.ts: terms + benchmarks + announced rates
                   + lot + asOf -> valuation; dispatches on primitive types only
  adapters/pl/     Polish calendar, benchmark definitions (PL_NBP_REFERENCE,
                   PL_CPI_GUS_YOY), terms manifests for the four series,
                   golden fixtures
  entities/        BondInstrument, BondTermsVersion, BondPeriodRate,
                   BenchmarkSeries, BenchmarkValue
  bond-valuation.service.ts   withScopedDb read -> engine
  bonds.module.ts
```

The engine never branches on a country or a product; a source-scanning guard
holds that. A product is a terms document, not code.

## Adding a country

1. `adapters/<cc>/`: its business-day calendar, its benchmark definitions,
   terms manifests, golden tests from an officially published example.
2. Map each local product to existing primitives. Only when an instrument
   has a new economic construction, add one primitive: a union member in the
   terms types, a parser case, one engine case, its tests.
3. A fetcher (definition provider) per country normalizes official terms and
   benchmark data into the same tables; it never computes a valuation.

## Phases

| PR | Content | Observable result |
| --- | --- | --- |
| 1 | Spec, plan, domain, engine, TOS/ROR/COI/EDO, migration with the five tables, read service | golden tests E1 to E16 pass; the immutability trigger refuses an update |
| 2 | Fetchers: NBP reference rate history (NBP API), GUS CPI, Ministry announced rates; a lease-guarded cron; provider health | stored observations for the open series; `missing` empties once fetched |
| 3 | Link a security to a bond instrument; lots from BUY transactions; bond value in portfolio valuation, with `valuationComplete` carried | a TOS holding shows its value in the portfolio |
| 4 | UI: bond detail (period, rate, accrued, early redemption, known vs projected); i18n | the detail view of discussion section 42 |
| 5 | OTS, DOR, ROS, ROD; older series terms | each product with its golden fixture |
| 6+ | Further countries in the order of the research note (simple marketable bonds, then indexed principal, floating, special retail); identifiers (ISIN, local series); market quote basis (percent of par, clean/dirty) | each country an adapter with golden tests; new primitives only where needed |

## What to run

Per PR, the "Required before you push" list in `AGENTS.md`. PR 1 touches a
migration, so it also runs `npm run migration:lint`, `scripts/verify-schema.sh`,
`node scripts/check-migration-prefixes.mjs`, and `npm run build && npm run
test:integration`.
