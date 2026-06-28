# Make it easy for forks to build and publish their own images

## Problem

Right now there's no first-class way for a fork to produce runnable backend + frontend images. The upstream `build-and-push` job in `ci.yml` is (rightly) tailored to this repo: it's gated on the full test/security matrix, bumps versions, creates releases, and signs images, and it publishes to the upstream GHCR namespace. A fork can't reuse it as-is.

So anyone running a fork (to test a feature branch on real infra, to self-host a patched build, or to demo a PR before it merges) ends up hand-rolling a CI change per branch/fork and tweaking it every time. That's repetitive and easy to get wrong, and the edits leak into PRs back to upstream.

## Proposal

Add a small, fork-friendly image publisher workflow to the repo that:

- **Derives the owner dynamically** (`ghcr.io/${owner}/monize-*`, lowercased) so it works unchanged on any fork -- no per-fork edits.
- **Publishes to the fork's own GHCR namespace** using the default `GITHUB_TOKEN` (`packages: write`) -- no secrets to configure.
- **Is independent of the release pipeline**: no version bump, no GitHub release, no image signing, not gated on the full matrix. It exists only to produce runnable images, tagged with a branch slug + short SHA (plus `latest`).
- **Does not run for the upstream repo**, so it never duplicates or competes with the canonical `ci.yml` publish. Guard the job with something like `if: github.repository_owner != '<upstream-owner>'` (or `github.repository != '<upstream>/monize'`).

### Triggering

Two complementary triggers, because GitHub runs a `push` workflow from the definition present on the pushed ref:

- `push` to a curated set of branch globs (`main`, `feat/**`, `fork/**`, ...) for branches that carry the file.
- `workflow_dispatch` with an optional `ref` input that checks out and builds any branch/tag/SHA. This lets a fork keep `main` a clean mirror of upstream and still build any branch on demand without copying the workflow around. (Note: `workflow_dispatch` requires the workflow to exist on the fork's default branch.)

### One-time fork setup (documented in the workflow header)

1. Enable Actions on the fork.
2. Nothing else -- `GITHUB_TOKEN` already has `packages: write`.
3. Optionally make the resulting packages public to pull without auth.

## Security notes

- Pin all third-party actions to commit SHAs.
- Never interpolate `${{ ... }}` (branch names, dispatch inputs) directly into `run:`; pass them via `env:` to avoid shell injection.
- `packages: write` is the only elevated permission; everything else stays `read`.

## Offer

I've already prototyped exactly this on my fork -- a self-contained `fork-images.yml` (dynamic owner, dual push/`workflow_dispatch` triggers, pinned SHAs, env-passed ref). Happy to open a PR adding it here behind the `repository_owner` guard so it's a no-op for upstream but available to every fork. Would you take it? Any preference on the trigger set or where it should live?
