# Sovereign Bonds: Plan

> Spec: [`docs/specs/polish-retail-bonds.md`](../specs/polish-retail-bonds.md). Task list: [`sovereign-bonds-tasks.md`](./sovereign-bonds-tasks.md). Origin: discussion kenlasko/monize#1650.

## Goal

Value Polish retail treasury bonds (TOS, ROR, COI, EDO first) from their issue
terms and official reference data, not from a market quote. Build the generic
part only as far as these four products need it.

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

## Architecture

```text
backend/src/bonds/
  domain/          exact-decimal, bond-terms (types + parser), period schedule,
                   rate resolution, cash flows, valuation types
  engine/          bond-engine.ts: terms + rates + lot + asOf -> valuation
  products/pl/     pl-business-days.ts, pl-observations.ts, one file per product
                   (tos.ts, ror.ts, coi.ts, edo.ts) holding only the formulas
                   the letter states, plus the golden fixtures
  entities/        BondIssue, BondTermsVersion, BondPeriodRate,
                   BondReferenceObservation, BondReferenceCoverage
  bond-valuation.service.ts   withScopedDb read -> engine
  bonds.module.ts
```

The product files are composition over the shared engine: the engine owns the
schedule, the rate lookup and the known/projected split; a product supplies the
per-bond formulas of section 2.4 of the spec.

## Phases

| PR | Content | Observable result |
| --- | --- | --- |
| 1 | Spec, plan, domain, engine, TOS/ROR/COI/EDO, migration with the five tables, read service | golden tests E1 to E16 pass; the immutability trigger refuses an update |
| 2 | Fetchers: NBP reference rate history (NBP API), GUS CPI, Ministry announced rates; a lease-guarded cron; provider health | stored observations for the open series; `missing` empties once fetched |
| 3 | Link a security to a bond issue; lots from BUY transactions; bond value in portfolio valuation, with `valuationComplete` carried | a TOS holding shows its value in the portfolio |
| 4 | UI: bond detail (period, rate, accrued, early redemption, known vs projected); i18n | the detail view of discussion section 42 |
| 5 | OTS, DOR, ROS, ROD; older series terms | each product with its golden fixture |

## What to run

Per PR, the "Required before you push" list in `AGENTS.md`. PR 1 touches a
migration, so it also runs `npm run migration:lint`, `scripts/verify-schema.sh`,
`node scripts/check-migration-prefixes.mjs`, and `npm run build && npm run
test:integration`.
