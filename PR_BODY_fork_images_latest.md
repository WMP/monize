## Linked discussion / issue

Follow-up to #714 / #724 (the `Fork Images` build fixes).

## Summary

One more newline bug in `fork-images.yml`, same class as the `$GITHUB_OUTPUT` one fixed in #724, but on the `:latest` append — so it only bites when building the **default branch**:

```bash
tags="$(printf '%s:%s\n%s:%s-%s\n' ...)"   # $() strips the trailing newline
if [ "$REF_NAME" = "$DEFAULT_BRANCH" ]; then
  tags="$(printf '%s%s:latest\n' "$tags" "$image")"   # :latest glued to last tag
fi
```

Because `$tags` no longer ends in a newline, `:latest` concatenates onto the previous tag and buildx fails:

```
ERROR: failed to build: invalid tag
"ghcr.io/<owner>/monize-backend:main-1a972a3ghcr.io/<owner>/monize-backend:latest":
invalid reference format
```

Failing run (a `Fork Images` build of `main` on my fork): https://github.com/WMP/monize/actions/runs/27822189202

Feature/fork-branch builds never hit this (they skip the `:latest` block); it only surfaces on a default-branch build. Fix: add the newline before appending `:latest` (`printf '%s\n%s:latest\n'`). Confirmed a default-branch fork build then tags `:<slug>`, `:<slug>-<sha>`, and `:latest` correctly.

## Checklist

- [x] An approved discussion or issue exists and is linked above.
- [x] This PR addresses a **single concern** (the `:latest` tag bug in fork builds).
- [x] New behavior has tests, and the existing suite passes. _(CI-only change.)_
- [x] All user-facing strings are translated for **every** locale (i18n parity). _(No user-facing strings.)_
- [x] No shared/core areas were refactored without prior agreement (fork-only `fork-images.yml`, never runs upstream).
- [x] The branch is rebased on the latest `main`.
- [x] AI assistance is disclosed below, and I have reviewed and own the result.

## AI assistance disclosure

Diagnosed and fixed with Claude Code; confirmed on my fork.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
