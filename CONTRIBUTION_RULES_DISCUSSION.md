# Proposal: a propose-first contribution workflow to prevent large, conflicting, AI-generated PRs

> Draft for a GitHub **Discussion** (category: Ideas / Meta) on `kenlasko/monize`.
> It's a process proposal, not a bug report. Paste manually (gh write is blocked locally).

## Context

Thanks for maintaining Monize — this is a constructive process proposal, not a complaint about anyone in particular.

As the project gets more attention, we're seeing more large, broad-scope PRs (often AI-assisted) that mix several concerns and touch shared parts of the codebase. A recurring side effect: contributors unknowingly work on overlapping areas, producing painful merge conflicts and rework — including against features being built jointly with the maintainer. Generating code is now cheap; reviewing, integrating, and maintaining it is not, and that cost falls on the maintainer.

## Problem

- Large multi-concern PRs are slow and risky to review.
- AI-generated changes vary in quality and often skip project conventions; "it compiles and the prompt looked right" != "ready to merge."
- No coordination on *who* works on *what* -> collisions on shared files and avoidable conflicts.
- The maintainer absorbs triage, conflict resolution, and QA that could have been prevented upfront.

## Proposed workflow (before any PR)

1. **Propose first.** Open a Discussion describing the idea and the problem it solves — before writing code. No surprise PRs.
2. **Agree on the approach.** The maintainer approves *how* it will be built: scope, boundaries, which modules it may touch, expected size, conventions, tests, and whether to split into smaller PRs.
3. **Assign ownership / a time window.** The maintainer decides who builds it and when, so two people don't touch the same area simultaneously. This is the key step for avoiding conflicts and hard merges.
4. **Then implement.** Open a PR scoped to exactly what was agreed, linking the discussion. PRs that skip steps 1-3 may be asked to go through the process first.

## Suggested PR rules (for `CONTRIBUTING.md`)

- One concern per PR; split large work into a reviewable series.
- Link the approving discussion/issue in the PR description.
- Follow existing conventions (structure, i18n for all locales, tests for new behavior).
- Disclose AI assistance and **own** the result: the author is responsible for correctness, conventions, and tests — not the reviewer.
- Don't refactor shared/core areas as a side effect of a feature PR without prior agreement.
- Rebase on latest `main` before requesting review.

## Why this helps

- Reviewer time goes to agreed, well-scoped changes instead of triage.
- Coordinated ownership prevents overlapping work and the conflicts that follow.
- New contributors still get a clear, welcoming on-ramp — they just start with a conversation.

## Open questions

- Enforce via a PR template checkbox ("linked to an approved discussion")?
- Visibility labels: `needs-approval` / `approved-to-build` / `in-progress: <area>`?
- A cooling-off rule for unsolicited large PRs?

Happy to help draft `CONTRIBUTING.md` and a PR template if there's interest.
