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
| Status | in-progress |

Runtime executed so far (results quoted, not asserted):

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

(in progress; completed at the end of the session)

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

## 5. Prior-finding dispositions

(in progress)

## 6. Mutation table

(in progress)

## 7. Counterexamples and the interaction scenario

(in progress)

## 8. Rejected hypotheses

(in progress)

## 9. Design risks

- D-S03-01: whole-entity `repo.save(user)` after an earlier read and an intervening SQL write to the same row appears on several credential paths (`auth.service.ts:511, 538, 786, 903, 920`; `auth-email.service.ts:119, 224`; `two-factor.service.ts:367, 516, 581, 615, 905, 998`; `users.service.ts:173, 481`). TypeORM's `save` diffs the snapshot against the current row and writes every column that differs, so a concurrent committed change to another column of `users` (a password reset, a lockout, a 2FA disable) can be reverted. A26-S03-02 is the instance proven on a single request; the concurrent instances are not yet demonstrated.

## 10. Missing tests and known-wrong tests

- INV-AUTH-001's required two-connection rotation test does not exist (`test/integration/` has no refresh-rotation suite; only `logout-revoke-failpoint`).
- `token.service.spec.ts` "should revoke entire family and throw when token is already revoked (replay detection)" asserts that `manager.update` was called; with a mocked transaction it cannot see the rollback (A26-S03-01).

## 11. Documentation inconsistencies

- `docs/system-invariants.md` INV-AUTH-001 says the loser "takes the reuse-detection branch" and the family ends revoked; at the baseline the branch's revocation rolls back (A26-S03-01).

## 12. Review ledger

(in progress)

## 13. Adversarial approval challenge

(in progress)

## 14. Verdict

(in progress; at least one HIGH confirmed, so the slice cannot be `APPROVE`)
