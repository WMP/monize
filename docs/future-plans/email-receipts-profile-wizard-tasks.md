# Email receipts: domain profile wizard, task list

> Companion to [`email-receipts-profile-wizard.md`](./email-receipts-profile-wizard.md).
> Definition of done per task is the layer's "Required before you push" list in
> `AGENTS.md`.

| ID | Task | Depends on | Status |
|----|------|-----------|--------|
| W1 | Backend: `GET /email-receipts/domains/uncovered` | - | done |
| W2 | Backend: `process-batch` `statuses`, parser `reprocessableCount` | - | done |
| W3 | Backend: `testDefinition` expected transactions | - | done |
| W4 | Backend: `generate-with-ai` (synchronous assistant run, create or revise a draft) | W3 | done |
| W5 | Backend: `POST /email-receipt-parsers/:id/preview` | - | done |
| W6 | Frontend: tab order; processing button only for failures and stale profiles | W2 | done |
| W7 | Frontend: Profiles tab domain cloud and the four-step wizard; remove `ProfileCreationGuide` | W1, W4, W5 | done |
| W8 | i18n: English, pseudo-locale, every other locale | W6, W7 | done |
