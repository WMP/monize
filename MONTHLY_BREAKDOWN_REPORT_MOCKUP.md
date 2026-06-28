# Feature mockup: Monthly Category Breakdown report

> This is a design mockup for discussion, not a PR. Screenshots of the working
> prototype are attached separately.
>
> - **Branch (full implementation):** https://github.com/WMP/monize/tree/port/monthly-breakdown-report
> - **Running images** (if you want to click through it):
>   `ghcr.io/wmp/monize-backend:fork-ghcr-images-708264c` and
>   `ghcr.io/wmp/monize-frontend:fork-ghcr-images-708264c` (also `:latest`).

## Why this report matters to me

This is the report I rely on most for actually managing my money, and **the exact
form of it matters to me a great deal** -- I would like Monize to reproduce it as
faithfully as possible. I designed and built this report before, for another
finance app, and the workflow it gives me is the reason I want the same thing
here. Let me explain what I do with it, because the value is in the workflow, not
just the table.

**1. It is my monthly budget overview, spreadsheet-style.** I want one dense grid
with **categories down the side and months across the top**, the way I'd lay it
out in a spreadsheet. That single view is how I run my household budget: I can see
twelve months of every category at once and actually read the *trend* -- is dining
out creeping up, did utilities spike in winter, is my saving rate holding. The
reports that already exist (summaries, transaction lists, timeline charts,
per-category pie charts) each give an aggregate or a single-period slice. None of
them let me see the whole year of every category side by side, and you cannot read
a trend by clicking through twelve separate monthly pie charts.

**2. Grouping by my own top-level categories is what makes it readable.** The rows
are grouped into sections by their **parent (top-level) category** -- Income,
daily living expenses, fixed obligations, savings, and so on -- with a colored
header and a subtotal per section. This matters because it mirrors how I actually
think about money: not as 60 flat categories, but as a handful of buckets. Crucially
it keys off *my own* category hierarchy, so whatever structure I've built (and
however I re-parent or rename categories over time) the report reorganizes itself
to match -- no hardcoded category list to maintain. Categories that sit at the top
level but still carry direct transactions fall into an "Other" section so nothing
silently disappears from the totals.

**3. The color-coded deviation is the point, not decoration.** Each cell is shaded
by how far that month is from that category's *own* average -- not from some fixed
budget I have to set up. That is deliberate: I don't want to maintain budget
targets, I want the report to tell me "this month is unusual for *you*". For
expenses, above-average shades red and below-average shades green; for income it
is reversed (a high-income month is good, so green). It only kicks in once a
category has at least three non-zero months, and zero months are excluded from the
average, so the highlighting is meaningful and not noise. The result: I scan the
grid and the anomalous months jump out by color, without reading a single number.

**4. Drill-down without losing my place is how I investigate.** When a cell looks
off, I click it and immediately see the transactions behind exactly that month and
category; when I go back, I'm returned to the breakdown with my context intact.
That tight "spot it in the grid -> open the transactions -> back to the grid" loop
is the whole analysis workflow for me, and it has to feel instant and stateful,
not like reloading a report from scratch each time.

**5. Signs and totals have to read cleanly.** Inflows and outflows are shown with
explicit signs and consistent classification, including in the per-section
subtotals and the per-month grand totals (income, expenses, balance). At a glance
I can tell a deduction from a credit even at the parent-summary level, which is
where ambiguous signs used to bite me.

So the shape I'm asking to keep is exactly that: a category-by-month matrix,
grouped by my parent categories, color-coded against each row's own average, with
one-click drill-down to the underlying transactions and clean signed totals.
Matching that form and that workflow closely is the whole point for me -- I'd
much rather have this than another aggregate chart.

> Scope note: today this is a cashflow report -- it covers standard income and
> expense transactions. Investment transactions (buying/selling securities) are
> deliberately out of scope for now and excluded from the figures, the same way
> the other category reports treat investment accounts. If I want money moved into
> investing to show up, I classify the transfer to the brokerage account as an
> ordinary categorized transaction. Full investment-asset support in this report
> would be a later step.

## What it does (the form to reproduce)

- **Matrix layout.** Rows are categories, **grouped under their parent category**
  into colored sections; columns are months in the selected range. Parent groups
  are sorted by magnitude so the biggest movers are at the top.
- **Income vs expense classification.** Each category is classified as income or
  expense (by whether its deposits exceed its withdrawals over the range) and
  rendered with a consistent sign so a row reads cleanly left to right.
- **Per-row Average + per-section subtotals.** Each row shows its monthly average
  alongside the months; each parent section has a subtotal row in the section's
  accent color.
- **Color-coded deviation (the heat map).** Each month cell is shaded by how far
  it deviates from that row's own average. Highlighting only kicks in once a
  category has at least 3 non-zero months, and zero-value months are excluded
  from the average. For expenses, above-average is "bad" (red); for income,
  above-average is "good" (green). This is what makes an unusual month jump out.
- **Absolute / percentage toggle.** A switch flips every value between absolute
  amounts and a percentage of the period total (income categories against total
  income, expense categories against total expenses).
- **Monthly grand totals.** Footer rows for total income, total expenses, and the
  net balance per month, with sums and averages.
- **Drill-down.** Clicking a cell navigates to the transactions list filtered to
  that month and the category (or all categories in a section), so you go from
  "that month looks high" to the actual transactions in one click.
- **Date range.** The report takes a start/end range; the matrix expands to
  however many months that covers.

## How it is built (fits existing conventions)

- **Backend:** `backend/src/built-in-reports/monthly-category-breakdown.service.ts`
  with a DTO and a `GET /built-in-reports/monthly-category-breakdown` endpoint,
  wired into the existing `built-in-reports` module -- the same shape as the other
  built-in reports.
- **One SQL aggregate, then in-memory shaping.** A single parameterized query
  aggregates deposits and withdrawals per (category, month, currency). It mirrors
  the exclusions the other category reports already use: transfers, voided rows,
  split parent rows, INVESTMENT accounts, and the synthetic asset-value-change
  category are all excluded, so the numbers tie out with the rest of the app.
- **Multi-currency aware.** Amounts are converted to the user's default currency
  via the existing `ReportCurrencyService` rate map before aggregation, so a
  mixed-currency account set still produces one coherent table.
- **Financial math per the repo rules.** All money goes through the shared
  `roundMoney` / `toMoneyNumber` helpers, so the response never carries floating
  point drift.
- **Frontend:** `MonthlyCategoryBreakdownReport.tsx` -- the original Bootstrap
  layout I built this report in, translated to this app's Tailwind and registered
  in the reports registry under the "spending" category. The deviation thresholds
  and section palette are carried over so the look matches.
- **Fully internationalized.** Unlike the two AI mockups, this one is already
  wired through `next-intl`: the report name/description resolve via the i18n'd
  reports registry, and `page.names.monthly-category-breakdown` /
  `page.descriptions.monthly-category-breakdown` are added to every locale (Polish
  gets a real translation; the rest fall back to English). The parity test and
  `i18n:check` pass. So this one could go in as a normal PR without an i18n
  follow-up.

## What I'd like from you

Mainly: a yes on bringing this report in. Faithful reproduction of *this* form --
the category-by-month matrix with section grouping, deviation heat map, and
drill-down -- is the whole point for me, so I'd rather not see it simplified down
to another aggregate chart. If anything about the classification rules, the
deviation thresholds, or the exclusions should differ to fit Monize's
conventions, I'm glad to adjust; I just want the resulting report to keep that
shape and read the way it does in the prototype.
