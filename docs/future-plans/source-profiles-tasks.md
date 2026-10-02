# Source profiles: agent task list

> Companion to [`source-profiles.md`](./source-profiles.md). One task per
> session and per PR, in dependency order. No task starts before SP1, except
> SP2, which the bank sync branch already carries.

## How to use this list

- **The governing invariants apply to every task**: S1 (a profile never
  changes the duplicate key), S2 (a shared profile carries no personal data),
  S3 (preview equals commit), S4 (structure through the existing processors).
- **Definition of done**: the layer gates of `AGENTS.md`; strings in every
  locale; the PR body per `.github/pull_request_template.md`.

## Task graph

| ID | Task | Depends on | Deploy impact | Status |
|----|------|-----------|---------------|--------|
| SP1 | Discussion approved; D1 to D4 answered; this plan merged | -- | none | [ ] |
| SP2 | Bank sync: the operation-code table moves to a built-in profile file for PKO BP, chosen by institution; other banks get the default profile | -- | inert | [ ] |
| SP3 | Profile schema, validator (S2), loader for built-in profiles; operation location and labels | SP1 | inert | [ ] |
| SP4 | Payee and description per type, with the named cleanup steps; preview shows the profile's effect | SP3, unified preview U3 | additive | [ ] |
| SP5 | User profiles: per-user override, editor in the preview, export and import as JSON | SP4 | additive | [ ] |
| SP6 | Structure per type: own-account transfer (bank sync BS14), split by captures (BS21, CSV P5) | SP4 | additive | [ ] |
| SP7 | CSV profiles on the same engine (csv-source-profiles P2 to P5) | SP4 | additive | [ ] |
| SP8 | Optional: converter for Firefly III CSV configurations (decision D2) | SP7 | none | [ ] |
