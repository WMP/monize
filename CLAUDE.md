# Monize

Personal finance management app (Microsoft Money replacement). NestJS backend, Next.js frontend, PostgreSQL database, all running in Docker/Kubernetes

See `backend/CLAUDE.md`, `frontend/CLAUDE.md`, and `database/CLAUDE.md` for layer-specific details (commands, structure, conventions).

## Tech Stack

| Layer | Tech | Version |
|-------|------|---------|
| Backend | NestJS + TypeORM | 11.x, TS 5.9 |
| Frontend | Next.js (App Router) + React | 16.x, React 19 |
| Database | PostgreSQL | 16 |
| Styling | Tailwind CSS | 4.x |
| State | Zustand (frontend), class-validator DTOs (backend) |
| Forms | react-hook-form + Zod (frontend), class-validator (backend) |
| Auth | JWT + Passport + OIDC + TOTP 2FA |
| AI | Anthropic SDK, OpenAI SDK, Ollama (user-configurable) |
| Testing | Jest (backend), Vitest (frontend), Playwright (e2e) |

Everything runs in Docker: `docker compose -f docker-compose.dev.yml up`.

## Critical Rules

### Code Organization
- Many small files over few large files (200-400 lines typical, 800 max)
- Organize by feature/domain, not by type
- Always update `database/schema.sql` alongside any migration
- Always create tests for any new functionality added

### Shared AI tools (AI Assistant + MCP server)
- Every AI tool that reads or aggregates data must share its implementation between the AI Assistant (`backend/src/ai/query/tool-executor.service.ts`) and the MCP server (`backend/src/mcp/tools/*.tool.ts`).
- Put the shared logic on the relevant domain service (e.g., `PortfolioService.getLlmSummary`, `TransactionAnalyticsService.getTransfersByAccount`). The two tool layers become thin adapters that call it.
- Both surfaces must return the same data shape. The AI tool executor wraps it with `{ summary, sources }`; MCP just `toolResult(data)`s it.
- Adding a new AI tool means wiring it into both layers in the same PR -- never ship a tool to only one of the two.

### Code Style
- No emojis in code, comments, or documentation
- Immutability always -- never mutate objects or arrays
- No `console.log` in production code; use NestJS `Logger` class
- Use proxy, not middleware (middleware is deprecated in this project)

### Code Intelligence
Prefer LSP over Grep/Read for code navigation — it's faster, precise, and avoids reading entire files:
- `workspaceSymbol` to find where something is defined
- `findReferences` to see all usages across the codebase
- `goToDefinition` / `goToImplementation` to jump to source
- `hover` for type info without reading the file

Use Grep only when LSP isn't available or for text/pattern searches (comments, strings, config).

After writing or editing code, check LSP diagnostics and fix errors before proceeding.

### Security (Do Not Regress)
- Parameterized queries only (TypeORM QueryBuilder or parameterized raw SQL). Never interpolate user input into SQL strings
- All controllers use `@UseGuards(AuthGuard('jwt'))` at class level (except health + auth)
- All service methods derive `userId` from JWT (`req.user.id`), never from request params/body
- All path `:id` params use `ParseUUIDPipe`
- DTOs use `whitelist: true` + `forbidNonWhitelisted: true`, with `@MaxLength` on strings, `@Min`/`@Max` on numbers, `@IsUUID` on ID references, `@SanitizeHtml()` on user-facing text fields
- All user-controlled values in HTML email templates must use `escapeHtml()`
- API keys encrypted with AES-256-GCM before storage, never returned to client
- CSRF double-submit cookie pattern is global; use `@SkipCsrf()` only for non-cookie auth (e.g., PAT bearer)

## QueryRunner Transactions (CRITICAL)

Any operation that touches multiple tables or does read-modify-write MUST use a QueryRunner. This is the most common source of bugs in this codebase.

```typescript
async createSomething(userId: string, dto: CreateDto) {
  const queryRunner = this.dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
  try {
    // All DB operations use queryRunner.manager instead of this.repo
    const entity = queryRunner.manager.create(Entity, { ...dto, userId });
    await queryRunner.manager.save(entity);
    await this.updateBalance(accountId, amount, queryRunner);

    await queryRunner.commitTransaction();
    return entity;
  } catch (error) {
    await queryRunner.rollbackTransaction();
    throw error;
  } finally {
    await queryRunner.release();
  }
}
```

Operations that already use QueryRunner correctly: `create()` and `createTransfer()` in transactions, investment transaction CRUD, transfer CRUD, holdings rebuild.

Operations that still need it (see AUDIT_FINDINGS.md): `update()`, `remove()`, split operations, bulk updates.

## Financial Math

All money values are stored as `decimal(20,4)` in PostgreSQL. In JavaScript, always round to avoid floating-point drift:

```typescript
// WRONG: floating-point accumulation
const total = items.reduce((sum, item) => sum + item.amount, 0);

// RIGHT: integer arithmetic
const totalCents = items.reduce(
  (sum, item) => sum + Math.round(Number(item.amount) * 10000), 0
);
const total = totalCents / 10000;

// For simple rounding
const rounded = Math.round(value * 10000) / 10000;
```

Balance updates use atomic SQL: `UPDATE accounts SET current_balance = current_balance + $1 WHERE id = $2`.

## Environment

Key env vars (see `.env.example` for full list):
- `JWT_SECRET` -- minimum 32 chars, enforced at startup
- `AI_ENCRYPTION_KEY` -- minimum 32 chars, for API key encryption
- `DATABASE_*` -- PostgreSQL connection
- `DEMO_MODE=true` -- enables demo restrictions, daily reset at 4 AM UTC
- `LOCAL_AUTH_ENABLED` / `REGISTRATION_ENABLED` -- auth toggles
- `OIDC_*` -- OpenID Connect provider config
