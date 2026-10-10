# Polish Retail Treasury Bonds (TOS, ROR, COI, EDO)

Specification for the first implementation of sovereign bond support proposed
in discussion kenlasko/monize#1650: a small generic bond domain, and the Polish
retail savings bonds TOS, ROR, COI and EDO as its first products. Written
before the implementation, per `docs/financial-calculation-contract.md`
section 9. The plan and the task list are
`docs/future-plans/sovereign-bonds.md` and
`docs/future-plans/sovereign-bonds-tasks.md`.

Every product rule below is taken from the issue letters (*listy emisyjne*) of
the Minister of Finance for the October 2026 series, and each rule names its
paragraph. A rule that the letters do not state is marked **assumption** and
is listed in section 10.

| Series | Letter | Product |
| --- | --- | --- |
| `TOS1029` | List emisyjny nr 97/2026 of 21 September 2026 | 3-year, fixed rate, compounded |
| `ROR1027` | List emisyjny nr 95/2026 of 21 September 2026 | 1-year, NBP reference rate, monthly coupons |
| `COI1030` | List emisyjny nr 98/2026 of 21 September 2026 | 4-year, CPI-linked, annual coupons |
| `EDO1036` | List emisyjny nr 99/2026 of 21 September 2026 | 10-year, CPI-linked, compounded |

## 1. Scope

In scope for the first PR:

- the generic bond domain: issue, versioned issue terms, rate rule,
  capitalization rule, redemption policy, holding lot, cash flow, valuation;
- a calculation engine in exact decimal arithmetic;
- the four products above;
- persistence of issue terms, announced period rates and reference data
  (NBP reference rate, GUS CPI) in global tables;
- a read service that values one holding lot from the stored data.

Out of scope for the first PR (the plan orders them): fetching terms from the
Ministry of Finance, NBP or GUS; linking a `securities` row to a bond issue;
feeding bond values into portfolio valuation; any UI; OTS, DOR, ROS, ROD;
taxes; the IKE/IKZE fee waiver; market-traded bonds, yields and day-count
conventions (discussion section 38).

## 2. The model

### 2.1 Issue and terms

A **bond issue** is one series (`TOS1029`). Its **terms** are what its issue
letter says. Terms are stored as an immutable, versioned document: version 1 is
what the letter says at issue, and a correction is a new version, never an edit.
A valuation names the terms version it used.

The terms document (`schemaVersion` 1):

```text
productCode        TOS | ROR | COI | EDO
seriesCode         e.g. TOS1029
currency           PLN
faceValue          "100.00"
saleWindow         { from, to }                  calendar dates
periodCount        3 | 12 | 4 | 10
periodMonths       12 | 1
rateRule           see 2.2
capitalization     NONE | COMPOUND_AT_PERIOD_END
compoundBaseRounding  PER_PERIOD | NONE          see 2.4
earlyRedemption    { fee, feeCappedAtAccruedInterestInFirstPeriodOnly,
                     floorAtFaceValue: ALL_PERIODS | FIRST_PERIOD,
                     earliestDaysAfterPurchase: 7,
                     latestDaysBeforeMaturity: 20,
                     excludesRecordDay }
source             { provider: PL_MF, url, document }
```

Every rate and amount is a decimal string, never a JSON number. Rates are
fractions (`"0.0440"` for 4.40%).

### 2.2 Rate rules

| Rule | Products | Rate of period k |
| --- | --- | --- |
| `FIXED` | TOS | `annualRate` for every period (TOS letter, para 14) |
| `BENCHMARK_PLUS_SPREAD` | ROR | k = 1: `firstPeriodRate`; k >= 2: `max(0, NBP) + spread` (ROR letter, para 15, 16, annex 1) |
| `INFLATION_PLUS_MARGIN_AS_RATE` | COI, EDO | k = 1: `firstPeriodRate`; k >= 2: `max(0, CPI) + margin` (COI letter, para 15 to 17; EDO letter, para 15 to 17, annex 1) |

Observation rules:

- **NBP** (`PL_NBP_REFERENCE`): the reference rate in force on the 10th
  business day before the first day of the calendar month in which period k
  starts (ROR letter, para 16). A business day excludes Saturdays, Sundays
  and Polish statutory holidays (para 29, 31). The rate in force on a day is the
  newest change effective on or before that day.
- **CPI** (`PL_CPI_GUS_YOY`): the 12-month CPI change announced by GUS in the
  month before the first month of period k (COI and EDO letters, para 16).
  **Assumption:** this is the final figure for the month two months before the
  period starts (a period starting in October uses August). The engine looks
  up the reference month `startMonth - 2`.

**An announced rate wins.** The Ministry announces each period's rate before
the period starts, and "the announced rate does not change" (para 17 / 18).
When an announced rate for (series, period) is stored, the engine uses it.
Otherwise it derives the rate from the stored observation. The valuation says
which (`rateSource`: `TERMS`, `ANNOUNCED`, `DERIVED`, `PROJECTED`).

### 2.3 Periods

Periods are anchored on the purchase date of the lot, not on the series
(EDO para 14: interest accrues "from the day of sale"). Period k starts at
`addMonthsClamped(purchaseDate, (k - 1) * periodMonths)` and ends at
`addMonthsClamped(purchaseDate, k * periodMonths)`, where the day of month is
`min(purchaseDay, daysInMonth)` and is always computed from the purchase
date, never from the previous period end. The ROR letter, annex 3, is the
truth table for this rule (31.10.2026 gives 30.11, 31.12, 31.01, 28.02, 31.03,
30.04). Maturity is the end of the last period.

`ACT` / `D` is the actual number of days in the period, start inclusive, end
exclusive. `a` is the number of days from the period start inclusive to the
calculation day `d` exclusive.

### 2.4 Amounts per bond

All amounts are computed for **one bond** and rounded to 0.01 PLN where the
letter rounds, then multiplied by the lot quantity. Rounding is half-up
(**assumption**: the letters say "rounded to two decimal places" and name no
mode).

| Product | Interest of period k | Value at maturity | Early redemption on day d in period k |
| --- | --- | --- | --- |
| TOS | compounded, not paid | `W = round(N (1+r)^3)` (annex 1) | `WP = round(N_{k-1} (1 + r a / ACT) - b)`, `N_{k-1} = round(N (1+r)^{k-1})`, floor 100 in every period (annex 2) |
| EDO | compounded, not paid | `W = round(N prod(1 + r_i))` (annex 2) | `WP = round(N prod_{i<k}(1 + r_i) (1 + r_k a / ACT) - b)`, no intermediate rounding, floor 100 in every period (annex 3) |
| COI | `O = round(N r_k)`, paid on the period end (annex 2, para 19) | `N` plus the last coupon | `WP = round(N (1 + r a / ACT) - b)`, floor 100 in period 1 only (annex 3) |
| ROR | `O = round(N r a / (D F))`, `F = 12`, paid on the period end (annex 2, para 20) | `N` plus the last coupon | `WP = round(N (1 + r a / (D F)) - b)`, floor 100 in period 1 only (annex 4) |

`b` is the early redemption fee: TOS 1.00, ROR 0.50, COI 2.00, EDO 3.00
(para 24 / 26 of each letter). In TOS and EDO, and in the first period of ROR
and COI, the fee is capped at the accrued interest; the floor of 100 is that
cap. From period 2, ROR and COI deduct the full fee, so the value can be below
the face value.

`compoundBaseRounding` is `PER_PERIOD` for TOS (annex 2 rounds `N_{k-1}`) and
`NONE` for EDO (annex 3 rounds only the result).

### 2.5 Early redemption window

A request is possible from 7 calendar days after the purchase date to 20
calendar days before maturity (para 21 / 23 / 25). ROR and COI also exclude
the record day (the 5th business day before a coupon date). Outside the
window `earlyRedemptionValue` is `null` and `earlyRedemptionRefusal` names the
rule. The engine values the request as if `d` were the calculation day; the
five-business-day settlement lag (para 26) is out of scope.

### 2.6 Valuation of a lot

Input: the issue, its terms version, the announced rates, the reference
observations, the lot (`purchaseDate`, `quantity`), `asOf`, and an optional
projection assumption (`cpiYoY`, `nbpReference`). Output:

```text
asOf, seriesCode, termsVersion, quantity
currentPeriod      { index, start, end, annualRate, rateSource } | null
principal          per-bond compounded base at the start of the period | null
accruedInterest    lot, since the last capitalization or coupon | null
grossValue         lot, principal + accrued interest, no fee | null
earlyRedemptionValue  lot | null, earlyRedemptionRefusal
knownCashflows     [{ date, type: INTEREST | PRINCIPAL, amount, status: KNOWN }]
projectedCashflows [{ ..., status: PROJECTED }]
maturityValueKnown     | null
maturityValueProjected | null
projectionAssumptions  [strings, each naming the series and the value assumed]
dataCompleteness   { termsComplete, referenceDataComplete, earlyRedemptionTermsComplete }
missing            [{ series, observation }]  what to obtain, and where
valuationComplete  all three flags true
```

## 3. Invariants

- **INV-BOND-001 Issue terms and announced rates are immutable.** A stored
  terms version and a stored announced rate are never updated or deleted; a
  correction is a new terms version. Mechanism: a `BEFORE UPDATE OR DELETE`
  trigger on both tables that raises.
- **INV-BOND-002 A missing rate is unknown, never substituted.** A period whose
  rate is neither announced nor derivable from a stored observation has no
  rate. The engine never uses another month's CPI, the latest NBP rate, 0 or
  the first-period rate in its place. Values that depend on it are `null` (if
  the period has started) or `PROJECTED` with a named assumption (if it has
  not).
- **INV-BOND-003 Money is exact until the letter rounds it.** The engine uses
  exact rational arithmetic (no JavaScript `number` on a money or rate path)
  and rounds only at the points section 2.4 names.
- **INV-BOND-004 Known and projected never mix.** A cash flow is `KNOWN` only
  when every rate it depends on is `TERMS`, `ANNOUNCED` or `DERIVED`.
  `maturityValueKnown` is `null` while any period rate is projected.

## 4. Truth table: rate of period k

| k | Announced rate stored | Observation stored | Period started (`start <= asOf`) | Rate | `rateSource` | Effect |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | any | any | any | `firstPeriodRate` / `annualRate` | `TERMS` | known |
| >= 2 | yes | any | any | announced | `ANNOUNCED` | known |
| >= 2 | no | yes | any | `max(0, obs) + margin` | `DERIVED` | known |
| >= 2 | no | no | yes | none | -- | values `null`, `referenceDataComplete = false`, `missing` names the observation |
| >= 2 | no | no | no | `max(0, assumption) + margin` | `PROJECTED` | projected; `null` if no assumption is given and no observation exists |

The default projection assumption is the newest stored observation of the
series, and the assumption string names it ("PL_CPI_GUS_YOY = 2.90% (2026-08),
assumed for every later period").

## 5. Numerical examples

Each line is computed with exact fractions and rounded half-up. The
fixtures copy these values, never the implementation's output.

| # | Case | Inputs | Expected |
| --- | --- | --- | --- |
| E1 | TOS1029 maturity value | r = 4.40% | `N1 = 104.40`, `N2 = 108.99`, `W = 113.79` (equals TOS letter, para 14) |
| E2 | TOS1029 early, period 1 | purchase 2026-10-15, d = 2027-04-15, a = 182, ACT = 365 | `101.19` |
| E3 | TOS1029 early, period 1, below floor | purchase 2026-10-15, d = 2026-10-25, a = 10 | `99.12` -> `100.00` |
| E4 | TOS1029 early, period 2 | d = 2028-01-15, a = 92, ACT = 366 | `104.55` |
| E5 | EDO1036 early, period 1, below floor | purchase 2026-10-01, d = 2027-04-01, a = 182, ACT = 365 | `99.67` -> `100.00` |
| E6 | EDO1036 early, period 2 | r2 = 4.90% (hypothetical), d = 2028-04-01, a = 183, ACT = 366 | `104.93` |
| E7 | EDO1036 maturity | r1 = 5.35%, r2..r10 = 4.90% (hypothetical) | `162.04` |
| E8 | COI1030 coupon, period 1 | r1 = 4.75% | `4.75` |
| E9 | COI1030 early, period 1 | purchase 2026-10-15, d = 2027-01-15, a = 92, ACT = 365 | `99.20` -> `100.00` |
| E10 | COI1030 early, period 2, no floor | r2 = 4.40% (hypothetical), d = 2027-10-16, a = 1, ACT = 366 | `98.01` |
| E11 | ROR1027 coupon, period 1 | purchase 2026-10-31, period to 2026-11-30, D = 30, r = 4.00% | `0.33` |
| E12 | ROR1027 early, period 1 | d = 2026-11-15, a = 15 | `99.67` -> `100.00` |
| E13 | ROR1027 coupon, period 3 | 2026-12-31 to 2027-01-31, D = 31, r = 3.75% (hypothetical) | `0.31` |
| E14 | NBP observation day | period starts in November 2026 | 2026-10-19 |
| E15 | NBP observation day across holidays | period starts in January 2027 (24, 25, 26 Dec are holidays) | 2026-12-16 |
| E16 | Lot | E2 with quantity 25 | `2529.75` |

## 6. Missing-data policy

- Missing terms version: the read service refuses with a message that names
  the series. No valuation is produced.
- A started period without a rate: section 4. `missing` names the series and
  the observation (`PL_CPI_GUS_YOY 2027-08`, or `PL_NBP_REFERENCE on
  2026-10-19`) and the source that publishes it (GUS, NBP).
- NBP coverage: a day after the series' `covered_through` date is unknown, even
  if an older rate exists, because a newer change may not be stored yet.
- CPI: a reference month with no stored row is unknown. A negative value is
  stored as is and floored at 0 in the rate rule only.
- `asOf` before the purchase date: refused. `asOf` on or after maturity: the
  lot is matured, `grossValue` is the maturity value and early redemption is
  refused.

## 7. Persistence

Global reference data with no owner (RLS bucket: exempt, same rationale as
`exchange_rates` and `market_index_prices`):

| Table | Key | Mutability |
| --- | --- | --- |
| `bond_issues` | `id`; unique `(country, series_code)` | insert only |
| `bond_terms_versions` | `(bond_issue_id, version)` | immutable (INV-BOND-001) |
| `bond_period_rates` | `(bond_issue_id, period_number)` | immutable (INV-BOND-001) |
| `bond_reference_observations` | `(series_code, observation_date)` | insert, correction by update |
| `bond_reference_coverage` | `series_code` | `covered_through` moves forward |

Rates are `NUMERIC(20,10)` (an exchange-rate-like quantity, not money); the
face value is `NUMERIC(20,4)`. All five tables are excluded from the user
backup: they are reference data a deployment re-fetches. A lot is not stored
in the first PR; the caller passes it.

## 8. Versioning and recomputation

A valuation is computed on read and is not stored, so there is nothing to
invalidate. A new terms version changes only valuations that ask for it; the
read service uses the newest version unless the caller names one. A new
announced rate or observation changes the next read.

## 9. Concurrency

The first PR has no writer outside tests and migrations. The immutability
trigger makes a concurrent writer of the same terms version fail, not
overwrite. Writers (fetchers) arrive in a later PR with their own lease.

## 10. Assumptions to confirm

1. Rounding mode is half-up (section 2.4).
2. The CPI used for a period starting in month M is the final figure for
   M - 2 (section 2.2).
3. "After seven calendar days" allows a request on `purchaseDate + 7`
   (section 2.5).
4. Polish statutory holidays include 24 December from 2025 on.

Each one is to be checked against a rate table or an early redemption
statement published by the Ministry or an issuing agent before the product
values are shown to a user.

## 11. Test matrix

| Area | Kind | Cases |
| --- | --- | --- |
| Exact arithmetic | unit | parse, add, multiply, divide, half-up at `.xx5`, negative values, refusal of a non-decimal string |
| Period schedule | unit | ROR annex 3 rows for purchase days 1, 28, 29, 30, 31; leap year; maturity |
| Business days | unit | E14, E15, Easter-based holidays for 2026 and 2027 |
| Products | golden | E1 to E16 from a JSON fixture per product |
| Missing data | unit | each row of section 4; `missing` content; matured lot; `asOf` before purchase |
| Window | unit | day 6 and 7 after purchase, 21 and 20 days before maturity, ROR record day |
| Terms parsing | unit | a valid document per product; unknown field, number instead of string, unknown product refused |
| Immutability | integration | update and delete of a terms version and of an announced rate raise |
| Read service | integration | loads the newest version, applies announced over derived, names the version |
