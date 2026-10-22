# S21 Tests, CI, release, deployment manifests

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S21 (parallel wave, child session_01Xmf7H997Adk6ipvAx74awQ) |
| Status | in-progress, remaining: coverage-exclusion reading (C2, C3), the integration deadlock reproduction (H1), final adversarial pass |
| `AUDIT_BASELINE_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| `git rev-parse HEAD` at start | `c07217e605677847354f732570fa7b6d2f5ef384` (plan step 2 pin check: empty diff outside `docs/audits/`) |
| Date | 2026-10-21 / 2026-10-22 UTC |
| Primary path | `.github/workflows/ci.yml` |
| Hint line | `prioritize zero discovered tests as a failure on every job, the tested imaged and tagged revision being one revision, passWithNoTests and skipped tests, coverage exclusions hiding a load-bearing file, known-wrong tests (search for the four unconfirmed ones in docs/verification-contract.md section 5), mock fidelity at the boundaries S03..S17 marked undetected, a deployment default (Helm, Compose) that disables a protection or a persistent mount, and documentation promising a guarantee no mechanism holds` |
| Runtime | Node 24.22.1; PostgreSQL 16 in Docker (`monize-pg`); Helm v3.16.4 (checksum-verified, scratchpad). Suites and probes: section 12. |
| Hosted CI | Available read-only through the GitHub API for `WMP/monize`: every `CI Pipeline` run on this audit branch's PR (#31, runs 270 to 329) ended `cancelled` by the next push of the same ref, which is evidence for the concurrency semantics used in A26-S21-02. No hosted run was used as a test result. |

## 2. Invariant map

| ID | Statement | Mechanism named | Path |
| --- | --- | --- | --- |
| INV-RELEASE-001 (`partial`) | The tested commit, the published image's revision, the release commit and the tag are one revision, or a later full gate verifies the final one. | `prepare-release` resolves `github.sha` once (`ci.yml:920-926`) and threads it into `GIT_SHA` and the OCI revision annotation (`:1013`, `:1023`); cosign, SBOM and Trivy target the digest. The git half has no mechanism (REL-003..005 not enforced). | `workflow_dispatch on main -> 14 gate jobs on github.sha -> prepare-release -> build-and-push (push :latest and :X.Y.Z, sign, SBOM, Trivy) -> release (bump commit [skip ci], git pull --rebase, push with admin PAT, gh release create without --target)` |
| S21-I1 (REL-001, `docs/release-integrity.md`) | Zero discovered tests is a failure on every job. | Jest and Vitest defaults (exit 1); Playwright default; `jest-config.guard.spec.ts` bans the pass-with-no-tests flag on every tracked runner surface. **No mechanism** for `node --test` (exit 0 on zero). | `test set (globs, regex) -> runner discovery -> exit code -> job status -> needs: of prepare-release / prepare-preview` |
| S21-I2 (REL-002) | A release-blocking suite is asserted present by name and its count is printed. | none (documented as not enforced). | same |
| S21-I3 (VER-004) | A test that asserts a defect is not coverage; it is corrected when the invariant is found violated. | review only; `docs/verification-contract.md` section 5 register. | `invariant violated -> grep suites -> correct assertion -> companion boundary test` |
| S21-I4 (testing contract, "a mock proves the call") | Each invariant whose defect lives at PostgreSQL, two processes, a provider or a browser has a test at that boundary. | `docs/verification-contract.md` section 3 matrix; integration harness `test/helpers/integration-setup.ts`. | `invariant -> required test kind -> job that owns it (section 4) -> harness fidelity (schema, stubs, role)` |
| S21-I5 (coverage gate) | The coverage thresholds measure the code that carries behaviour. | `backend/package.json` `jest.collectCoverageFrom` and `coverageThreshold` (95 lines, 94 statements, 95 functions, 85 branches); `frontend/vitest.config.ts:15-34` (91 / 90 / 87 / 84). | `src file -> include/exclude -> instrumented -> threshold -> job status` |
| S21-I6 (deployment default) | A documented default deployment either provides a writable durable mount for an enabled feature or refuses with a reason. | Helm: opt-in PVC plus `fsGroup` (`helm/values.yaml:238-264`, `deployment-backend.yaml:213-230`); backend: `describeStore` writability probe (S06). Compose: none (A26-S21-03). | `operator follows README -> compose/helm default -> mount ownership -> backend uid 1001 -> backup/attachment write` |
| INV-HA-001 (`partial`, deployment half) | A replica serves only while what it shares is reachable. | `checkClusterBoot` (`backend/src/common/cluster/cluster-mode.ts`); chart refusals tested by `ci.yml:504-531`; `BACKUP_SHARED_VOLUME` / `ATTACHMENT_SHARED_VOLUME` assertions (`ci.yml:465-468`, `:547-555`). | `values -> configmap -> env -> checkClusterBoot -> exit 1 / ready` |
| S21-I7 (artifact fidelity) | The artifact a release publishes is the artifact a gate exercised. | **none**: every gate that boots the application builds `target: development` (A26-S21-01). | `Dockerfile stage -> compose build target -> E2E / Lighthouse -> published image (target: production)` |

## 3. Lens ledger

| Lens | Status |
| --- | --- |
| Pin the revision | ran (section 1) |
| Instructions before implementation | ran: `AGENTS.md`, root, backend, frontend and e2e `CLAUDE.md`, `docs/release-integrity.md` (full), `docs/verification-contract.md` sections 4-5, `docs/guard-tests.md`, INV-RELEASE-001 and INV-HA-001 entries |
| Summaries as hypotheses | ran: every hand-off addressed to S21 (ledger and reports 01-18) re-checked; the merged mutation table spot-checked against source (four rows, all matched) |
| Invariant model | ran (section 2) |
| Change surface (producers / consumers) | ran: every workflow trigger and `needs:` edge of `ci.yml`; every compose file's build target; every runner's discovery set |
| Read-model semantic migration (Rule 4) | not applicable: the slice introduces no new derived field; the analogous question, "does the image a gate tested equal the image published", is A26-S21-01 |
| Upstream dependency mutation matrix (Rule 5) | ran for the release artifact: `github.sha` (dispatch) / `main` tip (rebase) / package.json version (bump) / image digest (build) / tag target (release); section 7 |
| Cross-layer verification | ran: workflow -> compose -> Dockerfile stage -> entrypoint -> backend boot |
| Representation boundary | ran on runner exit codes (zero tests, zero-test file, missing file, all-skipped) and on Helm string-vs-boolean values (the chart already refuses a quoted `"false"`, `ci.yml:547-555`) |
| Browser/UI round trip | not applicable: no UI value in the slice; the E2E suite's own fidelity is covered under A26-S21-05 |
| Server-authoritative metadata | ran on the release inputs: `inputs.version` / `release_type` are read through `env` and validated (`ci.yml:896-918`); no finding |
| Identity versus value | ran: version string versus image digest (A26-S21-02: one version string can name two digests) |
| State machine | ran on the release flow: states `gated -> images pushed -> signed -> scanned -> bumped -> tagged`; cancellation and failure from each state (section 7) |
| Concurrency and idempotency | ran: `concurrency: group ${{ github.workflow }}-${{ github.ref }}` with `cancel-in-progress` (`ci.yml:41-43`) shared by push and dispatch on `main`; release re-dispatch semantics |
| Partial failure and compensation | ran: GHCR push before the Trivy gate and before the git half (A26-S21-02) |
| External provider lookup | not applicable: no provider call in the slice; npm audit retry logic read (`scripts/lib/npm-audit-gate.mjs`, covered by its own `node --test` file) |
| Database and migration | ran only for deployment: liveness probe versus a long migration at boot (DR-S21-3); schema parity is S05's |
| Backup/restore | ran for the mounts only (A26-S21-03, MON-M11 Helm half) |
| Financial | not applicable: no money computation in the slice; the known-wrong 1:1 test is recorded against its owning finding |
| Authorization / RLS | ran for the test harness only: real-role coverage (A26-S04-04) consolidated in A26-S21-04 |
| Tests are evidence | ran: the whole slice (sections 6 and 10) |
| Mutation | ran (section 6) |
| Counterexamples and interaction | ran (section 7) |
| Rejected hypotheses | ran (section 8) |
| Suggested diffs | ran (each finding) |
| Adversarial approval challenge | ran (section 13) |

## 4. Confirmed findings

Severity-ordered. IDs `A26-S21-nn`.

### A26-S21-01 -- No CI gate boots the published images: every job that runs the application builds the `development` target

1. **Severity:** MEDIUM
2. **Confidence:** high
3. **Location:** `docker-compose.e2e.yml:67-71`, `:164-172` (`target: development`, `NODE_ENV: development`); `.github/workflows/ci.yml:1501-1510` (E2E), `lighthouse.yml` (same compose file); published targets `ci.yml:1004`, `:1369`; `backend/Dockerfile:1-23` (dev stage: full `npm ci`, `npm run start:dev`, root user) versus `:58-125` (production: `npm ci --omit=dev --libc=musl`, `dist/`, `docker-entrypoint.sh`, user `nestjs` 1001); `frontend/Dockerfile:1-19` versus `:35-93` (`next dev` versus the standalone `server.js`).
4. **Violated invariant:** S21-I7, and the purpose of INV-RELEASE-001: a release gate's result is evidence about the artifact it ships, not only about the source revision.
5. **Reproduction scenario:** a change makes the production artifact fail while the development one works. Concrete, reachable classes: (a) a runtime `import` of a package listed only in `devDependencies` (no lint rule forbids it: `backend/eslint.config.mjs` has no `import/no-extraneous-dependencies`); (b) a file the production stage forgets to copy (`backend/Dockerfile:93-110` copies `dist`, `schema.sql`, `migrations`, `release-notes`, the entrypoint, and nothing else); (c) a write to a path the non-root user 1001 cannot write (A26-S21-03 is a live instance: the E2E backend runs as root and never sees it); (d) a `NODE_ENV === "production"` branch (7 backend source files) or the production CSP without `'unsafe-eval'` (`frontend/src/proxy.ts:67`); (e) the `db-init` / `db-migrate` / `main` sequence of `backend/docker-entrypoint.sh`, which the development image replaces with `nest start --watch`. Every one of these passes `backend-unit-tests`, `backend-integration-tests` (no image), `frontend-unit-tests`, `e2e-tests` (development image) and `helm-chart` (render only), and `build-and-push` then pushes, signs and tags the broken image as `:latest` and `:X.Y.Z`; `build-preview` pushes it as `:beta` on every merge.
6. **Observed:** the only workflow that builds a production target and starts it is `zap.yml` (scheduled nightly, frontend only, `fail_action: false`, not in any `needs:`). No job runs `docker-entrypoint.sh` or `node dist/main.js`.
7. **Expected:** at least one gate in the `needs:` of `prepare-release` and `prepare-preview` builds the `production` targets the publish jobs build and boots them to `/api/v1/health/ready` (backend, after `db-init` and `db-migrate`) and to a page load (frontend standalone server), as the non-root user.
8. **Impact:** availability of every installation that pulls `:latest` (the README's production Compose file pins `:latest`, `docker-compose.prod.yml:23`, `:120`): a boot failure ships signed, attested and Trivy-scanned. Also hides security behaviour that exists only in production mode (CSP, `Secure` cookies).
9. **Root cause:** the E2E stack was built for developer speed (hot reload) and reused as the release gate; `docs/release-integrity.md` section 2 defines "one revision" by commit SHA only, so the artifact gap is not named anywhere.
10. **Recommended correction:** run the E2E stack (or at least a boot smoke) from the `production` targets in CI, and keep the development targets for local use.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ jobs:
+  image-boot-smoke:
+    name: Production image boot
+    runs-on: ubuntu-latest
+    steps:
+      - uses: actions/checkout@9f698171ed81b15d1823a05fc7211befd50c8ae0 # v6.0.3
+        with:
+          persist-credentials: false
+      - name: Build the published targets
+        run: |
+          docker build --target production -f backend/Dockerfile -t monize-backend:smoke .
+          docker build --target production -f frontend/Dockerfile -t monize-frontend:smoke frontend
+      - name: Boot them as published
+        run: docker compose -f docker-compose.e2e.yml -f docker-compose.smoke.yml up -d --wait --wait-timeout 600
@@ prepare-release:
-        helm-chart,
+        helm-chart,
+        image-boot-smoke,
       ]
@@ prepare-preview:
-        helm-chart,
+        helm-chart,
+        image-boot-smoke,
       ]
```

    with a `docker-compose.smoke.yml` overlay setting `image: monize-backend:smoke` / `monize-frontend:smoke`, `NODE_ENV: production` and a named volume at `/data/backups`. Maintainer decision: run the whole E2E suite on production images (stronger, slower) or keep a boot smoke beside the development-image E2E.
12. **Recommended regression test:** the smoke job itself; plus a guard that every image the publish jobs build (`target: production`) is also built by a job in their `needs:`.
13. **Suggested regression-test diff:** a case in `backend/src/common/ci-images.guard.spec.ts` (it already reads the workflow and compose text) asserting that the set of `target:` values pushed by `build-and-push` / `build-preview` is a subset of the targets built by a gate listed in `needs:`.
14. **Verification method:** mutation: add `import "supertest";` to `backend/src/main.ts` (a devDependency) and confirm the new job fails while the other gates stay green.
15. **Residual risks:** a boot smoke does not exercise the production paths of individual features; only running E2E on the production images does. The workflow change itself is under `.github/` and needs maintainer agreement (`AGENTS.md`).

Causality: `PRE_EXISTING_UNREPORTED` (the upstream audit lists "E2E development targets" in its tool table, `docs/audits/2026-08-upstream/07-tests-ci.md:478`, without a finding). Execution evidence: the trace above at the baseline SHA (every `target:` in every compose file and workflow listed in section 12); the bind-mount probe of A26-S21-03 shows one concrete production-only failure the development image hides. The devDependency mutation was not built into an image in this session (needs a production image build through the proxy).

### A26-S21-02 -- Release images are pushed to `:latest` and `:X.Y.Z` before the CVE gate and before the release decision; any later failure or cancellation leaves them published, and the next dispatch reuses the version

1. **Severity:** MEDIUM
2. **Confidence:** high
3. **Location:** `.github/workflows/ci.yml:998-1027` (`push: true`, tags `:latest` and `:X.Y.Z`), `:1035-1044` (cosign on all three references), `:1072-1080` (Trivy report, `exit-code: '0'`), `:1089-1096` (the CVE gate, `exit-code: '1'`, after the push), `:1098-1100` (comment: "so a failed or vulnerable build never leaves a dangling version commit"), `:41-43` (one concurrency group per workflow and ref, `cancel-in-progress: true`), `:896-918` (version derived from `backend/package.json` at `github.sha`); `docs/release-integrity.md:207` ("CVE gate fails the build ... The scan is a gate, not a report"); `docs/system-invariants.md` INV-RELEASE-001 "Retry semantics".
4. **Violated invariant:** INV-RELEASE-001 and REL-003: what a consumer pulls under a release tag is a verified, released revision; and the CVE gate keeps a CRITICAL-CVE image from being published.
5. **Reproduction scenario (three entry points, one root):**
   - (a) A base-image or dependency CVE rated CRITICAL with a fix available: `build-and-push` pushes `ghcr.io/kenlasko/monize-backend:latest` and `:1.19.1`, signs them, then "Fail on critical CVEs" exits 1. The job is red, `release` does not run -- and `:latest` already points at the vulnerable digest. Every `docker compose -f docker-compose.prod.yml pull` (`:latest`, `docker-compose.prod.yml:23`) installs it.
   - (b) The maintainer merges a PR while a release dispatch on `main` is in `build-and-push` or later. The push to `main` starts a run in the group `CI Pipeline-refs/heads/main`, the same group as the dispatch (`github.ref` is `refs/heads/main` for both), and `cancel-in-progress` cancels the release. Images already pushed stay published; no bump, no tag. Hosted evidence for the mechanism: runs 270 to 329 of this repository's `CI Pipeline` on PR #31 all ended `cancelled` by the next push of the same ref.
   - (c) After (a) or (b), the next dispatch reads `backend/package.json` (still the old version, the bump never landed), resolves the same `1.19.1`, and pushes a different digest under `:1.19.1`. An operator who pinned `:1.19.1` between the two runs now runs a different image under the same version tag, and both digests carry a valid cosign signature for `:1.19.1`.
6. **Observed:** publication to the consumer-facing tags is the first side effect of the release path; every gate after it (CVE gate, git bump, tag) can fail without unpublishing. INV-RELEASE-001's "Retry semantics" says "A re-run after a partial release may bump the version twice"; the more likely outcome of a re-dispatch after an image-stage failure is the opposite: the same version is reused for a different digest.
7. **Expected:** push by digest (or to a staging tag) first, run the CVE gate on that digest, and move `:latest` / `:X.Y.Z` only after the gate and, ideally, after the git half succeeded; refuse a dispatch whose version tag already exists in the registry; exclude release runs from cancellation.
8. **Impact:** security (a CRITICAL-CVE image reaches every `:latest` consumer despite the gate the docs describe), integrity of version identity (one version string, two images), operations (a half-published release no tag refers to, as the invariant's own crash semantics say).
9. **Root cause:** `docker/build-push-action` is configured with the final tags and `push: true` in the same step that builds, so the scan can only report on something already published; the concurrency group does not distinguish a release from a push.
10. **Recommended correction:** build and push by digest only (no tags), scan and sign the digest, then a final step (after the CVE gate, and in the `release` job if the maintainer wants tag-after-commit) adds `:X.Y.Z` and `:latest` with `docker buildx imagetools create`; give `workflow_dispatch` runs their own non-cancelling group; refuse when `:X.Y.Z` already exists.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@
 concurrency:
-  group: ${{ github.workflow }}-${{ github.ref }}
-  cancel-in-progress: true
+  group: ${{ github.workflow }}-${{ github.event_name == 'workflow_dispatch' && 'release' || github.ref }}
+  cancel-in-progress: ${{ github.event_name != 'workflow_dispatch' }}
@@ build-and-push:
-          push: true
+          # Digest only: no consumer-facing tag exists until the CVE gate passed.
+          outputs: type=image,name=${{ matrix.image }},push-by-digest=true,name-canonical=true,push=true
           platforms: linux/amd64,linux/arm64
           provenance: true
           sbom: true
-          tags: |
-            ${{ matrix.image }}:latest
-            ${{ matrix.image }}:${{ needs.prepare-release.outputs.version }}
@@
       - name: Fail on critical CVEs
         ...
+      - name: Refuse a version that is already published
+        env:
+          IMAGE: ${{ matrix.image }}
+          VERSION: ${{ needs.prepare-release.outputs.version }}
+        run: |
+          if docker buildx imagetools inspect "${IMAGE}:${VERSION}" >/dev/null 2>&1; then
+            echo "::error::${IMAGE}:${VERSION} already exists"; exit 1
+          fi
+      - name: Publish the gated digest under its tags
+        env:
+          IMAGE: ${{ matrix.image }}
+          DIGEST: ${{ steps.build.outputs.digest }}
+          VERSION: ${{ needs.prepare-release.outputs.version }}
+        run: docker buildx imagetools create -t "${IMAGE}:${VERSION}" -t "${IMAGE}:latest" "${IMAGE}@${DIGEST}"
```

    The cosign step then signs `${IMAGE}@${DIGEST}` only (a signature is per digest; the tag references are redundant). Maintainer decision: whether `:latest` moves before or after the `release` job's git half.
12. **Recommended regression test:** a workflow self-test (the INV-RELEASE-001 "Required tests" row) asserting, by parsing `ci.yml`, that no step with `push: true` in `build-and-push` carries a non-digest tag before the step named "Fail on critical CVEs", and that `workflow_dispatch` runs are not in a cancelling group.
13. **Suggested regression-test diff:** add to `backend/src/common/ci-images.guard.spec.ts`:

```ts
// The spec reads workflow text (it has no YAML parser); keep it textual.
it("publishes no consumer-facing tag before the CVE gate", () => {
  const ci = readFileSync(join(requireRepoRoot(), ".github/workflows/ci.yml"), "utf8");
  const job = ci.slice(ci.indexOf("\n  build-and-push:"), ci.indexOf("\n  release:"));
  const gate = job.indexOf("name: Fail on critical CVEs");
  const tagged = job.search(/\$\{\{ matrix\.image \}\}:(latest|\$\{\{ needs\.prepare-release\.outputs\.version)/);
  expect(gate).toBeGreaterThan(-1);
  expect(tagged === -1 || tagged > gate).toBe(true);
});
```

14. **Verification method:** a dispatch in a fork with a deliberately vulnerable base image: the registry must show no new `:latest`; a push to `main` during a dispatch must not cancel it.
15. **Residual risks:** the preview path pushes `:beta` with no CVE scan at all, by design (`ci.yml:1300-1304`); that is a documented choice, recorded as DR-S21-1, not part of this finding.

Causality: `PRE_EXISTING_UNREPORTED` (MON-M45 covers the git half only; S01 recorded the shared concurrency group as DR-S01-6, not executed). Rule 7: one root (publication precedes the gates), three entry points. Execution evidence: the step order traced at the baseline SHA, and the hosted cancellation of every superseded run on PR #31.

### A26-S21-03 -- Both documented Compose deployments mount `/data/backups` (and `/data/attachments`) root-owned, so the backend's user 1001 cannot write them (MON-M01 still open, narrowed)

1. **Severity:** MEDIUM
2. **Confidence:** high (executed)
3. **Location:** `docker-compose.prod.yml:103-108` (bind mounts `./monize/backups`, `./monize/attachments`); `docker-compose.ha.yml:159-163`, `:229-237` (named volume `backups`, `BACKUP_SHARED_VOLUME: "true"` at `:112`); `backend/Dockerfile:111-115` (`adduser -S nestjs -u 1001`, no `/data` directory, no `chown` of it); `README.md:645-658` (production steps: copy `.env`, `up -d`; no directory or ownership step), `README.md:634` (`BACKUP_HOST_DIR` default `./monize/backups`).
4. **Violated invariant:** S21-I6: a documented default deployment provides a writable durable mount for the features it enables, or the documentation says what the operator must do.
5. **Reproduction scenario:** on a Linux Docker Engine host, follow `README.md` "Docker Compose (Production)". Docker creates the missing bind source `./monize/backups` as `root:root 0755`; the backend runs as uid 1001; every write under `/data/backups` fails with `EACCES`. Same for the HA stack's named volume, which Docker creates root-owned because the image has no `/data/backups` to copy ownership from.
6. **Observed (executed):** `docker run -u 1001:1001 -v <new dir>/monize/backups:/data/backups node:24-alpine touch /data/backups/probe` -> `drwxr-xr-x root root /data/backups`, `Permission denied`; the same with a fresh named volume -> `Permission denied`. The Helm chart does not have this defect: it sets `fsGroup: 100` with `runAsGroup: 100` on an opt-in claim (`helm/templates/deployment-backend.yaml:230`, rendered with `backend.persistence.backups.enabled=true` in this session).
7. **Expected:** the image creates `/data/backups` and `/data/attachments` owned by 1001 (so a named volume inherits it), and the README tells bind-mount users to create the host directory owned by uid 1001 (or the compose file sets `user:` to match the host).
8. **Impact:** automatic backups (and `ATTACHMENT_STORAGE_PROVIDER=local`) do not work on either documented Compose deployment; S06 established that the service reports the store as unavailable with a reason (`describeStore`), so the failure is visible, not silent -- which is why this is MEDIUM, not HIGH. On the HA stack the operator has asserted `BACKUP_SHARED_VOLUME=true`, so the boot check passes and the feature is unavailable at the point of use. The E2E cluster shard cannot see it: its development image runs as root (A26-S21-01).
9. **Root cause:** the production image switched to a non-root user without creating the data directories it expects mounts on; the Compose files and README were not updated to match.
10. **Recommended correction:** create and own the mount points in the image; document the bind-mount ownership.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/Dockerfile
+++ b/backend/Dockerfile
@@ RUN addgroup -g 1001 -S nodejs && \
     adduser -S nestjs -u 1001 && \
+    mkdir -p /data/backups /data/attachments && \
+    chown -R nestjs:nodejs /data && \
     chmod +x ./docker-entrypoint.sh && \
--- a/README.md
+++ b/README.md
@@ ### Docker Compose (Production)
+2. Create the host folders the backend writes to, owned by the container user (uid 1001):
+```bash
+mkdir -p monize/backups monize/attachments && sudo chown -R 1001:1001 monize
+```
```

12. **Recommended regression test:** a production-image boot smoke (A26-S21-01) that mounts a fresh named volume at `/data/backups` and asserts the backup store reports `available: true`.
13. **Suggested regression-test diff:** in the smoke overlay of A26-S21-01, `volumes: [smoke_backups:/data/backups]` and a step `curl -fsS .../api/v1/...` against the store status (endpoint name to be taken from `backend/src/backup/auto-backup.controller.ts`; not verified here).
14. **Verification method:** the two `docker run` probes above against the rebuilt image must print `WRITE_OK`.
15. **Residual risks:** a pre-existing host directory owned by another uid still fails; rootless Docker and Docker Desktop map ownership differently and were not probed.

Causality: `PRIOR_REPORTED` (MON-M01), `CONFIRMED_WITH_DIFFERENT_ROOT_CAUSE`: the upstream finding's Helm persistence half is fixed (section 5), the Compose half is the uid mismatch above. `scripts/check-docs-manifests.mjs` (run: OK, 119 Helm values, 33 documents) checks paths and Helm defaults, not mount ownership.

### A26-S21-04 -- Program-wide: the concurrency, post-commit and database-boundary invariants behind 15 HIGH and MEDIUM findings have no test at the production boundary (MON-M46 still open; consolidation of every session's undetected rows)

1. **Severity:** MEDIUM (missing test; the defects it fails to catch are counted in their own findings)
2. **Confidence:** high (59 undetected mutation rows across 17 sessions, each executed or traced by its session; four re-checked against source here)
3. **Location:** the family table in section 6.2; harness roots in `backend/test/helpers/integration-setup.ts:160-215` (`ScheduledTransactionsModule` replaced by `{}` stubs for its three exports and internals in every suite built through `createIntegrationModule`), `INTEGRATION_TYPEORM_OPTIONS` (schema from entities, A26-S05-01).
4. **Violated invariant:** S21-I4 (`docs/verification-contract.md` sections 2-3: a lock, a lease, a CAS or a post-commit ordering is proved only by a test with independent connections or a failpoint at the same boundary as production).
5. **Reproduction scenario:** per row of section 6.2: delete the lock, predicate or ordering; every committed suite stays green. Examples executed by their sessions: `token.service.ts:149`/`:261` `lockTokenFamily` removed (S03, `token.service.spec.ts` 33/33 green, probe 59/60 leaks); `transaction-split.service.ts:1116` parent read without `FOR UPDATE` (S07, all suites green); `job-claim.service.ts:144/146/281` lease predicates (S08, only SQL-text unit assertions fail); `134_joint_native_read_rls.sql:47` delegate predicate (S04, 175/175 integration green); `budget-spending.util.ts:132` VOID filter (S16, 510 unit and 3 integration green).
6. **Observed:** eleven root-cause families (section 6.2), of which three are harness properties rather than missing cases: no reusable two-connection harness (F1), an entity-built schema without the production keys and CHECKs (F3, A26-S05-01), and the scheduled module stubbed for every integration suite (F4: 22 production files outside `src/scheduled-transactions/` consume the stubbed services; `scheduled-loan-pricing-concurrency.integration.spec.ts:40` and `loan-settlement-claim.integration.spec.ts:53` both state the real `post()` "cannot be constructed here").
7. **Expected:** the harness builds the schema from `database/schema.sql` (or a parity guard holds the entities to it), constructs the real scheduled module, and offers a two-connection barrier helper; each HIGH finding of the program has a red test before its fix.
8. **Impact:** every HIGH concurrency or post-commit fix of the remediation program can regress silently; the suites the docs name as the owners (`Backend Integration Tests` "owns six test kinds", `docs/verification-contract.md:358-362`) cannot currently host the tests for F3 and F4 at all.
9. **Root cause:** the integration harness trades fidelity for construction convenience (entity `synchronize`, module stubs to break a forwardRef cycle), and no harness primitive exists for two connections with a barrier, so each session that needed one wrote a throwaway probe.
10. **Recommended correction:** three harness tasks before the per-finding tests: (1) `createIntegrationModule` builds the real `ScheduledTransactionsModule` (resolve the cycle with `forwardRef` in the test module, as production does); (2) build the test schema by applying `schema.sql`, or add the parity guard S05 proposed; (3) a `raceTwo(dataSource, a, b, barrier)` helper under `test/helpers/`. Then one red test per family row.
11. **Suggested remediation diff:** incomplete -- the harness change is supported by the evidence (`integration-setup.ts:200-212`, delete the `overrideModule(ScheduledTransactionsModule)` block and import the real module), but whether the cycle resolves in a `TestingModule` without the stub was not tried in this session; that is the missing information.
12. **Recommended regression test:** per family, the first test listed in section 6.2's "first red test" column.
13. **Suggested regression-test diff:** the two-connection pattern S03 used for its probe (two `DataSource`s, a `pg_advisory_lock` barrier) promoted to `test/helpers/race.ts`; not written here.
14. **Verification method:** re-run each section 6.2 mutation after the harness change; every row must turn `covered`.
15. **Residual risks:** frontend cache rows (F11) need a browser or a component harness, not the database helper.

Causality: `PRIOR_REPORTED` (MON-M46), `CONFIRMED`, and widened: the upstream finding named seven race classes; the program found 59 undetected rows in eleven families. Joins, by Rule 7, the session test-coverage findings A26-S03-04, A26-S04-04, A26-S05-01 (harness half), A26-S07-09, A26-S08-05, A26-S16-09, A26-S17-05 (S23 keeps each defect finding separate and merges these test findings here or keeps them as surfaces of this one).

### A26-S21-05 -- The E2E release gate passes a test that failed twice out of three, never runs one of its tests, and swaps a shard for the cluster run

1. **Severity:** LOW
2. **Confidence:** high
3. **Location:** `e2e/playwright.config.ts:12` (`retries: process.env.CI ? 2 : 0`, no `failOnFlakyTests`); `ci.yml:1466-1478` (matrix `shard: [1, 2, 3, 4]` plus `include: shard: 4, cluster: 'true'`, which adds `cluster` to the existing shard-4 entry instead of adding a fifth job); `e2e/tests/backup.spec.ts:160-163` (`test.skip(process.env.DEMO_MODE !== 'true')`) versus `docker-compose.e2e.yml:46` (`DEMO_MODE: "false"`); no `e2e/tsconfig.json` and no lint or type-check step for `e2e/` in any workflow.
4. **Violated invariant:** S21-I1 in its general form: a green gate means every test in it passed on the configuration it names.
5. **Reproduction scenario:** (a) an order-dependent race in the app that fails one attempt in two passes with retries 2 at probability 7/8 per test, and the run is green (S01 observed 6 such first-attempt failures at the baseline); (b) the "Restricted in Demo Mode" backup test runs in no job; (c) shard 4's quarter of the suite runs only against the two-replica stack, so a defect that appears with one backend in that quarter is not seen.
6. **Observed:** as above; the job comment `ci.yml:1451` says "Retries (2 in CI) absorb flakiness".
7. **Expected:** flaky tests fail the gate (Playwright `failOnFlakyTests: true` in CI, or a step that fails on a non-empty "flaky" count), every test runs in some job, and the cluster run is a fifth job.
8. **Impact:** test signal; the defects are in other findings.
9. **Root cause:** retries were added to absorb environment noise and absorb product races too.
10. **Recommended correction / 11. Suggested remediation diff (illustrative, not applied):**

```diff
--- a/e2e/playwright.config.ts
+++ b/e2e/playwright.config.ts
   retries: process.env.CI ? 2 : 0,
+  // A retry may rescue the run from the environment, never hide a product race.
+  failOnFlakyTests: !!process.env.CI,
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
       matrix:
-        shard: [1, 2, 3, 4]
-        include:
-          - shard: 4
-            cluster: 'true'
+        shard: [1, 2, 3, 4]
+        cluster: ['false']
+        include:
+          - shard: 4
+            cluster: 'true'
+            name-suffix: cluster
```

    (the second hunk needs the job name and the `--shard` arithmetic adjusted; maintainer decision whether the cluster job runs the whole suite or one shard). The DEMO test needs either a demo-mode job or deletion with its behaviour covered by a component test.
12. **Recommended regression test / 13. diff:** a guard asserting `failOnFlakyTests` is set when `CI` is, beside `ci-images.guard.spec.ts`.
14. **Verification method:** a deliberately flaky test (`expect(Math.random() > 0.5)`) must turn the job red.
15. **Residual risks:** turning flakes red will surface the six S01 observed; they then need root causes.

Causality: `PRE_EXISTING_UNREPORTED` (S01 handed DR-S01-5 and the shard note to S21).

### A26-S21-06 -- `push:client:test` passes with zero discovered tests, and REL-001's "every runner fails on zero" does not hold for `node --test`

1. **Severity:** LOW
2. **Confidence:** high (executed)
3. **Location:** `backend/package.json` `push:client:test` = `node --test scripts/unifiedpush-client/*.test.cjs` (run by `ci.yml:78`); `docs/release-integrity.md:19-22`, `:70-73`; `backend/src/common/jest-config.guard.spec.ts` (scans for the flag only).
4. **Violated invariant:** REL-001 / S21-I1.
5. **Reproduction (executed in the scratch worktree):** `npm run push:client:test` at the baseline: `tests 10, pass 10`, exit 0. Rename `core.test.cjs` to `core.spec.cjs`: `tests 0, pass 0`, **exit 0**. Separately, `node --test empty.test.cjs` on a file declaring no test exits 0; a missing explicit file exits 1. The four other `node --test` steps in CI name explicit files, so they fail on a missing file but pass on a file emptied of tests.
6. **Observed / 7. Expected:** a renamed or moved push-client test silently drops out of `backend-lint`; expected exit 1 with zero tests.
8. **Impact:** test signal for the push tooling under `backend/scripts/` (INV-PUSH tooling, not the server); narrow.
9. **Root cause:** Node's test runner treats an empty set as success, and the guard only looks for a flag.
10. **Recommended correction / 11. diff (illustrative, not applied):**

```diff
--- a/backend/package.json
+++ b/backend/package.json
-    "push:client:test": "node --test scripts/unifiedpush-client/*.test.cjs",
+    "push:client:test": "node --test scripts/unifiedpush-client/core.test.cjs",
```

    and, for the general rule, a case in `jest-config.guard.spec.ts` refusing a `node --test` command whose arguments contain a glob.
12. **Regression test / 13. diff:** the guard case above (`expect(script).not.toMatch(/node --test[^&|]*\*/)` over every `package.json` script and workflow `run:`).
14. **Verification:** rename the file again; the step must exit 1.
15. **Residual:** an explicit file emptied of tests still passes; Node has no "fail on zero" switch, so a count assertion (REL-002) is the only full answer.

Causality: `NEW_SINCE_UPSTREAM_AUDIT` (the push tooling postdates `d5cea9bf`). Also a documentation inconsistency (MON-L07 residual, section 11).

### A26-S21-07 -- Coverage excludes every DTO, and two cross-field or privacy constraints that live only there are held by no test

1. **Severity:** LOW (test coverage; the code is correct at the baseline)
2. **Confidence:** high (executed)
3. **Location:** `backend/package.json` `jest.collectCoverageFrom` `"!src/**/*.dto.ts"` (also `*.entity.ts`, `*.module.ts`); `backend/src/emergency-access/dto/upsert-settings.dto.ts:12-36` (`ReminderLtGrantConstraint`, the only place `reminderAfterDays < grantAfterDays` is enforced: the monitor, `emergency-access-monitor.service.ts:892`, only compares days since login with each threshold); `backend/src/backup/support-backup/dto/create-support-backup.dto.ts:36-56` (`IsNonIntegerMultiplierConstraint`: the de-identifying multiplier must not be an integer); 26 DTO files carry 46 `@Transform` decorators and five carry custom constraints, three of them with no spec of their own.
4. **Violated invariant:** S21-I5 (the coverage gate measures the code that carries behaviour) and S21-I4.
5. **Reproduction (executed in the scratch worktree):** (a) `ReminderLtGrantConstraint.validate` -> `return true`: `npx jest src/emergency-access` 4 suites, 128 tests, all pass. (b) `IsNonIntegerMultiplierConstraint.validate` without `!Number.isInteger(value)`: `npx jest src/backup/support-backup` 5 suites, 64 tests, all pass. No integration suite goes through HTTP (0 of 118 import `supertest`; `emergency-access-grant-cycles.integration.spec.ts:198` calls `upsertSettings` directly), and no E2E spec sets `reminderAfterDays`.
6. **Observed:** with (a), an owner can save "remind after 30 days, grant after 7": the monitor grants the emergency contact access on day 7 and the owner's warning never precedes it. With (b), a support backup can be made with multiplier 2, so every private amount is recoverable by halving.
7. **Expected:** each cross-field or privacy rule in a DTO is pinned by a `validate()`-level spec, and the coverage gate counts DTO files (their decorators execute at import, so including them costs nothing but exposes untested constraint and transform bodies).
8. **Impact:** security and privacy rules that one refactor can drop with every gate green; no present-day defect.
9. **Root cause:** DTOs were excluded as declarative files; some now hold logic.
10. **Recommended correction:** drop `!src/**/*.dto.ts` from `collectCoverageFrom` (check the thresholds still hold) and add the two specs.
11. **Suggested remediation diff (illustrative, not applied):**

```diff
--- a/backend/package.json
+++ b/backend/package.json
     "collectCoverageFrom": [
       "src/**/*.(t|j)s",
       "!src/main.ts",
       "!src/**/*.module.ts",
       "!src/**/*.entity.ts",
-      "!src/**/*.dto.ts",
       "!src/database/seed*.ts",
```

12. **Recommended regression test / 13. Suggested regression-test diff (illustrative, not applied):**

```ts
// backend/src/emergency-access/dto/upsert-settings.dto.spec.ts
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { UpsertSettingsDto } from "./upsert-settings.dto";

it("refuses a reminder that does not come before the grant", () => {
  const dto = plainToInstance(UpsertSettingsDto, { enabled: true, grantAfterDays: 7, reminderAfterDays: 7 });
  expect(validateSync(dto).map((e) => e.property)).toContain("reminderAfterDays");
});
```

    and the same shape for `CreateSupportBackupDto` with `multiplier: 2`.
14. **Verification:** re-apply both mutations; the new specs must fail.
15. **Residual:** excluding `*.entity.ts` was tested the same way and is held: the entity `numericTransformer` mutation `null -> 0` in `investment-transaction.entity.ts:22-26` is killed by `security-transfer.integration.spec.ts` ("is stored as unknown for ADD_SHARES"). The frontend exclusion of `src/proxy.ts` hides nothing measurable either: measured alone, its own tests cover it at 97.05 % statements, 95.16 % branches, 100 % functions.

Causality: `PRE_EXISTING_UNREPORTED`.

## 5. Prior-finding dispositions

| MON | Disposition | Evidence |
| --- | --- | --- |
| MON-M01 | STILL_OPEN -> A26-S21-03 (narrowed) | The upstream evidence paths changed: `helm/templates/statefulset-backend.yaml` is gone (Deployments now, `deployment-backend.yaml`); `scripts/check-docs-manifests.mjs` now holds documented paths and Helm defaults to the manifests (run: OK). What remains: the Compose deployments' mount ownership (executed probe), the README production section ("Build and start" over a file that only pulls `:latest`; no ownership step), and the README "Kubernetes" section, which does not mention the chart or its persistence values. |
| MON-M11 (Helm half) | FIXED_VERIFIED | Mechanism: opt-in claims `backend.persistence.backups` / `.attachments` (`helm/values.yaml:238-264`), mounted at `backupContainerDir` with `fsGroup: 100` (`deployment-backend.yaml:195-230`), `Recreate` strategy for a ReadWriteOnce claim (`:45-49`), chart refusal without a size or claim; default off with the reason documented (`values.yaml:215-237`, `helm/README.md:318-330`); the backend reports the unwritable default as unavailable (S06, `describeStore`). Tests: `ci.yml:483-496` renders the claim and asserts `Recreate`; rendered here with `backend.persistence.backups.enabled=true` (PVC, mount, `fsGroup` present). Residual: no install test (the CI comment `ci.yml:381-385` says a kind/k3d install "remains open"). |
| MON-M44 | FIXED_VERIFIED | No pass-with-no-tests flag in any layer (S02, re-checked); `jest-config.guard.spec.ts:599-631` fails on its return across manifests, configs, workflows, shell scripts and Dockerfiles; Jest exits 1 on zero (S02 executed). Residual outside the original finding: A26-S21-06 (`node --test`). REL-002 (suite inventory) still not enforced, as documented. |
| MON-M45 | STILL_OPEN (A26-S02-10, confirmed again) | `ci.yml:1101-1197` unchanged at the baseline: bump commit `[skip ci]`, `git pull --rebase`, push with `RELEASE_TOKEN`, `gh release create` without `--target`. The baseline SHA itself is such a commit: `72c59ec` "chore: bump version to 1.19.0 [skip ci]" by `github-actions[bot]`, parent `bfb57ca` (the dispatched, tested revision), diff limited to the four version manifests -- so no merge raced this release, but nothing verified that. The publish-before-gate half is the separate root A26-S21-02. |
| MON-M46 | STILL_OPEN -> A26-S21-04 (widened) | Section 6.2. |
| MON-L07 | STILL_OPEN (narrowed; section 11) | `docs/release-integrity.md` now records the git half honestly (sections 2 and 6). Still overstated: the Trivy "gate" (A26-S21-02), "Playwright fails by default" read as "every runner" (A26-S21-06), "the 35 suites" (118 at the baseline), the CI-ownership table listing `Lighthouse audit` as a `ci.yml` job, and section 5's "reported but not located" list (located). |

## 6. Mutation table

### 6.1 This session's mutations

| Invariant | Mutation (file:line, what) | Test that fails | Verdict |
| --- | --- | --- | --- |
| REL-001 | `backend/scripts/unifiedpush-client/core.test.cjs` renamed to `core.spec.cjs` | none: `push:client:test` `tests 0`, exit 0 (executed) | **undetected** (A26-S21-06) |
| REL-001 | `--passWithNoTests` added to `test:integration` | `jest-config.guard.spec.ts` (S02 M11, re-read) | covered |
| S21-I7 | `import "supertest";` (devDependency) in `backend/src/main.ts` | none: no lint rule, unit and integration do not load `main.ts` at production install, E2E uses the development image (traced, not executed) | **undetected** (A26-S21-01) |
| S21-I6 | `/data/backups` mounted root-owned for uid 1001 (the baseline Compose default) | none: E2E runs as root (probe executed) | **undetected** (A26-S21-03) |
| INV-RELEASE-001 | CVE gate moved before the push (the fix of A26-S21-02), and its reverse | none: no workflow self-test exists | **undetected** |
| S21-I3 | `report-currency.service.ts:113-118` return `null` instead of `amount` (the contract-correct behaviour) | `report-currency.service.spec.ts:213` "returns original amount when no rate is available" fails (`toBe(1000)`; reasoned from the assertion, not executed) | detected **by a known-wrong test** (it protects the defect) |
| S21-I5 | `emergency-access/dto/upsert-settings.dto.ts:16` `return true` | none: `src/emergency-access` 128/128 (executed) | **undetected** (A26-S21-07) |
| S21-I5 | `support-backup/dto/create-support-backup.dto.ts:42` drop `!Number.isInteger` | none: `src/backup/support-backup` 64/64 (executed) | **undetected** (A26-S21-07) |
| S21-I5 | `securities/entities/investment-transaction.entity.ts:24-25` `null -> 0` | `security-transfer.integration.spec.ts` (1 failed, 69 passed, executed) | covered |
| S21-I5 | `frontend/vitest.config.ts:23` exclusion removed, coverage of `src/proxy.ts` measured | n/a (measurement: 97.05 / 95.16 / 100 / 97.01) | no hidden gap |

### 6.2 Program-wide table (undetected rows of S01..S18, merged; S19 and S20 had no section 6 when merged)

Every row below is a missing-test finding with the mutation as its proof (plan section 7). Grouped by root cause (Rule 7). 59 rows; source: each session's section 6, merged from the reports as written and spot-checked against source for S04 MA, S16 r3, S12 M11 and S08 M5.

| Family (root cause) | Rows (session mutation-id: file:line) | Findings | First red test to write |
| --- | --- | --- | --- |
| F1 No two-connection test: a lock, CAS, predicate or lease removed and nothing fails (10) | S02 M3i `emergency-access-claim.controller.ts:224-225`; S03 r1 `token.service.ts:261`, r2 `:149`, r5 `emergency-access-claim.controller.ts:222/226`; S04 r6 `delegation.service.ts:969/1005`, r7 `transaction-transfer.service.ts:911-920`; S07 M1 `transaction-split.service.ts:1116`; S10 M7 `accounts.service.ts:1872`; S11 r7 lease overrun; S12 M10i `investment-transactions.service.ts:4477` | A26-S02-12, A26-S03-04, A26-S04-01/-02, A26-S07-09, A26-S10-03, A26-S11-01, A26-S12-01 | refresh-rotation race (INV-AUTH-001) |
| F2 SQL text asserted by a unit test only (5) | S08 M5 `job-claim.service.ts:146`, M6 `:144`, M7 `:281`; S09 M1 `mny-import-job.service.ts:159`, M4 `mny-staging.service.ts:174` | A26-S08-05 | real-database lease expiry (INV-CRON-001) |
| F3 Entity-built harness lacks schema keys, CHECKs, FK actions (3) | S05 M3 `schema.sql:2407` budget period key, M4 82 CHECKs; S16 r6 `idx_notifications_fingerprint` | A26-S05-01, A26-S16-09 (+ S13's `ON DELETE` note) | a parity guard, then the budget-period `ON CONFLICT` race |
| F4 Harness stubs the scheduled module; the real `post()` never runs (2) | S08 r7 `scheduled-transactions.service.ts:3739`, r8 manual pin | A26-S08-01, -03, -05 (+ S11 trade rows, S15 M3) | `post()` of a claimed loan occurrence |
| F5 RLS not exercised under the unprivileged role (3) | S04 MA `134_joint_native_read_rls.sql:47`, MD `scoped-db.ts:208`, r8 `schema.sql:4111-4118` | A26-S04-03, -04 | delegate cannot read a non-granted joint account |
| F6 Baseline defect asserted by a known-wrong test or unobserved by any fixture (13) | S03 r3; S09 M7, M8; S10 M5, M6, M8; S11 r9; S15 M8, M9; S16 r5, r7, r8; S17 P3 | A26-S03-01, A26-S09-03/-06, A26-S10-01/-02/-04, A26-S11-04, A26-S15-01/-04, A26-S16-01/-03/-07, A26-S17-01 | each finding's own regression test |
| F7 A boundary not pinned in either direction (3) | S11 r8 `parse-trade.ts:559-571`; S12 M13 `holdings.service.ts:585`; S15 M7 `price-installment.ts:769` | A26-S11-02, A26-S12-06, A26-S15-06 | the 0.01 debt and the 0.0001 snap, both sides |
| F8 Failure after commit or an external side effect untested (6) | S06 M2 `backup-restore.service.ts:430`, R4; S09 M2 `mny-import-job.service.ts:618`, M6; S11 r10; S17 P2 `ai-actions.service.ts:267-271` | A26-S06-03, A26-S09-01/-02, A26-S11-03, A26-S17-02 | a failpoint after `markDataCommitted` |
| F9 A filter or fallback with no negative case (6) | S02 M1 / S13 M4 `portfolio.service.ts:2147`; S06 M4 `restoreDeferredFkColumns`; S12 M12i `:2371`; S16 r3 `budget-spending.util.ts:132`; S17 M2 `mcp-http.controller.ts:319-322` | A26-S02-11, A26-S06-06, A26-S16-09, A26-S17-05 | a VOID row in budget actuals |
| F10 CI, static or doc gate gap (4) | S01 M1 (lint `--fix`), M3 (`with-context` import), M5 (cron doc vs handler); S05 M5 (contract without expand) | A26-S01-01, -02, A26-S05-02 | lint without `--fix` in CI |
| F11 Frontend cache freshness untested (4) | S18 r4 `categories.ts:69-78`, r5 `investments.ts:120-129` and 15 sites, r6 `investments.ts:1162`, r7 `useExchangeRates.ts:66-73` | A26-S18-01..-04 | a read in flight across a mutation |

Secondary rows (not counted above; see the session reports): 32 rows "covered" only by a unit test with a mocked boundary, SQL text or call order (largest: S08 M1-M3, S12 M10, S07 M2-M3, S05 M1); 6 probe rows where only a scratch spec saw the defect (S02 R1-R2, S12 R1-R2, S13 R1, S07 R1-R10); 3 rows where the killing test is itself known-wrong (S06 M1, S12 M11, S17 M4). Ledger discrepancies found by the merge: the ledger's S03 row reads ":222+226 drop both guards" where the report's table has ":222 keep the hash and :226 drop used_at IS NULL"; S02's integration row is "M3i" in the report; rows present in reports but absent from the ledger list: S01 M1, M3, M5; S02 M1; S06 M2, R4; S08 A26-S08-01/-03 rows; S09 M1, M4; S11 A26-S11-03; S12 M13, M11; S15 M8, M9; S17 P3; S18 A26-S18-03/-04 rows. S14 had none (15 executed, 15 killed; its lens ledger says 12, the extra 3 are integration re-runs).

## 7. Counterexamples and the interaction scenario

- **Zero tests (S21-I1):** a refactor renames the push client's test to the repository's `*.spec.*` convention; `backend-lint` stays green (executed, A26-S21-06).
- **One revision (INV-RELEASE-001):** dispatch at `X`, merge `Y` during `build-and-push`: the release is cancelled after `:latest` moved to `X+bump-stamp`; the next dispatch at `Y` re-publishes the same version string from different source (A26-S21-02 (b)+(c)).
- **Artifact fidelity (S21-I7):** a dependency moved from `dependencies` to `devDependencies` by a lockfile tidy: every gate green, production crashes at `require` (A26-S21-01).
- **Deployment default (S21-I6):** a fresh Compose install on Linux: backups unavailable from day one (A26-S21-03, executed).
- **Known-wrong test (S21-I3):** fixing the 1:1 fallback in `convertAmount` turns `report-currency.service.spec.ts:213` red, and a reviewer reading "a test broke" may revert the fix.

**Interaction scenario (two correct mechanisms combined):** the HA Compose stack (`docker-compose.ha.yml`) sets `BACKUP_SHARED_VOLUME: "true"`, so `checkClusterBoot` (INV-HA-001) lets both replicas boot -- correctly, since the volume is shared -- but the shared named volume is root-owned (A26-S21-03), and the only test of the multi-replica product, the E2E cluster shard, runs the development image as root (A26-S21-01), where the same volume is writable. Each mechanism is right; together they ship a cluster whose backups cannot run, with every gate green and the boot check passed.

## 8. Rejected hypotheses

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| `check-env-docs.mjs` misses env reads | ran it (OK, 81 vars); a wider scan for `getOrThrow`, other receivers, `env.X`, `env["X"]` found only ignored or non-env names (`US_EQUITY` is a GEM asset key) | no undocumented variable found | REJECTED |
| Integration runner passes on zero suites | Jest exits 1 (S02 executed); guard re-read | holds | REJECTED (MON-M44 fixed) |
| Vitest passes on zero tests | Vitest 5 default `passWithNoTests: false`; no override in `vitest.config.ts` | holds | REJECTED |
| Guards in `backend/src` silently skip in CI | 15 specs use `REPO_ROOT \|\| process.env.CI ? describe : describe.skip`; CI sets `CI=true` | they run in CI; they skip only outside a checkout without `CI` | REJECTED |
| Helm default disables a protection | default render: `readOnlyRootFilesystem`, `runAsNonRoot`, `seccompProfile: RuntimeDefault`, drop ALL, `podSecurityEnforce: restricted`; the chart refuses two replicas at `single`, a selector-less spread, a zero-disruption budget (CI-tested) | no protection disabled by default | REJECTED |
| `zizmor ... \|\| true` hides workflow findings | SARIF is uploaded to code scanning; not a gate by design | visibility choice, documented in the job | DESIGN_RISK (not listed) |
| Unconfirmed known-wrong tests 2-4 still present | override price: `PostTransactionDialog.test.tsx:1426`, `OverrideEditorDialog.test.tsx:698` assert the override is kept; logout: `AppHeader.test.tsx:204` "does not claim success when authApi.logout fails", `auth.controller.spec.ts:1099`; backup naming: no filename assertion found, the located backup known-wrong tests are the cross-owner sweep (A26-S06-01) | corrected or replaced | REJECTED (items 2, 3); item 4 superseded by A26-S06-01's tests; item 1 CONFIRMED (section 10) |
| `net-worth.service.spec.ts:1961` "returns amount unconverted when no rate exists" is known-wrong | the body asserts the gap (comment "NOT applied as 1:1 (audit P5-009)") | the title is stale, the assertion is right | REJECTED (doc nit, section 11) |
| Entity numeric transformers excluded from coverage hide a defect | 31 entity files define local transformers; mutation `investment-transaction.entity.ts:22-26` `null -> 0` run against 8 investment integration suites | killed: `security-transfer.integration.spec.ts` fails (`Received: 0`), 69 others pass | REJECTED (held at integration) |
| `frontend/src/proxy.ts` (CSP nonce, auth redirect, API proxy) excluded from coverage hides an untested file | coverage measured with the exclusion removed, its five test files only | 97.05 % statements, 95.16 % branches, 100 % functions | REJECTED (the exclusion is unexplained but hides nothing today) |

## 9. Design risks

- **DR-S21-1** The preview path pushes `:beta` on every merge with no CVE scan, signature or SBOM (`ci.yml:1300-1304`, deliberate). Combined with A26-S21-01, `:beta` is an unbooted, unscanned image; acceptable only while nobody is told to run it.
- **DR-S21-2** `fork-images.yml` publishes `:latest` on every push to a fork's `main` and branch images for `feat/**`, `fork/**`, with "NOT gated on the full test/security matrix" (its header). On this fork it is in active use (runs 521-525 on 2026-10-18 built and pushed branch images). Documented choice for forks; a fork that deploys `ghcr.io/<owner>/monize-*:latest` deploys untested images.
- **DR-S21-3** Liveness versus migration (from S05): the backend runs `db-init` and `db-migrate` before `listen`; the chart's liveness probe (`initialDelaySeconds: 10`, `periodSeconds: 60`, default `failureThreshold: 3`, no `startupProbe`, `values.yaml:282-288`) restarts a pod whose migrations run longer than about 190 s, and the restarted pod starts the same migration again. A `startupProbe` or a pre-upgrade Job is a chart decision.
- **DR-S21-4** Direct `[skip ci]` pushes by the maintainer: `3519269` "fix(deps): bump vite ... and hono" was committed two seconds before `bfb57ca` "docs(trail) ... [skip ci]" (author dates); if pushed together, no push-triggered gate ran on the dependency bump before the release dispatch tested `bfb57ca`. Not verifiable without the upstream run list (out of this session's repository scope).
- **DR-S21-5** Branch protection is not readable from the repository (REL-007); the workflow comments imply the only required check is "Verify PR checklist", which auto-passes on push events (`pr-checklist.yml:16-19`). Whether the CI jobs are required checks could not be verified (no admin API access).

## 10. Missing tests and known-wrong tests

### 10.1 Known-wrong test register (program-wide)

| Test (path:line) | Asserts | Protects defect | Owner finding | Found by |
| --- | --- | --- | --- | --- |
| `backend/src/built-in-reports/report-currency.service.spec.ts:213-218` "returns original amount when no rate is available" (and the inverse-zero case near `:247`) | 1000 JPY with no rate -> `toBe(1000)` in USD | the 1:1 fallback of `convertAmount` (`report-currency.service.ts:113-118`), used by seven built-in report services | A26-S02-02 / A26-S13-01 (MON-H12, MON-M39) | S02, S13; re-located here: **this is `docs/verification-contract.md` section 5's unconfirmed item 1** |
| `backend/src/backup/auto-backup.service.spec.ts:3870/3871`, `:3907` "counts files left flat in the base folder by an older version" | the cross-owner legacy sweep | A26-S06-01 | A26-S06-01, MON-M43 | S02, S06 |
| `backend/src/auth/token.service.spec.ts:323` (replay detection), `:387` (user not found), `:408` (user inactive) | that `manager.update` was called, true while the revocation is rolled back | A26-S03-01 | A26-S03-01 | S03 |
| `backend/src/securities/investment-transactions.service.spec.ts:5120` "converts cash amount using the latest market rate when currencies differ", and five sibling cases S12 M11 names but does not list | stub `getRateForDate` to null and `getLatestRate` to the answer | the `getLatestRate` fallback, `investment-transactions.service.ts:789-792` | A26-S12-02 | S12 |
| `backend/src/delegation/rls-context-smoke.spec.ts` (S04 D-S04-05) | "authorization under the caller, then bypass" order | A26-S04-01 | A26-S04-01 | S04 |
| `backend/test/integration/backup-store-s3.integration.spec.ts:160-185` | unpadded day names, its own pruning wrong; never runs in CI | test defect | A26-S06-02 | S06 |
| `backend/src/users/users.service.spec.ts:148` | mocks `ensureSystemCurrency`, so write-before-ensure passes | A26-S13-05 | A26-S13-05 | S13 |
| `backend/src/transactions/transaction-bulk-update.service.spec.ts:2592-2643` | only that `updateBalance` was called | A26-S13-03 | A26-S13-03 | S13 |
| `frontend/src/lib/loan-history.test.ts:2058` | the overpayment-takes-the-interest variant of a same-day pair | order dependence (D9) | -- | S15 |
| `backend/src/ai/query/tool-executor.service.spec.ts:1345-1351`, `backend/src/mcp/tools/reports.tool.spec.ts:220-246` | `getSpendingAnomalies(userId, months)` | months passed as the z-score threshold | A26-S17-03 | S17 |

The four "reported but not located" items of `docs/verification-contract.md` section 5: item 1 located (row 1); items 2 and 3 corrected (section 8); item 4 superseded by the A26-S06-01 tests.

### 10.2 Missing tests of this slice

- A production-image boot in a gate (A26-S21-01); a release-workflow self-test (INV-RELEASE-001 "Required tests"; A26-S21-02); a bind-mount / named-volume writability check for the production image (A26-S21-03); a suite inventory (REL-002); a `failOnFlakyTests` guard (A26-S21-05); a `node --test` glob guard (A26-S21-06); MinIO and `BACKUP_STORE_S3_TEST_ENDPOINT` in `backend-integration-tests` so `backup-store-s3.integration.spec.ts` runs (A26-S06-02's CI half: today its `describe` is skipped in CI and counts as green); a kind/k3d chart install with persistence (`ci.yml:381-385`); the INV-HA-001 flip (a replica losing its channel goes 503), recorded as owed by the invariant itself; `e2e/` lint and type-check (no `tsconfig.json`, no ESLint config); the backend `test/*.e2e-spec.ts` suites run in no job (`backend/CLAUDE.md`: "three of five suites are broken").
- **Unstable test observed (midnight crossing):** `backend/test/integration/bank-sync.integration.spec.ts:74` fixes `today` once for the suite (`daysAgo = (days) => addDaysYMD(today, -days)`), while the service computes its own date at call time. The full integration run started at 23:59:24 UTC; the suite (126.5 s) failed at `:2777` with `defaultSyncFromDate` expected `2026-07-24`, received `2026-07-25`, and in further cases of the same describe blocks. Any CI run that crosses UTC midnight fails it; the remedy is an injected clock in the service, or reading `today` per test.
- **No integration suite goes through HTTP:** 0 of 118 import `supertest`, so `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`), guards and DTO constraints run only in unit DTO specs and the E2E suite (A26-S21-07 is one consequence).

## 11. Documentation inconsistencies

| Document | Claim | Reality |
| --- | --- | --- |
| `docs/release-integrity.md:207` | "CVE gate fails the build ... The scan is a gate, not a report" | the gate runs after `:latest` and `:X.Y.Z` are pushed (A26-S21-02) |
| `docs/release-integrity.md:205` | the SHA binding is "the pattern to copy" | true for the revision; the artifact built is a different target from the one the gates ran (A26-S21-01) |
| `docs/release-integrity.md:72-73` | "No runner carries such a flag today either ... Playwright fails by default when it discovers no spec files" | `node --test` passes on zero (A26-S21-06) |
| `docs/release-integrity.md:75-76` | "the 35 suites tracked under `backend/test/integration/`" | 118 spec files at the baseline; the guard asserts `> 30` |
| `docs/system-invariants.md` INV-RELEASE-001 "Retry semantics" | "may bump the version twice" | a re-dispatch after an image-stage failure reuses the version for a different digest (A26-S21-02 (c)); both outcomes are possible |
| `docs/verification-contract.md:345-354` | the jobs "that exist in `.github/workflows/ci.yml`" include `Lighthouse audit` | Lighthouse is `lighthouse.yml`, pull-request only, in no `needs:` |
| `docs/verification-contract.md` section 5 | four items "reported but not located" | item 1 located; ten audit-located known-wrong tests absent from the register (section 10.1) |
| `frontend/CLAUDE.md` Commands | `test:cov` "85% branches" | `vitest.config.ts` branches 84 (S01 D16, still open) |
| `ci.yml:1451` | "Gates releases: build-and-push lists this job in its needs" | `prepare-release` / `prepare-preview` list it; `build-and-push` needs only `prepare-release` (transitively equivalent; wording only) |
| `README.md:651-656` | "Build and start" `docker-compose.prod.yml` | the file pulls `:latest`, builds nothing; no ownership step for the bind mounts (A26-S21-03) |
| `backend/src/net-worth/net-worth.service.spec.ts:1961` | title "returns amount unconverted when no rate exists" | the body asserts the gap; title stale |

## 12. Review ledger

- **Directories inspected:** `.github/workflows/`, `scripts/`, `helm/`, `e2e/` (configs, skip sites), `backend/test/` (configs, helpers), compose files, Dockerfiles.
- **Files in full:** `.github/workflows/ci.yml`; `docs/release-integrity.md`; `backend/Dockerfile`; `frontend/Dockerfile`; `backend/docker-entrypoint.sh`; `backend/scripts/test-chain.mjs`; `backend/scripts/test-changed.mjs`; `frontend/scripts/test-changed.mjs`; `frontend/vitest.config.ts`; `backend/test/jest-integration.json`; `backend/test/jest-e2e.json`; the `jest` block of `backend/package.json`; `e2e/playwright.config.ts`; `e2e/playwright.push.config.ts`.
- **Files sampled (ranges):** `fork-images.yml` 1-56, 84-196; `lighthouse.yml` 25-67; `zap.yml` 20-63; `pr-checklist.yml` 1-40; `helm/values.yaml` 215-300 plus a structural grep of the whole file; `helm/templates/deployment-backend.yaml` (mounts, strategy, probes by grep); `helm/README.md` 318-335; `docker-compose.prod.yml` 96-112; `docker-compose.ha.yml` 155-165, 229-237; `docker-compose.e2e.yml` (targets, `DEMO_MODE`); `README.md` 486-527, 645-680; `docs/verification-contract.md` sections 4-5; `docs/system-invariants.md` INV-RELEASE-001, INV-HA-001; `scripts/check-env-docs.mjs` 1-80; `backend/test/helpers/integration-setup.ts` 75-105, 160-215, 251-273; `backend/src/common/jest-config.guard.spec.ts` (structure by grep); `backend/src/built-in-reports/report-currency.service.ts` 81-120 and its spec 195-240.
- **Searches:** skip/todo patterns across all suites; zero-discovery behaviour per runner; `target:` in every compose file and workflow; env-read patterns versus `.env.example`; DTO `@Transform` / validator constraints (46 decorators in 26 DTO files; 5 DTOs with custom constraints have no spec of their own) and entity transformers (31 files); known-wrong candidates by test title (1:1, override, logout).
- **Suites and probes run:** `node scripts/check-env-docs.mjs` (OK, 81 vars); `node scripts/check-docs-manifests.mjs` (OK, 119 Helm values, 33 documents); `helm lint` and `helm template` default and `backend.persistence.backups.enabled=true` (Helm v3.16.4); `push:client:test` baseline and renamed (10 then 0 tests, both exit 0); `node --test` on a missing file (exit 1) and an empty file (exit 0); two `docker run -u 1001` writability probes (bind mount, named volume: both denied). `TZ=UTC npm run test:unit -- --coverage` (backend) and `npm run test:cov` (frontend): running at this commit.
- **Hand-offs disposed:** S01 (deadlock: pending; E2E retries, `e2e/` unlinted, shard 4: A26-S21-05; concurrency group: A26-S21-02; branch threshold: section 11); S02 (A26-S02-10: section 5 MON-M45; A26-S02-12: F1); S03, S04, S07, S08, S10, S11, S15, S17 (MON-M46: A26-S21-04, rows in 6.2); S05 (A26-S05-01: F3; liveness: DR-S21-3; two-process `runMigrations()` race: 10.2 via S05); S06 (A26-S06-02 CI half: 10.2; MON-M11 Helm half: section 5); S09, S12, S13, S14, S16, S18 (rows in 6.2; known-wrong in 10.1).
- **Open hypotheses handed on:** to S23: merge A26-S21-04 with the session test-coverage findings it lists (Rule 7); A26-S21-01 and -03 share the "production image never exercised" root for the remediation plan. To S22: re-check `ci.yml` and the Dockerfiles on `main`.
- **Not reviewed:** `restore-peak-rss.yml`, `ghcr-cleanup.yml`, `bearer-exceptions-review.yml` beyond their triggers; `scripts/verify-schema.sh` (S05 ran it twice); the 40 E2E specs beyond their skip sites.

## 13. Adversarial approval challenge

Assumption: "the pipeline gates what it publishes" is wrong; find the path. Started from the slice's own abstractions (the `needs:` graph, job `if:` conditions, soft-failure constructs, runner discovery, build targets, tags), not from the findings.

- **`needs:` graph.** `prepare-release` and `prepare-preview` list the same 14 jobs (`ci.yml:856-872`, `:1246-1262`); `e2e-browsers` is reached transitively; `frontend-bundle-size` is pull-request only and reports, never gates. A skipped needed job skips its dependants (no `if: always()` on the publish jobs). No gap beyond A26-S21-01 (what the gates build) and A26-S21-02 (when the publish happens).
- **Soft failures.** `continue-on-error: true` only on the informational dev-dependency audit (`:235`); `|| true` only on zizmor's SARIF producer (`:615`) and diagnostics. Trivy's first step is `exit-code: '0'` by design, its second is the gate (A26-S21-02 is about its position, not its exit code).
- **Discovery.** Every runner checked for zero, all-skipped, missing-file and empty-file (section 12): one gap, A26-S21-06. Skips: 15 guard specs skip outside a checkout but run in CI; `backup-store-s3.integration.spec.ts` skips in CI (A26-S06-02); four E2E skip sites, one of them never runnable in CI (A26-S21-05).
- **Clock.** The integration job sets no `TZ` (runners are UTC) and captures "today" once per suite: the full run started at 23:59:24 UTC in this session and `bank-sync.integration.spec.ts` failed on the date that turned during it (`defaultSyncFromDate` expected `2026-07-24`, received `2026-07-25`, `:2777`). A CI run crossing UTC midnight fails the same way (section 10.2).
- **Tags and identity.** The version string is derived, not looked up; nothing refuses an existing version (A26-S21-02 (c)).
- **Deployment.** The Helm defaults hold every protection checked (section 8); the Compose defaults do not provide a writable mount (A26-S21-03), and the only multi-replica test cannot see it (section 7).
- **Found:** nothing beyond the seven findings; one new observation (the midnight flake) added to section 10.2.

## 14. Verdict

`APPROVE` for the slice under plan section 3 (no BLOCKER or HIGH survived the challenge): the release-integrity gaps are MEDIUM because the image half is digest-bound and every failure mode found is visible to an operator, not silent corruption. New in S21: 0 BLOCKER, 0 HIGH, 4 MEDIUM (A26-S21-01, -02, -03, -04), 3 LOW (A26-S21-05, -06, -07). MON-M45 stays open as S02's A26-S02-10 (MEDIUM), confirmed again. The APPROVE is for the slice's severity gate only; A26-S21-04 means the program's HIGH fixes have no regression harness yet, which the remediation plan should schedule first.
