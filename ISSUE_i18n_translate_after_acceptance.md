# Translate after functional acceptance, not during development (English-first)

## Problem

The current contributor guidance (CONTRIBUTING.md and CLAUDE.md, i18n section) says:

> A new feature is not done until it is fully internationalized and translated for every supported locale in the same PR.

That's the right end state, but enforcing it *throughout development* is costly. While a feature is still under review, its user-facing copy keeps changing -- labels get reworded, strings get split or dropped. Every change means re-translating across ~20 locales, and most of that work is thrown away when the wording changes again on the next review round. The parity tests (`messages.parity.test.ts`, `locales.parity.spec.ts`) push contributors to translate everything up front, i.e. at the worst possible time.

## Real-world cost

A concrete data point from building one feature with an AI coding agent (the reverse MCP relay chat): the work took roughly **50 minutes and ~150k tokens**. The translation pass alone -- filling ~20 locales across two namespaces -- was about **40k tokens** of that, roughly a quarter of the whole feature. And because the wording was still in flux during development, a good part of that translation effort was redone as strings changed. Doing the locale pass once, after the copy settled, would have removed that churn outright.

This matters more than a raw token count suggests. Contributors increasingly use AI coding agents (Claude Code, etc.) on **subscription plans with rolling 5-hour and weekly usage limits**, not metered API billing. So ~40k tokens spent re-translating copy that isn't final isn't just "cost" -- it's a real slice of a contributor's usage window, and on a lower tier (e.g. Claude Pro) that throwaway work can be the difference between finishing a feature in one sitting or hitting the limit mid-task. Translating once, after acceptance, keeps that budget on the actual engineering.

## Proposal

Make the workflow explicitly **English-first**: develop and review in English only, and do the full translation pass **once, after the code and its copy are functionally accepted**, as the final step before merge.

Concretely:

1. **During development / review:** add and edit only the English catalogs (`en/*`), and regenerate the pseudo-locale (`npm run i18n:pseudo`). The pseudo-locale already exercises every key for QA, so missing-translation bugs still surface. Do **not** hand-translate the other locales yet.
2. **After functional acceptance** (code approved, copy settled): run a single localization pass that fills every locale, then parity goes green. This can be the last commit on the PR, or a fast follow-up PR -- maintainer's choice.
3. **Merge gate unchanged:** `main` still requires full parity, so released code is never partially translated. Only the *timing* moves -- translate last, not continuously.

## Docs to change

- **CONTRIBUTING.md** / **CLAUDE.md** i18n sections: reword "translated for every supported locale in the same PR" to "English-first during development; all locales completed once the change is functionally accepted, before merge."
- Optionally note that parity-test failures on a WIP branch are expected until the localization pass, and are not a reason to translate early.

## Why this helps

- Eliminates repeated re-translation of copy that's still in flux -- translate each string once, when it's final.
- Keeps reviewers focused on behaviour and English wording, not 20 locale diffs.
- No regression in shipped quality: the merge gate and pseudo-locale stay.

## Open questions for the maintainer

- Preference for the localization pass: final commit on the same PR, or a dedicated follow-up PR?
- Should there be a label (e.g. `needs-i18n`) so WIP-but-English-complete PRs are obviously not mergeable yet?
