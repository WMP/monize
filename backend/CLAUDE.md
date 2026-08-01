# Backend Directory

NestJS API server. All commands run from this directory.

## Commands

```bash
npm run start:dev          # Dev server with HMR
npm run build              # Production build
npm run lint               # ESLint --fix
npm run test               # All tests (unit + E2E)
npm run test:unit          # Unit tests only (src/**/*.spec.ts)
npm run test:cov           # Coverage report (95% lines, 94% stmts, 95% funcs, 85% branches)
npm run test:e2e           # E2E tests (test/**/*.spec.ts, 30s timeout, sequential)
npm run i18n:pseudo        # Regenerate the xx pseudo-locale from en
npm run i18n:check         # Verify the pseudo-locale is up to date (CI gate)
npm run migration:lint     # Idempotency lint over database/migrations (CI gate)
npm run migration:lint:test # Self-test for the migration lint
```

## Module Structure

Each feature module under `src/` follows the standard layout. Use `ls src/` or LSP `workspaceSymbol` to discover modules; the cron schedule lives in `docs/cron-jobs.md`.

```
{feature}/
  {feature}.module.ts
  {feature}.controller.ts
  {feature}.service.ts
  {feature}.controller.spec.ts
  {feature}.service.spec.ts
  entities/{entity}.entity.ts
  dto/create-{entity}.dto.ts
  dto/update-{entity}.dto.ts
```

Controllers are thin and delegate to services. Services always take `userId` as the first parameter and filter by it for multi-tenancy.

## Configuration

- **Path alias:** `@/*` maps to `src/*` (tsconfig + Jest moduleNameMapper)
- **ESLint:** Flat config (`eslint.config.mjs`) with typescript-eslint + prettier
- **Jest:** Coverage thresholds: 95% lines, 94% statements, 95% functions, 85% branches. Excludes `main.ts`, modules, entities, DTOs, seed scripts, and migrations from coverage.
- **TypeScript:** ES2021 target, CommonJS modules, `strictNullChecks: true`, `noImplicitAny: false`

## Global Providers (app.module.ts)

Registered globally via `APP_FILTER`, `APP_GUARD`, `APP_INTERCEPTOR`:

| Provider | Purpose |
|----------|---------|
| `GlobalExceptionFilter` | Catches all exceptions; handles HttpException and TypeORM QueryFailedError |
| `ThrottlerGuard` | Rate limiting (100 requests/minute) |
| `CsrfGuard` | CSRF double-submit cookie validation |
| `MustChangePasswordGuard` | Blocks access until password change (admin-reset users) |
| `DemoModeGuard` | Restricts write operations in demo mode |
| `CsrfRefreshInterceptor` | Refreshes CSRF token cookie on responses |
| `ClassSerializerInterceptor` | Applies `@Exclude()` / `@Expose()` from class-transformer |

Also configured: `ConfigModule` (global), `TypeOrmModule` (async, PostgreSQL), `ThrottlerModule`, `ScheduleModule`.

## main.ts Setup

- **API prefix:** `api/v1`
- **Body limit:** 10mb (for large QIF file imports)
- **Swagger:** Enabled at `/api/docs` in non-production only
- **DATE column parser:** `pg.types.setTypeParser(1082, val => val)` -- returns DATE columns as strings to prevent timezone-related date shifting
- **Validation pipe:** Global with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`
- **Security:** Helmet (CSP, HSTS, frame-deny), CORS (credentials, configurable origins)
- **Cookie parser:** Required for OIDC state/nonce and auth tokens
- **Trust proxy:** Level 1 (Docker/nginx real client IP)

## Entity Conventions

**DATE columns** must use a string transformer to avoid timezone issues -- without this, PostgreSQL returns a `Date` parsed in UTC and reading `.toISOString()` can shift the day:

```typescript
@Column({
  type: 'date',
  name: 'transaction_date',
  transformer: {
    from: (value: string | Date): string => {
      if (!value) return value as string;
      if (typeof value === 'string') return value;
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    },
    to: (value: string | Date): string | Date => value,
  },
})
transactionDate: string;
```

**Decimal columns** use a `numericTransformer` to convert PostgreSQL's string representation to `number`. **Timestamps** are `@CreateDateColumn({ name: 'created_at' })` and `@UpdateDateColumn({ name: 'updated_at' })`.

**Raw selects bypass both transformers.** `getRawOne`/`getRawMany` return driver values, not entity-hydrated ones, so a DATE column comes back as a JS `Date` and a numeric as a string -- regardless of the transformer on the entity. Select a DATE as text in SQL (`TO_CHAR(col, 'YYYY-MM-DD')`) and pass a numeric through `Number()` before it reaches a DTO that declares `string`/`number`. `main.ts` installs a global DATE string parser, which hides the DATE half of this in the running server but not in tests, jobs, or any other process -- so do not rely on it. `payee-detail.service.ts` is the worked example; its `test/payee-detail.e2e-spec.ts` is what caught it, because a unit spec with mocked query builders cannot.

## DTO Conventions

### An optional field with a format validator needs `@ValidateIf`, not just `@IsOptional`

`@IsOptional()` waives validation for `undefined` and `null` only. A text input the user left alone arrives as `""` -- react-hook-form gives the empty string and the form sends it -- so an `@IsUrl` / `@IsEmail` sitting beside `@IsOptional()` still runs on it and rejects it. Because validation fails per *request*, one blank optional field breaks every save from that form, not just the field. Add `@ValidateIf((_o, value) => value !== null && value !== "")` for a column that is nullable, so a blank clears it. `src/common/optional-url-dto.spec.ts` sweeps every URL-validated DTO property and fails on a new one; a field whose column is NOT NULL belongs on that file's exemption list with the reason, not silently rejecting a blank.

This class of bug is invisible to unit tests, which construct payloads by hand and never send what the form sends. It surfaces in E2E or in production.

### A field that belongs to one account type is cleared when the type changes

`AccountsService.update` maps properties explicitly, and a type change has to
clear the columns that no longer apply -- the credit card statement fields and
the tax-estimation settings both do this at the end of the mapping. Left behind,
those values are unreachable from the UI (the form hides their section) yet
still read by services, so they silently come back into force the moment the
type is switched back. Guard on the *effective* type (`dto.accountType ??
account.accountType`), and clear after the assignments, not before.

## Testing Conventions

Mock repositories use `Record<string, jest.Mock>`; tests use `Test.createTestingModule` with mocks injected via `getRepositoryToken()`. E2E tests live in `test/` with helpers under `test/helpers/` (`auth-helper.ts`, `test-database.ts`, `test-factories.ts`).

## Internationalization (i18n)

Server-rendered strings (exception messages, email copy) are localized via `nestjs-i18n`. Wrap exception messages in `tr(key, fallback, args)` (`src/i18n/translate.ts`), which resolves against the request locale and returns the English `fallback` outside an HTTP context (jobs, schedulers, tests). Render emails with an `EmailT` translator (`emailTranslator(i18n, recipientLang)` from `src/i18n/email-translator.ts`) so copy matches the recipient's stored locale rather than the request's. Catalogs live in `src/i18n/locales/{locale}/*.json`, one folder per supported locale; the authoritative locale list is `SUPPORTED_LOCALE_CODES` in `src/i18n/config.ts` (root `CLAUDE.md` enumerates them) -- keep it in sync with the frontend's. The `en-*` entries are lean regional variants (declared in `LOCALE_BASES`): they hold only the keys that differ from `en` and fall back to it per key. Adding or changing a string means updating every locale -- the parity test `src/i18n/locales.parity.spec.ts` fails otherwise -- then regenerating the pseudo-locale with `npm run i18n:pseudo`. Full contributor flow: `src/i18n/README.md`.

## Cron Jobs

Cron jobs use `@Cron()` from `@nestjs/schedule` and run **in the API process** -- `ScheduleModule.forRoot()` is registered in `app.module.ts`; there is no separate scheduler process (on k8s with more than one backend replica, every replica fires every cron). For the full schedule, see `docs/cron-jobs.md` or grep `@Cron(`.

Every `@Cron` handler is an out-of-request entry point, so its body must seed its own RLS context (tasks C2-C4): the cross-user fan-out under `withSystemContext`, each per-user body under `withUserContext(userId)`. A handler that reaches the DB with no ambient context throws `DB access outside request/user/system context` in every `RLS_MODE`, including `off` -- the per-module `rls-context-smoke.spec.ts` specs are the pattern for proving a cron runs clean.
