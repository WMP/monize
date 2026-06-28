# Discussion: scoping access to specific categories / tags / payees (hide sensitive data from AI and from other users)

## Problem / motivation

Right now access in Monize is **all-or-nothing per surface**:

- An **AI** surface (the AI Assistant tool executor and the MCP server) operates as the
  authenticated user and can read **every** transaction, category, tag and payee that user
  owns. A Personal Access Token (`pat_*`) / OAuth token carries coarse scopes (`read`,
  `reports`, `write`) but no notion of *which* data it may see.
- **Delegation / shared access** scopes by **account** (and by section, e.g. "investments"),
  via `DelegationService.readableAccountIds`. There is no way to share an account but hide
  particular transactions within it.

But some financial data is sensitive in a way that doesn't line up with account boundaries.
Examples:

- A transaction tagged `medical`, `legal`, or `personal` that I'm fine tracking myself but
  don't want an external MCP client (or whatever LLM is behind it) to read or summarise.
- A payee (a therapist, a lawyer, a specific person) I don't want surfaced when I let a
  family member act on my behalf through shared access.
- A whole category ("Gifts") I want excluded when the AI builds a spending summary, because
  it would spoil a surprise for the very person who shares the instance.

So the ask: **can we scope read access to specific categories, tags, or payees** — so that
chosen slices of financial data are withheld from (a) the AI surfaces and/or (b) other users
of our Monize instance?

## What already exists (reuse, don't reinvent)

- **Shared AI tool layer.** Per the repo rule, every AI tool that reads or aggregates data
  shares its implementation between the AI Assistant (`tool-executor.service.ts`) and the
  MCP server (`mcp/tools/*.tool.ts`) via a domain-service method. A redaction filter applied
  **once** in that domain layer would cover both AI surfaces automatically — and is the only
  place it can be applied safely (otherwise one un-filtered tool leaks everything).
- **MCP auth + scopes.** Tokens already resolve to `{ userId, scopes }` (`mcp-context.ts`),
  PATs via `PatService`, OAuth via `OAuthProviderService`. There is a natural place to attach
  a per-token data filter.
- **Delegation.** `DelegationService` already restricts delegates to `readableAccountIds`
  and section access. Category/tag/payee exclusions are the same idea, one level finer.
- **Entities.** `categories`, `tags` (shared pool, attached to transactions + splits via
  join tables), and `payees` are all per-user with stable IDs — easy to reference from a
  rule or a flag.

## The two axes (they're related but not identical)

1. **Hide from AI** — keep the data in Monize, just don't expose it to the AI Assistant / MCP.
   The owner still sees everything in the normal UI.
2. **Hide from other users** — extend delegation so a grantee who can read an account still
   can't see transactions touching a sensitive category/tag/payee.

A single "sensitivity" concept could feed both, or they could be configured independently.
Worth deciding early.

## Where could the rule live? (three designs, not mutually exclusive)

### A — A "sensitive / private" flag on the entity (simplest)
Add `isSensitive` (or `excludeFromAi` / `excludeFromSharing`) to `categories`, `tags`,
`payees`. Any transaction whose category/tag/payee is flagged is filtered out of the
relevant surface.

- Pro: trivial to set in the UI, one switch per category/tag/payee, applies everywhere
  consistently.
- Con: it's **global per user** — every AI token and every delegate is treated the same.
  No "this key can see medical, that one can't".

### B — Per-token (PAT / API key) allow/deny lists
Attach an exclusion (or inclusion) list of category/tag/payee IDs to each Personal Access
Token / connector. Different MCP clients then see different slices.

- Pro: granular — a read-only budgeting bot can be denied `medical` while a personal
  assistant token sees everything.
- Con: more config surface; PAT creation UI needs a picker; rules must be stored with the
  token and threaded into the resolved context.

### C — Per-delegation filters
Extend the delegation grant (which already scopes by account + section) with category/tag/
payee exclusions, so shared access can withhold specific data within an otherwise-readable
account.

- Pro: reuses the delegation model; natural home for the "hide from other users" axis.
- Con: only covers delegation, not the owner's own AI tokens (which is axis 1).

A plausible v1: **A** for the owner's own AI surfaces (one global "don't show the AI this")
plus **C** for sharing, with **B** as a later refinement if per-token granularity is wanted.

## The hard part: aggregations and totals

Filtering a **list** (transactions, payees) is straightforward — drop the rows. The real
design question is what happens to **aggregates** (net worth, spending by category, cash flow,
portfolio summaries) when some underlying data is hidden:

- **Fully remove** — excluded amounts vanish from every total. Clean and truly private, but
  now the AI's "total spending" disagrees with the UI's, which can be confusing or look like
  a bug.
- **Include the amount, redact the label** — totals still reconcile, but a "Hidden" /
  "Other" bucket appears instead of the real category/payee. Leaks the *existence* and
  *magnitude*, not the identity. Often the right trade-off for budgeting questions.
- **Per-rule choice** — let the flag say whether it's "hide the line" or "hide the label".

This needs a decision per surface; "net worth" probably must include hidden amounts (or it's
wrong), while "list my transactions with payee X" should omit them entirely.

## Consistency / security requirements (do not regress)

- The filter MUST be applied in the **shared domain-service layer**, not per tool — every
  read/aggregate tool (AI + MCP) inherits it, with no per-tool opt-in that could leak.
- `userId` still comes from the session/token, never from arguments; the redaction rule is
  resolved alongside it.
- **Write** tools need a matching rule: should an AI token that can't *see* a sensitive payee
  be allowed to *create* a transaction against it? Probably no (you'd be writing into a
  hidden slice). At minimum, writes shouldn't reveal hidden entities back in their response.
- Edge cases to pin down:
  - A transaction with **multiple tags** where only one is sensitive — hide the whole
    transaction, or just suppress the sensitive tag? (Hiding the whole row is the safe
    default.)
  - **Splits** — a split line tagged sensitive inside an otherwise-visible transaction.
  - **Transfers** — both legs must be filtered together to avoid a half-visible transfer.
  - **Search / resolve-by-name** helpers must not resolve a hidden payee/category by name.

## Out of scope (for a first pass)

- Field-level redaction (e.g. hide the *amount* but show the row) — heavier; revisit only if
  needed.
- Encryption-at-rest per slice — this is an access/visibility feature, not an encryption one.
- Time-boxed or one-shot grants.

## Open questions

1. One global "sensitive" concept (axis 1 + axis 2 share it) or two independent toggles?
2. Default aggregation behaviour: remove vs. redact-to-"Hidden"? Per surface, or per rule?
3. Granularity: per-user global (A), per-token (B), per-delegation (C) — which for v1?
4. Do hidden categories/tags/payees disappear from the AI's *vocabulary* entirely (the model
   never learns they exist), or just from the data (the model knows the bucket exists but not
   its contents)?
5. Should "write" tokens be blockable from creating data against hidden entities?
