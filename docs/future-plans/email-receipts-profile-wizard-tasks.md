# Email receipts: domain profile wizard, task list

> Companion to [`email-receipts-profile-wizard.md`](./email-receipts-profile-wizard.md).
> Definition of done per task is the layer's "Required before you push" list in
> `AGENTS.md`.

| ID | Task | Depends on | Status |
|----|------|-----------|--------|
| W1 | Backend: `GET /email-receipts/domains/uncovered` | - | todo |
| W2 | Backend: `process-batch` `statuses`, parser `reprocessableCount` | - | todo |
| W3 | Backend: `testDefinition` expected transactions | - | todo |
| W4 | Backend: `generate-with-ai` (synchronous assistant run, create or revise a draft) | W3 | todo |
| W5 | Backend: `POST /email-receipt-parsers/:id/preview` | - | todo |
| W6 | Frontend: tab order; processing button only for failures and stale profiles | W2 | todo |
| W7 | Frontend: Profiles tab domain cloud and the four-step wizard; remove `ProfileCreationGuide` | W1, W4, W5 | todo |
| W8 | i18n: English, pseudo-locale, every other locale | W6, W7 | todo |
