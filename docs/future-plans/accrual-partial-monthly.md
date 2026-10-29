# Partial FX for monthly recognition charts

Extend the reviewed partial budget read boundary to the monthly transaction HTTP read only. Direct internal service calls remain strict. Native Cash/no-schedule requests preserve the original array and SQL path.

## Contract

An active Accrual monthly read with missing FX returns the existing explicit incomplete-result object, known components with currencies/dates and missing pair/date repair metadata. It must not return a zero monthly chart, a complete total or invented seasonality. Complete reads retain the array shape. The frontend API recognizes the response before treating it as an array.

The register, category detail and payee detail retain independent successfully loaded data. Their monthly panel renders the shared known-component/repair/retry notice. Category/payee seasonality is withheld through the same error boundary; monthly-average cards remain unknown. Any ordinary monthly request failure is also a panel error, not an empty chart. Async errors belong to the same request key as their data.

## Edits and verification

Opt in the monthly controller via ReportingEndpoint partial-read metadata; reuse its existing accumulator and bounded diagnostics. Add recognition-aware conversion checks to the HTTP interception integration fixture, including rate repair. Add typed API and register/category/payee panel tests, including stale response and ordinary-error cases. Preserve direct strict service regressions. Run focused types/tests, then update server records before final whole-branch gates. No mutation or closing route opts in.
