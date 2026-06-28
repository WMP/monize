## Problem

Image publishing is gated to a manual release: the `prepare-release` / `build-and-push` jobs in `ci.yml` run only on `workflow_dispatch` on `main`, so merging a PR to `main` doesn't produce an image. Changes that are already on `main` — e.g. the reverse MCP relay (#722) and the in-chat write confirmations (#725) — aren't pullable as an image until the next manual release. To try merged-but-unreleased work you currently have to either wait for a release or fork + build it yourself.

## Question / request

Could upstream publish images more often, so the current `main` is testable before a formal release? A few options, any one of which would help:

1. **Edge tag on push to `main`** — build + push an unversioned `:edge` (or `:main`) tag on each push to `main`, separate from the versioned release tags. No version bump, no GitHub release. The real release pipeline (version bump, cosign signing, SBOM/provenance) stays exactly as-is.
2. **Nightly** — a scheduled build of `main` to `:edge` / `:nightly`.
3. **Dispatch releases more frequently** — simplest, but heavier (version bump + release each time).

Option 1 looks lightest: a pullable "latest main" without churning versions or signing every commit.

## Why

It closes the gap between "merged to `main`" and "pullable image". Today the only ways to test a merged fix are to wait for a release or to fork and build (Fork Images) — fine for contributors, but an edge image would let anyone `docker pull` and confirm a change before it ships.

## Note

This is separate from Fork Images (#714), which lets a *fork* build its own images. This asks whether *upstream* can surface an edge/`main` image directly.
