## Linked discussion / issue

Closes the build failure reported in #714 (the `Fork Images` workflow you added there).

## Summary

Small fixes to `.github/workflows/fork-images.yml` so `Fork Images` actually builds on a fork:

1. **Blocker — `$GITHUB_OUTPUT` heredoc.** The multi-line `tags` value is written via a heredoc, but command substitution strips the trailing newline and `printf '%s'` doesn't re-add it, so the last tag and the `EOF` delimiter end up on the same line and the step fails with `Invalid value. Matching delimiter not found 'EOF'` — before any image is built, on every fork. Fixed with `printf '%s\n'`. (Confirmed: with this, the build gets past the metadata step and pushes images.)
2. **Pushed tags in the run Summary.** A `Summary` step now lists the pushed image tags on the run page, so you can copy-paste what to `docker pull` without opening the build log.
3. **Branch in the immutable tag.** The per-commit tag now embeds the branch: `:<branch-slug>-<short-sha>` (alongside the moving `:<branch-slug>`), so an immutable tag tells you which branch it came from.

(1) is the actual blocker; (2) and (3) restore niceties from the prototype and are easy to drop if you'd rather keep the current scheme.

## Checklist

- [x] An approved discussion or issue exists and is linked above.
- [x] This PR addresses a **single concern** (making the fork image build work).
- [x] New behavior has tests, and the existing suite passes. _(CI-only change; verified by running the workflow on my fork — the build now completes and pushes images.)_
- [x] All user-facing strings are translated for **every** locale (i18n parity). _(No user-facing strings.)_
- [x] No shared/core areas were refactored without prior agreement (fixes only the fork-only `fork-images.yml`, which never runs upstream).
- [x] The branch is rebased on the latest `main`.
- [x] AI assistance is disclosed below, and I have reviewed and own the result.

## AI assistance disclosure

Diagnosed and fixed with Claude Code; I reviewed the change and confirmed the build works on my fork.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
