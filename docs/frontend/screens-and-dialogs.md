# Frontend: screens and dialogs

How a list page, a detail page and a dialog are put together, so a new feature looks like the screens users already know. Read this before adding a page, a dialog or a toolbar. `ui-conventions.md` says which component to use for a single control; this document says how the controls are arranged.

Paths beginning with `src/` or `scripts/`, and layer configuration filenames, are relative to `frontend/`; other source paths (including `test/...`) are relative to `frontend/src/`. Explicit repository prefixes are preserved.

## Copy the established screen, never the most recent one

The reference screens are the ones users spend their time on: **Transactions, Investments, Securities, Currencies, Accounts** and the New/Edit Transaction dialog. Before building a screen, open the reference screen of the same kind and put the two side by side.

Do not take the pattern from the most recently merged feature. A recent screen is not yet reviewed against the rest of the app, and an agent that searches recent commits for "how this repo does it" spreads its drift to the next feature. This rule came from PR #1890: the shared-expenses screens copied the `Modal` header and the AI-review/email-receipt layouts, which had themselves drifted from the reference screens. If a recent screen and a reference screen disagree, the reference screen wins, and the recent screen is a defect to report.

## A dialog looks like New Transaction

| Do | Do not |
|---|---|
| Large bold title (`text-2xl font-bold`) at the top of the content padding | A small title in a header strip |
| Close with Cancel / Close in the button row, Escape and backdrop | An X button in the corner as well as Cancel |
| Spacing between header, body and buttons | A full-width line under the header or above the buttons |
| A divider, when one is needed (under form tabs), inside the content padding | A divider that runs edge to edge of the panel |
| Explanation in an `InfoTooltip` beside the label or title | A paragraph under the title or above the buttons that every user must read again on each open |
| One primary button: the action that saves or confirms | A second primary button (a link to another page styled as primary) |

`Modal`'s `title` prop still wires `aria-labelledby`, which is the accessibility fix it was added for. Its visual header must render as the table above says. Until `Modal` does that, a new dialog does not add borders or an X of its own around the `title` header.

A dialog that is a form with a secondary save mode ("Save & New") uses `SplitSubmitButton`, as Create Transaction does. Do not add a separate button or a separate flow for it.

## Field labels

- **Title Case nouns**, as in the rest of the app: "Account Name", "Funds From (optional)", "Price per Share". Articles, short prepositions and conjunctions stay lower case ("Share a Private Document", not "Share A Private Document").
- **A label names the field; it is not a question.** "Description", not "What was it for?".
- **Optional fields** end with "(optional)". Required fields have no marker.
- **A field whose meaning is not obvious gets an `InfoTooltip`.** Test it with a real case: "I am on holiday in Germany. Do I pick PLN or EUR?" If the label alone does not answer that, rename the field ("Settlement Currency") or add the tooltip.

## Money entry

The currency of an amount is chosen with `CurrencyPickerButton` beside the amount field, as in New Transaction. Do not add a separate Currency select next to the amount. The amount field shows the currency symbol from `CurrencyInput` (`zł 400.00`); do not show the ISO code as a prefix.

## A list page looks like Currencies and Securities

Top to bottom:

1. **`PageHeader`**: title, optional help icon, one-line subtitle. The actions on the right: secondary actions (Refresh, Refresh Rates) as bordered buttons, then the one primary "New …" button last.
2. **Summary row**: `SummaryCard`s with an icon each (`SummaryIcons`), in one grid with one gap. Do not use a free-form card with a `<dl>` inside.
3. **Toolbar row**: the search field first, then the filter segments, wrapping on a phone (`flex-wrap`, `w-full sm:w-auto`, `sm:ml-auto`; see `ui-conventions.md`).
4. **The list**: a table (`CurrencyList`, `SecurityList` are the models), with `Th`/`Td`, a clickable row through `useLongPress({ onClick })`, and row actions at the right. Cards in a grid are for a dashboard, not for a list of records the user scans, sorts and compares.
5. **`Pagination`** below the table when the list pages.

### Search

- **No label above the search field.** The placeholder says what is searched: "Search by symbol or name…", "Search by code or name…".
- **The list filters while the user types.** Do not add a "Search" button. A search that needs a server round trip is debounced, not submitted.
- Search syntax help, when there is any, is the `SearchSyntaxHelp` pattern beside the field (Transactions).

### Filters

- **A filter of one list is the segmented control** (`SEGMENTED_GROUP_CLASS` + `segmentClass`), next to the search, **with counts**: "All (9)", "Active (3)", "Inactive (6)".
- **Filters are always visible.** Do not fold People / From date / To date behind a `<details>` "Filter by …" disclosure. A filter the user cannot see is a filter the user forgets is applied.

### Refresh and export

- **Refresh** is a bordered button with an icon. When the data has an age, the button shows it ("Refresh (3 hours ago)"). It is never loose text at the end of a row.
- **Export** is the export control of `ListTopToolbar` (or `ReportToolbarActions` in a report). It is never a text button in the filter row.

## Navigation between views is `Tabs`; a segmented control filters one list

| The control switches … | Use |
|---|---|
| between different views or sections of a page (Groups / People; Expenses / Balances / Files / Settings) | `Tabs` (`components/ui/Tabs.tsx`), as on the security, payee and category detail pages |
| the subset of one list (Active / Archived, All / Pending / Applied) | the segmented control, with counts |
| the shape of one view (Table / Calendar) | `ViewModeToggle` |

The two look different on purpose: `Tabs` says "you are now somewhere else", the segmented control says "the same list, filtered". Using the pill for navigation makes a section look like a filter.

## A detail page looks like the security detail page

- Chevron + "Back to <List>" **above** the title, and `EntitySwitcher`'s caret after the title (`ui-conventions.md`, "A detail page returns to its list above the title"). Not "All <Things>".
- Actions on the title row, primary last.
- `SummaryCard` row, then `Tabs`, then the tab's own toolbar and list as on a list page.

## Repeated sections use the existing layout

When a section already exists on a reference screen, the new screen uses the same component and the same layout, even when it shows other data:

- **Attachments**: `AttachmentsSection` as in New Transaction. "Attachments" label on the left, the buttons on the right, "No attachments yet" below. No extra card around it, no `EmptyState` with an icon inside a form. An extra action (share a document) goes into the same button row.
- **Warranties**: the same row layout as Attachments.

## Buttons with the same label do the same thing

- Two buttons on one screen with the same label do the same action and have the same style. If one of them does something else (records a payment that is not in the list), it gets its own label ("Record Other Repayment").
- A row action repeated on every row is an outline button or a `RowActions` entry. A screen-level action is in the header or the toolbar, not below the last row.

## Switches have labels

`ToggleSwitch` always has its visible label beside it. A switch with no text next to it, or with a button attached where its label should be, cannot be understood without trying it. A navigation link next to a switch goes on its own line.

## Before you open the PR

Put the new screen next to its reference screen at the same width and check:

- [ ] dialog: title size, no X, no full-width lines, one primary button, help in tooltips
- [ ] labels: Title Case nouns, "(optional)", no questions
- [ ] money: currency picker beside the amount
- [ ] list page: `PageHeader` actions, `SummaryCard` row, search with placeholder and live filter, segments with counts, table, `Pagination`
- [ ] navigation with `Tabs`, filters with the segmented control
- [ ] filters always visible; refresh and export in their standard places
- [ ] existing sections (attachments, warranties) use their component and layout
- [ ] no two buttons with the same label and different behaviour
- [ ] at 375 px nothing leaves the screen
