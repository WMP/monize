# Spec: portfolio-movement notifications

Status: **proposed, awaiting maintainer approval.** The measure and the product
decisions below were confirmed with the feature's requester (the branch author);
they still need the maintainer's sign-off before this ships to `main`. Scope from
discussion #1291 (the `investments` group, "significant portfolio movement") and
the maintainer's answer "investment / portfolio-movement alerts: your choice,
could be useful" (kenlasko/monize#1291, 2026-09-01; recorded in
`notification-preferences.md` Section 16.1).

Owner: notification-center. Related: #1291, `notification-preferences.md`,
`fx-conversion-completeness.md` (the completeness contract this producer must
obey), `financial-calculation-contract.md` (a subtotal is not a total),
INV-NOTIFY-001 (the write door).

---

## 1. What this adds, and the requester's actual requirement

Once per day, the Notification Center measures the **market-driven** change in the
value of the user's investment accounts and, when it exceeds the user's configured
percentage, raises one notification (`investments` category).

The requirement, verbatim: *"a feature that says once a day about the change in
value of investment accounts, but not that the value changed because I deposited
money."* So the movement this reports is **not** the day-over-day change in total
value. A deposit raises the total without the market having moved, and reporting
that as "your portfolio moved +5%" is exactly the false signal to avoid. The
figure is the change **net of the money the user put in or took out**.

Three rules, and the second and third are what make this hard:

1. **Crossing, not level** (as for every producer): fire once when the day's
   movement first exceeds the threshold, not on every observation of a value.
2. **Net of external flows** (Section 2): the reported movement excludes cash the
   user moved across the boundary of their investment accounts. Dividends,
   interest, buys and sells are *internal* to those accounts and are **kept** in
   the movement (they are return); deposits and withdrawals from outside are
   *external* and are **removed**.
3. **A subtotal is not a total** (`fx-conversion-completeness.md`): the value spans
   currencies and priced securities, and the flow spans currencies, so a movement
   computed from an **incomplete** valuation or an **unconvertible** flow is a
   confident false number. If any component is unknown, the movement is
   **unknown**, the alert is **withheld**, and the baseline is **not** advanced.
   This is the #1247/#1125 family of bug.

## 1.1 Why "net of external flows" is the measure (and why dividends decide it)

Two measures were considered.

- **Price-only** -- sum over today's holdings of `quantity x (price_today -
  price_prevClose)`. It excludes deposits (a deposit changes no quantity), but it
  **misreports a dividend**: on the ex-dividend date the security price drops by
  roughly the dividend while the cash the dividend paid lands in the account, so a
  price-only measure shows the drop as a **loss** the user did not take. Rejected
  for that reason.
- **Change in value minus external flow** (adopted) -- the modified-Dietz
  numerator over the set of investment accounts. A dividend is an *internal* flow
  (cash from a holding the user already owns, not from their pocket), so it is not
  removed; the ex-date price drop is offset by the dividend cash and the day nets
  to ~0, which is correct -- the user neither gained nor lost, value moved from the
  share price into their cash. Buys and sells are internal too (cash <-> securities
  inside the set), so they net to zero in the value and are not removed. Only cash
  crossing the boundary from outside is removed. This is the only one of the two
  that is right for dividends, and dividends are why it was chosen.

---

## 2. The measure

Let `A` be the set of the user's **investment accounts** -- both the
`INVESTMENT_CASH` sleeve and the `INVESTMENT_BROKERAGE` sleeve (an INVESTMENT
account is a pair; `investment-filter.util.ts` is the one place that rule is
written, and this producer uses it rather than an account-type predicate by hand).

- `MV(t)` = the market value of `A` at date `t`, in the user's reporting currency:
  the market value of the security holdings plus the cash balances, priced and
  converted through `getPortfolioSummary` -- the same aggregate, resolver and
  completeness flag every other investment surface reads. `MV(t)` carries a
  completeness bit: `getPortfolioSummary(...).valuationComplete`.
- `externalFlow(day)` = the net cash that crossed `A`'s boundary **from outside
  `A`** since the baseline, in the reporting currency:
  - **included** (external): an ordinary deposit or withdrawal in an account of
    `A`; a transfer leg in `A` whose counterparty account is **not** in `A`;
  - **excluded** (internal): every investment-linked cash leg (BUY / SELL /
    DIVIDEND / interest / fees -- identified by `investmentLinkedTransactionExclusion`
    / `investmentLinkedSplitExclusion`, never by hand); a transfer leg in `A` whose
    counterparty account is **also** in `A` (a move within the set);
    a `VOID` or future-dated row (moved no balance).
  `externalFlow` carries its own completeness bit: if any included flow cannot be
  converted to the reporting currency (a missing rate), the flow is **incomplete**.
- `movement(day)` = `MV(today) - MV(baseline) - externalFlow(day)`.
- `movementPercent(day)` = `movement(day) / MV(baseline) * 100`, computed only when
  `MV(baseline) > 0`.

The percentage is the day's **market return** on the starting value, excluding the
user's own contributions. A positive movement is a gain the market produced; a
negative one is a loss the market produced; a deposit-only day is `movement ~= 0`.

---

## 3. Invariants

- **INV-PORTMOVE-001 (complete, or withhold and do not advance).** A movement is
  computed and an alert considered only when the current `MV` **and** the baseline
  `MV` were both captured with `valuationComplete === true` **and** the
  `externalFlow` is complete. If any is incomplete, there is no alert **and** the
  baseline is not advanced -- advancing on a subtotal makes the *next* comparison
  wrong too. An incomplete run is a no-op.
- **INV-PORTMOVE-002 (unknown is not zero).** A missing price, a missing rate, or
  an unconvertible flow makes the movement unknown, never `0%` and never "no
  movement". Every completeness read is `=== true` (defensive; an absent flag
  during a rolling deploy reads as incomplete), never `!incomplete`.
- **INV-PORTMOVE-003 (one currency).** `MV(today)`, `MV(baseline)` and
  `externalFlow` are all in the user's reporting currency, resolved through the one
  shared reader (`preferredCurrency` / `resolveUserDefaultCurrency`,
  `default-currency.util.ts`; never a local `reportingCurrency` alias, which
  `default-currency.guard.spec.ts` would fail). A baseline captured in a different
  reporting currency is not compared -- a reporting-currency change re-baselines
  (D5).
- **INV-PORTMOVE-004 (baseline value 0 has no percentage).** When `MV(baseline)`
  is `0` (no holdings, or first holdings), the percentage is undefined; the
  producer raises nothing and records the new complete baseline. A first non-zero
  value is not a "movement".
- **INV-PORTMOVE-005 (one writer, isolated).** Written through
  `NotificationDispatchService.notify` -> `NotificationService.create`
  (INV-NOTIFY-001), from a cron under `withSystemContext` fan-out /
  `withUserContext` body, **after** the day's price refresh. It never hooks a price
  or balance write.
- **INV-PORTMOVE-006 (movement is a market return, never a contribution).** The
  external flow is always subtracted; a deposit-only day never fires. The flow is
  derived through `investment-filter.util.ts`, so an auto-generated trade leg is
  never counted as a contribution and a dividend is never counted as one either.

---

## 4. State (new)

There is **no daily portfolio-value snapshot in the codebase** -- only monthly
`monthly_account_balances.market_value`, too coarse for a day-over-day movement.
So the producer keeps its own minimal per-user state, a new user-owned table
`notification_portfolio_state`:

```
user_id                UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
move_alert_percent     NUMERIC(9,4)  NULL   -- threshold; NULL = off (default, opt-in)
baseline_value         NUMERIC(20,4) NULL   -- last COMPLETE MV (INV-PORTMOVE-001)
baseline_currency      CHAR(3)       NULL   -- reporting currency baseline_value is in
baseline_captured_on   DATE          NULL   -- the day the baseline MV was measured
```

- RLS: user-owned; policy + `ENABLE ROW LEVEL SECURITY` in the same migration, in
  `schema.sql`, and in the direct-table array. Classify in
  `support-backup-rules.ts` (a new `RULES` entry -- every column classified, or the
  coverage guard fails) and add to `export-table-queries.ts` and `restore-plan.ts`
  after `users` (or to `INTENTIONALLY_EXCLUDED_TABLES` with a reason -- it is a
  per-user setting plus a derived baseline, so **exported**). `entity` declares any
  index it arbitrates on (there is none here beyond the PK).
- `NULL move_alert_percent` = off. The default is off; the feature is opt-in.

---

## 5. New notification type, category and copy

- `NotificationType`: `PORTFOLIO_MOVEMENT` (<= 30 chars). One type; the direction
  travels in `data.direction` and the sign of `data.changePercent`. The sign is
  provable here (a complete value minus a complete value minus a complete flow), so
  it is safe to carry, unlike a mixed-sign split-parent snapshot.
- `NotificationCategory`: `INVESTMENTS = "INVESTMENTS"`.
- `notificationCategoryOf` maps `PORTFOLIO_MOVEMENT -> INVESTMENTS`;
  `typesForCategory(INVESTMENTS)` includes it.
- `NOTIFICATION_CATEGORY_CHANNELS` gains `INVESTMENTS`
  (`{ email: true, emailNotification: true, push: true, unifiedpush: true }`);
  `NOTIFICATION_PREFERENCE_CATEGORIES` gains it; `PUSH_CATEGORY_COPY` gains its
  generic copy plus `push.notification.investments` (English-first, pseudo
  regenerated). The frontend mirror (`notification-preferences.ts`), the client
  copy composition and the `notification-target` mapping follow, held by the same
  three contract tests.
- Deep link: `target: "/investments"` (the route exists:
  `frontend/src/app/investments/page.tsx`), asserted by
  `notification-target.contract.test.ts`.

---

## 6. The producer

Cron service `PortfolioMovementAlertService`, scheduled **after** the daily price
refresh so the current value is priced. Percentages are compared at full precision
and only rounded for display (`PORTFOLIO_MOVE_PERCENT_DECIMALS`, a ratio -- never
`roundMoney`, which is 4dp money precision and would misstate a percentage; see the
"an exchange rate is not money" rule, which a ratio shares).

```
for each user with move_alert_percent set:            // withSystemContext fan-out
  withUserContext(userId): withScopedDb:              // baseline r-m-w in one tx
    const ccy = preferredCurrency(pref)               // shared resolver (INV-...-003)
    const s = portfolio.getPortfolioSummary(userId)   // MV(today) + completeness
    if (s.valuationComplete !== true) return           // INV-PORTMOVE-001/002 no-op
    const mvToday = s.totalPortfolioValue              // holdings + cash, in ccy
    if (baseline == null || baselineCurrency !== ccy):
        record baseline = { mvToday, ccy, today }; return           // 003/004/005
    const flow = externalFlow(A, baseline_captured_on, today)       // Section 2
    if (!flow.complete) return                          // INV-PORTMOVE-001/002 no-op
    if (baseline_value == 0):
        record baseline = { mvToday, ccy, today }; return           // INV-PORTMOVE-004
    const movement = mvToday - baseline_value - flow.value
    const pct = movement / baseline_value * 100
    if (Math.abs(pct) >= move_alert_percent):
        dispatch.notify(userId, {
          type: PORTFOLIO_MOVEMENT,
          severity: NotificationSeverity.INFO,          // D4
          title, message,
          data: { changePercent: round(pct, PORTFOLIO_MOVE_PERCENT_DECIMALS),
                  direction: pct >= 0 ? "up" : "down",
                  movementValue: movement, baselineValue: baseline_value,
                  currentValue: mvToday, currencyCode: ccy },
          target: "/investments",
          dedupeKey: `portmove:${userId}:${today}`,      // one per day
        })
    record baseline = { mvToday, ccy, today }            // rebaseline each complete run
```

`dedupeKey` carries the day, so at most one movement alert exists per day
(crossing). Delivery, throttle and fan-out are the seam's. The baseline advances
to today's complete `MV` on every complete run whether or not it fired, so the next
day measures from today.

---

## 7. Numerical examples

Reporting currency USD, threshold 5%. `MV` = holdings + cash of the investment
accounts.

```
day 1: MV=100,000 complete                       -> baseline=100,000 (first; no alert)
day 2: MV=103,000 complete, flow=0
       movement=+3,000, pct=+3.00% < 5%           -> silent; rebaseline 103,000
day 3: MV=113,000 complete, flow=+12,000 (deposit)
       movement=113,000-103,000-12,000=-2,000
       pct=-1.94% < 5%                            -> silent (a 10k deposit did NOT
                                                     fire a +9.7% "gain"); rebaseline
day 4: MV=118,000 complete, flow=0 (dividend day)
       the dividend is internal, not in flow; the ex-date price drop is offset by
       the dividend cash inside MV
       movement=+5,000, pct=+4.42% < 5%           -> silent; rebaseline 118,000
day 5: MV=108,000 complete, flow=0
       movement=-10,000, pct=-8.47% >= 5%         -> FIRE down; rebaseline 108,000
day 6: MV=110,000 INCOMPLETE (one holding unpriced)
       valuationComplete=false                    -> NO-OP: no alert, baseline stays
                                                     108,000 (INV-PORTMOVE-001)
day 7: flow FX rate for a EUR deposit missing     -> flow incomplete -> NO-OP
```

Day 3 is the requester's requirement (a deposit does not fire); day 4 is the
dividend correctness; days 6-7 are "a subtotal is not a total" on each of the two
completeness sources.

---

## 8. Missing-data policy

- `valuationComplete !== true` on the current run -> no alert, no rebaseline.
- `externalFlow` incomplete (any included flow unconvertible) -> no alert, no
  rebaseline.
- A stored baseline is only ever a complete `MV`.
- `baseline_value == 0` -> undefined percentage -> no alert, rebaseline only.
- No value is defaulted, no flow is defaulted to zero, no percentage is computed
  from a subtotal. Withholding is at the producer -- the honest place for a batch
  job with no reader waiting.

---

## 9. Deliberate trades

- **The producer owns its baseline; it does not add a daily snapshot table for
  everyone.** It needs only "the last complete `MV` I saw" -- one row per opted-in
  user. If a general daily snapshot is later built, this baseline reads from it.
- **Day-over-day, not intraday.** Intraday value is computed live and cached 60s;
  alerting on it would be noisy. A daily period matches "significant movement" and
  the once-a-day price refresh.
- **Fire only above a threshold, not a daily heartbeat** (requester's choice): a
  quiet day is silent; the alert is a crossing, consistent with every other
  producer, not a daily digest.
- **One type, signed data.** The sign is provable (complete value - complete value
  - complete flow), so up/down is a `data` field, not two types.

---

## 10. Decisions (confirmed with the requester; maintainer signs off)

- **D0. Build it.** The requester asked for it explicitly ("na pewno chce" -- "I
  definitely want"). The `investments` category is created with it.
- **D1. Measure = change in value minus external flow** (Section 1.1), because it
  is the only measure that is correct for dividends.
- **D2. Default off, opt-in per user**; one percentage threshold once enabled
  (default e.g. 5%). Absolute-amount threshold deferred.
- **D3. Fire only when `|movementPercent| >= move_alert_percent`** (requester's
  choice: threshold, not a daily heartbeat).
- **D4. Aggregate = `getPortfolioSummary().totalPortfolioValue`** (investment
  accounts' holdings + cash), not whole-account net worth. #1291 says "portfolio".
- **D5. Cadence = daily**, chained after the price refresh; the period key is the
  calendar day in the user's timezone.
- **D6. Severity `INFO`** (informational). A large drop is still `INFO`; the
  message carries the number and direction.
- **D7. Reporting-currency change re-baselines** (no cross-currency comparison,
  INV-PORTMOVE-003).
- **D8. Baseline storage = a dedicated `notification_portfolio_state` table**
  (a threshold plus a derived baseline is not a "preference" and does not belong
  on `user_preferences`).

---

## 11. Test matrix (offline-runnable except where noted)

1. **Deposit does not fire** (INV-PORTMOVE-006): a large deposit with no market
   move yields `movement ~= 0` and no alert (day 3).
2. **Dividend is return, not a loss** (INV-PORTMOVE-006): an ex-dividend day where
   price drops and the dividend cash lands nets to ~0 movement, never a loss.
3. **Buy/sell internal**: a same-day buy funded from the cash sleeve does not move
   the measure (cash <-> securities inside the set).
4. **Withhold on incomplete value** (INV-PORTMOVE-001/002): an unpriced holding ->
   `valuationComplete=false` -> no alert, baseline unchanged (day 6).
5. **Withhold on incomplete flow**: a deposit in a currency with no rate -> flow
   incomplete -> no alert, baseline unchanged (day 7).
6. **Unknown is not zero**: an incomplete run does not fire a "0% / no movement".
7. **Crossing once per day**: two runs the same day do not both fire (dedupe key
   carries the day).
8. **baseline value 0** raises nothing, only rebaselines (INV-PORTMOVE-004).
9. **Currency change** re-baselines, never compares across currencies
   (INV-PORTMOVE-003).
10. **Percentage precision**: the figure is a ratio, rounded at
    `PORTFOLIO_MOVE_PERCENT_DECIMALS`, never `roundMoney` (a guard scan asserts
    the producer does not `roundMoney` a percentage).
11. **Write door / category wiring / delivery matrix / target route**: the
    `INVESTMENTS` category resolves, the target resolves, one writer.
12. **Rolling-deploy safety**: an absent `valuationComplete` reads as incomplete.

Integration (CI-owned): the baseline read-modify-write under `withScopedDb`, the
RLS policy, schema drift, the new table's backup round-trip, and a real
`getPortfolioSummary` returning an incomplete valuation (an unpriced security in a
real database).
