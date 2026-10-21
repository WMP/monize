# S21 Tests, CI, release, deployment manifests

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S21 (parallel wave, child session_01Xmf7H997Adk6ipvAx74awQ) |
| Status | in-progress, remaining: lenses 3-14 being written; inventory and first execution evidence below |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` at start | `c07217e605677847354f732570fa7b6d2f5ef384` (pin check of plan step 2: empty diff outside `docs/audits/`) |
| Date | 2026-10-21 / 2026-10-22 UTC |
| Primary path | `.github/workflows/ci.yml` |
| Hint line | `prioritize zero discovered tests as a failure on every job, the tested imaged and tagged revision being one revision, passWithNoTests and skipped tests, coverage exclusions hiding a load-bearing file, known-wrong tests (search for the four unconfirmed ones in docs/verification-contract.md section 5), mock fidelity at the boundaries S03..S17 marked undetected, a deployment default (Helm, Compose) that disables a protection or a persistent mount, and documentation promising a guarantee no mechanism holds` |
| Runtime | in progress; see section 12 |

## Inventory (working notes, folded into section 12 at the end)

- Workflows read in full: `ci.yml` (1641 lines). Read in part: `fork-images.yml` (1-56, 84-196), `lighthouse.yml` (25-67), `zap.yml` (20-63).
- Runners and their zero-discovery behaviour:

| Job / step | Runner | Zero discovered | Evidence |
| --- | --- | --- | --- |
| `backend-unit-tests` `npm run test:unit -- --coverage` | Jest, roots `src`, `testRegex .*\.spec\.ts$` | exit 1 | Jest default; S02 executed |
| `backend-integration-tests` `npm run test:integration` | Jest, `test/jest-integration.json` | exit 1 | S02 executed (MON-M44) |
| `frontend-unit-tests` `npm run test:cov` | Vitest 5 | exit 1 | Vitest default `passWithNoTests: false` |
| `e2e-tests`, `test:push`, cluster step | Playwright | exit 1 on no spec file; exit 0 when every test is skipped | Playwright default |
| `backend-lint` `push:client:test` | `node --test scripts/unifiedpush-client/*.test.cjs` | **exit 0** | executed: renamed `core.test.cjs`, `tests 0`, exit 0 |
| `backend-lint` `push:tls:test`, `migration:lint:test`; `npm-audit` and `env-doc-check` `node --test <file>` | node:test, explicit file | exit 1 when the file is missing, **exit 0** when the file holds no test | executed in the scratchpad |

- Build targets: `docker-compose.e2e.yml:70,167` build `target: development` (`NODE_ENV: development`); `ci.yml:1004,1369` publish `target: production`; only `zap.yml` (scheduled, `fail_action: false`) builds a production frontend; no workflow boots the production backend image.
