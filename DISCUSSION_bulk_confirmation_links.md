# Discussion: one confirmation "link" to approve many AI-proposed transactions at once

> Propose-first Discussion (per CONTRIBUTING) — for `kenlasko/monize` Discussions
> (Ideas). Not a PR. Grew out of the reverse-relay import flow (#793 follow-ups):
> importing a large CSV produces many confirmation cards the user has to approve
> one by one.

## Problem / motivation

When the AI proposes writes (create/categorize transactions, etc.) the user
approves them through **confirmation cards**: each card carries a signed
descriptor, and on approval the browser POSTs it to `/ai/actions/confirm`, which
re-verifies the HMAC signature, re-checks ownership, re-validates, and performs
the real write. A bulk card can carry up to **`MAX_BULK_ACTION_ROWS = 25`** items
(the cap exists because tool-call arguments count against the provider's
output-token budget).

That works fine for a handful of rows. It does **not** scale to a real import:
bringing in a full PPK / brokerage history (e.g. ~180 line items) produces **~10
separate cards**, and the user has to find and approve each one — in the web
chat, interleaved with the agent's narration, sometimes arriving minutes apart as
the agent streams them. It is easy to miss one, approve the same set twice, or
lose track of what has and hasn't been booked. (We already hit the adjacent bug
where a later batch reset earlier *confirmed* cards back to pending.)

What the user actually wants is: **"approve all of these at once"** — one
action, one click (or one link), covering a coherent group of proposed
transactions, instead of N card approvals.

## The hard part: what does "all of these" mean?

A single approve-many affordance needs a **scope** — the set of pending writes it
covers. There is no obviously-correct grouping, and that's the crux of this
discussion. Candidate axes:

- **By the import/proposal batch** — "everything the assistant just proposed in
  this turn." Natural and unambiguous, but tied to one chat turn; doesn't help if
  the proposal spans turns or the user wants a subset.
- **By date / date range** — "approve all proposed deposits in 2023." Intuitive
  for time-series imports, but a single import mixes dates arbitrarily.
- **By category** — "approve all the PPK contributions." Meaningful, but depends
  on the AI having categorized consistently, and a category can span many imports.
- **By tag** — "approve everything tagged `ppk-import-2026-06`." Flexible and
  explicit, but only works if the proposal is tagged up front.
- **By account** — "approve all proposed rows on the brokerage account." Coarse.

Each axis is reasonable for *some* import and wrong for others. Hard-coding one
(or shipping five filter pickers) pushes a modelling problem onto the user that
they don't want to solve — they just want the right things approved.

## Key insight: let the AI define the group and emit the link

The agent that produced the proposals is the one component that **already knows
the coherent grouping** — it built the batch, it knows these 84 rows are "PPK
2023–2026, employee + employer contributions + 2 withdrawals," it knows which are
deposits vs. buys vs. sells. So instead of asking the user to reconstruct the
grouping after the fact, the AI **names the group and generates a single signed
confirmation link** for it.

Concretely, a "confirmation link" would be a **signed envelope over a set of
proposed actions** (or over a server-side-stored proposal), with:

- a human-readable **label** the AI writes ("PPK history 2023–2026 — 41
  contributions + 2 withdrawals, 168 rows"),
- the **set membership** (the explicit list of `actionId`s, or a stored proposal
  id), and
- the same integrity guarantees a single card already has — HMAC signature,
  owning `userId`, `expiresAt`, single-use.

The user opens the link (or clicks one "Approve all 168" button rendered from it),
sees the summary, and confirms once. The backend fans out to the same per-action
confirm path that exists today.

## What already exists (reuse, don't reinvent)

- **Signed action descriptors** (`ai-action-signing.service.ts`,
  `AiActionDescriptor` + `signature` + `expiresAt`) — the integrity boundary is
  already built; a link is just a larger/grouped envelope using the same HMAC.
- **`batch_actions`** — a single descriptor can already carry multiple sub-actions
  and is applied transactionally-ish in `ai-actions.service.ts`. The 25-row cap is
  a *token-budget* limit on what one tool call can emit, **not** a limit on what
  one confirmation can apply — so a link could legitimately cover more than 25.
- **Single-use / idempotency** — the `consumed` map (keyed by `actionId` +
  `expiresAt`) already prevents double-apply; a group link needs the same, keyed
  by the group.
- **Relay buffering + pickup** — cards composed slowly are already buffered per
  user and picked up by the browser; a grouped proposal fits the same channel.
- **Shared AI tool layer** — per the repo rule, the grouping/proposal logic must
  live on a domain service shared by the AI Assistant executor and the MCP server,
  so both surfaces emit the same link.

## Rough proposed direction (to debate, not a spec)

1. The AI assembles a **proposal**: a labelled set of validated, signed
   sub-actions (it may exceed 25 because it's not one tool call — it's stored
   server-side as the agent streams batches, or referenced by id).
2. The backend mints a **confirmation link / token** = HMAC over
   `{ groupId, userId, actionIds (or proposalId), expiresAt }`.
3. The chat renders **one "Approve all N" affordance** (a card, or a real
   `/ai/confirm/<token>` link the user can open) showing the AI's label + a short
   summary (counts, total amount, date span, accounts touched).
4. On approval, the confirm endpoint verifies the token, re-checks ownership,
   re-validates every member, applies them, and marks the group consumed.
   Partial-failure handling: apply what's valid, report what was skipped (as
   `batch_actions` already does), never silently drop.

## Security / correctness considerations (do not regress)

- Re-verify signature + ownership + `expiresAt` server-side; the link is not
  trusted, it's an integrity-checked envelope. Treat the URL form as
  bearer-capability: short TTL, single-use, scoped to one `userId`.
- Respect `DemoModeGuard`, the AI **write limiter** (a 168-row link must count as
  168 writes, not 1), and `@SanitizeHtml`/`stripHtml` on the AI-authored label.
- Idempotency for the whole group **and** its members, so re-opening the link or a
  retried request can't double-book.
- Re-validate each member at apply time (prices, accounts, balances may have moved
  since the proposal) — the signature only proves the client didn't tamper.

## Open questions

- **Scope model:** explicit `actionId` list vs. a stored server-side proposal
  referenced by id? (The latter sidesteps the 25-row token limit cleanly.)
- **Subset approval:** can the user uncheck rows before approving the group, or is
  it all-or-nothing per link?
- **Link vs. button:** is a real openable URL worth it (shareable, survives a chat
  reload), or is one in-chat "Approve all" button enough?
- **Cross-turn proposals:** should a group be allowed to accumulate across several
  agent turns, or is it always one turn?
- **Expiry/cleanup:** TTL for an un-approved group; what happens to a half-approved
  group if the link expires.

## Why post this first

This touches the AI write/confirm integrity boundary and both AI surfaces (the
Assistant and the MCP relay), so the grouping model and the security envelope
should be agreed before any code — exactly the propose-first case.
