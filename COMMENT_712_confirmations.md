Picking up the write-confirmation thread. Two models I'd like your read on. Both move the confirmation into the **Monize web chat** (where the human actually is in relay mode) and both reuse the #686 signed-action infra — each proposed write is a signed descriptor, "apply" goes through the existing confirm endpoint — so the in-client confirmation for the normal assistant stays untouched.

**Option A — typed confirmation cards, one view per operation type.**

Instead of a single generic dialog, each proposed write renders a card tailored to its type:

- create payee → name + default category
- create transaction → account, amount, date, payee, category, description
- create investment / brokerage transaction → account, security, exchange, quantity, price, currency, fee

Each card has approve / reject inline. When the agent proposes several of one type (e.g. the 7 ETF buys from my receipt test), they group into one card with per-row toggles + "Approve all." This is essentially extending the current `pending_action` cards to more types + batching.

Pros: immediate, conversational, low friction for one-off actions. Cons: for a big import you click through a lot of cards inline.

**Option B — a global staged "pending changes" review (firewall / git-staging style).**

The agent *stages* proposed operations into a persistent **"Pending changes (N)"** tray instead of asking inline. You open the tray, see every staged op grouped by type with a preview, edit or drop individual ones, then **Apply all** in one go (or discard all). Like a firewall ruleset or `git add` → review → commit: design the changes first, then commit the whole batch.

Pros: ideal for bulk (import a brokerage statement → 1 account + 7 transactions reviewed together); nothing applies until you say so; trivial "discard everything"; and it **sidesteps the blocking-elicitation problem entirely** — the agent stages and returns immediately, you apply later. Cons: a new surface to build; slight indirection for single quick edits.

They're complementary: cards in (A) could each offer "Apply now" **or** "Add to pending changes" (B). For the relay specifically, B fits the agent-proposes / human-reviews loop best and removes the timeout pressure; A is nicer for single conversational edits.

Either way we'd add a couple of new signed action types (investment transaction, account) on top of the existing create_transaction / create_payee / categorize.

Which direction do you prefer — A, B, or a hybrid (typed cards that can apply inline *or* queue into a global pending-changes tray)? I'm leaning hybrid, with B as the primary surface for relay and bulk imports.
