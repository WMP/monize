# Prior Findings Register (upstream audit of 2026-08)

> The 70 canonical findings of the upstream audit of `kenlasko/monize` at `d5cea9bf`
> (`docs/audits/2026-08-upstream/08-final-report.md`, Appendix A), each assigned to the session
> of [`sessions.md`](./sessions.md) that disposes of it at `AUDIT_BASELINE_SHA`. S02 triages the
> HIGH and verification-defect rows first; the owning session makes the final disposition.

## Dispositions

| Disposition | Meaning | Evidence required |
| --- | --- | --- |
| `FIXED_VERIFIED` | The scenario cannot be reached at the baseline. | The mechanism (constraint, lock, CAS, guard test) named, and the test run in the session. |
| `STILL_OPEN` | The scenario is reachable. | Becomes an `A26-*` finding in the session report, in the full 15-field format. |
| `SUPERSEDED` | The code path no longer exists. | The replacement named and audited under its own invariant. |
| `NOT_LOCATED` | The evidence path is gone and no equivalent was found. | The searches performed, listed. |
| `REJECTED` | The upstream analysis was wrong. | The reconstruction that shows it, with the current code. |
| `HANDED_TO_Sxx` | S02 only: triaged, final call with the owning session. | The owning session's ID. |

A row keeps `open` until its owning session writes the disposition and the session commit. Two
columns are filled in by sessions: **Disposition** and **Evidence** (a section reference in the
session report, `NN-<slice>.md#...`).

## HIGH

| ID | Title (abridged) | Owner | S02 triage | Disposition | Evidence |
| --- | --- | --- | --- | --- | --- |
| MON-H01 | Automatic backups of different owners and instances share one filename and retention namespace | S06 | STILL_OPEN (residual) (S02) | open | |
| MON-H02 | Restore remaps local/S3 attachment metadata without copying or verifying the bytes | S06 | FIXED_VERIFIED (S02) | open | |
| MON-H03 | Concurrent MNY import starts create separate active jobs for one user | S09 | FIXED_VERIFIED (S02) | open | |
| MON-H04 | Import worker crash after the data commit lets retry replay the committed source | S09 | STILL_OPEN (residual) (S02) | open | |
| MON-H05 | Transaction, transfer, reconciliation and bulk mutations derive balance deltas from stale snapshots | S07 | STILL_OPEN (S02) | open | |
| MON-H06 | Scheduled posting has no durable occurrence identity and commits money before advancing the schedule | S08 | STILL_OPEN (residual) (S02) | open | |
| MON-H07 | Absolute balance recomputation can overwrite a concurrent committed atomic delta | S07 | FIXED_VERIFIED (S02) | open | |
| MON-H08 | Holding updates and full rebuilds can lose concurrent investment transactions | S12 | FIXED_VERIFIED (S02) | open | |
| MON-H09 | One emergency-access claim token can be consumed by two concurrent requests | S03 | FIXED_VERIFIED (S02) | FIXED_VERIFIED | `03-security-auth.md#5-prior-finding-dispositions` |
| MON-H10 | Transfer VOID transitions can leave the two legs and both balances inconsistent | S07 | STILL_OPEN (residual) (S02) | open | |
| MON-H11 | Transfer currencies, FX rate and destination value are not server-authoritative | S07 (client half S19) | STILL_OPEN (residual) (S02) | open | |
| MON-H12 | Unavailable FX is converted as a valid-looking 1:1 value | S13 | STILL_OPEN (S02) | open | |
| MON-H13 | Historical net-worth replay adds a stock-split ratio instead of multiplying shares | S13 | FIXED_VERIFIED (S02) | open | |
| MON-H14 | Investment preview and commit can use different exchange rates without disclosure | S12 | FIXED_VERIFIED (S02) | open | |
| MON-H15 | Opening an existing scheduled investment override replaces its stored price with the latest quote | S19 | FIXED_VERIFIED (S02) | open | |
| MON-H16 | Partial or unavailable portfolio valuations are rendered as complete totals | S20 | STILL_OPEN (residual) (S02) | open | |

## MEDIUM

| ID | Title (abridged) | Owner | Disposition | Evidence |
| --- | --- | --- | --- | --- |
| MON-M01 | Deployment documentation and defaults do not match Compose and Helm manifests | S21 | open | |
| MON-M02 | Contributor guidance recommends transaction APIs the scoped rule prohibits | S01 | open | |
| MON-M03 | Delegated `/users/me` responses expose fields outside the delegated profile | S03 | FIXED_VERIFIED | `03-security-auth.md#5-prior-finding-dispositions` |
| MON-M04 | MCP sessions keep the scopes from session creation after the bearer is revalidated | S17 | open | |
| MON-M05 | OIDC destructive-action confirmation accepts an arbitrary non-empty value | S03 | FIXED_VERIFIED | `03-security-auth.md#5-prior-finding-dispositions` |
| MON-M06 | Delegation create, link and revoke conflict with enforced RLS ownership | S04 | FIXED_VERIFIED | `04-rls-tenancy.md#5-prior-finding-dispositions` |
| MON-M07 | Delegated activity is attributed to the effective owner, not the real actor | S03 | FIXED_VERIFIED | `03-security-auth.md#5-prior-finding-dispositions` |
| MON-M08 | Restore ordering can fail linked asset/loan account relationships | S06 | open | |
| MON-M09 | Automatic-backup artifacts are published through non-crash-atomic final-file operations | S06 | open | |
| MON-M10 | Authenticated users can browse and select arbitrary server filesystem backup paths | S06 | open | |
| MON-M11 | Default Helm deployment exposes automatic backup without a writable persistent mount | S06 (Helm half S21) | open | |
| MON-M12 | Backup export reads tables through separate transactions, not one snapshot | S06 | open | |
| MON-M13 | Backup export buffers the whole database and archive in memory | S06 | open | |
| MON-M14 | RLS enforce mode can accept an unsafe runtime database role | S04 | FIXED_VERIFIED | `04-rls-tenancy.md#5-prior-finding-dispositions` |
| MON-M15 | The runtime application role can write migration history | S05 | FIXED_VERIFIED | `05-migrations-schema.md#5-prior-finding-dispositions` |
| MON-M16 | Restore decompression has no effective size or ratio bound | S06 | open | |
| MON-M17 | Backups containing custom currencies are not portable across instances | S06 | open | |
| MON-M18 | Support backups retain identifying custom-currency names while UI copy says masked | S06 | open | |
| MON-M19 | Global custom-currency cleanup decides deletion from tenant-filtered evidence | S13 | open | |
| MON-M20 | Account closure can race a mutation and commit a closed non-zero account | S07 | open | |
| MON-M21 | Concurrent incremental split additions can exceed the parent amount | S07 | open | |
| MON-M22 | Local and S3 attachment bytes are not transactionally coupled to metadata | S06 | open | |
| MON-M23 | Logout can miss a refresh token created by a concurrent rotation in the same family | S03 | FIXED_VERIFIED | `03-security-auth.md#5-prior-finding-dispositions` |
| MON-M24 | Parallel failed logins lose counter increments and delay lockout | S03 | FIXED_VERIFIED | `03-security-auth.md#5-prior-finding-dispositions` |
| MON-M25 | AI insight generation uses a process-local guard and duplicates work across replicas | S08 (claim), S17 (provider) | open | |
| MON-M26 | Emergency-access grant issuance can send links another replica immediately invalidates | S03 | FIXED_VERIFIED | `03-security-auth.md#5-prior-finding-dispositions` |
| MON-M27 | Ordinary transaction currency can disagree with the owning account currency | S07 (cross-check S10) | open | |
| MON-M28 | Mixed-sign split children are accepted when their signed total equals the parent | S07 (client half S19) | open | |
| MON-M29 | Explicit zero or negative investment FX rates produce inconsistent cash postings | S12 | open | |
| MON-M30 | BUY commission is omitted from cost basis although cash and UI wording include fees | S12 | open | |
| MON-M31 | Transfer split amounts are omitted from budget spending | S16 | open | |
| MON-M32 | Final scheduled loan payment recalculates splits without shrinking the parent payment | S15 | open | |
| MON-M33 | Monte Carlo current-value failure is converted to a real zero | S13 | open | |
| MON-M34 | Bulk deletion can leave linked-account monthly/net-worth snapshots stale | S13 | open | |
| MON-M35 | Foreign-security transfer resets destination cost basis to an implied 1:1 value | S12 | open | |
| MON-M36 | A failed backend logout is presented as a successful local logout | S18 | open | |
| MON-M37 | Two-decimal split editing and one-cent tolerance conflict with four-decimal persistence | S19 | open | |
| MON-M38 | Successful transaction mutations leave cached budget progress stale | S18 | open | |
| MON-M39 | Tests validate missing FX as a successful 1:1 conversion (verification defect) | S13 | open | S02 triage: STILL_OPEN (relocated), see `02-prior-high-triage.md#5-prior-finding-dispositions` |
| MON-M40 | The scheduled-override test expects an existing price to be overwritten (verification defect) | S19 | open | S02 triage: FIXED_VERIFIED, see `02-prior-high-triage.md#5-prior-finding-dispositions` |
| MON-M41 | The historical stock-split fixture encodes additive shares (verification defect) | S13 | open | S02 triage: FIXED_VERIFIED, see `02-prior-high-triage.md#5-prior-finding-dispositions` |
| MON-M42 | The AppHeader test expects logout failure to look successful (verification defect) | S18 | open | S02 triage: FIXED_VERIFIED, see `02-prior-high-triage.md#5-prior-finding-dispositions` |
| MON-M43 | Automatic-backup tests expect generic cross-owner keys (verification defect) | S06 | open | S02 triage: STILL_OPEN (narrowed), see `02-prior-high-triage.md#5-prior-finding-dispositions` |
| MON-M44 | The backend integration CI command can succeed after discovering zero tests | S21 | open | S02 triage: FIXED_VERIFIED, see `02-prior-high-triage.md#5-prior-finding-dispositions` |
| MON-M45 | The release workflow pushes a `[skip ci]` bump after testing a different SHA | S21 | open | S02 triage: STILL_OPEN, see `02-prior-high-triage.md#5-prior-finding-dispositions` |
| MON-M46 | Canonical concurrency defects lack deterministic tests at the production boundary (missing test) | S21 | open | |
| MON-M47 | No local/S3 attachment backup-restore round trip verifies bytes and remapping (missing test) | S06 | open | |

## LOW

| ID | Title (abridged) | Owner | Disposition | Evidence |
| --- | --- | --- | --- | --- |
| MON-L01 | A stale PAT comment mentions a reports scope issuance does not support | S03 | FIXED_VERIFIED | `03-security-auth.md#5-prior-finding-dispositions` |
| MON-L02 | Database initialization and migration runners are not serialized across replicas | S05 | FIXED_VERIFIED | `05-migrations-schema.md#5-prior-finding-dispositions` |
| MON-L03 | Budget-alert deduplication is a check-then-insert race | S16 | open | |
| MON-L04 | Staged-file expiry can delete bytes a pending or running import still needs | S09 | open | |
| MON-L05 | Concurrent attachment uploads can exceed the per-transaction cap | S06 | open | |
| MON-L06 | Bill and mortgage reminder crons send duplicate email from every replica | S08 | open | |
| MON-L07 | Test and CI documentation overstates enforcement | S21 | open | |

## Hints from the repository itself

These are not dispositions. They are places where the repository claims, in prose, that an
upstream finding was addressed; a session verifies the mechanism and the test before writing
`FIXED_VERIFIED`.

- `docs/verification-contract.md` section 5 says the additive split fixture (MON-M41), the
  OIDC sentinel acceptance (MON-M05) and two loan tests were corrected, and that the tests behind
  MON-M39, MON-M40, MON-M42 and MON-M43 were searched for and not found.
- `docs/verification-contract.md` section 6 names source scans now holding INV-FX-001
  (MON-H12), INV-HOLDING-002 (MON-H13), INV-PROFILE-001 (MON-M03), INV-CURRENCY-001 and
  INV-CACHE-001 (MON-M38).
- `docs/audits/monize-audit-01-response.md` and `monize-audit-01-remediation-review-response.md`
  describe the one-active-job index (MON-H03) and a retired-job worker still committing
  (MON-H04's neighbour).
- `docs/system-invariants.md` marks INV-IMPORT-001, INV-IMPORT-002, INV-CLAIM-001,
  INV-BACKUP-001..003 and others `enforced`; each entry names its mechanism, which is the thing to
  test, not the status.
