# Full Read-Only Audit 2026-10: Program Ledger

> Every session reads this file first and writes it last (plan section 4, steps 1 and 11).
> It is the only shared state between sessions. Keep entries short; the detail is in the
> session reports.

## Pinned revision

| Field | Value |
| --- | --- |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| Audit branch | `ccr-1f689e5c-onia07` |
| Pinned on | 2026-10-21 |
| Upstream audit baseline | `d5cea9bfa995885ba5198f9843359362927c0fd4` (2026-08-01) |
| `main` at last delta check | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` (S22, 2026-10-22): equal to the baseline, empty delta; S23 re-fetches `main` before the final report |

A session whose code differs from `AUDIT_BASELINE_SHA` in anything but `docs/audits/2026-10/`
and `docs/audits/2026-08-upstream/` (the check in plan section 4, step 2) stops and reports
before auditing.

## Session status

| Session | Status | Started | Finished | Commit | Findings (B/H/M/L) | Report |
| --- | --- | --- | --- | --- | --- | --- |
| S00 planning | done | 2026-10-21 | 2026-10-21 | this commit | -- | `plan.md`, `sessions.md`, `prior-findings-register.md` |
| S01 | done | 2026-10-21 | 2026-10-21 | 3a3be8a | 0/0/0/4 | `01-baseline.md` (child session_01K2tpEV1qrxan3G3mhQa4Jn); verdict APPROVE |
| S02 | done | 2026-10-21 | 2026-10-21 | bd06ebd | 0/2/8/2 | `02-prior-high-triage.md` (child session_01366anc7J8MgFS2vwq5szy2) |
| S03 | done | 2026-10-21 | 2026-10-21 | 4adfd72 | 0/1/3/3 | `03-security-auth.md` (child session_019xGDCFeEXnmBq2PfLKgW9t); verdict REQUEST CHANGES |
| S04 | done | 2026-10-21 | 2026-10-21 | b7c894b | 0/0/4/0 | `04-rls-tenancy.md` (child session_01XG1M2wjANyUMMeHkkGGyN1); verdict REQUEST CHANGES |
| S05 | done | 2026-10-21 | 2026-10-21 | 3268ccec | 0/0/1/2 | `05-migrations-schema.md` (child session_01XM8Gxs6p79kg8d2mviohsA); verdict APPROVE |
| S06 | done | 2026-10-21 | 2026-10-21 | fdf434c | 0/0/2/4 | `06-backup-restore.md` (child session_01H4ePk3D2tytbTfCDnY7hrp); verdict APPROVE |
| S07 | done | 2026-10-21 | 2026-10-21 | 03fdd62 | 0/2/5/2 | `07-cash-ledger.md` (child session_01XfUxS4dgiSNkonPgLiFnwC); verdict REQUEST CHANGES |
| S08 | done | 2026-10-21 | 2026-10-21 | bc3a4b5 | 0/1/2/2 | `08-scheduler-cron.md` (child session_014ydW7reUCeSgTdjvYkk8qB); verdict REQUEST CHANGES |
| S09 | done | 2026-10-21 | 2026-10-21 | d8ce637 | 0/1/3/2 | `09-import-mny.md` (child session_01KxbrJgNzbFhpqTXYbkj5SV); verdict REQUEST CHANGES |
| S10 | done | 2026-10-21 | 2026-10-21 | 35d5915 | 0/1/2/2 | `10-rules-banksync-csv.md` (child session_01BAgjpKaPyGwg41HxkiQbW3); verdict REQUEST CHANGES |
| S11 | done | 2026-10-21 | 2026-10-21 | 669ff34 | 0/1/0/3 | `11-email-receipts.md` (child session_01NGWhzqqpfZRRd58ooquSgs); verdict REQUEST CHANGES |
| S12 | done | 2026-10-21 | 2026-10-21 | 7a1b2f7 | 0/1/6/3 | `12-securities-holdings.md` (child session_01E4gKh1kzVaxArb2UHN9km7); verdict REQUEST CHANGES |
| S13 | done | 2026-10-21 | 2026-10-21 | 9a84c7f | 0/3/2/1 | `13-valuation-fx-networth.md` (child session_01GUef7zhtKRQiqbpDiYB7ZD, resumed after the usage-limit reset); verdict REQUEST CHANGES |
| S14 | done | 2026-10-21 | 2026-10-21 | 8a0beff | 0/0/1/2 | `14-bonds.md` (child session_0123vTCmSakgyRaknyvJmWAm, resumed after the usage-limit reset); verdict APPROVE |
| S15 | done | 2026-10-21 | 2026-10-21 | b947bf1 | 0/1/4/5 | `15-loans-strategies.md` (child session_01JEBFJpQ1qzqkCGWz62GC7v); verdict REQUEST CHANGES |
| S16 | done | 2026-10-21 | 2026-10-21 | b6cde01 | 0/1/5/3 | `16-budgets-reports.md` (child session_01EZWKuDHxiBSTAvGP32QcFb, resumed after the usage-limit reset); verdict REQUEST CHANGES; categories, payees, tags, calendar sampled only |
| S17 | done | 2026-10-21 | 2026-10-21 | 7387a3f | 0/0/3/4 | `17-ai-mcp-notifications.md` (child session_01111K7XW3AyLWdho7J2V8cV); verdict REQUEST CHANGES |
| S18 | done | 2026-10-21 | 2026-10-21 | 76bb9c5 | 0/0/6/5 | `18-frontend-core.md` (child session_018vbbzt6wxobMRRSa69Nm2B); verdict APPROVE |
| S19 | done | 2026-10-21 | 2026-10-22 | a9f53b1 | 0/2/2/3 | `19-frontend-forms.md` (child session_01LuCrA2Ko2LmWJpCCVZtqu1); verdict REQUEST CHANGES; the five largest forms sampled, Playwright not run |
| S20 | done | 2026-10-21 | 2026-10-22 | c7a3707 | 0/1/3/4 | `20-frontend-figures.md` (child session_01VSrfzDF4F63zWMJY2giCfB); verdict REQUEST CHANGES; budgets, strategies, bonds, receipts, tours UI sampled by grep only |
| S21 | done | 2026-10-21 | 2026-10-22 | 8ea9316 | 0/0/4/3 | `21-tests-ci-release.md` (child session_01Xmf7H997Adk6ipvAx74awQ); verdict APPROVE; program-wide mutation table in its section 6.2, known-wrong tests in 10.1 |
| S22 | done | 2026-10-22 | 2026-10-22 | 59a1440 | 0/0/0/0 | `22-delta-review.md` (child session_014uWBGZjh8U2E8eYrTBBQUi); `MAIN_SHA` = `AUDIT_BASELINE_SHA`, empty delta; 8 re-check runs green |
| S23 | in-progress | 2026-10-22 | | | | `23-final-report.md`, `remediation-tasks.md` (child: see next ledger update) |

Status values: `open`, `in-progress` (resume it first), `done`, `split` (see `sessions.md` for
the two halves).

## Toolchain state at the baseline

Filled by S01. Later sessions read it instead of re-discovering it.

| Check | Result | Notes |
| --- | --- | --- |
| Node version | Node 24.22.1 via `/opt/nvm` (`nvm install 24 && nvm use 24`) | The container default, Node 22.22.0, fails `npm ci` in both layers; CI pins Node 24. S00 verified both. |
| `backend/`: `npm ci` | OK on Node 24 (S00) | `src/common/doc-paths.spec.ts` and `instruction-files.spec.ts` ran: 26 passed |
| `backend/`: `npm run lint && npx tsc --noEmit && npm run typecheck` | lint passes only because CI's `npm run lint` runs `--fix`; the check form fails with 3 prettier errors (A26-S01-01); tsc and typecheck pass (S01) | |
| `backend/`: `TZ=UTC npm run test:unit` | pass (S01) | 1048 suites, 27481 tests: 27479 pass, 2 root-only skips; coverage thresholds met |
| `backend/`: `npm run test:integration` | 1 FAIL (S01): `ofx-import-fitid` deadlocks in `cleanTables` TRUNCATE in the full run, passes 10/10 alone (handed to S21 as a flake root cause) | 118 suites, 1479 tests: 1470 pass, 8 skip, 1 fail |
| `frontend/`: `npm ci`, `npm run lint && npm run type-check && npm run i18n:check` | pass on Node 24 (S01) | |
| `frontend/`: `npm run test:cov` | pass (S01) | 1139 files, 22249 tests; coverage thresholds met |
| `e2e/`: stack start (`docker-compose.e2e.yml`) | ran (S01), Chromium only, images built with the proxy CA injected in a scratch worktree | 191 tests: 178 pass, 6 flaky (pass on retry), 7 skip, 0 fail |
| `scripts/verify-schema.sh` | OK (S05, 2 passes) | `migration:lint` OK, 233 files |
| `node scripts/check-migration-prefixes.mjs` | OK (S05, after `git fetch --unshallow`) | |

## Running counts

| Severity | Confirmed `A26-*` findings so far |
| --- | --- |
| BLOCKER | 0 |
| HIGH | 18 (S02: 2, S03: 1, S07: 2, S08: 1, S09: 1, S10: 1, S11: 1, S12: 1, S13: 3, S15: 1, S16: 1, S19: 2, S20: 1; S20-01 re-assesses and supersedes S02-03; S13-01 supersedes S02-02; S15-01 and S07-02 share `undoSimpleEntity`; S07-01, S08-01 and S09-01 supersede S02-01, -04 and -05) |
| MEDIUM | 66 (S02: 8, S03: 3, S04: 4, S05: 1, S06: 2, S07: 5, S08: 2, S09: 3, S10: 2, S12: 6, S13: 2, S14: 1, S15: 4, S16: 5, S17: 3, S18: 6, S19: 2, S20: 3, S21: 4; S21-04 widens MON-M46 and merges the per-session test-coverage rows; S10-02 supersedes S02-09; S07-03 and -05 supersede S02-07 and -08) |
| LOW | 59 (S01: 4, S02: 2, S03: 3, S05: 2, S06: 4, S07: 2, S08: 2, S09: 2, S10: 2, S11: 3, S12: 3, S13: 1, S14: 2, S15: 5, S16: 3, S17: 4, S18: 5, S19: 3, S20: 4, S21: 3) |

Prior findings disposed (final, by the owning session): 70 of 70. S21: FIXED_VERIFIED M11 (Helm half), M44; STILL_OPEN M01 (narrowed, A26-S21-03), M45 (A26-S02-10), M46 (widened, A26-S21-04), L07 (narrowed). Raw counts before S23's consolidation: 32 FIXED_VERIFIED in full, 11 FIXED_VERIFIED with a residual or test gap, 24 STILL_OPEN in whole or part, 2 REJECTED (M28 both halves), 0 SUPERSEDED, 0 NOT_LOCATED; the register holds the per-row wording. FIXED_VERIFIED: S01 (M02), S03 (H09, M03, M05, M07, M23, M24, M26, L01), S04 (M06, M14), S05 (M15, L02), S06 (H02, M08, M09, M10, M11 backup half, M12, M13, M16, M17, M18, L05), S07 (H07, M21, M27), S08 (M25 claim half, L06), S09 (H03), S12 (H08, M29, M30), S15 (M32), S13 (H13, M19, M33, M34, M41), S16 (M31, L03 with residuals), S17 (M04 with a test gap, M25 provider half), S18 (M36, M42). STILL_OPEN: S18 (M38 narrowed -> A26-S18-01), S20 (H16 -> A26-S20-01), S19 (M37 -> A26-S19-03, H11 client half -> A26-S19-01, H14 client half -> A26-S19-04). FIXED_VERIFIED also S19 (H15, M40). REJECTED also S19 (M28 client half). S13 (H12 -> A26-S13-01/-02, M39 relocated -> A26-S13-01), S12 (H14 server half residual, M35), S08 (H06 residual), S09 (H04 -> A26-S09-01, L04 narrowed), S06 (H01, M22, M43, M47), S07 (H05, H10 residual, H11 server half residual, M20 residual). REJECTED: S07 (M28 server half; the client half stays with S19). S02 triaged 23 rows (12 FIXED_VERIFIED, 11 STILL_OPEN in whole or part); final call stays with the owning sessions, see the register.

## Open hypotheses handed between sessions

One line each: `from Sxx to Syy: <hypothesis>; <what to check>`. The receiving session deletes
the line when it disposes of the hypothesis in its report.

- from S02 to S06: MON-H01 residual (legacy flat-root sweep, no instance namespace, A26-S02-06), MON-H02 real local/S3 round trip still missing, MON-M43 narrowed; see `02-prior-high-triage.md` sections 5 and 9.
- from S02 to S07: MON-H05 split-transfer leg deltas from snapshots (A26-S02-01, executed 10/10), MON-H10 bulk VOID expansion race (A26-S02-07), MON-H11 residuals, A26-S02-08 reconciled lock bypass; section 5.
- from S02 to S08: MON-H06 residual, manual post not pinned to the occurrence (A26-S02-04); no integration test calls the real `post()`.
- from S02 to S09: MON-H04 residual, replay by a new start on the same staged file (A26-S02-05).
- from S02 to S10: QIF split-transfer leg unconverted (A26-S02-09); `applyOpeningBalance` hypothesis (section 9).
- from S02 to S12: MON-H14 residual hypothesis, latest rate used for a back-dated trade (section 9).
- from S02 to S13: MON-H12 built-in reports still 1:1 (A26-S02-02), guard blind spot (A26-S02-11), MON-M39 relocated to `report-currency.service.spec.ts:213`.
- from S02 to S20: MON-H16 residual, FX-incomplete account and dashboard widget (A26-S02-03).
- from S02 to S21: MON-M45 release job pushes an untested bump (A26-S02-10); A26-S02-12 integration race exercises a copy of the consume SQL.
- from S21 to S23: merge A26-S21-04 with the per-session test-coverage findings it lists (Rule 7); A26-S21-01 and -03 share the "production image never exercised" root. Every "to S21" line above is disposed of in `21-tests-ci-release.md` (section 6.2 for the mutation rows, 10.1 for the known-wrong tests).
- from S22 to S23: state in the final report that the audited revision has no hosted CI run (the commit carries `[skip ci]`; the fork's last push run on `main` is from 2026-10-16); re-fetch `main` before writing the final report and run a second delta review if it moved.
- from S19 to S21: three undetected mutation rows and the known-wrong rate test (`19-frontend-forms.md` section 12). To S20/S23: the `toFixed` readouts (A26-S19-07) are figure surfaces. To S23: A26-S19-01 joins MON-H11's remediation task; A26-S19-04 joins A26-S12-02 and A26-S13-02 ("a rate for a date").
- from S20 to S23: the country look-through aggregate carries no completeness (with S13); the intraday response needs a completeness flag before any frontend surface can mark a dropped bond (with S14/S13); `totalGainLoss` (A26-S20-02) is quoted by the AI and MCP portfolio tools (with S17); the bank-sync preview UI and the rules editor were not read (with S10). Coverage gap for S23's ledger: INV-SHARE-001..005 (PWA share target) were audited by neither S18 nor S20.
- from S18 to S20: `DailyInvestmentValue` flags not read in `InvestmentValueChart.tsx` and `PortfolioValueWidget.tsx`; `?? 0` / `|| 0` on `totalPortfolioValue` in four components. To S19: `PostTransactionDialog.tsx:433` seeds the posting form with `nextOverride?.amount ?? scheduledTransaction.amount` (the banned pattern); `OverrideEditorDialog.tsx:203-290` seeds from the base amount. To S13/S23: server-side weightings skip unpriced holdings with no flag (`sector-weighting.service.ts:420-431`). To S21: A26-S18-02 and -03 as baseline-undetected rows; a guard for `setCache(` outside `apiCache.ts`; no E2E fixture for access-cookie expiry (A26-S18-06: two tabs refreshing at once read as token theft).
- from S17 to S23: `TransactionsService.update()` itself does not refuse a transfer leg (the refusal is in the AI/MCP previews only); A26-S17-02 (post-commit failure releases the single-use claim, Retry writes twice) shares a root with A26-S08-02, consolidate under Rule 7. To S20: the transactions page summary and any widget reading `getSummary` totals show a mixed-currency scalar (A26-S17-01). To S21: missing two-connection test for INV-DISPATCH-003; A26-S17-05 (MON-M04 fix undetected by every suite); the post-commit case for `ai-action-replay.integration.spec.ts`.
- from S14 to S13/S23: A26-S14-01 is a net-worth valuation-series root (consolidate with S13's position-price findings); the S01 Monte Carlo item is disposed of; `currencyCode ?? "USD"` at `monte-carlo.service.ts:721` is an FX-lens item. To S20: the intraday path values a linked security at the ledger close and drops bond holdings in the no-ledger branch. To S19: the redemption form's keep-the-edit behaviour untested. To S21: M6 held by SQL-text unit assertions only.
- from S16 to S20: request-by-request export gating in multi-request reports; `exportToPdf` partial caption across every report using `PartialTotal`. To S13/S23: A26-S02-02's eleven-endpoint surface list (section 9); A26-S16-01 and -06 join the "convert before summing" remediation task. To S17: `getLlmBudgetStatus` carries the unconverted `spent` into AI and MCP answers. To S23: categories, payees, tags and calendar were sampled through their integration suites only (INV-PAYEE-001/002, INV-DAYNOTE-001 mechanisms not re-read).
- from S13 to S19: does the server keep a client-sent `exchangeRate` of an embedded investment split prefilled from `getRate` (A26-S13-02); the onboarding round trip (A26-S13-05). To S20: frontend `MonthlyNetWorth` / `AccountSummary` types without completeness flags (A26-S13-04), the net-worth report. To S17: the AI/MCP account summary drops the flags (A26-S13-04). See `13-valuation-fx-networth.md` section 12.
- from S15 to S19/S20, S12/S13, S21, S23: see `15-loans-strategies.md` section 12; A26-S15-01 and A26-S07-02 share `undoSimpleEntity` (consolidate in S23); S08's slot-selection question answered as spec design (D2), the fix stays in `post()`.
- from S11 to S13: `resolveCashExchangeRateOrNull` falls back to `getLatestRate` from the trade card; `getRateForDate` writes fetched rates in the caller's transaction (A26-S11-03). To S17: can an MCP agent or the assistant claim a request under `EMAIL_RECEIPTS_CLAIM_KEY`; the AI review inbox card does not show `forwarded_by` (A26-S11-04 residual). To S21: the integration harness stubs `ScheduledTransactionsService` with `{}`, so no integration test can run a trade card. To S23: A26-S11-01 and A26-S08-04 share one root cause (lease TTL independent of the provider budget), consolidate under Rule 7.
- from S12 to S13: realized-gain and capital-gains consumers of A26-S12-04 (built-in reports, AI/MCP `get_capital_gains`, tax figures) and the valuation of Money-imported cross-currency holdings (A26-S12-09, `net-worth/position-price.util.ts` txFallback); to S09/S10: see `12-securities-holdings.md` section 12.
- from S10 to S11, S13, S15, S19/S20, S21: see `10-rules-banksync-csv.md` section 12; INV-BANKSYNC-001's index entry names only the hash-to-ref path (A26-S10-01); `AccountsService.delete` counts and removes in separate unlocked transactions (A26-S10-03).
- from S01 to S07, S08, S09, S10, S12, S13/S14, S21, S03/S04: see `01-baseline.md` section 12.7 (undo never recomputes net worth; Monte Carlo bond valuation; the integration flake, E2E retries and e2e not linted go to S21). S01 counts 49 crons in 46 services (the plan said 40) and an index/body status mismatch for INV-BONDNOTIFY-003.
- from S03 to S04: D-S03-01 -- CONFIRMED by S04 for the delegation paths (A26-S04-02); S04's sweep found 26 cross-transaction read-then-save sites, listed in `04-rls-tenancy.md` section 12.
- from S04 to S07: cross-owner update/delete authorized in an earlier transaction and written under `withSystemContext` without a re-check (A26-S04-01, executed); stale whole-entity saves in `accounts/`.
- from S04 to S03/S21: the auth/users/admin/emergency read-then-save sites from the 26-site sweep (S03 is done; S21 carries them into the program mutation table).
- from S04 to S18: INV-SHARE-001..005 are the PWA share target, not joint accounts; `sessions.md` S04 and S20 mislabel them (corrected in sessions.md by the orchestrator).
- from S04 to S21: A26-S04-04 (no real-role tests for delegation, joint or cross-owner paths) joins MON-M46.
- from S06 to S21: INV-BACKUP-006's S3 integration suite never runs in CI (A26-S06-02, no MinIO); the unpadded-date test defect; see `06-backup-restore.md` section 12.
- from S06 to S08, S19: see `06-backup-restore.md` section 12 (the S04 item there is forwarded to S21, since S04 is done).
- from S08 to S11, S15, S17, S19, S21: see `08-scheduler-cron.md` section 12 (49-row cron matrix there; lease predicates held only by SQL-text unit assertions).
- from S09 to S10, S12/S13, S13, S15, S18/S19, S21: see `09-import-mny.md` section 12; A26-S09-06 (an unvalidated currency code creates a global ACTIVE system currency; same shape in `UpdatePreferencesDto.defaultCurrency`) is S13's; INV-IMPORT-003 still unenforced on the MNY and QIF writers.
- from S07 to S08, S10, S16, S17, S19, S21: see `07-cash-ledger.md` section 12; A26-S07-02 (undo of an account edit restores `current_balance` absolutely) touches every consumer of the undo log.
- from S03 to S17: confirm the MCP/PAT bearer verifiers reject `step_up` / `oidc_reauth` JWT types (A26-S03-03).
- from S03 to S18: frontend handling of the 401 "Refresh token reuse detected".
- from S03 to S21: A26-S03-04's three missing two-connection tests join MON-M46.
- from S05 to S06: semantic backfills (e.g. `skip_price_updates`, 20261012131846) are not applied to rows restored from pre-1.19 backups (A26-S05-03).
- from S05 to S21: liveness probe versus a long migration; a real-runner two-replica race test is still owed.
- from S05 to S04: delegation unique keys missing in the entity-built integration harness (A26-S05-01).
- from S05 to S10/S11: rule deletion nulls `rule_id` on open reviews.

## Program-wide mutation table (undetected rows only)

Appended by each session; S21 merged it into `21-tests-ci-release.md` section 6.2 (A26-S21-04). `invariant | mutation (file:line, what) | test that
should fail | session`.

- `INV-AUTH-004 | token.service.ts:261 drop lockTokenFamily in revokeTokenFamily | a two-connection logout-vs-rotation test | S03`
- `INV-AUTH-001/004 | token.service.ts:149 drop lockTokenFamily in refreshTokens | same | S03`
- `INV-AUTH-001 | token.service.ts:164-177 reuse revocation rolled back (baseline defect) | a real-database reuse test | S03`
- `INV-CLAIM-001 | emergency-access-claim.controller.ts:222+226 drop both guards | a two-connection claim test | S03`
- S19: `INV-OCCURRENCE-002 | OverrideEditorDialog.tsx:423 !hasStoredPrice -> true | a stored price with the field cleared before the quote lands | S19`; redemption keep-the-edit guard; see `19-frontend-forms.md` section 12.
- S20: three rows in `20-frontend-figures.md` section 6.
- S18: `INV-CACHE-001 | categories.ts:69-78, payees.ts:187-204 (no invalidation) | none | S18`; `INV-CACHE-001 | investments.ts:120-129 and 15 more hand-rolled getCached/setCache read sites (no generation) | none | S18`; see `18-frontend-core.md` section 12.
- S17: `INV-MCP-001 | mcp-http.controller.ts:319-322 serve the session's stored scopes | an existing-session narrowed-scope case | S17`; `INV-MCP-004 | ai-actions.service.ts:267-271 release after a committed write (baseline) | a post-commit failure case | S17`.
- S14: none (15 mutations executed, 15 killed); M6 unit SQL-text only.
- S16: VOID in budget actuals; rollover relation; fingerprint index removal; next-period dates; budget currency conversion; `16-budgets-reports.md` section 6.
- S13: `INV-FX-001 | portfolio.service.ts:2147 ?? null -> ?? 1 | a portfolio case with no series and no spot rate | S13`; unit-only rows for INV-CURRENCY-001 and INV-CACHE; `13-valuation-fx-networth.md` section 6.
- S15: M7 (a debt of exactly 0.01 treated as paid off) undetected; M3 unit-only; `15-loans-strategies.md` section 6.
- S11: `INV-RECEIPT-006 | baseline (P2) | a lease-overrun integration test | S11`; `INV-TRADE-001 | parse-trade.ts:559-571 | a price-only >4-decimal case | S11`; `INV-RECEIPT-008 | forwarded-receipt.ts:33-71 | a non-owner forward test | S11`.
- S12: `INV-HOLDING-001 | investment-transactions.service.ts:4477 drop update()'s lockHoldingScope | integration none (unit mock-order only) | S12`; transfer basis client `costPerShare` (`:2371`) unit only; `12-securities-holdings.md` section 12.
- S10: four undetected rows in `10-rules-banksync-csv.md` section 6.
- S08: M5-M7 (lease predicates) caught only by SQL-text unit assertions; `08-scheduler-cron.md` section 6.
- S09: `fail()` `retryable=$4` undetected by every suite (A26-S09-02); `09-import-mny.md` section 6.
- S06: M4 (Phase-3 `user_id` predicate untested) of `06-backup-restore.md` section 6.
- S07: M1 (`addSplit` parent lock removed, undetected by all suites, A26-S07-09) and two unit-only rows of `07-cash-ledger.md` section 6.
- S04: MA (`134:47` delegate predicate dropped, 175/175 green) and MD (scoped-db `real_user` collapsed, integration green) of `04-rls-tenancy.md` section 6, plus its three baseline defects.
- S05: M3, M4, M5 of `05-migrations-schema.md` section 6 (entity-harness parity gaps; runner lock caught only by mock-order unit specs).
- S02's table: see `02-prior-high-triage.md` section 6 (M3 undetected at integration level, A26-S02-12).

## Known deviations from the plan

- 2026-10-21 21:00 UTC: the five-hour usage window was exhausted with S13, S14 and S16 running; all three failed their turn and were resumed at 23:12 UTC after the reset (S13 from its pushed partial, S14 and S16 from their session context).
- S16: subagent sweeps lost to the usage limit; the worker restart detached HEAD, re-pointed to the local commit (ancestor check) and pushed without rewriting remote history.
- S13: sweeps delegated to four read-only subagents, citations spot-checked.
- S15: two read-only sweep subagents (GEM, frontend history); every reported claim re-verified or executed by the session.
- S06: one final commit instead of incremental commits; the branch HEAD was detached after a rebase and reattached by fast-forward.
- S03: the Docker daemon was not running in the child container; `dockerd` was started by hand (S04 and S05 prompts carry the workaround).
- Wave 1 (2026-10-21): S01, S02 and S03 run concurrently as three remote child sessions on
  `claude-opus-5-5`, orchestrated by session_018Nx7aian3f7dpRX5msjFBg. The S02 and S03 dependency
  on S01 is waived; each child brings up its own toolchain. Children write only their report
  file; the orchestrator merges dispositions and ledger text after each check-in.

Record any time a session could not follow `plan.md` section 4 (a suite that cannot run in
the container, a slice split in two, a lens not run) with the reason.

- S01: `scripts/check-docs-manifests.mjs` scans the audit reports too; a report naming a non-existent npm script fails it, so the orchestrator runs it before each ledger commit.
- S00: `npm ci` fails on the container's default Node 22.22.0 in both layers because entries
  in the lock files (`chokidar@5.0.0` under `@nestjs/cli`, `msw@2.15.0`) declare engines the
  default Node does not satisfy; this is a session-environment fact, not a repository defect,
  since CI runs Node 24 and the lock files install there. S01 confirms it on the frontend and
  records whether `docs/` says which Node version a contributor needs.
- S00: the clone is shallow (276 commits from 2026-10-11); the upstream baseline `d5cea9bf` is
  not reachable in it, so the prior findings are re-verified against the current code only, never
  by diffing against the upstream baseline. S05 and S22 need `git fetch --unshallow origin`.
