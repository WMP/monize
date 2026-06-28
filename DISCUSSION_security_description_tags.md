# Discussion: security description + user tags, and a portfolio chart by tag

## Problem / motivation

Securities today carry only structured fields (symbol, name, type, currency, sector/industry). There is no place to:

- **Describe an instrument** in your own words (or pre-filled from the provider) — what it actually is.
- **Label instruments with your own classification** that cuts across the provider's `securityType`/`sector`. A real example: one ETF is "All-World", another is "AI/semis", another is "bonds". These are *my* buckets, not Yahoo's sectors.

And because there is no such label, you cannot answer the question that motivates this: **"how is my portfolio split across my own themes?"** — e.g. a pie of portfolio value by tag (All-World vs AI vs Bonds vs …).

## Goal

1. A free-text **description** on a security, optionally pre-filled from the price provider.
2. User-defined **tags** on securities (many-to-many), reusing the existing tag system.
3. A **portfolio allocation chart grouped by tag**, alongside the existing allocation-by-security and sector-weightings views.

## What already exists (reuse, don't reinvent)

- **Generic `Tag` entity** (`backend/src/tags/entities/tag.entity.ts`): `userId`, `name`, `color`, `icon`, case-insensitive unique per user. Already attached to transactions and splits via composite-PK join tables (`transaction_tags`, `transaction_split_tags`, `onDelete: CASCADE`). The same pattern extends cleanly to securities. Full tag CRUD + UI (`TagForm`, `TagList`, `lib/tags.ts`, tag chips) already exist.
- **`Security` entity** (`backend/src/securities/entities/security.entity.ts`): has `sector`, `industry`, `sectorWeightings` (JSONB), `quoteProvider`, but **no `description`**.
- **Allocation grouping precedent**: `PortfolioCalculationService.buildAllocation()` turns holdings into `AllocationItem[]` (`name`, `symbol`, `type`, `value`, `percentage`, `color`), and `GET /portfolio/sector-weightings` already groups holdings by an attribute. Grouping by tag is the same shape.
- **Chart**: `frontend/src/components/investments/AssetAllocationChart.tsx` (Recharts donut + legend) is reusable.
- **Provider profile data** (verified against Yahoo `quoteSummary`, see Appendix): stocks expose a full text description + sector/industry; ETFs do **not** expose free text but do expose fund family, asset-class split, expense ratio and yield.

## Proposal

### Part 1 — Security description

- Add `description TEXT NULL` to `securities` (entity + `schema.sql` + create/update DTOs with `@IsOptional() @IsString() @MaxLength(...) @SanitizeHtml()`).
- Surface it in `SecurityForm` (textarea) and the security detail/list.
- **Pre-fill from provider** (optional button "Fetch from Yahoo"), best-effort, always user-editable, never silently overwriting a manual edit:
  - **Stock**: `summaryProfile.longBusinessSummary` (full prose) → description; `sector`/`industry` already stored.
  - **ETF/fund**: no prose available; synthesize a one-liner from `quoteType.longName` + `fundProfile.family` + `topHoldings` asset-class split + `feesExpensesInvestment` + yield, e.g. *"Global aggregate bond ETF (iShares/BlackRock). ~99% bonds, ~1% cash. TER 0.10%, yield 3.14%."*
  - Requires the Yahoo **cookie + crumb** flow for the `v10/quoteSummary` endpoint (the current `YahooFinanceService` only uses the crumb-free v8 chart API) — a contained addition: fetch+cache a crumb, refresh on 401. Reuse `throttledFetch`. Treat as the same "authoritative source, human can override" pattern we used for security currency / FX rate.

### Part 2 — Security tags

- New join entity + table **`security_tags`** (composite PK `security_id, tag_id`, both `onDelete: CASCADE`, index on `tag_id`) — mirrors `transaction_tags` exactly.
- Reuse the **existing `Tag` pool** (no new tag entity). `SecuritiesService` gains `setSecurityTags(securityId, tagIds, userId, queryRunner?)` and `findByTag(userId, tagId)`, mirroring `TagsService.setTransactionTags`.
- Reuse the existing tag picker (chips + create-on-the-fly) in `SecurityForm`; show tag chips in `SecurityList`.
- `GET /securities` (and detail) return the security's tags so the UI can render/filter.

### Part 3 — Portfolio allocation by tag

- `PortfolioCalculationService.buildAllocationByTag(...)`: same inputs/colors/sort as `buildAllocation`, but the grouping key is the security's tag(s). Cash and untagged holdings get their own buckets ("Cash", "Untagged").
- `GET /portfolio/allocation/by-tag?accountIds=...` returning the existing `AllocationItem[]` shape (with `type: 'tag'`).
- Frontend: reuse `AssetAllocationChart` with a `groupBy: 'security' | 'sector' | 'tag'` toggle (or a sibling chart), plus `investmentsApi.getAllocationByTag()` with the existing 60s cache.

## Key design decisions / open questions

1. **Multi-tag allocation (the main one).** A security can have several tags. How does its value enter the by-tag chart?
   - **A — overlapping exposure (recommended):** the holding's full value counts once under *each* of its tags. Answers "how much of my portfolio touches AI?" Percentages can sum >100%; label the chart as "exposure by tag", not a strict partition.
   - **B — partition:** split a holding's value across its tags (equally or by a per-tag weight) so the pie sums to 100%. Cleaner pie, but the split is arbitrary unless we add per-(security,tag) weights.
   - **C — single dimension:** chart only one tag "group" at a time (e.g. a tag namespace/dimension), so each security contributes to exactly one slice.
   Recommendation: ship **A** first (simplest, most useful), revisit B/C if needed.

2. **Shared vs. namespaced tag pool.** Reuse the same tags as transactions (one "AI" tag everywhere) or a separate security-only namespace? Reusing the pool is least code and tags-are-just-labels; downside is the picker lists transaction-context tags too. Proposal: **reuse the pool** in v1; optionally add a `scope`/usage hint later if it gets noisy.

3. **Untagged + cash buckets** in the by-tag chart — include as explicit slices (recommended) or exclude?

4. **MCP/AI parity.** Per the shared-tool rule, extend the consolidated `manage_securities` tool (+ AI equivalent) to accept `description` and `tags` on create/edit. Proposed as a small follow-up, not blocking Parts 1–3.

## Delivery — a single PR

This ships as **one PR**: description, tags, and the by-tag chart are one cohesive concern ("classify securities and see the portfolio by your own classification") — splitting them would land half-features (tags with nothing to view them by, a chart with nothing to group). The shared-tool rule also wants the MCP/AI side wired in the same PR as the data model. Internal build order within the PR:

1. Schema + `Security.description` + `security_tags` join entity/table (+ `schema.sql`).
2. Backend: DTOs, `SecuritiesService` (`setSecurityTags`, `findByTag`), tags returned on read; Yahoo profile pre-fill in `YahooFinanceService` (cookie+crumb).
3. Portfolio: `buildAllocationByTag` + `GET /portfolio/allocation/by-tag`.
4. Frontend: description textarea + tag picker in `SecurityForm`, tag chips in `SecurityList`, by-tag toggle in `AssetAllocationChart`.
5. `manage_securities` MCP tool + AI equivalent accept `description` + `tags` (both layers in sync).
6. i18n (English-first) + tests across the touched layers.

## Conventions to honour

- **Single concern**: one PR, but it stays a single cohesive concern (classify securities + view the portfolio by that classification); description, tags, chart and the MCP/AI parity are facets of it, not separate features.
- **i18n**: English-first new keys in `securities` catalogs (front + back), regenerate pseudo-locale; full locale pass at acceptance.
- **Security**: `@SanitizeHtml()` on description, `ParseUUIDPipe` on ids, `userId` from JWT, parameterised queries.
- **Tests**: `securities.service.spec` (setSecurityTags/findByTag), `portfolio-calculation.service.spec` (buildAllocationByTag, incl. multi-tag + untagged + cash), `SecurityForm.test` (description + tag picker).
- **Schema**: update `database/schema.sql` alongside the migration.

## Out of scope

- Full provider holdings list (Yahoo's public API returns it only partially/empty — verified on AGGG.L).
- Auto-tagging / rules engine (manual tags only for now).
- Per-(security,tag) weights (only needed if we pick partition option B).

---

## Appendix — verified Yahoo profile data (AGGG.L vs MSFT)

`v10/finance/quoteSummary` (needs cookie+crumb):

- **MSFT (EQUITY):** `summaryProfile.longBusinessSummary` ≈ 1975 chars of prose; `sector="Technology"`, `industry="Software - Infrastructure"`.
- **AGGG.L (ETF):** no `longBusinessSummary`; `quoteType.longName="iShares Core Global Aggregate Bond UCITS ETF USD (Dist)"`; `fundProfile.family="BlackRock Asset Management Ireland - ETF"`, TER 0.10%; `topHoldings` asset split bonds 99.4% / cash 0.6% / equity 0%, plus `bondRatings`; `summaryDetail.yield=3.14%`. Holdings list empty via API.

So: prose description pre-fill works for stocks; for funds we synthesize from structured fields.
