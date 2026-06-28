# feat: AI Payee Organizer — categorize from name + merge duplicates

Branch: `feat/ai-payee-organizer` -> base `main` (independent)

## Why
Bulk-importing transactions can create hundreds of payees with **no default
category** (e.g. ~792 after one import). The existing category suggestion is
**history-based** (`payees/category-suggestions`, `WHERE category_id IS NOT NULL`),
so it can't help when the imported transactions are themselves uncategorized —
there is nothing to learn from. This feature fills that cold-start gap with the
user's own LLM and also consolidates duplicate payees.

## What
A new **Organize Payees** view in the AI menu (`/ai/organize-payees`) that:
1. Suggests a default category for each uncategorized payee **from the payee
   name** (Starbucks -> Coffee, Shell -> Fuel, ...).
2. Flags **high-confidence duplicate payees** to merge.
3. Lets the user review a preview (per-payee category checkboxes + per-group merge
   checkboxes) and apply selections.
4. A toggle — **"Allow AI to propose new categories"** — controls whether the AI
   may suggest creating new categories or must map to existing ones only.

## How
- **Shared service** `PayeeOrganizerService.suggest()/apply()` (`src/ai/payee-organizer/`).
  `suggest()` calls `AiService.complete()` (same path as Insights) with a dedicated
  `PAYEE_ORGANIZER_SYSTEM_PROMPT` and **defensively validates** the LLM output:
  drops hallucinated/unowned category and payee ids, one suggestion per payee,
  conservative merges only. `apply()` **reuses** the battle-tested write paths —
  `CategoriesService.create`, `PayeesService.applyCategorySuggestions`, and
  `PayeesService.mergePayees` — so no new write/transaction logic.
- **Endpoints** (JWT-guarded, userId from token):
  `POST /api/v1/ai/payee-organizer/suggest` `{ allowNewCategories }` and
  `POST /api/v1/ai/payee-organizer/apply` `{ categoryAssignments, merges }`.
- **Shared-tool rule (CLAUDE.md):** exposed in both AI surfaces via the single
  service — MCP tools `suggest_payee_organization` / `apply_payee_organization`,
  and `suggest_payee_organization` in the AI Assistant tool-executor. `apply`
  stays write-only on MCP + REST (the executor is read-only by design).

## Tests
Service, controller, MCP tool, and frontend view specs. `tsc --noEmit` clean on
both backend and frontend; new tests pass. (One pre-existing, date-dependent
`insights-aggregator` test fails on `main` independently of this change.)

## Decisions / notes for review
- **Demo mode:** `DemoModeGuard` is opt-in via `@DemoRestricted()`, and the reused
  write endpoints (merge, category create, category-suggestion apply) are not
  demo-restricted (demo relies on the daily reset). `apply` follows that same
  convention. Add `@DemoRestricted()` to the apply handler if you want it hard-
  blocked in demo mode.
- Requires the user to have an AI provider configured (AI Settings); otherwise
  `suggest` returns 400 and the view surfaces the message.
- No schema/migration changes.
