# S03 Security: auth, OAuth, users, admin, emergency access, delegation

## 1. Metadata

| Field | Value |
| --- | --- |
| Session | S03 (parallel wave, run by orchestrator session `session_018Nx7aian3f7dpRX5msjFBg`) |
| `AUDIT_BASELINE_SHA` / `PR_REVIEW_SHA` | `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86` |
| Audit branch head at start | `becd00facf022d3e52e3d6efa8019a486c68b1de` (pin check of plan step 2: empty diff outside `docs/audits/`) |
| Date | 2026-10-21 |
| Primary path | `backend/src/auth/` |
| Secondary paths | `backend/src/oauth/`, `users/`, `admin/`, `emergency-access/`, `delegation/`, `push/` (device auth), `common/interceptors/request-context.interceptor.ts`, `main.ts`, `frontend/src/store/authStore.ts`, `frontend/src/lib/api*.ts` |
| Hint line | `prioritize purpose binding and single use of step-up and emergency claims (conditional UPDATE, not read-then-write), refresh-token family rotation and logout under concurrency, lockout counters under parallel failures, delegated DTO allowlists, actor versus effective-owner attribution, ParseUUIDPipe and whitelist on every controller, userId never from the request, secrets never returned` |
| Toolchain | Node 24.22.1 (`nvm use 24`); `backend/` `npm ci` OK; PostgreSQL 16 (`mirror.gcr.io/library/postgres:16-alpine`) in Docker after starting `dockerd` by hand (the daemon was not running in the container) |
| Status | done |
| Findings (B/H/M/L) | 0 / 1 / 3 / 3 |

Runtime executed (results quoted, not asserted; full list in section 12):

- Integration, existing suites, one worker: `npm run test:integration -- 'auth-attempt-counter|auth-state-tables|emergency-access-grant-cycles|login-lockout|single-use-token|logout-revoke-failpoint|security-cross-user-isolation|oauth-signing-keys|push-chart-token'` -> `Test Suites: 9 passed, 9 total; Tests: 87 passed, 87 total`. There is no integration suite named `step-up` or `delegation`; the nearest are listed in section 12.
- Unit, slice: `TZ=UTC npx jest src/auth src/oauth src/users src/admin src/emergency-access src/delegation src/push src/common/interceptors` -> `Tests: 1951 passed, 1951 total`.
- Probe (scratch worktree `<scratchpad>/mut` at `AUDIT_BASELINE_SHA`, file `backend/test/integration/zz-audit-s03-probe.integration.spec.ts`, never on the audit branch): see A26-S03-01 and A26-S03-02 for the quoted output.

## 2. Invariant map

| ID | Statement | Mechanism named in code | Path |
| --- | --- | --- | --- |
| INV-CLAIM-001 | An emergency claim token is consumed exactly once | Conditional `UPDATE emergency_access_contacts ... WHERE claim_token_hash = $1 AND claim_token_used_at IS NULL AND claim_token_expires_at >= CURRENT_TIMESTAMP RETURNING` as the first statement of the credential transaction (`emergency-access-claim.controller.ts:219-242`) | magic link -> `POST /emergency-access/claim/complete` (unauthenticated, `withSystemContext`) -> cheap pre-check (no write) -> breach check + bcrypt -> conditional consume -> owner password, 2FA, PATs, trusted devices, sibling tokens, settings -> commit -> refresh-family revoke (post-commit, up to 10 passes) -> OAuth grant revoke -> new token pair + cookies |
| INV-AUTH-001 | A refresh token rotates once; a second presentation revokes the family | `lockTokenFamily` advisory lock, then `pessimistic_write` row lock, then `isRevoked` branch (`token.service.ts:117-249`) | refresh cookie -> `POST /auth/refresh` -> `withSystemContext` -> one `withScopedDb` transaction -> family lock -> row lock -> rotate or reuse branch -> cookies. **The reuse branch's family revocation is rolled back by its own throw: A26-S03-01.** |
| INV-AUTH-004 | A logout reports only what it achieved | `revokeRefreshToken` -> `revokeTokenFamily` under `lockTokenFamily` in the same transaction as the lookup; controller awaits it with no catch | logout -> revoke -> clear cookies -> body |
| INV-AUTH-002 | Every failed login is counted | One CTE `UPDATE users SET failed_login_attempts = failed_login_attempts + 1 ... FOR UPDATE ... RETURNING` (`login-lockout.ts`) | login -> user read -> lock check on the snapshot -> bcrypt -> `recordFailedLogin` in its own transaction. **The success path resets the counter in SQL and then writes the pre-bcrypt snapshot back with `repo.save(user)`: A26-S03-02.** |
| INV-AUTH-005 | A replaced password ends every credential issued on the old one | `revokeStandingCredentials` inside the password write's transaction; refresh and OAuth after commit | reset/change/admin/delegate/claim -> PATs + trusted devices (in tx) -> refresh families + OAuth grants (post-commit, error logged and rethrown) |
| INV-AUTH-003 | A destructive OIDC action needs a real IdP round trip | `OidcReauthService.issue/consume`: HS256 JWT bound to `sub` + purpose + `jti`, 5 min, `claimJti` `INSERT ... ON CONFLICT (jti) DO NOTHING RETURNING`, `auth_time` freshness | destructive UI -> OIDC redirect with pending marker cookie (bound to `state`) -> callback -> artifact in URL fragment -> step-up / delete / restore consume |
| (unnamed) step-up | A step-up token unlocks exactly its purpose for exactly its subject for 5 minutes | `StepUpGuard`: signature, `type === "step_up"`, `purpose`, `sub === req.user.id`. Not single-use: no `jti` check, deliberate per the guard (no document claims single use) | `POST /auth/step-up` -> token in body -> `X-Step-Up-Token` header on `POST /auth/tokens` and the emergency-access settings writes |
| INV-ACTIVITY-001 | Activity is attributed to whoever acted | `request-context.interceptor.ts:120-123` stamps `realUserId` | every authenticated request -> throttled per-process write of `users.last_activity_at` for the real user -> emergency-access inactivity monitor reads it |
| INV-PROFILE-001 | A profile response is an allowlist | `PROFILE_FIELDS` + `toDelegatedUserProfile` dropping `SELF_ONLY_PROFILE_FIELDS` | `/users/me`, `/auth/profile`, login body, admin list/create/update -> `toUserProfile` |
| INV-PUSH-001 (auth half) | A push subscription belongs to its caller | DTO without `userId`, `forbidNonWhitelisted`, `user_id` in every `WHERE`, unique `endpoint_hash` with conditional `ON CONFLICT ... WHERE user_id = EXCLUDED.user_id` | not yet traced in this session (see section 3) |
| (unnamed) token type | Each JWT signed with `JWT_SECRET` is accepted only by the verifier it was minted for | None: verifiers deny-list `type === "2fa_pending"` only. **A26-S03-03.** | step-up token, OIDC re-auth artifact and pending marker all verify as access tokens in `JwtStrategy.validate` |

## 3. Lens ledger

| Lens | Status |
| --- | --- |
| Pin the revision | ran: `PR_REVIEW_SHA` = `AUDIT_BASELINE_SHA`; plan step 2 diff empty |
| Instructions before implementation | ran: `AGENTS.md`, root and `backend/CLAUDE.md`, `.claude/commands/audit.md` in full, INV-CLAIM-001, INV-AUTH-001..005, INV-ACTIVITY-001, INV-PROFILE-001, INV-PUSH-001 entries of `docs/system-invariants.md`; the eight upstream sections of `08-final-report.md` |
| Summaries as hypotheses | ran: every code comment claiming a fix (claim consume, family lock, lockout CTE, allowlist) re-derived from code and, for the concurrency ones, executed |
| Invariant model | ran (section 2) |
| Change surface (producers/consumers) | ran for refresh tokens (every revoke call site: logout, reuse, change-password, admin, delegate, email reset, 2FA reset, OIDC link, claim), JWT mint and verify sites (all six), profile serializers (all `toUserProfile` callers), context call sites (20 files) |
| Rule 4 read-model migration / Rule 5 dependency matrix | not applicable because the slice holds no cached derived financial value; the cached identity value (`lastActivityWrite` per-process throttle map in the interceptor) was checked: it only delays a write, never redirects it |
| Cross-layer verification | ran: controller -> DTO -> guard -> service -> transaction -> SQL for claim, refresh, logout, login, step-up, OIDC re-auth, delegate reset, admin reset; frontend only for credential persistence (`authStore.ts`) |
| Representation boundaries | ran: token `type` absent vs present (A26-S03-03); `claim_token_*` NULL states; `lockedUntil` past vs NULL (A26-S03-02) |
| Browser/UI round trip | ran (narrow): step-up and re-auth tokens are not persisted by the client; the re-auth artifact travels in a URL fragment. The rest belongs to S18/S19 |
| Server-authoritative metadata | ran: no slice DTO accepts `userId` (`create-push-subscription.dto.ts` deliberately has none; `reset-2fa.dto` rejects one); `users.controller.ts` uses `realUserId` for the caller's own password; `JwtStrategy` takes `sub` and re-validates the acting context per request |
| Identity versus value | ran: refresh family id vs token hash; claim token hash vs contact id; push endpoint hash vs owner |
| State machine | ran for the claim token (issued -> delivered -> consumed / voided / expired) and the refresh token (live -> rotated -> revoked, family revoked); the grant cycle (`grant_generation`) sampled |
| Concurrency and idempotency | ran with execution: claim race, rotate-vs-logout, rotate-vs-per-user-revoke, reuse; lockout increment via existing two-pool suite |
| Partial failure and compensation | ran: claim (password committed, refresh revoke after), admin/delegate reset (A26-S03-05), OAuth grant revocation after commit (logged and rethrown on every path read) |
| External/provider lookup | ran (narrow): `PasswordBreachService` is called before bcrypt on the claim and change-password paths and only after the cheap token pre-check; no amplification found. SMTP in the emergency monitor covered by MON-M26 |
| Database and migration | not applicable because the slice changes no schema at the baseline; `single_use_tokens`, `oidc_step_up_claims`, `auth_attempt_counters` unique keys were read in their entities only (S05 owns parity) |
| Backup/restore | not applicable except the OIDC re-auth consume on restore (`backup-restore.service.ts:581-596`), covered under MON-M05; S06 owns the rest |
| Financial / loan | not applicable because no money is computed in the slice |
| Authorization, authentication, RLS | ran: all lenses in the hint line; `withSystemContext` call sites on the public routes (claim, refresh, logout, login, 2FA, OIDC) each justified by a pre-identity comment; all 20 context-using files are in `WITH_CONTEXT_ALLOWLIST` |
| Tests are evidence | ran: `token.service.spec.ts` replay case and the claim SQL-text test are tests of calls, not properties (A26-S03-04) |
| Mutation | ran (section 6), 16 rows, 4 undetected |
| Counterexamples | ran (section 7) |
| Interaction | ran (section 7) |
| Rules 1, 2, 3, 7, 8 | ran (each finding; section 8) |
| Suggested diff + Rule 10 | ran; Rule 10 checks: A26-S03-01 keeps the unknown-token branch throwing inside the transaction (no write to preserve); A26-S03-07 keeps the in-transaction blanket revoke so the INV-AUTH-005 unit tests that assert it stay meaningful; A26-S03-03 keeps a grace for type-less access tokens so a rolling deploy does not log everyone out |
| Adversarial approval challenge | ran (section 13) |
| Final merge gate | not applicable as a PR gate (no PR); hosted CI not consulted; local suites quoted in section 12 |

## 4. Confirmed findings

### A26-S03-01 -- Refresh-token reuse detection does not revoke the family: the revocation is rolled back by the exception that reports it

1. **Severity:** HIGH
2. **Confidence:** high (executed against PostgreSQL 16)
3. **Location:** `backend/src/auth/token.service.ts:164-177` (reuse branch), same pattern at `:179-185` (expired) and `:191-203` (inactive user); transaction boundary `backend/src/common/db/scoped-db.ts:230-231` (`dataSource.transaction`, rolls back on throw); caller `backend/src/auth/auth.service.ts:945-950`, `backend/src/auth/auth.controller.ts:1265-1287`.
4. **Violated invariant:** INV-AUTH-001, "a second presentation revokes the family" (`docs/system-invariants.md`, status `enforced`). Rotation-with-reuse-detection exists so that, when a refresh token is stolen and both parties present it, the family dies and the thief's successor stops working.
5. **Reproduction:** user signs in (token `t0`, family F). An attacker who copied `t0` presents it first: rotation revokes `t0` and inserts `t1` (live, family F). The victim's browser then presents `t0`. `refreshTokens` takes the family lock, reads `t0` with `isRevoked = true`, runs `UPDATE refresh_tokens SET is_revoked = true WHERE family_id = F`, and throws `UnauthorizedException("Refresh token reuse detected")` inside the same `withScopedDb` callback. `dataSource.transaction` rolls the UPDATE back. `t1` stays live; the attacker keeps rotating it indefinitely (each rotation resets the expiry).
6. **Observed:** probe `AUDIT S03 probe: refresh reuse` (scratch worktree, real `TokenService`, real PostgreSQL):
   ```text
   AUDIT-PROBE rows after reuse [{"is_revoked":true,"replaced_by_hash":"05a7e8ca..."},{"is_revoked":false,"replaced_by_hash":null}]
   AUDIT-PROBE successorStillRotates true
   Expected: false / Received: true
   ```
   The reuse is reported (401 to the victim, cookies cleared) while the attacker's successor rotates successfully afterwards.
7. **Expected:** after a reuse is detected every member of family F is `is_revoked = true` and committed, and presenting `t1` yields 401.
8. **Impact:** security. The one control that turns refresh-token theft into a detected, self-healing event is inert: the thief retains a session for as long as they keep rotating; the legitimate user is logged out (their `t0` is dead) and signing in again creates a new family without touching F. Only a password change, an admin action or an emergency claim (`revokeAllUserRefreshTokens`) ends F. The same rollback makes the expired-token mark (`:179-185`) and the inactive-user family revoke (`:191-203`) no-ops; those two are harmless today because the conditions are re-checked on every presentation.
9. **Root cause:** a refusal that must leave a durable side effect is raised inside the transaction that holds the side effect. The repository rule "a rejected command must not already have written" was applied in the wrong direction here: this refusal is *required* to write.
10. **Recommended correction:** decide inside the transaction, commit the revocation, then raise outside it. Return a discriminated result from the `withScopedDb` callback and throw after it resolves.
11. **Suggested remediation diff (illustrative, not applied):**
    ```diff
    --- a/backend/src/auth/token.service.ts
    +++ b/backend/src/auth/token.service.ts
    @@ async refreshTokens(
    -    return withScopedDb(this.dataSource, async (manager) => {
    +    type Outcome =
    +      | { kind: "ok"; accessToken: string; refreshToken: string; userId: string }
    +      | { kind: "refused"; key: string; fallback: string };
    +    const outcome = await withScopedDb<Outcome>(this.dataSource, async (manager) => {
    @@
           if (existingToken.isRevoked) {
             await manager.update(
               RefreshToken,
               { familyId: existingToken.familyId },
               { isRevoked: true },
             );
    -        throw new UnauthorizedException(
    -          tr("errors.auth.refreshTokenReuseDetected", "Refresh token reuse detected"),
    -        );
    +        // Committed, then refused: the revocation IS the point of this branch.
    +        return {
    +          kind: "refused",
    +          key: "errors.auth.refreshTokenReuseDetected",
    +          fallback: "Refresh token reuse detected",
    +        };
           }
           if (existingToken.expiresAt < new Date()) {
             existingToken.isRevoked = true;
             await manager.save(existingToken);
    -        throw new UnauthorizedException(tr("errors.auth.refreshTokenExpired", "Refresh token expired"));
    +        return { kind: "refused", key: "errors.auth.refreshTokenExpired", fallback: "Refresh token expired" };
           }
    @@ (inactive user branch: same shape)
    -      return { accessToken, refreshToken: newRawRefreshToken, userId: user.id };
    +      return { kind: "ok", accessToken, refreshToken: newRawRefreshToken, userId: user.id };
         });
    +    if (outcome.kind === "refused") {
    +      throw new UnauthorizedException(tr(outcome.key, outcome.fallback));
    +    }
    +    return { accessToken: outcome.accessToken, refreshToken: outcome.refreshToken, userId: outcome.userId };
       }
    ```
    The unknown-token branch (no row) writes nothing and may keep throwing inside the callback. Still to verify: type-check, `token.service.spec.ts` (its replay case asserts `manager.update` was *called*, which is why it is green today), the new integration test below, and that `auth.controller.ts` refresh still clears cookies on the 401.
12. **Recommended regression test:** a real-database test that rotates `t0`, presents `t0` again, and asserts the successor is revoked and refused. The unit test cannot catch this class: it mocks `withScopedDb`'s transaction, so a call to `update` is indistinguishable from a committed update.
13. **Suggested regression-test diff (illustrative, not applied):**
    ```diff
    --- /dev/null
    +++ b/backend/test/integration/refresh-reuse-revokes-family.integration.spec.ts
    @@
    +it("a reused token revokes the successor durably (INV-AUTH-001)", async () => {
    +  const user = await createTestUserDirect(dataSource);
    +  const { refreshToken: t0 } = await withSystemContext(() => tokens.generateTokenPair(user, false));
    +  const { refreshToken: t1 } = await withSystemContext(() => tokens.refreshTokens(t0));
    +  await expect(withSystemContext(() => tokens.refreshTokens(t0))).rejects.toThrow("reuse");
    +  const live = await dataSource.query(
    +    `SELECT count(*)::int AS n FROM refresh_tokens WHERE user_id = $1 AND is_revoked = false`, [user.id]);
    +  expect(live[0].n).toBe(0);
    +  await expect(withSystemContext(() => tokens.refreshTokens(t1))).rejects.toThrow();
    +});
    ```
    It fails on the baseline (probe output above) and passes with the diff.
14. **Verification method:** the integration test above; the existing two-connection rotation test that INV-AUTH-001 lists as required is also missing (section 10) and belongs beside it; `token.service.spec.ts` updated to assert the throw happens after the transaction resolves.
15. **Residual risks:** the diff does not bound how long a thief who is never raced by the victim keeps a family (absolute family lifetime is a separate design choice); the nightly purge (`token.service.ts:363-389`) deletes revoked rows, after which a reused `t0` is "Invalid refresh token" and revokes nothing -- the detection window is therefore at most one day for non-remember-me sessions.

- **Causality class:** `PRE_EXISTING_UNREPORTED` (the reuse branch predates the upstream audit; MON-M23 looked at logout, not at the reuse branch's commit).
- **Rule 7 surfaces:** the three refusal branches of `refreshTokens`.

### A26-S03-02 -- A successful password login writes the pre-bcrypt snapshot back and restores the failed-login counter it just reset

1. **Severity:** MEDIUM
2. **Confidence:** high (executed against PostgreSQL 16)
3. **Location:** `backend/src/auth/auth.service.ts:387-391` (snapshot read), `:470-478` (SQL reset), `:537-538` (`user.lastLogin = new Date(); repo.save(user)`), same at `:509-511` (trusted-device 2FA path); `backend/src/auth/login-lockout.ts` (escalation reads the restored counter).
4. **Violated invariant:** the success-path reset described in INV-AUTH-002 ("The success-path reset writes a fixed absolute value and was always safe") and the code comment at `auth.service.ts:463-469` ("A correct password is authoritative about the attempts before it").
5. **Reproduction:** an account has `failed_login_attempts = 4` (four typos, below the threshold of 5). The owner then signs in with the correct password. `loginWithinContext` read the `User` entity before bcrypt (`failedLoginAttempts = 4`), resets the row to 0 in SQL, then `repo.save(user)` lets TypeORM diff the snapshot against the database (`4` vs `0`) and writes `failed_login_attempts = 4` back. The next single wrong password -- by the owner or by anyone who knows the address -- reaches 5 and locks the account for 30 minutes and sends the lockout email. After a past lockout the snapshot also restores the expired `locked_until`, so the escalation logic treats the next failure as a repeat offence.
6. **Observed:** probe `AUDIT S03 probe: login counter reset survives the snapshot save` drives the real `AuthService.login` (local account, no 2FA, verified email) against real PostgreSQL: `AUDIT-PROBE after successful login {"failed_login_attempts":4,"locked_until":null}`, `Expected: 0 / Received: 4`.
7. **Expected:** `failed_login_attempts = 0`, `locked_until = NULL` after a successful password check.
8. **Impact:** availability and security operations: a user who recovered from typos is one typo (or one hostile attempt) away from a 30-minute lockout and an alarming email; lockout notifications overcount. No credential is exposed.
9. **Root cause:** a whole-entity `save` of a snapshot taken before a SQL write to the same row. The reset was moved into SQL (audit P4-012) but the later `save` of the stale entity was left in place, so the two writes disagree and the later one wins.
10. **Recommended correction:** update only the column the success path owns (`last_login`) and fold the counter reset into the same statement.
11. **Suggested remediation diff (illustrative, not applied):**
    ```diff
    --- a/backend/src/auth/auth.service.ts
    +++ b/backend/src/auth/auth.service.ts
    @@
    -    await withScopedDb(this.dataSource, (manager) =>
    -      manager.query(
    -        `UPDATE users
    -            SET failed_login_attempts = 0, locked_until = NULL
    -          WHERE id = $1
    -            AND (failed_login_attempts <> 0 OR locked_until IS NOT NULL)`,
    -        [user.id],
    -      ),
    -    );
    +    await withScopedDb(this.dataSource, (manager) =>
    +      manager.query(
    +        `UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1`,
    +        [user.id],
    +      ),
    +    );
    +    user.failedLoginAttempts = 0;
    +    user.lockedUntil = null;
    @@ (trusted-device branch and final branch)
    -          user.lastLogin = new Date();
    -          await this.scoped(User, (repo) => repo.save(user));
    +          user.lastLogin = new Date();
    +          await this.scoped(User, (repo) =>
    +            repo.update({ id: user.id }, { lastLogin: user.lastLogin }),
    +          );
    ```
    Keeping the entity in step (`user.failedLoginAttempts = 0`) matters because `sanitizeUser(user)` and `generateTokenPair(user)` read it afterwards. Still to verify: `auth.service.spec.ts` (it mocks `save`), the probe as a permanent integration test, and the other whole-entity saves listed in section 9.
12. **Recommended regression test:** an integration test that seeds `failed_login_attempts = 4`, logs in successfully through `AuthService.login`, and asserts 0; plus one failed attempt afterwards asserts `locked_until IS NULL`.
13. **Suggested regression-test diff (illustrative, not applied):** the probe in section 1 (`a successful login leaves failed_login_attempts at 0`) moved into `test/integration/login-lockout.integration.spec.ts`, which already has the module set-up.
14. **Verification method:** that test, with the 2FA trusted-device variant (seed a trusted device) as a second case.
15. **Residual risks:** the same stale-snapshot `save(user)` shape exists on other credential paths (section 9, design risk D-S03-01); this diff fixes only the login path.

- **Causality class:** `PRE_EXISTING_UNREPORTED` (MON-M24 is the concurrent-failure lost increment, fixed; this is the success path overwriting the reset).

### A26-S03-03 -- `JwtStrategy` accepts every `JWT_SECRET`-signed token except `2fa_pending` as an access token

1. **Severity:** LOW
2. **Confidence:** high (static; every verifier read)
3. **Location:** `backend/src/auth/strategies/jwt.strategy.ts` `validate()` (deny-lists only `type === "2fa_pending"`); mint sites `backend/src/auth/step-up/step-up.service.ts:210-214` (`type: "step_up"`, 5 min, returned in the JSON body), `backend/src/auth/oidc/oidc-reauth.service.ts:277-284` (pending marker, `oidc_reauth_pending`) and `:362` (artifact, `oidc_reauth`, delivered in the URL fragment `#reauth_token=` by `auth.controller.ts:668-678`), all HS256 with `JWT_SECRET` and `sub = userId`. Same deny-list shape at `delegation/guards/account-delegate.guard.ts:104-111` and `oauth/oauth-interaction.controller.ts:382-388`.
4. **Violated invariant:** a credential minted for one verifier is not accepted by another (purpose binding, hint line).
5. **Reproduction:** a signed-in user obtains a step-up token (`POST /auth/step-up`) or completes an OIDC re-auth; the token is readable by page script. Sending it as `Authorization: Bearer <token>` to any `AuthGuard('jwt')` route passes `JwtStrategy.validate` (no `type` check beyond `2fa_pending`), so it acts as a 5-minute access token. Bearer-header requests are outside the cookie/CSRF path.
6. **Observed:** the access-token payload has no `type`, and validation accepts any payload whose `sub` resolves to an active user.
7. **Expected:** access tokens carry a positive type (`type: "access"`) and `JwtStrategy` accepts only that type (an allowlist); the other verifiers check their own positive type, as `StepUpGuard` and `two-factor.service.ts` already do.
8. **Impact:** narrow. The token belongs to the same user who requested it, so there is no cross-user escalation. It converts a script-readable step-up or re-auth artifact into a bearer access credential usable off-origin for up to 5 minutes, which an XSS could otherwise not obtain (the access and refresh tokens are httpOnly cookies).
9. **Root cause:** one HS256 secret for several token types with deny-list typing.
10. **Recommended correction:** add `type: "access"` to the two access-token mint sites, accept only that type in `JwtStrategy`, `AccountDelegateGuard` and `resolveCookieUser`, with a one-release grace for type-less tokens (15-minute lifetime makes the grace short).
11. **Suggested remediation diff (illustrative, not applied):**
    ```diff
    --- a/backend/src/auth/token.service.ts
    +++ b/backend/src/auth/token.service.ts
    @@ generateTokenPair / refreshTokens
         const payload: Record<string, unknown> = {
           sub: user.id,
    +      type: "access",
    --- a/backend/src/auth/strategies/jwt.strategy.ts
    +++ b/backend/src/auth/strategies/jwt.strategy.ts
    @@ async validate(payload: any) {
    -    if (payload.type === "2fa_pending") {
    +    // Allowlist: an access token is typed "access"; a type-less token is a
    +    // pre-upgrade access token (<= 15 min old) and is accepted until the next release.
    +    if (payload.type !== undefined && payload.type !== "access") {
           throw new UnauthorizedException(
    ```
    Still to verify: every test fixture that signs an access token without `type`; the MCP/OAuth bearer paths, which use their own verifiers.
12. **Recommended regression test:** `jwt.strategy.spec.ts`: `validate({ sub, type: "step_up" })`, `oidc_reauth` and `oidc_reauth_pending` all reject.
13. **Suggested regression-test diff (illustrative, not applied):**
    ```diff
    +it.each(["step_up", "oidc_reauth", "oidc_reauth_pending", "2fa_pending"])(
    +  "refuses a %s token as an access token", async (type) => {
    +    await expect(strategy.validate({ sub: "u1", type })).rejects.toThrow(UnauthorizedException);
    +  });
    ```
14. **Verification method:** the unit test; an HTTP-level check that a step-up token in `Authorization` gets 401.
15. **Residual risks:** separate secrets per token type would be stronger; not proposed here.

- **Causality class:** `PRE_EXISTING_UNREPORTED` for the step-up token; `NEW_SINCE_UPSTREAM_AUDIT` for the OIDC re-auth artifact and marker (INV-AUTH-003 machinery postdates `d5cea9bf`).

### A26-S03-04 -- The concurrency mechanisms behind INV-AUTH-001/004 and INV-CLAIM-001 have no behavioural test: removing them leaves every existing suite green

1. **Severity:** MEDIUM (test coverage; the mutations reintroduce MON-M23 and MON-H09)
2. **Confidence:** high (mutations executed, section 6)
3. **Location:** `backend/src/auth/token.service.ts:149` (family lock in `refreshTokens`), `:261` (family lock in `revokeTokenFamily`), `:164-177` (reuse branch); `backend/src/emergency-access/emergency-access-claim.controller.ts:219-231` (conditional consume); tests `backend/src/auth/token.service.spec.ts`, `backend/test/integration/logout-revoke-failpoint.integration.spec.ts`, `backend/test/integration/emergency-access-grant-cycles.integration.spec.ts`, `backend/src/emergency-access/emergency-access-claim.controller.spec.ts`.
4. **Violated invariant:** `docs/verification-contract.md` -- a concurrency claim needs a real two-connection test; INV-AUTH-001 and INV-CLAIM-001 each list that test as "required" / "still owed".
5. **Reproduction (mutation):** delete `await lockTokenFamily(manager, familyId)` from `revokeTokenFamily`: `token.service.spec.ts` 33/33 pass, `logout-revoke-failpoint` 2/2 pass; the session's race probe (60 rotate-versus-logout pairs) reports `{"leaks":48,"rotationsWon":49}` -- 48 logouts returned success with a live token in the family. Deleting the family lock from `refreshTokens` instead: same suites green, probe `{"leaks":59,"rotationsWon":60}`. Removing both claim guards (`claim_token_used_at IS NULL` and `claim_token_hash = NULL`): the integration suite `emergency` 15/15 pass; only the unit spec fails, and only because it matches the SQL text; the probe shows both concurrent claims succeed in 5/5 rounds (`{"ok":2,"statuses":["ok","ok"]}`), the exact MON-H09 takeover race.
6. **Observed:** the mechanisms work at the baseline (probe: 0/60 leaks; 5/5 claim rounds with one winner) but nothing in the repository's suites would notice their removal; A26-S03-01 is a defect of exactly this blind spot.
7. **Expected:** one integration test per mechanism that fails on the mutation.
8. **Impact:** regression risk on three security-critical properties; the invariant index marks them `enforced` on the strength of mechanisms no test protects.
9. **Root cause:** unit tests with a mocked transaction stand in for concurrency proofs.
10. **Recommended correction:** add the three two-connection tests below to `test/integration/` (the session's probe is a working draft of each).
11. **Suggested remediation diff (illustrative, not applied):** this finding is the test itself (protocol item 12 exception: the defect is the missing test).
    ```diff
    --- /dev/null
    +++ b/backend/test/integration/auth-concurrency.integration.spec.ts
    @@
    +// INV-AUTH-004: logout racing a rotation of the same token leaves no live member.
    +it("logout covers a replacement inserted by a concurrent rotation", async () => {
    +  for (let i = 0; i < 40; i++) {
    +    const { refreshToken: t0 } = await withSystemContext(() => tokens.generateTokenPair(user, false));
    +    const familyId = await familyOf(t0);
    +    await Promise.allSettled([
    +      withSystemContext(() => tokens.refreshTokens(t0)),
    +      sleep(i % 4).then(() => withSystemContext(() => tokens.revokeRefreshToken(t0))),
    +    ]);
    +    expect(await liveMembers(familyId)).toBe(0);
    +  }
    +});
    +// INV-AUTH-001: two concurrent rotations of one token yield one successor.
    +it("two concurrent rotations produce exactly one live successor", async () => { /* allSettled x2, count fulfilled === 1 */ });
    +// INV-CLAIM-001: two concurrent completes with different passwords -> one 200, one 404, one password.
    +it("a claim token is consumed once under concurrency", async () => { /* see probe */ });
    ```
12. **Recommended regression test:** as above; each must be shown failing on its mutation before it is merged.
13. **Suggested regression-test diff:** above.
14. **Verification method:** run each test on the baseline (green) and on the mutations of section 6 (red).
15. **Residual risks:** timing-based races are probabilistic; the logout test hit the window 48-59 times in 60 here, which is ample, but a slower CI runner should keep the iteration count rather than lower it.

- **Causality class:** `PRE_EXISTING_UNREPORTED` (slice-specific instance of MON-M46, which S21 owns).

### A26-S03-05 -- Admin and owner-of-delegate password resets revoke PATs and trusted devices in a separate transaction from the password write

1. **Severity:** LOW
2. **Confidence:** high (static)
3. **Location:** `backend/src/admin/admin.service.ts:603-609` (`save(targetUser)` in one `withScopedDb`, then `revokeSessionsAndTokens` at `:723-731` in another; same split at `:445` and `:505`); `backend/src/delegation/delegation.service.ts:1512-1538` (`repo.save(delegate)` in one `systemScoped` call, `revokeStandingCredentials` in the next).
4. **Violated invariant:** INV-AUTH-005, whose stated mechanism is that `revokeStandingCredentials` "revokes PATs and deletes trusted devices inside the password write's own withScopedDb transaction, so a refused reset revokes nothing and a committed one leaves neither live". The user, email-reset, OIDC-link and emergency-claim paths do this; these two do not.
5. **Reproduction:** an administrator resets a user's password (or an owner resets a delegate-only user's password); the password write commits; the second transaction fails (connection loss, statement timeout, deploy). The new password is live and the old password's PATs and trusted devices are too. The caller gets a 500.
6. **Observed:** two commits where the contract promises one.
7. **Expected:** password, PATs and trusted devices change in one transaction; refresh families and OAuth grants after the commit, as elsewhere.
8. **Impact:** narrow: it needs a failure in a millisecond window, and the admin sees an error. When it happens the credentials the reset existed to end keep working with no log line naming them (the admin path has no equivalent of the claim controller's account-naming error log).
9. **Root cause:** `revokeSessionsAndTokens` bundles the in-transaction half and the refresh-token half, so callers invoke it after their own write's transaction instead of passing their manager.
10. **Recommended correction:** take the manager: call `revokeStandingCredentials(manager, id)` inside the `save`'s transaction; keep the refresh-token and OAuth halves after the commit.
11. **Suggested remediation diff (illustrative, not applied):**
    ```diff
    --- a/backend/src/admin/admin.service.ts
    +++ b/backend/src/admin/admin.service.ts
    @@ resetUserPasswordWithinContext
    -    await withScopedDb(this.dataSource, (manager) =>
    -      manager.getRepository(User).save(targetUser),
    -    );
    +    await withScopedDb(this.dataSource, async (manager) => {
    +      await manager.getRepository(User).save(targetUser);
    +      await revokeStandingCredentials(manager, targetUserId);
    +    });
    --- a/backend/src/delegation/delegation.service.ts
    +++ b/backend/src/delegation/delegation.service.ts
    @@ resetDelegatePassword
    -    await this.systemScoped(User, (repo) => repo.save(delegate));
    -    await this.systemScoped(RefreshToken, async (repo) => {
    -      await repo.update({ userId: delegate.id, isRevoked: false }, { isRevoked: true });
    -      await revokeStandingCredentials(repo.manager, delegate.id);
    -    });
    +    await this.systemScoped(User, async (repo) => {
    +      await repo.save(delegate);
    +      await revokeStandingCredentials(repo.manager, delegate.id);
    +      await repo.manager.getRepository(RefreshToken).update(
    +        { userId: delegate.id, isRevoked: false }, { isRevoked: true });
    +    });
    ```
    `revokeSessionsAndTokens` then drops its `revokeStandingCredentials` call for the reset path only (the disable/delete paths at `:445` and `:505` should be checked the same way). Still to verify: `admin.service.spec.ts`, `delegation.service.spec.ts`, and that a refusal after the `save` now rolls the revocation back too.
12. **Recommended regression test:** a failpoint test in the style of `logout-revoke-failpoint.integration.spec.ts`: a `BEFORE UPDATE` trigger on `personal_access_tokens` that raises; assert the reset rejects and the password hash is unchanged.
13. **Suggested regression-test diff:** as described; not drafted further this session.
14. **Verification method:** that failpoint test for both paths.
15. **Residual risks:** the delegate path's whole-entity `save(delegate)` is also an instance of D-S03-01.

- **Causality class:** `PRE_EXISTING_UNREPORTED` (INV-AUTH-005 postdates the upstream audit; these two paths were not brought into line with its mechanism).

### A26-S03-06 -- Per-user TOTP and step-up attempt budgets are enforced by peek-then-verify, so concurrent guesses exceed the cap

1. **Severity:** LOW
2. **Confidence:** medium (static; not executed)
3. **Location:** `backend/src/auth/two-factor.service.ts:237-245` (per-token peek), `:274` and `:414-420` (`userTotpBudgetSpent` peek), `:430` (increment after the failed check); `backend/src/auth/step-up/step-up.service.ts` `verifyAndIssue` (peek at the top, `recordFailure` after bcrypt/TOTP).
4. **Violated invariant:** the per-user budget "keyed by user rather than by client address, so no forwarded header moves it" (comment at `two-factor.service.ts:405-413`) bounds how many codes are checked per window. The increment is atomic (`AuthAttemptCounterService.increment`), but the decision to check a code is taken on a value read before any of the concurrent failures are counted.
5. **Reproduction:** an attacker who has the password (2FA login) or a stolen session (step-up) sends K requests at once, each with a different code, from K client addresses so the per-IP `@Throttle` (5 per 15 minutes on `/auth/2fa/verify`, 10 per minute on `/auth/step-up`) does not bind. All K `peek` calls read the same count below `MAX_USER_2FA_ATTEMPTS` / `MAX_ATTEMPTS = 10`, so all K codes are checked; the counter afterwards equals K and the lock follows, but K guesses were evaluated instead of at most the cap.
6. **Observed:** cap enforced only for sequential attempts.
7. **Expected:** reserve an attempt before checking the code (`increment` first, compare the returned count with the cap, then refund on success via `reset`), the same "decide from what the database committed" rule `recordFailedLogin` follows.
8. **Impact:** narrows the second-factor guessing budget only by the attacker's address count; a 6-digit TOTP with replay protection (`claimTotpCode`) keeps the per-burst success probability at K / 10^6 (or K * 3 / 10^6 with a ±1 step window). Low.
9. **Root cause:** read-then-act on a counter whose write is atomic.
10. **Recommended correction:** increment-then-check.
11. **Suggested remediation diff (illustrative, not applied):**
    ```diff
    --- a/backend/src/auth/step-up/step-up.service.ts
    +++ b/backend/src/auth/step-up/step-up.service.ts
    @@ verifyAndIssue
    -    const attempts = await this.attemptCounters.peek(STEP_UP_ATTEMPT_SCOPE, attemptKey);
    -    if (attempts >= this.MAX_ATTEMPTS) {
    +    // Reserve the attempt first: the count we compare is the one the database committed.
    +    const { count } = await this.attemptCounters.increment(
    +      STEP_UP_ATTEMPT_SCOPE, attemptKey, this.LOCKOUT_WINDOW_MS, "sliding");
    +    if (count > this.MAX_ATTEMPTS) {
    @@
    -    if (!verified) {
    -      await this.recordFailure(attemptKey);
    +    if (!verified) {
    ```
    The success path keeps its `reset`. Same shape for `userTotpBudgetSpent` / `recordUserTotpFailure`. Still to verify: `step-up.service.spec.ts`, `two-factor.service.spec.ts`, and that a correct code after nine failures still passes (`count` 10 is not `> 10`).
12. **Recommended regression test:** integration: 20 concurrent wrong codes against one user; assert at most `MAX` reached the verifier (spy on `verifyTotpForUser` call count, real counter table).
13. **Suggested regression-test diff:** not drafted this session.
14. **Verification method:** that test.
15. **Residual risks:** none beyond the throttler's own per-address semantics.

- **Causality class:** `PRE_EXISTING_UNREPORTED` (MON-M24 covered the login counter only).

### A26-S03-07 -- Change-password, admin reset/disable and owner-of-delegate reset end refresh sessions with one blanket UPDATE, which misses a successor inserted by a concurrent rotation

1. **Severity:** MEDIUM
2. **Confidence:** high (executed against PostgreSQL 16)
3. **Location:** `backend/src/users/users.service.ts:479-485` (`update({ userId, isRevoked: false }, { isRevoked: true })` inside the password transaction); `backend/src/admin/admin.service.ts:723-733` (`revokeSessionsAndTokens`, used by reset at `:609`, and at `:445`, `:505`); `backend/src/delegation/delegation.service.ts:1530-1535`. Contrast `backend/src/auth/token.service.ts:313-361` (`revokeAllUserRefreshTokens`: capture families, lock each, re-revoke until a pass changes nothing), used by the email reset, 2FA reset, OIDC link and emergency claim.
4. **Violated invariant:** INV-AUTH-005 ("no ... refresh token ... issued before it keeps working") and the statement-snapshot rule recorded in `token.service.ts:126-131` and INV-AUTH-004: a single `UPDATE ... WHERE user_id = ? AND is_revoked = false` blocked on the row a rotation holds sees, after that rotation commits, the old row but not the replacement inserted after its snapshot.
5. **Reproduction:** an attacker holds a stolen refresh token and keeps refreshing it. The account owner changes their password from Settings (or an administrator resets it, or disables the account, or the owner of a delegate-only user resets it). If a rotation is in flight when the revoking UPDATE starts, the UPDATE waits on the rotating row, revokes it, and misses its successor. The password change reports success; the attacker's successor keeps rotating.
6. **Observed:** probe `AUDIT S03 probe: blanket per-user revoke vs rotation`, 60 rotate-versus-revoke pairs per run, two runs: the blanket statement (the exact `repo.update` these three paths issue) leaked a live token in `{"leaks":35}` and `{"leaks":34}` of 60 (an earlier run: 23); `revokeAllUserRefreshTokens` under the same harness leaked `{"leaks":0}` in both runs.
7. **Expected:** after the call resolves, no refresh token issued before it is live.
8. **Impact:** security. The remedy a user reaches for after suspecting theft -- change the password -- can leave the thief's session alive, and with A26-S03-01 the reuse alarm does not end it either. The window is the duration of one rotation, so an attacker who rotates on every allowed refresh (10 per minute) and a user who changes the password once have a small but real chance per change; the admin "disable account" path has the same gap.
9. **Root cause:** three call sites predate or bypass the converging helper and open-code the blanket statement the helper's comment explains is unsafe.
10. **Recommended correction:** after the commit, call `TokenService.revokeAllUserRefreshTokens(userId)` on all three paths (the change-password path may keep the in-transaction blanket UPDATE as a first pass; the post-commit convergence is what closes the gap). For change-password from Settings, pass the caller's refresh token as `keepSessionOf` only if the product wants the current session kept (today it is revoked too; keep that).
11. **Suggested remediation diff (illustrative, not applied):**
    ```diff
    --- a/backend/src/users/users.service.ts
    +++ b/backend/src/users/users.service.ts
    @@ changePassword
         await withScopedDb(this.dataSource, async (manager) => {
           await manager.getRepository(User).save(user);
           await manager
             .getRepository(RefreshToken)
             .update({ userId, isRevoked: false }, { isRevoked: true });
           await revokeStandingCredentials(manager, userId);
         });
    +    // The blanket UPDATE above has a statement-snapshot blind spot against a
    +    // concurrent rotation; converge after the commit (token.service.ts).
    +    await this.tokenService.revokeAllUserRefreshTokens(userId);
    --- a/backend/src/admin/admin.service.ts
    +++ b/backend/src/admin/admin.service.ts
    @@ private async revokeSessionsAndTokens(targetUserId: string)
         await withScopedDb(this.dataSource, async (manager: EntityManager) => {
    ...
         });
    +    await this.tokenService.revokeAllUserRefreshTokens(targetUserId);
         await this.oauthProviderService.revokeAllForUser(targetUserId);
    --- a/backend/src/delegation/delegation.service.ts
    +++ b/backend/src/delegation/delegation.service.ts
    @@ resetDelegatePassword
    +    await withSystemContext(() => this.tokenService.revokeAllUserRefreshTokens(delegate.id));
         await revokeOAuthGrantsAfterCommit(
    ```
    `UsersService`, `AdminService` and `DelegationService` need `TokenService` injected (check `module-graph.spec.ts` for a cycle; `forwardRef` per `backend/CLAUDE.md` if one appears). Still to verify: unit specs of the three services, the integration test below, and the context each call runs under (admin and delegation paths are under `withSystemContext` already; `users.service` runs in the caller's user context, which owns the rows).
12. **Recommended regression test:** the probe as a permanent integration test against each service method, not against the bare statement.
13. **Suggested regression-test diff (illustrative, not applied):**
    ```diff
    +it.each(["changePassword", "adminReset", "delegateReset"])(
    +  "%s leaves no live refresh token under a concurrent rotation", async (path) => {
    +    for (let i = 0; i < 40; i++) {
    +      const { refreshToken: t0 } = await withSystemContext(() => tokens.generateTokenPair(user, false));
    +      await Promise.allSettled([rotate(t0), sleep(i % 4).then(() => runPath(path))]);
    +      expect(await liveTokens(user.id)).toBe(0);
    +    }
    +  });
    ```
14. **Verification method:** that test; the probe's `revokeAllUserRefreshTokens` variant shows the expected result (0/60).
15. **Residual risks:** `revokeAllUserRefreshTokens` gives up after 10 passes with a warning; a client rotating faster than that is not realistic at a 10-per-minute throttle.

- **Causality class:** `PRE_EXISTING_UNREPORTED` (MON-M23 was raised for logout only; the same root cause on these three paths was not reported).
- **Rule 7 surfaces:** `users.service.ts` changePassword; `admin.service.ts` reset password, disable, delete (via `revokeSessionsAndTokens`); `delegation.service.ts` resetDelegatePassword.

## 5. Prior-finding dispositions

| ID | Disposition | Evidence |
| --- | --- | --- |
| MON-H09 | `FIXED_VERIFIED` | Mechanism: the consume is one conditional `UPDATE ... WHERE claim_token_hash = $1 AND claim_token_used_at IS NULL AND claim_token_expires_at >= CURRENT_TIMESTAMP RETURNING`, which also sets `claim_token_hash = NULL`, as the first statement of the credential transaction (`emergency-access-claim.controller.ts:219-242`); the pre-check at `:183` writes nothing. Executed: two concurrent `complete` calls with different passwords on two pool connections, 5 rounds: `{"ok":1,"statuses":["ok",404],"isA":true,"isB":false,"liveFamilies":1}` every round. The two guards are mutually redundant (removing only `used_at IS NULL` still yields one winner, because the hash predicate no longer matches after the first commit); removing both reproduces the upstream race in 5/5 rounds. The repository's own protection is a SQL-text unit assertion only: A26-S03-04. |
| MON-M03 | `FIXED_VERIFIED` | `users/user-profile.ts` builds every profile from `PROFILE_FIELDS`; `/users/me` (`users.controller.ts:36-53`) and `/auth/profile` (`auth.controller.ts:795-796`) return `toDelegatedUserProfile` while acting, which drops `hasPassword`, `pendingEmail`, `mustChangePassword`, `isDelegateOnly`, `backupEncryptionEnabled`. Mutation M-DELEG (section 6) fails 4 tests. Residual, not a finding: an acting delegate still reads the owner's `lastLogin`, `lastActivityAt`, `role` and `authProvider` (section 9, D-S03-03). |
| MON-M05 | `FIXED_VERIFIED` | No path accepts a presence-only value: `users.service.ts:528-535` and `backup-restore.service.ts:581-596` call `OidcReauthService.consume`, which verifies HS256 signature, `type === "oidc_reauth"`, `sub`, purpose, `jti`, `exp`, then `claimJti` (`INSERT ... ON CONFLICT (jti) DO NOTHING RETURNING`, `oidc-reauth.service.ts:237-256`); the callback requires `auth_time` freshness against the pending marker bound to `state`. Mutations M-JTI and M-OPURP fail the unit spec. The sentinel string survives only in comments. Residual: A26-S03-03 (the artifact also verifies as an access token). |
| MON-M07 | `FIXED_VERIFIED` | `request-context.interceptor.ts:120-123` stamps `realUserId`; mutation M-ACT fails 3 tests in `request-context.interceptor.spec.ts`; the monitor reads `owner.lastActivityAt ?? owner.lastLogin` (`emergency-access-monitor.service.ts:259, 714`), so a delegate no longer resets the owner's clock. |
| MON-M23 | `FIXED_VERIFIED` | `revokeRefreshToken` looks up and revokes in one transaction; `revokeTokenFamily` takes `lockTokenFamily` before its `UPDATE`, and `refreshTokens` takes the same lock before the row lock, so the UPDATE's statement snapshot is taken after any rotation in the family committed. Executed: 60 rotate-versus-logout pairs, `{"leaks":0,"rotationsWon":60}`; with either lock removed, 48 and 59 leaks. No repository test detects the mutation: A26-S03-04. |
| MON-M24 | `FIXED_VERIFIED` | `login-lockout.ts` `recordFailedLogin`: one `UPDATE ... FROM (SELECT ... FOR UPDATE)` incrementing in SQL and deriving the lock from the incremented value; `test/integration/login-lockout.integration.spec.ts` (two pools, N concurrent failures, counter == N) ran green in this session. A different defect on the success path (the reset is overwritten) is A26-S03-02. |
| MON-M26 | `FIXED_VERIFIED` | Grant transition is a conditional `UPDATE emergency_access_settings ... WHERE granted_at IS NULL AND enabled = true RETURNING grant_generation` (`emergency-access-monitor.service.ts:94-110`); per-contact token issuance is a compare-and-set on the observed hash, ciphertext and void reason (`:638-669`), and a contact already holding a live stored credential gets the same token re-sent (`credentialFor`, `:583-602`), so a second replica can at worst repeat a valid link, never invalidate a delivered one. `emergency-access-grant-cycles.integration.spec.ts` 15/15 green; mutation M-CAS fails 14 of them; mutation M-GRANT is caught by the unit spec only. Residual: duplicate delivery of the same valid link under a two-replica overlap (at-least-once email), accepted by design in the code comments. |
| MON-L01 | `FIXED_VERIFIED` | `auth/scopes.ts` is the single scope list (`API_SCOPES = ["read", "write"]`) with comments recording the old `reports` defect; `create-pat.dto.ts:24` and `docs/backend/mcp.md:244` state there is no `reports` scope. `scopes.spec.ts` ran green. |

## 6. Mutation table

All mutations run in the scratch worktree `<scratchpad>/mut` at `AUDIT_BASELINE_SHA`, reverted with `git checkout` after each run; `git status` clean except the untracked probe file.

| Invariant | Mutation (file:line, what) | Test that fails | Verdict |
| --- | --- | --- | --- |
| INV-AUTH-004 / MON-M23 | `token.service.ts:261` delete `lockTokenFamily` in `revokeTokenFamily` | none of the repository's (`token.service.spec.ts` 33/33, `logout-revoke-failpoint` 2/2); session probe only (48/60 leaks) | **undetected** |
| INV-AUTH-001 / INV-AUTH-004 | `token.service.ts:149` delete `lockTokenFamily` in `refreshTokens` | none of the repository's (same suites green); session probe only (59/60 leaks) | **undetected** |
| INV-AUTH-001 | the reuse branch's revocation is rolled back (the baseline itself, A26-S03-01) | none; `token.service.spec.ts` replay case is green on the defect | **undetected** |
| INV-CLAIM-001 / MON-H09 | `emergency-access-claim.controller.ts:226` drop `claim_token_used_at IS NULL` | `emergency-access-claim.controller.spec.ts` (SQL text, 1 test); behaviourally an equivalent mutant (hash predicate still serializes) | covered (text only) |
| INV-CLAIM-001 / MON-H09 | `:222` keep the hash and `:226` drop `used_at IS NULL` | `emergency-access-claim.controller.spec.ts` (SQL text, 1 test); integration `emergency` 15/15 green; session probe 5/5 double success | covered by unit text only; **undetected** at integration level |
| INV-ACTIVITY-001 / MON-M07 | `request-context.interceptor.ts:120` `realUserId` -> `userId` | `request-context.interceptor.spec.ts` (3) | covered |
| INV-AUTH-003 / MON-M05 | `oidc-reauth.service.ts:254` `claimJti` always true | `oidc-reauth.service.spec.ts` (3; mocked DB) | covered |
| INV-AUTH-003 | `oidc-reauth.service.ts:410` purpose check off | `oidc-reauth.service.spec.ts` (1) | covered |
| step-up subject binding | `step-up.guard.ts:109` `sub` check off | `step-up.guard.spec.ts` (1) | covered |
| step-up purpose binding | `step-up.guard.ts:98` purpose check off | `step-up.guard.spec.ts` (1) | covered |
| INV-PROFILE-001 / MON-M03 | `user-profile.ts:126` delegated drop list emptied | `users` + `auth.controller` specs (4) | covered |
| own-password only | `users.controller.ts:93` `realUserId` -> `id` | `users.controller.spec.ts` (1) | covered |
| MON-M26 | `emergency-access-monitor.service.ts:102` drop `granted_at IS NULL` | `emergency-access-monitor.service.spec.ts` (2); integration 15/15 green | covered (unit only) |
| MON-M26 | `:670` CAS on observed hash disabled | `emergency-access-grant-cycles.integration.spec.ts` (14) | covered |
| INV-PUSH-001 | `push-subscription.service.ts:349` `ON CONFLICT ... WHERE user_id = EXCLUDED.user_id` -> `TRUE` | `push-subscription.service.spec.ts` (2); integration `security-cross-user|push` 48/48 green | covered (unit only) |
| INV-AUTH-002 / MON-M24 | conceptual: replace the SQL increment by a JS read-modify-write | `login-lockout.integration.spec.ts` (N concurrent failures on two pools) | covered (conceptual; not executed) |

## 7. Counterexamples and the interaction scenario

Counterexamples, each not copied from an existing test:

- INV-AUTH-001: rotate `t0` once, then present `t0` again -> the successor survives (A26-S03-01, executed).
- INV-AUTH-002: four typos, one correct login, one typo -> locked (A26-S03-02, the first half executed).
- INV-CLAIM-001: two different proposed passwords racing on one link -> exactly one password durable (executed; holds).
- INV-AUTH-004: logout staggered 0-3 ms behind a rotation -> 0/60 leaks (executed; holds).
- INV-AUTH-003: an `oidc_reauth` artifact presented as `Authorization: Bearer` -> accepted by `JwtStrategy` (A26-S03-03, static).
- INV-PROFILE-001: an acting delegate reading `/users/me` -> owner's credential-state fields absent (unit-covered; holds).
- INV-AUTH-005: an admin reset whose second transaction fails -> new password live with old PATs (A26-S03-05, static).

Interaction scenario (refresh theft + reuse detection + logout + password change): a thief rotates a stolen `t0`; the victim's next refresh presents `t0` and is told "reuse detected" (A26-S03-01: the thief's `t1` survives). The victim, alarmed, logs out from the browser: logout presents the victim's cookie, which was cleared on the 401, so nothing is revoked. The victim signs in again: a new family; the thief's family F is untouched. The victim changes the password from Settings: `users.service.ts:479-485` revokes with one blanket UPDATE, and if the thief's client rotates during it, F's newest member survives (A26-S03-07, executed: 23-35 of 60). Correct mechanisms (rotation under lock, logout under lock) compose with two incorrect ones into a session the user may not be able to end at all. The fix for A26-S03-01 closes the chain at its first step; A26-S03-07's closes the user's own remedy.

## 8. Rejected hypotheses

| Candidate | Evidence considered | Why rejected or downgraded | Final classification |
| --- | --- | --- | --- |
| Step-up tokens are replayable within 5 minutes (hint: "single use of step-up") | `step-up.guard.ts` never checks `jti`; `step-up.service.ts:210-214` mints one | No document or invariant claims single use for step-up tokens; they are purpose-, subject- and time-bound, and the two purposes (`personal-access-token`, `emergency-access`) are settings writes the same session could repeat after another step-up. The single-use requirement is stated, and met, for the OIDC artifact (INV-AUTH-003) | `DESIGN_RISK` (D-S03-02) |
| OAuth consent `POST /oauth/interaction/:uid/confirm` is `@SkipCsrf` and cookie-authenticated, so CSRF can grant a client | `oauth-interaction.controller.ts:23, 131-170`; `auth_token` cookie `sameSite: "lax"`; `uid` is the provider's unguessable interaction id bound to its own interaction cookie | A cross-site POST does not carry `SameSite=Lax` cookies, and the attacker cannot know the victim's `uid` | `REJECTED` |
| Emergency claim: the pre-check (`findValidContact`) is a read-then-write | `emergency-access-claim.controller.ts:183` | The pre-check only rejects early; the consume is the conditional UPDATE (executed race, section 5) | `REJECTED` |
| Lockout check reads a snapshot before bcrypt, so parallel attempts on an unlocked account all reach bcrypt | `auth.service.ts:400-409` | All of them are counted atomically and the lock follows; the burst is bounded by the per-address throttle; same class as A26-S03-06 but for passwords the lock is the documented control and it engages | downgraded, folded into A26-S03-06's reasoning |
| `revokeAllUserRefreshTokens` misses a family opened mid-sweep | `token.service.ts:313-361` | Deliberate (comment cites maintainer review PR #1097 finding 4): a session opened after the operation began is not one the caller asked to end | `REJECTED` (Rule 2: deliberate semantics) |
| Delegated refresh rotation keeps `actingAsUserId` after the delegation is revoked | `token.service.ts:222-238` | `JwtStrategy.validate` re-runs `validateActingContext` on every request and `AccountDelegateGuard` re-checks capabilities | `REJECTED` |
| An id route in the slice lacks `ParseUUIDPipe` | `grep @Param(` over the slice's controllers | Only `push-chart.controller.ts` `:token` (an opaque one-use token, not a UUID) | `REJECTED` |
| A `withSystemContext` / `withUserContext` / `withDelegateContext` call site in the slice is missing from `WITH_CONTEXT_ALLOWLIST` | 20 files in the slice call one; each checked against `backend/eslint.config.mjs` | All 20 are listed | `REJECTED` |
| A TOTP code can be replayed across login and step-up | `two-factor.service.ts:315-320, 477-512` (`SingleUseTokenService.claim` with one purpose for both) | Replay protection is shared and atomic (`INSERT ... ON CONFLICT DO NOTHING RETURNING`); `single-use-token` integration suite green | `REJECTED` |
| Frontend persists a credential | `frontend/src/store/authStore.ts:139-143` `partialize` keeps only `isAuthenticated`; no storage of step-up or re-auth tokens found | -- | `REJECTED` |

## 9. Design risks

- D-S03-01: whole-entity `repo.save(user)` after an earlier read and an intervening SQL write to the same row appears on several credential paths (`auth.service.ts:511, 538, 786, 903, 920`; `auth-email.service.ts:119, 224`; `two-factor.service.ts:367, 516, 581, 615, 905, 998`; `users.service.ts:173, 481`). TypeORM's `save` diffs the snapshot against the current row and writes every column that differs, so a concurrent committed change to another column of `users` (a password reset, a lockout, a 2FA disable) can be reverted. A26-S03-02 is the instance proven on a single request; the concurrent instances are not yet demonstrated (handed to S04/S07 as a pattern search, section 12).
- D-S03-02: step-up tokens are reusable for their purpose for 5 minutes (no `jti` consumption). Acceptable for the two current purposes; a future destructive purpose added to `STEP_UP_PURPOSES` would inherit replayability. A guard that refuses a destructive purpose without a `jti` claim would make the rule machine-checked.
- D-S03-03: an acting delegate receives the owner's `lastLogin`, `lastActivityAt`, `role`, `authProvider` and `emailVerified` from `/users/me` and `/auth/profile`. Not credential state, and the UI may need some of it; whether a delegate should see the owner's presence timestamps is a product decision (they reveal when the owner was last active, which is also the emergency-access clock).
- D-S03-04: the nightly purge deletes revoked refresh tokens (`token.service.ts:378-382`), which also deletes the evidence reuse detection needs; once A26-S03-01 is fixed, a token stolen more than a day before reuse will be "invalid", not "reused".

## 10. Missing tests and known-wrong tests

- INV-AUTH-001's required two-connection rotation test does not exist (`test/integration/` has no refresh-rotation suite; only `logout-revoke-failpoint`). A26-S03-04.
- INV-CLAIM-001's two-connection test is listed as "still owed" and is still missing; the only protection is a SQL-text unit assertion. A26-S03-04.
- No test drives `AuthService.login` against a real database; `auth.service.spec.ts` mocks `save`, which is how A26-S03-02 stays green.
- No test covers the three blanket-revoke paths under a concurrent rotation (A26-S03-07).
- Known-wrong (asserts current defect as correct): `token.service.spec.ts` "should revoke entire family and throw when token is already revoked (replay detection)" asserts that `manager.update` was called, which is true while the revocation is rolled back (A26-S03-01). Same for the "user is not found" and "user is inactive" cases.
- INV-AUTH-005's own "still owed" item (a real-database test that a PAT minted before a reset is refused after it) is still missing.

## 11. Documentation inconsistencies

- `docs/system-invariants.md` INV-AUTH-001 says the loser "takes the reuse-detection branch" and the family ends revoked; at the baseline the branch's revocation rolls back (A26-S03-01).
- `docs/system-invariants.md` INV-AUTH-005 says standing credentials are revoked "inside the password write's own withScopedDb transaction"; the admin and owner-of-delegate resets do it in a second transaction (A26-S03-05), and three paths do not use the converging refresh revocation its "existing revocation" wording implies (A26-S03-07).
- `docs/system-invariants.md` INV-AUTH-002 says "the success-path reset writes a fixed absolute value and was always safe"; a later whole-entity save overwrites it (A26-S03-02).
- `docs/system-invariants.md` INV-CLAIM-001 names only `claim_token_used_at IS NULL` as the guard; at the baseline `claim_token_hash = NULL` in the same statement is an equally sufficient second guard, which is why removing the named predicate alone does not reopen the race (section 6). Not wrong, but a reader removing the "redundant" hash clear would then depend on the predicate alone without knowing it.

## 12. Review ledger

- `PR_REVIEW_SHA` = `AUDIT_BASELINE_SHA` = `72c59ec4bc6e9f2cb3a5d25977c94dd2c09e5a86`; audit branch head at start `becd00fa`; `main` not consulted (S22).
- Directories inspected: `backend/src/auth/` (all subdirectories listed), `backend/src/emergency-access/`, `backend/src/delegation/` (service and guard), `backend/src/users/` (controller, service, profile), `backend/src/admin/` (service), `backend/src/oauth/` (interaction controller), `backend/src/push/` (chart controller, subscription conflict clause), `backend/src/common/interceptors/`, `backend/src/common/db/` (scoped-db, locks), `frontend/src/store/authStore.ts`.
- Files read in full: `emergency-access-claim.controller.ts`, `token.service.ts`, `login-lockout.ts` (code), `step-up.service.ts` (code), `step-up.guard.ts`, `single-use-token.service.ts`, `jwt.strategy.ts` (code), `user-profile.ts` (code), `push-chart.controller.ts`.
- Files sampled with ranges: `auth.service.ts:55-160, 360-560, 930-975`; `auth.controller.ts:1260-1355` and the `setAuthCookies` block; `oidc-reauth.service.ts:100-160, 237-300, 362-458`; `two-factor.service.ts:225-275, 405-440, 477-512`; `emergency-access-monitor.service.ts:75-200, 360-470, 583-670`; `users.controller.ts:30-125`; `users.service.ts:184-215, 455-560`; `delegation.service.ts:763-787, 1465-1540`; `admin.service.ts:333-395, 552-610, 723-735`; `oauth-interaction.controller.ts:20-170, 370-400`; `account-delegate.guard.ts:85-140`; `request-context.interceptor.ts:55-125`; `backup-restore.service.ts:570-605`; `credential-revocation.ts:60-90`; `scopes.ts`, `create-pat.dto.ts`.
- Repository-wide searches: every `refreshTokens(`, `revokeAllUserRefreshTokens`, `revokeStandingCredentials(` caller; every `jwtService.sign` / `jwt.sign` / `jwtService.verify` / `jwt.verify` site; every `RequireStepUp(`; every `oidcReauth.consume`; every `toUserProfile` / `toDelegatedUserProfile` caller; every `repo.save(user)` in `auth/` and `users/`; `@Param(` without `ParseUUIDPipe` in the slice; class-level `AuthGuard('jwt')` per slice controller; `withSystemContext|withUserContext|withDelegateContext` in the slice against `WITH_CONTEXT_ALLOWLIST`.
- Context call-site list (override: built here, not taken from S01): 20 files in the slice call an identity-context helper -- `admin/admin.service.ts` (8 sites), `auth/auth-state-sweeper.service.ts` (1), `auth/auth.controller.ts` (4), `auth/auth.service.ts` (13), `auth/pat.service.ts` (1), `auth/strategies/jwt.strategy.ts` (4), `auth/token.service.ts` (1), `common/interceptors/request-context.interceptor.ts` (3), `delegation/cross-owner-access.service.ts` (5), `delegation/delegation.service.ts` (7), `delegation/guards/account-delegate.guard.ts` (1), `delegation/joint-accounts.service.ts` (1), `emergency-access/emergency-access-claim.controller.ts` (2), `emergency-access/emergency-access-monitor.service.ts` (2), `oauth/oauth-interaction.controller.ts` (1), `oauth/oauth-provider.service.ts` (2), `oauth/oauth-signing-keys.service.ts` (1), `push/push-chart-artifact.service.ts` (3), `push/push-config.service.ts` (4), `push/push-subscription.service.ts` (1). All 20 files are in `WITH_CONTEXT_ALLOWLIST`. Counts are grep line counts and may include a multi-line call twice.
- Suites run, with results:
  - `npm run test:integration -- 'auth-attempt-counter|auth-state-tables|emergency-access-grant-cycles|login-lockout|single-use-token|logout-revoke-failpoint|security-cross-user-isolation|oauth-signing-keys|push-chart-token'`: 9 suites, 87 tests, all passed.
  - `TZ=UTC npx jest src/auth src/oauth src/users src/admin src/emergency-access src/delegation src/push src/common/interceptors`: 1951 tests, all passed.
  - Probe file (scratch worktree only): refresh reuse (fails on baseline: A26-S03-01), login counter (fails: A26-S03-02), claim race x5 (passes), logout race (passes), per-user revoke race (blanket fails, helper passes: A26-S03-07).
  - Mutation runs: section 6.
  - No integration suite is named `step-up` or `delegation`; the nearest are `joint-accounts`, `rls-*` (owned by S04) and `security-cross-user-isolation` (run).
- Toolchain deviation: the Docker daemon was not running in the container; `dockerd` was started by hand before the PostgreSQL container. `npm ci` OK on Node 24.
- Areas reviewed without a finding: claim consume (MON-H09), logout (MON-M23), lockout increment (MON-M24), OIDC re-auth (MON-M05), activity attribution (MON-M07), profile allowlist (MON-M03), grant issuance (MON-M26), PAT scopes (MON-L01), TOTP replay, admin last-admin locking (`lockAdminsForUpdate`), push subscription ownership clause, OAuth consent CSRF, frontend credential persistence.
- Not covered this session (sampled or skipped, never reported clean): OAuth provider internals (`oauth-provider.service.ts`, signing-key rotation beyond its integration suite), PAT bearer guard and MCP bearer path (S17 owns MCP), the remaining `auth.controller.ts` routes (register, forgot/reset, OIDC callback body), `frontend/src/lib/api.ts` 401/refresh interceptor, `docs/specs/row-level-security.md` and `docs/rls-runbook.md` (S04), `SECURITY.md`.
- Open hypotheses handed on:
  - to S04: D-S03-01, whole-entity `repo.save(user)` after an intervening SQL write can revert a concurrent change to another `users` column; search the RLS/tenancy paths that save `User` and demonstrate one concurrent instance.
  - to S17: confirm the MCP/PAT bearer verifiers do not accept the `step_up` / `oidc_reauth` JWT types (A26-S03-03 checked only the cookie/`Authorization` JWT path).
  - to S18: the frontend's handling of the 401 "Refresh token reuse detected" (does it surface anything to the user, or log out silently).
  - to S21: A26-S03-04's three missing two-connection tests join MON-M46.
- Ledger text for the orchestrator (S03 row): status `done`; findings B/H/M/L = 0/1/3/3; prior findings disposed 8 of 8 (all `FIXED_VERIFIED`); undetected mutation rows: `INV-AUTH-004 | token.service.ts:261 drop lockTokenFamily in revokeTokenFamily | a two-connection logout-vs-rotation test | S03`; `INV-AUTH-001/004 | token.service.ts:149 drop lockTokenFamily in refreshTokens | same | S03`; `INV-AUTH-001 | token.service.ts:164-177 reuse revocation rolled back (baseline defect) | a real-database reuse test | S03`; `INV-CLAIM-001 | emergency-access-claim.controller.ts:222+226 drop both guards | a two-connection claim test | S03`; deviation: dockerd started by hand.

## 13. Adversarial approval challenge

Started from the slice's own abstractions, not from the findings: "a refusal inside `withScopedDb`", "a JWT signed with `JWT_SECRET`", "a revoke of refresh tokens", "a counter read before a check", "an entity saved after a SQL write".

- Refusal inside a transaction that must leave a write: searched every `throw` that follows a write in `token.service.ts`, the claim controller, `login-lockout` callers, `oidc-reauth.consume` (the claim is its last statement before return, and a refusal before it writes nothing), `step-up.service.ts` (`recordFailure` runs in its own transaction before the throw) and `two-factor.service.ts` (same). Found A26-S03-01 only.
- JWT types: every mint and verify site enumerated; found A26-S03-03; `two-factor.service.ts` and `StepUpGuard` check a positive type, the other three verifiers do not.
- Refresh revocation: every revoke call site enumerated and the two shapes (blanket vs converging) separated; found A26-S03-07 and executed it.
- Counter-before-check: login (atomic increment, lock snapshot is a burst bound only), step-up and TOTP (A26-S03-06).
- Entity save after SQL write: login (A26-S03-02, executed), others recorded as D-S03-01.
- Legacy data: a refresh row with `acting_as_user_id` set but `delegation_id` NULL (pre-migration shape) produces an un-acting payload (`token.service.ts:235`), which is the safe direction. A claim row with a hash and no ciphertext (older version) gets a new token with a warning (`credentialFor`), which can invalidate a delivered link; the code logs that it does so, and it applies only to rows written before the ciphertext column existed.
- Stale client: an access token minted before A26-S03-03's fix carries no `type`; the suggested diff accepts it for one release.

The challenge did not overturn any finding and added A26-S03-07 to the list.

## 14. Verdict

`REQUEST CHANGES` for the slice: one HIGH (A26-S03-01) survived the adversarial challenge, with three MEDIUM (A26-S03-02, -04, -07) and three LOW (A26-S03-03, -05, -06). All eight owned prior findings are `FIXED_VERIFIED`, each by a named mechanism; two of those mechanisms (MON-H09's consume, MON-M23's family lock) are protected by no behavioural test in the repository (A26-S03-04). Hosted CI was not consulted; every result above is a local run on `AUDIT_BASELINE_SHA`.
