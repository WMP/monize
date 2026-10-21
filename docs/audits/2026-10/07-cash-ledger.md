# S07 Cash Ledger: Transactions, Accounts, Transfers, Splits, Reconciliation

Status: in-progress, remaining: lens write-up, mutation runs, search parser, register order, final challenge.

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S07 (child session_01XfUxS4dgiSNkonPgLiFnwC, orchestrator session_018Nx7aian3f7dpRX5msjFBg) |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| HEAD at start | `7bc633477c6ffb32bd724f403dab5a541e15d923`; pin check (`git diff --stat` against the baseline outside `docs/audits/`) empty |
| Date | 2026-10-21 |
| Primary path | `backend/src/transactions/` |
| Hint line | `prioritize stale-snapshot balance deltas versus atomic SQL on every mutation path (single, bulk, undo, AI, MCP, scheduled), the four-state VOID matrix on transfer legs, server-derived currency and rate on transfers, split sum and sign rules at four decimals, account closure versus a concurrent mutation, absolute recompute versus a concurrent delta, rejection before write, derived-state invalidation after commit, and the one search parser` |
| Runtime | Node 24.22.1; `npm ci` OK; PostgreSQL 16 (`mirror.gcr.io/library/postgres:16-alpine`, Docker, `dockerd` started by hand). Baseline integration: 9 suites, 104 tests passed. Probes in a scratch worktree at the baseline: see section 12. |

## 2. Invariant map

(being written)

## 4. Confirmed findings (working list)

- A26-S07-01 HIGH: transfer edit paths derive both balance deltas from pre-transaction snapshots (split leg, A26-S02-01; connected cross-owner). Executed: split leg 5/5 divergence (+10.00/-10.00); cross-owner double submit, owner ledger +100.00 and delegate -100.00.
- A26-S07-02 MEDIUM: strict reconciled lock skipped on split-leg and cross-owner edit and delete (A26-S02-08 widened). Executed.
- A26-S07-03 MEDIUM: bulk VOID decides mirror expansion before the row lock (A26-S02-07). Executed: one leg VOID, other CLEARED, +100.00 created.
- A26-S07-04 MEDIUM: `PATCH /transactions/:id` amount on one mirror transfer leg changes one leg only (-100.00 / +150.00). Executed.
- A26-S07-05 MEDIUM: an account closes with a pending future-dated row; the due-balance cron then gives the closed account -25.00 (MON-M20 residual). Executed.
- A26-S07-06 MEDIUM: renaming an investment pair writes back the linked half's stale `current_balance` (S04 sweep 1142 -> 1200). Executed: +10.00 lost.
