# AI review queue retry and email-receipt matching fixes, task list

> Companion to [`ai-review-retry.md`](./ai-review-retry.md). Definition of done
> per task is the layer's "Required before you push" list in `AGENTS.md`.

| ID | Task | Depends on | Status |
|----|------|-----------|--------|
| R1 | Docs: plan and task list | - | done |
| R2 | Database and backend: `attempts`, `last_error`, `last_attempt_at`, `needs_agent`, `close_reason`; retry with backoff in the automatic step; close reasons; data migration (decisions 1, 2, 3, 5) | R1 | todo |
| R3 | Backend: re-open (REST single and batch, MCP `reopen`), refusal reasons, list fields (decision 4) | R2 | todo |
| R4 | Backend: `match.includeAccountIds`, `INVESTMENT_CASH` excluded from automatic candidates (decision 6) | R1 | todo |
| R5 | Backend: record step `repeat` (decision 9) | R1 | todo |
| R6 | Database and backend: Message-ID dedupe, migration that resolves existing copies (decisions 7, 8) | R2 | todo |
| R7 | Frontend: `needs_agent` and last error on a request, re-open single and bulk, closed requests view | R3 | todo |
| R8 | i18n: English, pseudo-locale, every other locale | R2-R7 | todo |
