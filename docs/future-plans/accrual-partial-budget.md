# Partial FX for accrual budget reads

This repair follows the accrual review plan and the FX completeness contract. Cash and no-schedule execution preserve their native contracts. Missing FX during an active Accrual budget read must not produce a plausible zero, health score or spending recommendation.

## Boundary and invariants

- Only explicit read boundaries opt into partial budget accumulation. Mutations, period closing and unscoped internal callers retain their strict/native behavior.
- Monetary query buckets keep converted known components while recording missing pair/date metadata in the read's existing AsyncLocalStorage context. No user-wide cache or persisted approximation.
- When every component converts, the existing response shape is retained.
- When any component is unknown, the response is an explicit partial object: `fxComplete:false`, `total:null`, `result:null`, `knownComponents`, `missingRatePairs`, `repair:currency_rate_history`, `fetchAttempted:false`. It contains no calculated health score, remaining balance, variance or recommendation from an incomplete sum.
- Components carry their own target currency, effective date and known subtotal; unrelated or overlapping query subtotals are never added into a headline. Bound the returned list and disclose truncation separately.
- REST and assistant/MCP budget reads share this boundary. Disabled/no-schedule execution does not allocate an accumulation scope.
- The frontend budget API recognizes the partial response before treating it as a normal summary/array. Reports show the existing partial-FX explanation plus inspectable known components and repair/retry actions. They do not render empty/zero charts or stale previous data.
- Existing legacy snapshot limitations are distinct from FX gaps and must not be labelled as missing rates.

## Implementation

Add the scoped budget accumulator/boundary in the accrual reporting layer, declare opt-in transport metadata through ReportingEndpoint, and wrap the LLM budget status entry point. Let reportingMoneyMany accumulate only inside that boundary; strict consumers stay strict until their own contract is wired. Add a typed frontend partial-response recognizer, extend the shared report error renderer, and handle the budget detail page explicitly.

## Evidence required

Real enforced PostgreSQL budget reads with known and missing currencies: no503, no total/score/ratio, exact known subtotal and dated pairs. The complete path remains unchanged; Cash/disabled remain native. Exercise REST interception and assistant/MCP payloads, independent frontend partial/error/empty states, retry after rate repair, response list bounds, request isolation and no poisoning across sibling reads. Preserve source-ledger/balance data. Run relevant type, guard and regression gates; do not weaken thresholds or allowlists.
