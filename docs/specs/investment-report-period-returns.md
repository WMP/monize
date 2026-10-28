# Spec: per-security period returns in the investment reports

Status: **accepted.** Scope from kenlasko/monize#1865 ("Investment report period
returns: confirm the return method").

Owner: investment-reports. Related: `docs/specs/portfolio-period-result.md` (the
portfolio-level measure), `docs/financial-calculation-contract.md` (missing data,
a subtotal is not a total).

---

## 1. The defect this exists to remove

The per-security columns 1W, 4W, 3M, 1Y, 3Y and YTD put every purchase in the
window into the denominator as if it had been made on the first day. A purchase
late in the window then dilutes the return as if the money had worked all
period, and a sale does the reverse.

Example, with a window of 7 days: 10 shares held at 100, 90 bought at 100 on day
2, price 110 at the end. The market gave +10 on 100 shares for part of the
window. The start-of-window formula divided 1,000 by 10,000 and printed 10%,
although 9,000 of the money was invested for only 5 of the 7 days. A reader who
compares the column with the price move sees a figure that fits neither the
position they had at the start nor the one they had at the end.

## 2. The measure

The window is (start, asOf]. Dates are ISO `YYYY-MM-DD`. Modified Dietz:

```
numerator   = MV + income + outflows - begin - inflows
denominator = begin + sum(w_i * inflow_i) - sum(w_i * outflow_i)
w_i         = days(asOf - flowDate_i) / days(asOf - start)
return      = numerator / denominator * 100
```

- `days` is calendar days, `Date.parse` of the ISO strings over 86,400,000. A
  flow on `asOf` weighs 0.
- `MV` is market value as of `asOf`, in the security's currency.
- `begin` is the quantity held at `start` times the close on or before `start`.
- `inflows`: BUY cost in the security currency; transfer-in and share
  adjustments in, valued at the close on or before their date.
- `outflows`: SELL proceeds; transfer-out and share adjustments out, valued the
  same way as inflows with no own price.
- `income`: cash distributions and return of capital in the window. Income
  belongs to the numerator only. It is not a deposit, so it does not weigh into
  the denominator.
- REINVEST and RETURN_OF_CAPITAL are not flows. A reinvested dividend spends
  income the position earned; its shares are already in `MV`.

"All dates" (against cost basis) and the annualized column are not changed.

## 3. Why Modified Dietz

- `PortfolioPeriodResultService` (INV-PORTRESULT-001) is portfolio-level and
  includes cash. It has no per-security flows, so it cannot answer for one row.
- A full time-weighted return needs a valuation at every flow date. A report row
  has closes only on price dates; a flow on a day with no close would need an
  invented value. Modified Dietz is the standard approximation when sub-period
  valuations are not taken. It is exact when no flow occurs and when the flows
  do not coincide with large price moves.

## 4. Missing-data policy

The column is `null` (not 0, not a partial figure) when:

1. there is no market value;
2. there is no close on or before `start`;
3. the quantity at `start` is 0;
4. `begin <= 0`;
5. a flow in the window cannot be valued (a BUY with no cost, a SELL with no
   proceeds, a transfer on a day with no close);
6. the weighted denominator is `<= 0` (a sale larger than the money still at
   work);
7. `days(asOf - start) <= 0`.

## 5. Truth table

Window 2024-06-03 .. 2024-06-10 (7 days). `held10`: 10 shares at 100 at start.

| Case | MV | Flows | Denominator | Return |
| --- | --- | --- | --- | --- |
| No flows, close 110 | 1,100 | none | 1,000 | 10% |
| BUY 90 at 100 on 06-05, close 110 | 11,000 | in 9,000, w 5/7 | 7,428.5714 | 13.4615% (old formula: 10%) |
| BUY 90 at 100 on 06-05, close 100 | 10,000 | in 9,000 | 7,428.5714 | 0% |
| Transfer in 5 at 100 on 06-05, close 110 | 1,650 | in 500, w 5/7 | 1,357.1429 | 11.0526% |
| SELL 9 for 900 on 06-04, close 110 | 110 | out 900, w 6/7 | 228.5714 | 4.375% |
| SELL 9 for 1,200 on 06-04, close 110 | 110 | out 1,200, w 6/7 | -28.5714 | null |
| BUY 90 at 100 on 06-10, close 110 | 11,000 | in 9,000, w 0 | 1,000 | 100% |
| BUY with no cost on 06-05 | any | unvaluable | n/a | null |

## 6. Test matrix

All cases are in `backend/src/investment-reports/investment-report-data.service.spec.ts`,
describe "period returns with share flows inside the window": no flows, flat
purchase, flat sale, transfer in, mid-window purchase with a price rise, sale
with a hand-computed value, non-positive denominator, flow on the as-of date,
reinvested dividend, unvaluable flow.
