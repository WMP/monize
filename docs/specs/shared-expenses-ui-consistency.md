# Shared expenses: unified split and screen consistency

Status: requester-authorized refinement, 29 October 2026. The request to read
and implement the feedback authorizes this iteration; upstream acceptance and
the `approved-to-build` label remain separate.

Sources: [WMP's review](https://github.com/kenlasko/monize/discussions/1889#discussioncomment-19254373),
its follow-up about the transaction dialog, and the approved
`docs/frontend/screens-and-dialogs.md` contract. This refines the presentation
in `docs/specs/shared-expenses-ui-polish.md`; its group-only boundary still holds.

## Scope

Use existing dialog, form, summary, tab, table, filter, attachment and paging
components. Short Title Case labels and `InfoTooltip` replace instructional
labels and passive help blocks. Settlement Currency explains the currency of
group balances even when individual purchases use another currency. Keep
Activity, independent payers/beneficiaries, selected people and explicit zero.
Do not add accounts, posting, transaction matching, dependencies or migrations.

The shared `Modal` chrome is being handled separately by WMP. Keep its accessible
`title`; do not patch global chrome or add a second header. Use the normal
transaction form's presentation controls, not its private-transaction submission
path. Single-save forms use `FormActions`; no invented second save action.

## Unified split editor

One participant list replaces the split-mode tabs. Amount, percentage and relative
shares are adjacent ways to edit the same split, with a keyboard-accessible
percentage slider and an Equal reset. Editing amounts or percentages pins those
values; clearing a field releases it to the equal remainder. Excluding a person
does not remove them from the group or alter the payer. Relative shares use the
existing WEIGHT instructions. Existing exact/percentage instructions open pinned.

Keep the current input unchanged until Apply. Opening and applying an unedited
split retains its mode/instructions and backend rounding seed. Use the existing
`splitRemainderEqually` helper for explicit remainder instructions and the existing
server preview for rounded final amounts. Percentage/weight readouts are ratios,
not a second allocation algorithm. Applying an edit updates the parent draft;
only the parent's current accepted server preview can enable the expense save.

The split preview may use a temporary description and a neutral contribution
when those unrelated fields are unfinished. It performs no write, preserves the
operation/entry identity and only supplies SHARE allocations to this dialog.
The expense preview still validates the actual description and payer totals.
An old or failed preview never supplies amounts for the current draft. Missing
amounts are disclosed, not replaced by zero. Templates edit proportions without
presenting their artificial basis as money.

| Input | Expected result |
| --- | --- |
| Three people, 400, equal | Server allocates 133.34/133.33/133.33 according to the existing seed; opening the editor does not move the extra cent. |
| 400, one fixed coffee of 20, two unfilled people | EXACT 20/190/190. |
| 100, fixed 20 and explicit 0, three unfilled people | 20/0/26.67/26.67/26.66 using the existing remainder helper. An excluded sixth person has no share. |
| One fixed 40 percent, two unfilled people | PERCENT 40/30/30. |
| All percentage fields explicitly total 99.99 | Refuse Apply; identify the missing 0.01. Do not normalize explicit values. |
| Fixed amounts exceed total, or all shares are zero | Refuse Apply; retain editable values. |
| Relative shares 2/1/1 | Server allocates half/quarter/quarter with existing rounding. |
| Cancel, unchanged edit, delayed or failed preview | Cancel leaves parent untouched; unchanged edit round-trips; stale amounts are withheld. |

## Screens and evidence

Overview: summary cards with icons, live placeholder search, Active/Archived
counts, header Refresh, navigation Tabs and the existing table/pager. Detail:
Back to Shared Expenses, summary cards, Tabs including Activity, live debounced
search, visible People/From/To filters, `ListTopToolbar` export and normal pager.
Keep stale-row actions disabled while a newer filter request is pending.

Attachments share the existing header with Scan/Add/Share a Private Document;
plain empty text replaces the decorative empty card. Repayment suggestions and
Record Other Repayment use outline buttons. Existing managed-account editing
gets a visible switch label, secondary finance navigation and one primary save.

Relevant invariants: SE-001, SE-003 through SE-009, SE-012, INV-DISPLAY-001.
Financial allocation and authorization mechanisms are unchanged. Focused tests
cover the numerical table, cancellation, stale preview, navigation, visibility,
upload retry and managed-account controls. Check actual browser persistence and
320/390px layouts; capture synthetic-data screenshots after the production build.

