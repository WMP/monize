# S19 Frontend Forms Round Trip

Status: in-progress, remaining: override editor, investment forms, post dialog, account form, import wizard, rules editor, settings and reauthentication, sections 2-14 to complete.

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S19 (child session_01LuCrA2Ko2LmWJpCCVZtqu1), parallel wave with S17 and S18 |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| Pin check | `git diff --stat 72c59ec4 HEAD -- . ':!docs/audits/2026-10' ':!docs/audits/2026-08-upstream'` empty |
| Date | 2026-10-21 |
| Primary path | `frontend/src/components/transactions/` |
| Hint line | as in `sessions.md` S19, verbatim |
| Runtime | in progress (see section 12) |

## 4. Confirmed findings (draft)

- A26-S19-01 (HIGH, executed): a cross-currency transfer opened from its receiving leg loads the receiving amount into the source-amount field; an unedited save re-prices the transfer (USD 100 -> CAD 135 becomes USD 135 -> CAD 135, the USD account debited a further 35.00).
- A26-S19-02 (HIGH, executed): editing an ordinary or split transaction and switching it to Transfer mode creates a new transfer and leaves the original row; the account is debited twice.
- A26-S19-03 (MEDIUM, executed): two-decimal loading and blur of four-decimal amounts (MON-M37).
- A26-S19-04 (MEDIUM, executed): investment form and embedded investment split prefill the undated latest rate and send it as explicit; a back-dated trade commits today's rate (MON-H14 client half, A26-S13-02 persisted path).
- A26-S19-05 (LOW): transfer cost per share is editable but ignored on create.
- A26-S19-06 (LOW): a stored 0 % loan rate loads as empty and blocks every edit.
