# Shared expenses: implementation plan for the UI review

Status: Approved for implementation on 28 October 2026.
Specification: `docs/specs/shared-expenses-ui-polish.md`.
Task list: `docs/future-plans/shared-expenses-ui-polish-tasks.md`.

The plan addresses Ken's 28 October PR review. The source is linked in the
specification, which maps all 11 comments and specifies the proposed FX policy.
The requester approved the complete specification, including the private FX policy.

## Baseline and constraints

- Published revision: `dede6ceb934f3fdca8f5b23746bad83823318c38`, including
  Ken's merge of main. Local revision during analysis: `f08198611`.
- Relevant shared-expense/form files are unchanged between those revisions.
- Synchronize the feature branch by fast-forward after rechecking its state;
  preserve external commits. Do not rebase or force-push for this synchronization.
- No Docker, dependency changes, schema migrations, guard exceptions or release
  infrastructure changes are included. A newly discovered need is reported.
- The PR remains a draft until the maintainer agrees it is ready. User approval
  of this specification is not a claim of upstream merge approval.

## Edit map and observations

| Concern | Existing entry points | Observe after change |
| --- | --- | --- |
| Single-form save and documents | `frontend/src/components/shared-expenses/SharedEntryEditor.tsx`, `frontend/src/components/shared-expenses/SharedDocuments.tsx`, `frontend/src/components/transactions/AttachmentsSection.tsx` | Successful Save closes; a failed upload retries on the saved entry in place. |
| Tables and filter presentation | `frontend/src/app/shared-expenses/page.tsx`, `frontend/src/app/shared-expenses/[groupId]/page.tsx`, `frontend/src/components/transactions/TransactionFilterPanel.tsx`, `frontend/src/components/ui/Table.tsx` | Consistent filter/table styling; original data and responsive actions preserved. |
| Money controls | `frontend/src/components/shared-expenses/SharedPrimitives.tsx`, `frontend/src/components/transactions/CurrencyPickerButton.tsx`, `frontend/src/components/shared-expenses/SharedSplitEditor.tsx` | Standard square selector and money input; precision and bound currencies retained. |
| New versus matched payment | `frontend/src/components/shared-expenses/SharedBooking.tsx`, `frontend/src/components/shared-expenses/SharedBankPaymentEditor.tsx`, `frontend/src/components/shared-expenses/SharedCombinedBooking.tsx`, `frontend/src/components/transactions/TransactionForm.tsx` | Standard creation form; matched facts read-only; no premature private write. |
| Historical candidates | `frontend/src/components/shared-expenses/SharedTransactionPicker.tsx`, `backend/src/shared-expenses/shared-finance.controller.ts`, `backend/src/shared-expenses/shared-finance.service.ts`, `backend/src/transactions/transaction-search-query.util.ts` | Eligibility before paging, All Dates, stable order, explicit failed/empty states. |
| Category/FX semantics | `backend/src/shared-expenses/shared-bank-payment-plan.ts`, `backend/src/shared-expenses/shared-finance-plan.ts`, `backend/src/shared-expenses/shared-finance-write.ts`, `backend/src/shared-expenses/shared-finance-preview.ts`, `backend/src/shared-expenses/dto/shared-finance.dto.ts` | Numerical spec cases hold in saved rows, private reports and group balances. |
| Contracts and consumers | `docs/specs/shared-expenses.md`, `docs/specs/shared-expenses-ux.md`, `docs/specs/shared-expenses-consumers.md`, `docs/frontend/ui-conventions.md`, `docs/frontend/forms-and-formatting.md` | Rules name the reused abstractions, changed figures have one server answer, old behavior is explicitly superseded after approval. |

Keep components and helpers focused. Any extracted filter/form presentation
must serve both callers and preserve ordinary Transactions behavior. Do not turn
this into a general form-builder or redesign unrelated pages.

## Delivery order

1. Approve and commit the spec before product changes; pin the synchronized head.
2. Add focused regressions for save/attachments, table/filter conventions and
   currency controls; implement that UI slice.
3. Reuse normal transaction creation with the shared submission adapter; separate
   matched-source allocation and make historical matching searchable.
4. Implement the approved category/FX policy with real database evidence,
   compatibility and report checks; preserve group arithmetic.
5. Run the required gate once on the assembled change, fix actual failures,
   finish locale parity, capture working screens and publish the verified commits.

These are parts of one review iteration, not a commitment to repeated full
audits. Further scope comes from concrete feedback or a demonstrated defect.
