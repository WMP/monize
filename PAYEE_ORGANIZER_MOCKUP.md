# Feature mockup: AI Payee Organizer (categorize + merge duplicates)

> This is a design mockup for discussion, not a PR. Screenshots of the working
> prototype are attached separately.
>
> - **Branch (full implementation):** https://github.com/WMP/monize/tree/port/payee-organizer
> - **Running images** (if you want to click through it):
>   `ghcr.io/wmp/monize-backend:fork-ghcr-images-708264c` and
>   `ghcr.io/wmp/monize-frontend:fork-ghcr-images-708264c` (also `:latest`).

## Why this exists (the problem)

After a bulk import (QIF / CSV / bank export), two things reliably go wrong with
payees, and both are tedious to fix by hand:

1. **Hundreds of uncategorized payees.** A single import created ~792 payees with
   no default category. The existing rule-based "Auto-assign categories" only
   helps where a payee name already matches a rule; the long tail
   ("BIEDRONKA 1234", "ZABKA Z7782", "PAYPAL *SPOTIFY") is left for the user to
   open one by one and pick a category from memory.
2. **Duplicate payees from noisy bank descriptors.** The same merchant arrives as
   "Lidl", "LIDL sp. z o.o.", "LIDL WARSZAWA 0421" etc. Manual merge
   (`MergePayeeDialog`) is one-pair-at-a-time, so cleaning up a fresh import is a
   long afternoon of scrolling and comparing.

The insight: a human can glance at a payee name and its recent transaction
descriptions and *immediately* know both the right category and which entries are
the same merchant. That recognition step is exactly what an LLM is good at. So we
let the AI do the recognition and propose, and keep the human strictly as the
**reviewer who confirms** -- nothing is written to the database without an
explicit "Apply".

## What it does

One screen that turns "792 messy payees" into a reviewable worklist. For each
**slice** of uncategorized payees the AI returns a single unified list of rows,
where each row is either:

- a **singleton** payee with a suggested default category, or
- a **cluster** of likely-duplicate payees (e.g. the three Lidls) with a
  suggested surviving payee *and* a category for it.

The user reviews and, per row, can:

- tick the row to apply it (nothing is ticked by default -- opt-in, never
  opt-out, so a careless "Apply all" can't happen),
- override the AI's category from a searchable dropdown (the AI's pick is
  pre-selected; "Parent: Child" labels; can also create a brand-new category
  inline),
- for a cluster, choose **which** payee survives (radio), or mark the whole
  cluster **"Not duplicates"** -- which is *persisted* so the AI never suggests
  that grouping again on the next run,
- click any payee name to open the **same inline edit dialog used in the
  transactions view** (rename/fix without leaving the screen).

"Apply selected" commits only the ticked rows in one transaction, then drops the
resolved rows from the list and keeps the rest -- **without firing another AI
call**. (An early version re-analyzed on apply and surprised the user with an
unwanted second LLM request; that is fixed.)

### Designed around real LLM provider limits

The prototype is built to work on free / low-TPM providers (Groq, Ollama), not
just big-context paid APIs:

- **"Payees per run" (25/50/100/200)** -- analyze one slice at a time so the
  prompt never blows the tokens-per-minute ceiling. The response reports how many
  duplicate clusters remain so the user knows to run again.
- **"Merge-only" mode** -- skips the category list in the prompt (much smaller,
  cheaper) when the user only wants de-duplication.
- **"Min. transactions"** -- only spend tokens categorizing payees that actually
  get used, skipping one-off entries.
- **"Allow AI to propose new categories"** toggle (default off) -- keeps the AI
  mapping onto the existing category tree unless the user opts into new ones.

## How it is built (fits existing conventions)

- **Backend:** `backend/src/ai/payee-organizer/` -- a `suggest` endpoint (read /
  propose) and an `apply` endpoint (write). `apply` runs inside a single
  `QueryRunner` transaction: it categorizes survivors, creates any approved new
  categories, re-points the duplicates' transactions onto the surviving payee,
  deactivates the merged-away payees, and persists rejections.
- **Rejected merges are remembered:** new entity + migration
  `084_payee_merge_rejections.sql` (with `schema.sql` updated). A "Not duplicates"
  decision is durable, so re-running analysis doesn't re-suggest noise the user
  already dismissed -- the tool gets quieter the more you use it.
- **The provider is the user's configured one:** all LLM calls go through the
  existing `AiService.complete(...)` so it respects each user's chosen
  provider/model/key, same as the rest of the AI features.
- **Shared-tool rule honored:** the suggest logic is exposed both as an MCP tool
  (`backend/src/mcp/tools/payee-organizer.tool.ts`) and an AI-assistant tool
  (`suggest_payee_organization` in the tool-executor), returning the same shape,
  per the repo's "every AI data tool lives in both surfaces" rule.
- **No new money math, no schema risk beyond the one additive table.** Merging
  reuses the existing payee-merge path; categorization reuses the existing
  category/payee update paths.

## Open design question: where should this live?

The prototype currently sits under the **AI menu** as its own page
(`/ai/organize-payees`). On reflection I think that is the wrong home, and I'd
like your call before this becomes a real PR.

**Recommendation: move it into the Payees screen as one more toolbar action**,
next to the actions that already live there:

- `Deactivate unused` (bulk maintenance)
- `Auto-assign categories` (rule-based -- the AI organizer is the smarter sibling
  of exactly this)
- per-row `Merge` (manual -- the AI organizer is the bulk version of exactly this)

Rationale:

1. **It is a payee-maintenance task, not a chat task.** Everything it does
   (categorize, merge, deactivate) already has a manual equivalent on the Payees
   page. Discoverability is far better when "let AI tidy these up" sits right
   beside "auto-assign" and "merge", at the moment the user is staring at the
   mess.
2. **It composes with the existing payee tooling.** The rule-based auto-assign
   handles the easy matches for free (no tokens); the user then reaches for the
   AI button only for the long tail. Putting them side by side makes that
   workflow obvious.
3. **The AI menu reads as "talk to an assistant".** A dedicated review-and-apply
   grid is a different interaction model and is a bit of a stretch there.

Concretely that would mean: keep the backend endpoints and the MCP/assistant
tools exactly as they are (so the assistant and MCP can still drive it), and
surface the UI as an **"Organize with AI"** button in the Payees toolbar opening
the same review grid (modal or sub-page) instead of an AI-menu page. If you'd
rather keep AI features grouped under the AI menu for consistency, that's an easy
alternative -- I just wanted to flag that the natural home, by task, is Payees.

Happy to adjust the placement (and the wording -- the prototype strings are
English-only for now; full i18n for all locales would land with the real PR) once
you tell me which way you'd like it.
