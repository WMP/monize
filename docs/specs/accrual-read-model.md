# Accrual read-model redesign contract

Approved direction: owner requested the first-principles redesign on 2026-10-27 after maintainer performance feedback on PR #1883. Preserve the existing schedule editor, equal allocations, source-edit validation and allocation persistence. Replace the ledger-wide table-shadowing read strategy.

## Invariants

1. Disabled accruals execute ordinary cash queries. New defaults are cash. Existing schedules and saved choices are retained when disabled; source writes continue maintaining their existing schedules through scoped transactions so re-enabling cannot expose stale allocations.
2. A selected accrual view with no relevant schedules may execute native queries, but selection, response identity, pagination and cache semantics remain consistent. Resolve eligibility across the authorized owner/joint-account scope once per read; do not cache schedule existence across requests.
3. Recognition rows are a read model, not bank transactions. Existing stored allocations are the recognition facts. Unscheduled components retain their cash date. A scheduled component contributes only its allocation on its effective date.
4. Explicit reporting relations use distinct names. They do not shadow transactions, splits, tags or investments through same-name CTEs. Cash readers and unrelated entities never consult them. Query factories select the appropriate read-only entity/relation explicitly.
5. Ordinary SQL views are a candidate implementation: SECURITY INVOKER preserves caller RLS, explicit typed columns avoid JSON record reconstruction, UNION ALL keeps unaffected rows on indexed base-table branches, and aggregation is limited to affected sources. Actual query plans and performance tests decide whether this is sufficient.
6. Account, owner, date and identity restrictions must reach the appropriate base/recognition branches before expensive work. Recognition dates, not payment dates, decide which allocation is in a reporting window. A payment outside the window with allocations inside must remain visible.
7. Register count, ordering and page selection share the same effective rows. Visible rows retain stable report/source identities and parent navigation; bank balances and reconciliation retain cash semantics.
8. Prepaid/unearned balances continue to derive from settlement versus recognition through the selected date. No second complete journal or duplicate bank transactions.

## Numerical and edge examples

A USD -1200 payment on 2026-10-15, spread October through September, remains one -1200 cash payment. Accrual reporting recognizes -100 per month. Filtering November includes its allocation even though the cash date is October. A split with an unscheduled -20 and scheduled -120 contributes -20 at payment and the scheduled monthly components at their effective dates. Rounding remainder stays in the final allocation. Disabling restores cash presentation without deleting either schedule.

Missing FX keeps existing refusal/nullable-total contracts appropriate to each reader; source-entered rates, native precision and tenant/delegate masking must not change.

## Acceptance matrix

- Feature disabled; enabled with zero, one and many schedules.
- First/last schedule creation/deletion changes execution strategy on the next read.
- Source edit while disabled, then re-enable: allocations match the edited source.
- Whole transaction and partial split schedules; past/future dates; category/payee/tag filtering; transfers and investments; stable pagination/count; FX completeness; RLS and joint/delegate scope.
- Real PostgreSQL ledger: 35,738 transactions, 10,281 splits, one 641-row account and predominantly absent link/parent relationships. Record count/page latency, EXPLAIN (ANALYZE, BUFFERS), and query work for zero/one/many schedules. Initial generous 5-second local/CI ceiling catches the 48-second failure; compare to native cash and tighten only with measured evidence. A no-schedule optimization alone does not satisfy acceptance.

No production deployment is part of this task. Additive migrations and schema remain paired; preserve applied migrations and do not reset explicit preferences blindly.
